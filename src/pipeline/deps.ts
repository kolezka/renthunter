import type { AppConfig } from "../config";
import type { CheckDeps } from "./check";
import type { RefreshDeps } from "./refresh";
import type { Logger } from "../log/logger";
import { withLogging, appLogger, createRunLogger } from "../log/logger";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
  getOfferByExternalId, acquireRunLock, releaseRunLock,
  getActiveScorableOffers, updateOfferScore,
} from "../db/queries";
import { fetchPage } from "../scraper/fetch";
import { resolveSource } from "../scraper/sources/registry";
import { scoreOffer } from "../scorer/deepseek";
import { sendNotification } from "../notify/apprise";
import { extractFeatures } from "../keywords/features";
import { embed } from "../embeddings/client";
import { runCheck } from "./check";
import { runRescore, type RescoreDeps } from "./rescore";
import { progressBus } from "./progress";
import { runRegistry } from "./runs";

// A run lease older than this is considered stale and may be reclaimed.
// Must exceed the longest possible run (trigger maxDuration=300s).
const RUN_LOCK_STALE_MS = 15 * 60 * 1000;

/** Bind the browserless config (if any) into a fetchPage closure matching the
 *  injected (url) => Promise<string> shape. Empty url → direct fetch. */
function makeFetchPage(env: AppConfig, signal?: AbortSignal) {
  const browserless = env.browserless.url ? env.browserless : undefined;
  return (url: string) => fetchPage(url, { browserless, signal });
}

/** Compose the logged CheckDeps used by runCheck (trigger task + manual run).
 *  When `run` is given (real guarded runs), wires runId/signal/emitProgress
 *  and binds the signal into the fetchPage closure so cancellation reaches
 *  in-flight fetches. */
export function buildCheckDeps(
  env: AppConfig,
  logger: Logger,
  run?: { runId: string; signal: AbortSignal },
): CheckDeps {
  return withLogging(
    {
      getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
      fetchPage: makeFetchPage(env, run?.signal), resolveSource, scoreOffer, sendNotification,
      appriseUrl: env.appriseUrl,
      deepseekApiKey: env.deepseekApiKey,
      deepseekBaseUrl: env.deepseekBaseUrl,
      deepseekModel: env.scorerModel,
      extractFeatures, embed,
      embedBaseUrl: env.embedBaseUrl, embedApiKey: env.embedApiKey, embedModel: env.embedModel,
      log: logger,
      runId: run?.runId,
      signal: run?.signal,
      emitProgress: run ? (e) => progressBus.emit(e) : undefined,
    },
    logger,
  );
}

/** Compose deps for the single-offer refresh path. */
export function buildRefreshDeps(env: AppConfig, logger: Logger): RefreshDeps {
  return {
    getConfig,
    getOffer: getOfferByExternalId,
    fetchPage: makeFetchPage(env),
    resolveSource,
    scoreOffer,
    upsertOffer,
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
    deepseekModel: env.scorerModel,
    extractFeatures, embed,
    embedBaseUrl: env.embedBaseUrl, embedApiKey: env.embedApiKey, embedModel: env.embedModel,
    log: logger,
  };
}

/**
 * Acquire the cross-process run lock and run the crawl in-process under the given
 * source ("manual" | "scheduled"). Fire-and-forget: returns the runId and a `done`
 * promise immediately; releases the lock when the run settles. `{ busy: true }`
 * when another run already holds the lock.
 */
export async function runCrawlGuarded(
  env: AppConfig,
  source: string,
): Promise<{ runId: string; done: Promise<void> } | { busy: true }> {
  const runId = crypto.randomUUID();
  const acquired = await acquireRunLock(runId, source, RUN_LOCK_STALE_MS);
  if (!acquired) return { busy: true };
  const controller = new AbortController();
  runRegistry.register({ runId, kind: "crawl", source, controller });
  const logger = createRunLogger(appLogger, runId);
  const done = runCheck(buildCheckDeps(env, logger, { runId, signal: controller.signal }))
    .then(() => {})
    .catch((err) => { console.error(`${source} runCheck failed:`, err); })
    .finally(() => { runRegistry.finish(runId); return releaseRunLock(runId); });
  return { runId, done };
}

/** Compose deps for the re-score path. emitProgress goes to the in-process bus
 *  (relayed to WebSocket clients by the server). */
export function buildRescoreDeps(
  env: AppConfig,
  logger: Logger,
  runId: string,
  signal?: AbortSignal,
): RescoreDeps {
  return {
    runId,
    getConfig,
    getActiveScorableOffers,
    scoreOffer,
    updateOfferScore,
    sendNotification,
    appriseUrl: env.appriseUrl,
    markNotified,
    notifyOnQualify: true,
    emitProgress: (e) => progressBus.emit(e),
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
    deepseekModel: env.scorerModel,
    signal,
    log: logger,
  };
}

/**
 * Acquire the cross-process run lock (source "rescore") and run a re-score in
 * the background. Returns { disabled } without touching the lock when DeepSeek
 * is off, { busy } when another run holds the lock, else { runId, done }.
 */
export async function runRescoreGuarded(
  env: AppConfig,
): Promise<{ runId: string; done: Promise<void> } | { busy: true } | { disabled: true }> {
  const cfg = await getConfig();
  if (!cfg.deepseekEnabled) return { disabled: true };

  const runId = crypto.randomUUID();
  const acquired = await acquireRunLock(runId, "rescore", RUN_LOCK_STALE_MS);
  if (!acquired) return { busy: true };
  const controller = new AbortController();
  runRegistry.register({ runId, kind: "rescore", source: "rescore", controller });
  const logger = createRunLogger(appLogger, runId);
  const done = runRescore(buildRescoreDeps(env, logger, runId, controller.signal))
    .then(() => {})
    .catch((err) => { console.error("rescore failed:", err); })
    .finally(() => { runRegistry.finish(runId); return releaseRunLock(runId); });
  return { runId, done };
}
