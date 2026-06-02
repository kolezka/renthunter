import { test, expect } from "bun:test";
import type { Logger, LogInput } from "../src/log/logger";
import { nullLogger, createRunLogger, withLogging } from "../src/log/logger";
import type { CheckDeps } from "../src/pipeline/check";

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

function fakeDeps(over: Partial<CheckDeps> = {}): CheckDeps {
  return {
    getConfig: async () => ({}) as any,
    getKnownExternalIds: async () => new Set<string>(),
    upsertOffer: async () => {},
    markNotified: async () => {},
    markInactive: async () => {},
    fetchPage: async () => "<html>",
    parseListUrls: () => [],
    parseDetail: () => ({}) as any,
    scoreOffer: async () => ({ score: 1, reasons: "ok" }),
    sendNotification: async () => {},
    appriseUrl: "http://apprise",
    deepseekApiKey: "k",
    deepseekBaseUrl: "https://api.deepseek.com",
    log: nullLogger,
    ...over,
  };
}

test("withLogging logs a fetch event on success", async () => {
  const { logger, entries } = recordingLogger();
  const deps = withLogging(fakeDeps(), logger);
  await deps.fetchPage("https://example.com");
  const e = entries.find((x) => x.event === "fetch");
  expect(e).toBeDefined();
  expect(e!.level).toBe("info");
  expect((e!.context as any).url).toBe("https://example.com");
});

test("withLogging logs an error-level fetch event and rethrows on failure", async () => {
  const { logger, entries } = recordingLogger();
  const deps = withLogging(fakeDeps({ fetchPage: async () => { throw new Error("down"); } }), logger);
  await expect(deps.fetchPage("https://x")).rejects.toThrow("down");
  const e = entries.find((x) => x.event === "fetch");
  expect(e!.level).toBe("error");
  expect((e!.context as any).error).toContain("down");
});

test("withLogging logs score and notify events", async () => {
  const { logger, entries } = recordingLogger();
  const deps = withLogging(fakeDeps(), logger);
  await deps.scoreOffer({ description: "d", criteria: "c" }, { apiKey: "k", baseUrl: "b" });
  await deps.sendNotification({ appriseUrl: "a", targets: [], title: "hi", body: "b" });
  expect(entries.find((x) => x.event === "score")).toBeDefined();
  expect(entries.find((x) => x.event === "notify")).toBeDefined();
});

test("withLogging sets deps.log to the provided logger", () => {
  const { logger } = recordingLogger();
  const deps = withLogging(fakeDeps(), logger);
  expect(deps.log).toBe(logger);
});
