import type { Logger } from "../log/logger";
import type { AppConfig } from "../config";
import { getConfig } from "../db/queries";
import { runCrawlGuarded, runRescoreGuarded } from "./deps";

/** How often to re-read config while everything is disabled (both intervals <= 0). */
export const IDLE_RECHECK_MS = 60_000;

export interface SchedulerConfig {
  pollIntervalMin: number;
  rescoreIntervalMin: number;
}

export interface SchedulerDeps {
  getConfig: () => Promise<SchedulerConfig>;
  runCrawl: () => Promise<void>;
  runRescore: () => Promise<void>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  log: Logger;
}

/** A job is due when enabled (interval > 0) and at least `interval` has elapsed. */
export function isDue(now: number, last: number, intervalMin: number): boolean {
  return Number.isFinite(intervalMin) && intervalMin > 0 && now - last >= intervalMin * 60_000;
}

/** Ms until the soonest enabled job is next due; IDLE_RECHECK_MS if none enabled.
 *  Clamped to >= 1 so a just-run/overdue job yields a tiny delay, never 0. */
export function nextDelayMs(
  now: number,
  lastCrawlAt: number, pollMin: number,
  lastRescoreAt: number, rescoreMin: number,
): number {
  const cands: number[] = [];
  if (Number.isFinite(pollMin) && pollMin > 0) cands.push(lastCrawlAt + pollMin * 60_000 - now);
  if (Number.isFinite(rescoreMin) && rescoreMin > 0) cands.push(lastRescoreAt + rescoreMin * 60_000 - now);
  if (cands.length === 0) return IDLE_RECHECK_MS;
  return Math.max(1, Math.min(...cands));
}

/**
 * Start the unified self-scheduling loop. Each wake-up re-reads config (so UI
 * changes take effect next cycle), then runs the due jobs sequentially — crawl
 * first, then rescore — AWAITING each so runs never overlap and the shared run
 * lock is free between them. Reschedules at the soonest upcoming due time.
 *
 * Both jobs' "last run" clocks start at boot, so the first run of each happens
 * after one full interval, never on boot. Returns stop() to cancel the timer.
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  let stopped = false;
  let handle: unknown = null;
  const start = deps.now();
  let lastCrawlAt = start;
  let lastRescoreAt = start;

  const idle: SchedulerConfig = { pollIntervalMin: 0, rescoreIntervalMin: 0 };

  async function readConfig(): Promise<SchedulerConfig> {
    try {
      return await deps.getConfig();
    } catch (err) {
      await deps.log.log({ level: "error", event: "scheduler.config_error", message: `scheduler getConfig failed: ${String(err)}` });
      return idle;
    }
  }

  function schedule(cfg: SchedulerConfig): void {
    if (stopped) return;
    const delay = nextDelayMs(deps.now(), lastCrawlAt, cfg.pollIntervalMin, lastRescoreAt, cfg.rescoreIntervalMin);
    handle = deps.setTimer(() => { void tick(); }, delay);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const cfg = await readConfig();
    if (stopped) return;

    if (isDue(deps.now(), lastCrawlAt, cfg.pollIntervalMin)) {
      try { await deps.runCrawl(); }
      catch (err) { await deps.log.log({ level: "error", event: "scheduler.error", message: `scheduled crawl failed: ${String(err)}` }); }
      lastCrawlAt = deps.now();
      if (stopped) return;
    }

    if (isDue(deps.now(), lastRescoreAt, cfg.rescoreIntervalMin)) {
      try { await deps.runRescore(); }
      catch (err) { await deps.log.log({ level: "error", event: "scheduler.error", message: `scheduled rescore failed: ${String(err)}` }); }
      lastRescoreAt = deps.now();
      if (stopped) return;
    }

    schedule(cfg);
  }

  void (async () => {
    const cfg = await readConfig();
    schedule(cfg);
  })();

  return () => { stopped = true; if (handle !== null) deps.clearTimer(handle); };
}

/** Compose the real scheduler deps: DB config + lock-guarded crawl and rescore,
 *  each awaited to completion so the loop stays sequential. */
export function buildSchedulerDeps(env: AppConfig, logger: Logger): SchedulerDeps {
  return {
    getConfig: async () => {
      const c = await getConfig();
      return { pollIntervalMin: c.pollIntervalMin, rescoreIntervalMin: c.rescoreIntervalMin };
    },
    runCrawl: async () => {
      const r = await runCrawlGuarded(env, "scheduled");
      if ("busy" in r) {
        await logger.log({ level: "info", event: "scheduler.skipped", message: "scheduled crawl skipped: another run in progress" });
        return;
      }
      await r.done;
    },
    runRescore: async () => {
      const r = await runRescoreGuarded(env);
      if ("busy" in r) {
        await logger.log({ level: "info", event: "scheduler.skipped", message: "scheduled rescore skipped: another run in progress" });
        return;
      }
      if ("disabled" in r) return;
      await r.done;
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    log: logger,
  };
}
