import { test, expect } from "bun:test";
import { nextDelayMs, IDLE_RECHECK_MS, startScheduler, type SchedulerDeps } from "../src/pipeline/scheduler";

test("nextDelayMs: 0 means idle recheck, no run", () => {
  expect(nextDelayMs(0)).toEqual({ delayMs: IDLE_RECHECK_MS, willRun: false });
});

test("nextDelayMs: positive minutes convert to ms and will run", () => {
  expect(nextDelayMs(5)).toEqual({ delayMs: 5 * 60_000, willRun: true });
});

test("nextDelayMs: negative is treated as idle", () => {
  expect(nextDelayMs(-3)).toEqual({ delayMs: IDLE_RECHECK_MS, willRun: false });
});

function makeDeps(over: Partial<SchedulerDeps> = {}) {
  const calls = { runs: 0, timers: [] as Array<{ fn: () => void; ms: number }> };
  const deps: SchedulerDeps = {
    getConfig: async () => ({ pollIntervalMin: 5 }),
    runGuarded: async () => { calls.runs++; return { ran: true }; },
    setTimer: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; },
    clearTimer: () => {},
    log: { log() {} },
    ...over,
  };
  return { deps, calls };
}

test("startScheduler schedules the first cycle using the configured interval", async () => {
  const { deps, calls } = makeDeps();
  startScheduler(deps);
  await Promise.resolve();
  expect(calls.timers.length).toBe(1);
  expect(calls.timers[0]!.ms).toBe(5 * 60_000);
  expect(calls.runs).toBe(0);
});

test("firing the timer runs the crawl then schedules the next cycle", async () => {
  const { deps, calls } = makeDeps();
  startScheduler(deps);
  await Promise.resolve();
  await calls.timers[0]!.fn();
  await Promise.resolve();
  expect(calls.runs).toBe(1);
  expect(calls.timers.length).toBe(2);
});

test("idle interval (0) schedules a recheck and does not run", async () => {
  const { deps, calls } = makeDeps({ getConfig: async () => ({ pollIntervalMin: 0 }) });
  startScheduler(deps);
  await Promise.resolve();
  expect(calls.timers[0]!.ms).toBe(IDLE_RECHECK_MS);
  await calls.timers[0]!.fn();
  await Promise.resolve();
  expect(calls.runs).toBe(0);
});

test("stop() prevents further scheduling after the current cycle", async () => {
  const { deps, calls } = makeDeps();
  const stop = startScheduler(deps);
  await Promise.resolve();
  stop();
  await calls.timers[0]!.fn();
  await Promise.resolve();
  expect(calls.timers.length).toBe(1);
});
