import { test, expect } from "bun:test";
import type { Logger, LogInput } from "../src/log/logger";
import { nullLogger, createRunLogger } from "../src/log/logger";

function recordingLogger(): { logger: Logger; entries: LogInput[] } {
  const entries: LogInput[] = [];
  return { logger: { log: (e) => { entries.push(e); } }, entries };
}

test("nullLogger.log is a no-op and does not throw", () => {
  expect(() => nullLogger.log({ level: "info", event: "x", message: "y" })).not.toThrow();
});

test("createRunLogger stamps runId on every entry", async () => {
  const { logger, entries } = recordingLogger();
  const run = createRunLogger(logger, "run-123");
  await run.log({ level: "info", event: "run.start", message: "go" });
  await run.log({ level: "error", event: "fetch", message: "boom", context: { url: "u" } });
  expect(entries.length).toBe(2);
  expect(entries[0]!.runId).toBe("run-123");
  expect(entries[1]!.runId).toBe("run-123");
  expect(entries[1]!.context).toEqual({ url: "u" });
});
