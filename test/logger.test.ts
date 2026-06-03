import { test, expect } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger, LogInput } from "../src/log/logger";
import { nullLogger, createRunLogger, withLogging, formatLogLine, createFileLogger, combineLoggers } from "../src/log/logger";
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

test("formatLogLine renders ts, level, event, runId, message and context", () => {
  const line = formatLogLine(
    { level: "info", event: "run.finish", message: "done", context: { n: 1 }, runId: "r1" },
    new Date("2026-06-03T14:29:53.805Z"),
  );
  expect(line).toBe('2026-06-03T14:29:53.805Z INFO  run.finish [r1] done {"n":1}\n');
});

test("createFileLogger appends entries to a daily file under the given dir", async () => {
  const dir = join(tmpdir(), `rh-log-${Date.now()}`);
  try {
    const logger = createFileLogger(dir);
    await logger.log({ level: "info", event: "a", message: "first" });
    await logger.log({ level: "error", event: "b", message: "second", context: { x: 2 } });
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const file = join(dir, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
    const text = await readFile(file, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("INFO  a first");
    expect(lines[1]).toContain('ERROR b second {"x":2}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createFileLogger never throws on an unwritable path", async () => {
  // A path whose parent is a NUL byte can't be created; log() must swallow it.
  const logger = createFileLogger("\0/definitely/invalid");
  await expect(logger.log({ level: "info", event: "x", message: "y" })).resolves.toBeUndefined();
});

test("combineLoggers fans out to every sink and isolates a throwing one", async () => {
  const a = recordingLogger();
  const c = recordingLogger();
  const throwing: Logger = { log() { throw new Error("boom"); } };
  const combined = combineLoggers(a.logger, throwing, c.logger);
  await combined.log({ level: "info", event: "e", message: "m" });
  expect(a.entries.length).toBe(1);
  expect(c.entries.length).toBe(1); // sink after the throwing one still ran
});

function fakeDeps(over: Partial<CheckDeps> = {}): CheckDeps {
  return {
    getConfig: async () => ({}) as any,
    getKnownExternalIds: async () => new Set<string>(),
    upsertOffer: async () => {},
    markNotified: async () => {},
    markInactive: async () => {},
    fetchPage: async () => "<html>",
    resolveSource: () => null,
    scoreOffer: async () => ({ score: 1, reasons: "ok" }),
    sendNotification: async () => {},
    appriseUrl: "http://apprise",
    deepseekApiKey: "k",
    deepseekBaseUrl: "https://api.deepseek.com",
    extractFeatures: async () => [],
    embed: async () => [0, 0],
    embedBaseUrl: "https://embed.example",
    embedApiKey: "",
    embedModel: "m",
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
