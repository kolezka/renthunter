import { schedules, logger as triggerLogger } from "@trigger.dev/sdk";
import { runCheck } from "../src/pipeline/check";
import { loadConfig } from "../src/config";
import { pruneLogs } from "../src/db/queries";
import { dbLogger, createRunLogger } from "../src/log/logger";
import { buildCheckDeps } from "../src/pipeline/deps";

export const checkOffers = schedules.task({
  id: "check-offers",
  cron: "*/5 * * * *",
  // More CPU headroom for the in-process concurrency pool (config.concurrencyLimit).
  // Machine is an infra property — it can't be DB-driven, so it lives here.
  machine: "small-2x",
  run: async () => {
    const env = loadConfig();
    const runId = crypto.randomUUID();
    const logger = createRunLogger(dbLogger, runId);
    const deps = buildCheckDeps(env, logger);

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
      await pruneLogs().catch((err) => console.error("pruneLogs failed:", err));
    }
  },
});
