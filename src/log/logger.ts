import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** Render one entry as a single human-readable, greppable line (trailing \n). */
export function formatLogLine(input: LogInput, now: Date): string {
  const run = input.runId ? ` [${input.runId}]` : "";
  const ctx = input.context !== undefined ? ` ${safeJson(input.context)}` : "";
  return `${now.toISOString()} ${input.level.toUpperCase().padEnd(5)} ${input.event}${run} ${input.message}${ctx}\n`;
}

/** Local YYYY-MM-DD, used for the daily log filename. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Append every entry to a daily file under `dir` (default `$LOG_DIR` or `logs/`),
 * one line per entry, rotating by local date (`logs/2026-06-03.log`). Mirrors
 * dbLogger's contract: never throws — a failed file write must not break a run.
 */
export function createFileLogger(dir = process.env.LOG_DIR || "logs"): Logger {
  let dirReady: Promise<unknown> | null = null;
  return {
    async log(input) {
      try {
        if (!dirReady) dirReady = mkdir(dir, { recursive: true });
        await dirReady;
        const now = new Date();
        await appendFile(join(dir, `${localDay(now)}.log`), formatLogLine(input, now));
      } catch (err) {
        console.error("fileLogger: failed to write log entry:", err);
      }
    },
  };
}

/** Default file sink, writing to `$LOG_DIR` (or `logs/`). */
export const fileLogger: Logger = createFileLogger();

/** Fan out each entry to every sink. Awaits all; a throwing sink can't stop the
 *  others or surface (each is isolated), matching the never-throw log contract. */
export function combineLoggers(...loggers: Logger[]): Logger {
  return {
    async log(input) {
      await Promise.all(
        loggers.map(async (l) => {
          try { await l.log(input); } catch (err) { console.error("combineLoggers: sink failed:", err); }
        }),
      );
    },
  };
}

/** Composition-root sink: persist to the DB `logs` table AND the `logs/` folder. */
export const appLogger: Logger = combineLoggers(dbLogger, fileLogger);

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
