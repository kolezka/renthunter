import { schedules, logger } from "@trigger.dev/sdk";
import { runCheck } from "../src/pipeline/check";
import { loadConfig } from "../src/config";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
} from "../src/db/queries";
import { fetchPage } from "../src/scraper/fetch";
import { parseListUrls, parseDetail } from "../src/scraper/parse";
import { scoreOffer } from "../src/scorer/deepseek";
import { sendNotification } from "../src/notify/apprise";

// Static 5-minute cron. config.pollIntervalMin is informational for now;
// dynamic schedules land once trigger.dev is self-hosted (see spec).
export const checkOffers = schedules.task({
  id: "check-offers",
  cron: "*/5 * * * *",
  run: async () => {
    const env = loadConfig();
    const summary = await runCheck({
      getConfig,
      getKnownExternalIds,
      upsertOffer,
      markNotified,
      markInactive,
      fetchPage,
      parseListUrls,
      parseDetail,
      scoreOffer,
      sendNotification,
      appriseUrl: env.appriseUrl,
      deepseekApiKey: env.deepseekApiKey,
      deepseekBaseUrl: env.deepseekBaseUrl,
    });
    logger.info("check-offers done", {
      listedCount: summary.listedCount,
      newCount: summary.newCount,
      notifiedCount: summary.notifiedCount,
      errorCount: summary.errorCount,
    });
    return summary;
  },
});
