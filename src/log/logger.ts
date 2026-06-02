import { appendLog } from "../db/queries";

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
