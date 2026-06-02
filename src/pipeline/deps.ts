import type { AppConfig } from "../config";
import type { CheckDeps } from "./check";
import type { RefreshDeps } from "./refresh";
import type { Logger } from "../log/logger";
import { withLogging } from "../log/logger";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
  getOfferByExternalId,
} from "../db/queries";
import { fetchPage } from "../scraper/fetch";
import { parseListUrls, parseDetail } from "../scraper/parse";
import { scoreOffer } from "../scorer/deepseek";
import { sendNotification } from "../notify/apprise";

/** Compose the logged CheckDeps used by runCheck (trigger task + manual run). */
export function buildCheckDeps(env: AppConfig, logger: Logger): CheckDeps {
  return withLogging(
    {
      getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
      fetchPage, parseListUrls, parseDetail, scoreOffer, sendNotification,
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
    parseDetail,
    scoreOffer,
    upsertOffer,
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
    log: logger,
  };
}
