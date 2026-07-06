import { test, expect } from "bun:test";
import type { LogEntry } from "../web/lib/api";
import {
  mergeEntries, filterEntries, summarizeContext, distinctEvents, distinctRuns, BUFFER_CAP,
} from "../web/lib/logs";

const entry = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({
  id, ts: `2026-07-06T00:00:${String(id % 60).padStart(2, "0")}.000Z`,
  runId: null, level: "info", event: "fetch", message: `msg ${id}`, context: null,
  ...over,
});

test("mergeEntries dedups by id and keeps ascending order regardless of arrival order", () => {
  const buf = mergeEntries([], [entry(5), entry(6)]);       // stream arrives first
  const merged = mergeEntries(buf, [entry(3), entry(4), entry(5)]); // backlog second
  expect(merged.map((e) => e.id)).toEqual([3, 4, 5, 6]);
});

test("mergeEntries drops oldest entries past the cap", () => {
  const big = Array.from({ length: BUFFER_CAP }, (_, i) => entry(i + 1));
  const merged = mergeEntries(big, [entry(BUFFER_CAP + 1)]);
  expect(merged.length).toBe(BUFFER_CAP);
  expect(merged[0]!.id).toBe(2);
  expect(merged[merged.length - 1]!.id).toBe(BUFFER_CAP + 1);
});

test("mergeEntries returns the same array when nothing new arrived", () => {
  const buf = mergeEntries([], [entry(1)]);
  expect(mergeEntries(buf, [entry(1)])).toBe(buf);
});

test("filterEntries combines level, event, run and text dimensions", () => {
  const list = [
    entry(1, { level: "error", event: "offer.error", runId: "run-a", message: "boom" }),
    entry(2, { level: "info", event: "fetch", runId: "run-b", message: "ok" }),
  ];
  expect(filterEntries(list, { level: "error", event: "all", runId: "all", search: "" }).map((e) => e.id)).toEqual([1]);
  expect(filterEntries(list, { level: "all", event: "fetch", runId: "all", search: "" }).map((e) => e.id)).toEqual([2]);
  expect(filterEntries(list, { level: "all", event: "all", runId: "run-a", search: "" }).map((e) => e.id)).toEqual([1]);
  expect(filterEntries(list, { level: "all", event: "all", runId: "all", search: "BOOM" }).map((e) => e.id)).toEqual([1]);
});

test("filterEntries search also matches event names and context payloads", () => {
  const list = [
    entry(1, { event: "scheduler.skipped" }),
    entry(2, { context: { url: "https://ogloszenia.trojmiasto.pl/x" } }),
  ];
  expect(filterEntries(list, { level: "all", event: "all", runId: "all", search: "scheduler" }).map((e) => e.id)).toEqual([1]);
  expect(filterEntries(list, { level: "all", event: "all", runId: "all", search: "trojmiasto" }).map((e) => e.id)).toEqual([2]);
});

test("summarizeContext prefers error-ish keys and truncates", () => {
  const s = summarizeContext({ durationMs: 1200, error: "ECONNRESET", status: 502 });
  expect(s.startsWith("error=ECONNRESET")).toBe(true);
  expect(s).toContain("status=502");
  const long = summarizeContext({ error: "x".repeat(500) });
  expect(long.length).toBeLessThanOrEqual(140);
  expect(long.endsWith("…")).toBe(true);
});

test("summarizeContext handles non-object and empty contexts", () => {
  expect(summarizeContext(null)).toBe("");
  expect(summarizeContext(undefined)).toBe("");
  expect(summarizeContext("plain failure")).toBe("plain failure");
  expect(summarizeContext({})).toBe("");
});

test("distinctEvents returns sorted unique names", () => {
  const list = [entry(1, { event: "score" }), entry(2, { event: "fetch" }), entry(3, { event: "score" })];
  expect(distinctEvents(list)).toEqual(["fetch", "score"]);
});

test("distinctRuns is newest-first with short labels", () => {
  const list = [
    entry(1, { runId: "aaaaaaaa-1111", ts: "2026-07-06T08:00:00.000Z" }),
    entry(2, { runId: "bbbbbbbb-2222", ts: "2026-07-06T09:30:00.000Z" }),
    entry(3, { runId: "aaaaaaaa-1111", ts: "2026-07-06T08:05:00.000Z" }),
  ];
  const runs = distinctRuns(list);
  expect(runs.map((r) => r.id)).toEqual(["bbbbbbbb-2222", "aaaaaaaa-1111"]);
  expect(runs[1]!.label.startsWith("aaaaaaaa")).toBe(true);
});
