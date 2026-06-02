import type { AppConfig } from "../config";
import type { CheckDeps } from "./check";
import type { RefreshDeps } from "./refresh";
import type { Logger } from "../log/logger";
import { withLogging, dbLogger, createRunLogger } from "../log/logger";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
  getOfferByExternalId, acquireRunLock, releaseRunLock,
  getActiveScorableOffers, updateOfferScore,
} from "../db/queries";
import { fetchPage } from "../scraper/fetch";
import { resolveSource } from "../scraper/sources/registry";
import { scoreOffer } from "../scorer/deepseek";
import { sendNotification } from "../notify/apprise";
import { runCheck } from "./check";
import { runRescore, type RescoreDeps } from "./rescore";
import { progressBus } from "./progress";
import { RUN_LOCK_STALE_MS } from "./run-lock";

/** Compose the logged CheckDeps used by runCheck (trigger task + manual run). */
export function buildCheckDeps(env: AppConfig, logger: Logger): CheckDeps {
  return withLogging(
    {
      getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
      fetchPage, resolveSource, scoreOffer, sendNotification,
      appriseUrl: env.appriseUrl,
      deepseekApiKey: env.deepseekApiKey,
      deepseekBaseUrl: env.deepseekBaseUrl,
      log: logger,
    },
    logger,
  );
}

/** Compose deps for the single-offer refresh path. */
export function buildRefreshDeps(env: AppConfig, logger: Logger): RefreshDeps {
  return {
    getConfig,
    getOffer: getOfferByExternalId,
    fetchPage,
    resolveSource,
    scoreOffer,
    upsertOffer,
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
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
  const logger = createRunLogger(dbLogger, runId);
  const done = runCheck(buildCheckDeps(env, logger))
    .then(() => {})
    .catch((err) => { console.error(`${source} runCheck failed:`, err); })
    .finally(() => releaseRunLock(runId));
  return { runId, done };
}

/** Compose deps for the re-score path. emitProgress goes to the in-process bus
 *  (relayed to WebSocket clients by the server). */
export function buildRescoreDeps(env: AppConfig, logger: Logger, runId: string): RescoreDeps {
  return {
    runId,
    getConfig,
    getActiveScorableOffers,
    scoreOffer,
    updateOfferScore,
    emitProgress: (e) => progressBus.emit(e),
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
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
  const logger = createRunLogger(dbLogger, runId);
  const done = runRescore(buildRescoreDeps(env, logger, runId))
    .then(() => {})
    .catch((err) => { console.error("rescore failed:", err); })
    .finally(() => releaseRunLock(runId));
  return { runId, done };
}
