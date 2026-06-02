import { schedules, logger as triggerLogger } from "@trigger.dev/sdk";
import { runCheck } from "../src/pipeline/check";
import { loadConfig } from "../src/config";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive, pruneLogs,
} from "../src/db/queries";
import { fetchPage } from "../src/scraper/fetch";
import { parseListUrls, parseDetail } from "../src/scraper/parse";
import { scoreOffer } from "../src/scorer/deepseek";
import { sendNotification } from "../src/notify/apprise";
import { dbLogger, createRunLogger, withLogging } from "../src/log/logger";

// Static 5-minute cron. config.pollIntervalMin is informational for now;
// dynamic schedules land once trigger.dev is self-hosted (see spec).
export const checkOffers = schedules.task({
  id: "check-offers",
  cron: "*/5 * * * *",
  run: async () => {
    const env = loadConfig();
    const runId = crypto.randomUUID();
    const logger = createRunLogger(dbLogger, runId);

    const deps = withLogging(
      {
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
        log: logger,
      },
      logger,
    );

    try {
      const summary = await runCheck(deps);
      triggerLogger.info("check-offers done", {
        listedCount: summary.listedCount,
        newCount: summary.newCount,
        notifiedCount: summary.notifiedCount,
        errorCount: summary.errorCount,
      });
      return summary;
    } finally {
      // Retention: drop entries older than 7 days, once per run.
      await pruneLogs();
    }
  },
});
