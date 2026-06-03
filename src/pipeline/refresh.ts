import type { Config, NewOffer, Offer } from "../db/schema";
import type { Source } from "../scraper/sources/types";
import { maybeScore } from "./check";
import type { Logger } from "../log/logger";
import { enrichOffer, type EnrichDeps } from "./enrich";

export interface RefreshDeps extends EnrichDeps {
  getConfig: () => Promise<Config>;
  getOffer: (externalId: string) => Promise<Offer | null>;
  fetchPage: (url: string) => Promise<string>;
  resolveSource: (url: string) => Source | null;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  upsertOffer: (o: NewOffer) => Promise<void>;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
}

/** Re-fetch one offer's detail page, re-score it, persist, and return the
 *  refreshed row. Throws "offer not found" if the externalId is unknown. */
export async function refreshOffer(externalId: string, deps: RefreshDeps): Promise<Offer> {
  const existing = await deps.getOffer(externalId);
  if (!existing) throw new Error("offer not found");

  const config = await deps.getConfig();
  const html = await deps.fetchPage(existing.url);
  const src = deps.resolveSource(existing.url);
  if (!src) throw new Error(`no parser for ${existing.url}`);
  const d = src.parseDetail(html);
  const { score, reasons } = await maybeScore(d, config, deps);
  const enriched = await enrichOffer(d, config, deps, existing.embedTextHash ?? null);

  const row: NewOffer = {
    externalId,
    url: existing.url,
    source: existing.source,
    title: d.title,
    price: d.price,
    area: d.area,
    rooms: d.rooms,
    district: d.district,
    description: d.description,
    images: d.images,
    ...enriched,
    score,
    scoreReasons: reasons,
  };
  await deps.upsertOffer(row);
  await deps.log.log({
    level: "info",
    event: "offer.refresh",
    message: `refreshed offer ${externalId}`,
    context: { externalId, score },
  });

  const refetched = await deps.getOffer(externalId);
  // Merge the freshly scraped data on top of whatever getOffer returns (which
  // may be a stale/sparse row in tests, or the live DB row in production).
  return { ...existing, ...refetched, ...row, score, scoreReasons: reasons } as Offer;
}
