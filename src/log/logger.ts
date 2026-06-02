import { appendLog } from "../db/queries";
import type { CheckDeps } from "../pipeline/check";

export type LogLevel = "info" | "warn" | "error";

export interface LogInput {
  level: LogLevel;
  event: string;
  message: string;
  context?: unknown;
  runId?: string | null;
}

export interface Logger {
  log(input: LogInput): void | Promise<void>;
}

/** Persists to the `logs` table. Never throws — a failed log write must not
 *  break a check run. */
export const dbLogger: Logger = {
  async log(input) {
    try {
      await appendLog(input);
    } catch (err) {
      console.error("dbLogger: failed to persist log entry:", err);
    }
  },
};

/** Discards everything. Used as the default in tests and any run without a sink. */
export const nullLogger: Logger = { log() {} };

/** Wraps a base logger so every entry carries the same `runId`. */
export function createRunLogger(base: Logger, runId: string): Logger {
  return { log: (input) => base.log({ ...input, runId }) };
}

/** Decorates the external-call deps so each call emits a log event (with
 *  duration) on success and an error event on failure, then sets `deps.log`
 *  to the same logger. Used at the composition root. */
export function withLogging(deps: CheckDeps, logger: Logger): CheckDeps {
  return {
    ...deps,
    log: logger,
    fetchPage: async (url) => {
      const start = Date.now();
      try {
        const html = await deps.fetchPage(url);
        await logger.log({ level: "info", event: "fetch", message: `fetched ${url}`, context: { url, durationMs: Date.now() - start } });
        return html;
      } catch (err) {
        await logger.log({ level: "error", event: "fetch", message: `fetch failed: ${url}`, context: { url, error: String(err), durationMs: Date.now() - start } });
        throw err;
      }
    },
    scoreOffer: async (input, opts) => {
      const start = Date.now();
      try {
        const r = await deps.scoreOffer(input, opts);
        await logger.log({ level: "info", event: "score", message: `scored ${r.score}`, context: { score: r.score, durationMs: Date.now() - start } });
        return r;
      } catch (err) {
        await logger.log({ level: "error", event: "score", message: "scoring failed", context: { error: String(err), durationMs: Date.now() - start } });
        throw err;
      }
    },
    sendNotification: async (input) => {
      const start = Date.now();
      try {
        await deps.sendNotification(input);
        await logger.log({ level: "info", event: "notify", message: `notified: ${input.title}`, context: { title: input.title, durationMs: Date.now() - start } });
      } catch (err) {
        await logger.log({ level: "error", event: "notify", message: "notification failed", context: { title: input.title, error: String(err), durationMs: Date.now() - start } });
        throw err;
      }
    },
  };
}
