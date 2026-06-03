import { test, expect } from "bun:test";
import { isDue, nextDelayMs, IDLE_RECHECK_MS, startScheduler, type SchedulerDeps } from "../src/pipeline/scheduler";

const MIN = 60_000;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

test("isDue: disabled (0/negative) is never due", () => {
  expect(isDue(MIN * 100, 0, 0)).toBe(false);
  expect(isDue(MIN * 100, 0, -5)).toBe(false);
});

test("isDue: due only once the interval has elapsed", () => {
  expect(isDue(5 * MIN - 1, 0, 5)).toBe(false);
  expect(isDue(5 * MIN, 0, 5)).toBe(true);
});

test("nextDelayMs: none enabled -> idle recheck", () => {
  expect(nextDelayMs(0, 0, 0, 0, 0)).toBe(IDLE_RECHECK_MS);
});

test("nextDelayMs: crawl only -> time until crawl due", () => {
  expect(nextDelayMs(0, 0, 5, 0, 0)).toBe(5 * MIN);
});

test("nextDelayMs: both enabled -> soonest", () => {
  expect(nextDelayMs(0, 0, 5, 0, 10)).toBe(5 * MIN);
});

test("nextDelayMs: overdue job clamps to a positive delay (no busy-spin)", () => {
  expect(nextDelayMs(100 * MIN, 0, 5, 0, 0)).toBe(1);
});

function makeDeps(over: Partial<SchedulerDeps> = {}) {
  let clock = 0;
  const calls = { crawls: 0, rescores: 0, timers: [] as Array<{ fn: () => void; ms: number }> };
  const deps: SchedulerDeps = {
    getConfig: async () => ({ pollIntervalMin: 5, rescoreIntervalMin: 0 }),
    runCrawl: async () => { calls.crawls++; },
    runRescore: async () => { calls.rescores++; },
    setTimer: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; },
    clearTimer: () => {},
    now: () => clock,
    log: { log() {} },
    ...over,
  };
  return { deps, calls, setClock: (n: number) => { clock = n; } };
}

test("startScheduler schedules the first cycle at the configured crawl interval", async () => {
  const { deps, calls } = makeDeps();
  startScheduler(deps);
  await flush();
  expect(calls.timers.length).toBe(1);
  expect(calls.timers[0]!.ms).toBe(5 * MIN);
  expect(calls.crawls).toBe(0);
});

test("firing the timer runs the crawl (when due) then reschedules", async () => {
  const { deps, calls, setClock } = makeDeps();
  startScheduler(deps);
  await flush();
  setClock(5 * MIN);
  await calls.timers[0]!.fn();
  await flush();
  expect(calls.crawls).toBe(1);
  expect(calls.rescores).toBe(0);
  expect(calls.timers.length).toBe(2);
});

test("rescore runs on its own cadence with crawl disabled", async () => {
  const { deps, calls, setClock } = makeDeps({ getConfig: async () => ({ pollIntervalMin: 0, rescoreIntervalMin: 10 }) });
  startScheduler(deps);
  await flush();
  expect(calls.timers[0]!.ms).toBe(10 * MIN);
  setClock(10 * MIN);
  await calls.timers[0]!.fn();
  await flush();
  expect(calls.rescores).toBe(1);
  expect(calls.crawls).toBe(0);
});

test("when both are due in one tick, crawl runs then rescore", async () => {
  const { deps, calls, setClock } = makeDeps({ getConfig: async () => ({ pollIntervalMin: 5, rescoreIntervalMin: 5 }) });
  startScheduler(deps);
  await flush();
  setClock(5 * MIN);
  await calls.timers[0]!.fn();
  await flush();
  expect(calls.crawls).toBe(1);
  expect(calls.rescores).toBe(1);
});

test("idle interval (both 0) schedules a recheck and runs nothing", async () => {
  const { deps, calls } = makeDeps({ getConfig: async () => ({ pollIntervalMin: 0, rescoreIntervalMin: 0 }) });
  startScheduler(deps);
  await flush();
  expect(calls.timers[0]!.ms).toBe(IDLE_RECHECK_MS);
  await calls.timers[0]!.fn();
  await flush();
  expect(calls.crawls).toBe(0);
  expect(calls.rescores).toBe(0);
});

test("stop() prevents further scheduling after the current cycle", async () => {
  const { deps, calls } = makeDeps();
  const stop = startScheduler(deps);
  await flush();
  stop();
  await calls.timers[0]!.fn();
  await flush();
  expect(calls.timers.length).toBe(1);
});
