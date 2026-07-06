import type { Config, Offer } from "../db/schema";
import type { Logger } from "../log/logger";
import { resolveBaseUrl } from "../config";
import type { RescoreEvent, RescoreSummary } from "./progress";
import { runPool } from "./pool";
import { buildOfferNotification } from "../notify/message";

export interface RescoreDeps {
  runId: string;
  getConfig: () => Promise<Config>;
  getActiveScorableOffers: () => Promise<Offer[]>;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string; model?: string; language?: string },
  ) => Promise<{ score: number; reasons: string }>;
  updateOfferScore: (externalId: string, score: number | null, reasons: string | null) => Promise<void>;
  sendNotification: (input: { appriseUrl: string; targets: string[]; title: string; body: string }) => Promise<void>;
  appriseUrl: string;
  markNotified: (externalId: string) => Promise<void>;
  notifyOnQualify: boolean;
  emitProgress?: (e: RescoreEvent) => void;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel?: string;
  /** Cooperative cancellation: checked before each offer. */
  signal?: AbortSignal;
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
    if (deps.signal?.aborted) return;
    try {
      const { score, reasons } = await deps.scoreOffer(
        { description: offer.description ?? "", criteria: config.aiCriteria },
        { apiKey: deps.deepseekApiKey, baseUrl: resolveBaseUrl(config.aiBaseUrl, deps.deepseekBaseUrl), model: config.scorerModel || deps.deepseekModel, language: config.outputLanguage },
      );
      await deps.updateOfferScore(offer.externalId, score, reasons);
      if (deps.notifyOnQualify && score >= config.scoreThreshold && !offer.notified) {
        try {
          const { title, body } = buildOfferNotification({
            title: offer.title, price: offer.price, area: offer.area, rooms: offer.rooms,
            district: offer.district, url: offer.url, reasons,
          });
          await deps.sendNotification({ appriseUrl: deps.appriseUrl, targets: config.appriseUrls, title, body });
          await deps.markNotified(offer.externalId);
        } catch (err) {
          await deps.log.log({
            level: "error", event: "notify",
            message: "rescore notification failed",
            context: { externalId: offer.externalId, error: String(err) },
          });
        }
      }
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
  if (deps.signal?.aborted) {
    await deps.log.log({
      level: "info",
      event: "rescore.cancelled",
      message: `rescore cancelled: ${scored} scored, ${errors} errors`,
      context: summary,
    });
  } else {
    await deps.log.log({
      level: "info",
      event: "rescore.finish",
      message: `rescore finished: ${scored} scored, ${errors} errors`,
      context: summary,
    });
  }
  deps.emitProgress?.({ type: "rescore:done", runId: deps.runId, summary });
  return summary;
}
