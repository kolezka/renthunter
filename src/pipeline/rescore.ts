import type { Config, Offer } from "../db/schema";
import type { Logger } from "../log/logger";
import type { RescoreEvent, RescoreSummary } from "./progress";
import { runPool } from "./pool";

export interface RescoreDeps {
  runId: string;
  getConfig: () => Promise<Config>;
  getActiveScorableOffers: () => Promise<Offer[]>;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  updateOfferScore: (externalId: string, score: number | null, reasons: string | null) => Promise<void>;
  emitProgress?: (e: RescoreEvent) => void;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  log: Logger;
}

/** Re-score every active offer against the current AI criteria, reusing each
 *  offer's stored description (no scraping, no notifications). No-op when
 *  DeepSeek is disabled — re-scoring then would null out every score. */
export async function runRescore(deps: RescoreDeps): Promise<RescoreSummary> {
  const config = await deps.getConfig();
  if (!config.deepseekEnabled) {
    await deps.log.log({ level: "warn", event: "rescore.skip", message: "rescore skipped: deepseek disabled" });
    return { scored: 0, errors: 0 };
  }

  const offers = await deps.getActiveScorableOffers();
  await deps.log.log({ level: "info", event: "rescore.start", message: `rescore started: ${offers.length} offers` });
  deps.emitProgress?.({ type: "rescore:start", runId: deps.runId, total: offers.length });

  let scored = 0;
  let errors = 0;
  await runPool(offers, config.concurrencyLimit, async (offer) => {
    try {
      const { score, reasons } = await deps.scoreOffer(
        { description: offer.description ?? "", criteria: config.aiCriteria },
        { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
      );
      await deps.updateOfferScore(offer.externalId, score, reasons);
      deps.emitProgress?.({ type: "rescore:scored", externalId: offer.externalId, score, reasons });
      scored++;
    } catch (err) {
      errors++;
      await deps.log.log({
        level: "error",
        event: "offer.error",
        message: `failed rescoring offer ${offer.externalId}`,
        context: { externalId: offer.externalId, error: String(err) },
      });
    }
  });

  const summary: RescoreSummary = { scored, errors };
  await deps.log.log({
    level: "info",
    event: "rescore.finish",
    message: `rescore finished: ${scored} scored, ${errors} errors`,
    context: summary,
  });
  deps.emitProgress?.({ type: "rescore:done", runId: deps.runId, summary });
  return summary;
}
