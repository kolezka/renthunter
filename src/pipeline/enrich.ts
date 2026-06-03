import type { Config, NewOffer } from "../db/schema";
import type { OfferDetail } from "../scraper/sources/types";
import type { Logger } from "../log/logger";
import { extractKeywords } from "../keywords/gazetteer";
import { buildEmbedText, embedTextHash } from "../embeddings/embedText";

export interface EnrichDeps {
  extractFeatures: (i: { title: string; description: string }, o: { apiKey: string; baseUrl: string; language?: string }) => Promise<string[]>;
  embed: (text: string, o: { baseUrl: string; apiKey: string; model: string }) => Promise<number[]>;
  deepseekApiKey: string; deepseekBaseUrl: string;
  embedBaseUrl: string; embedApiKey: string; embedModel: string;
  log: Logger;
}

export type EnrichFields = Pick<NewOffer,
  "districtCanonical" | "kind" | "features" | "embedding" | "embedTextHash">;

/** Derive gazetteer keyword fields, AI features, and an embedding for a detail.
 *  Extraction/embedding failures are logged and degrade to null/[] — never throw.
 *  Pass `prevEmbedTextHash` (the hash stored on the existing offer row) to skip
 *  re-embedding when the embed text is unchanged; `embedding` will be null so
 *  upsertOffer preserves the existing vector. */
export async function enrichOffer(
  d: OfferDetail,
  config: Pick<Config, "extractEnabled" | "embedEnabled" | "outputLanguage">,
  deps: EnrichDeps,
  prevEmbedTextHash: string | null = null,
): Promise<EnrichFields> {
  const { districtCanonical, kind } = extractKeywords({ district: d.district, title: d.title });

  let features: string[] = [];
  if (config.extractEnabled && deps.deepseekApiKey) {
    try {
      features = await deps.extractFeatures(
        { title: d.title, description: d.description },
        { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl, language: config.outputLanguage },
      );
    } catch (err) {
      await deps.log.log({ level: "warn", event: "enrich.features.error", message: String(err) });
    }
  }

  let embedding: number[] | null = null;
  let hash: string | null = null;
  if (config.embedEnabled && deps.embedApiKey) {
    const text = buildEmbedText({ title: d.title, districtCanonical, kind, features, description: d.description });
    hash = embedTextHash(text);
    if (prevEmbedTextHash && prevEmbedTextHash === hash) {
      // unchanged text — skip re-embedding; null embedding makes upsert preserve the existing vector
      embedding = null;
    } else {
      try {
        embedding = await deps.embed(text, { baseUrl: deps.embedBaseUrl, apiKey: deps.embedApiKey, model: deps.embedModel });
      } catch (err) {
        embedding = null;
        await deps.log.log({ level: "warn", event: "enrich.embed.error", message: String(err) });
      }
    }
  }

  return { districtCanonical, kind, features, embedding, embedTextHash: hash };
}
