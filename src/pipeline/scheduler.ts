import type { Logger } from "../log/logger";
import type { AppConfig } from "../config";
import { getConfig } from "../db/queries";
import { runCrawlGuarded } from "./deps";

/** How often to re-read config while auto-crawl is disabled (pollIntervalMin <= 0). */
export const IDLE_RECHECK_MS = 60_000;

export interface SchedulerDeps {
  getConfig: () => Promise<{ pollIntervalMin: number }>;
  runGuarded: () => Promise<{ ran: boolean }>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  log: Logger;
}

/** Pure decision: how long to wait next, and whether that wake-up runs a crawl. */
export function nextDelayMs(pollIntervalMin: number): { delayMs: number; willRun: boolean } {
  if (!Number.isFinite(pollIntervalMin) || pollIntervalMin <= 0) {
    return { delayMs: IDLE_RECHECK_MS, willRun: false };
  }
  return { delayMs: pollIntervalMin * 60_000, willRun: true };
}

/**
 * Start the self-scheduling crawl loop. Reads pollIntervalMin from DB each cycle
 * (so UI changes take effect on the next cycle), runs the crawl through the shared
 * run lock, and reschedules. Returns a stop() that cancels the pending timer.
 *
 * Self-scheduling (not setInterval) guarantees no overlapping runs and picks up
 * interval/disable changes live. The first run happens AFTER one interval, never on
 * boot — so bun --hot reloads and container restarts don't hammer the target.
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  let stopped = false;
  let handle: unknown = null;

  async function schedule(): Promise<void> {
    if (stopped) return;
    let minutes = 0;
    try {
      minutes = (await deps.getConfig()).pollIntervalMin;
    } catch (err) {
      await deps.log.log({ level: "error", event: "scheduler.config_error", message: `scheduler getConfig failed: ${String(err)}` });
    }
    if (stopped) return;
    const { delayMs, willRun } = nextDelayMs(minutes);
    handle = deps.setTimer(() => { void tick(willRun); }, delayMs);
  }

  async function tick(willRun: boolean): Promise<void> {
    if (stopped) return;
    if (willRun) {
      try {
        const r = await deps.runGuarded();
        if (!r.ran) {
          await deps.log.log({ level: "info", event: "scheduler.skipped", message: "scheduled run skipped: another run in progress" });
        }
      } catch (err) {
        await deps.log.log({ level: "error", event: "scheduler.error", message: `scheduled run failed: ${String(err)}` });
      }
    }
    await schedule();
  }

  void schedule();
  return () => { stopped = true; if (handle !== null) deps.clearTimer(handle); };
}

/** Compose the real scheduler deps (DB config + lock-guarded run, source "scheduled"). */
export function buildSchedulerDeps(env: AppConfig, logger: Logger): SchedulerDeps {
  return {
    getConfig,
    runGuarded: async () => {
      const r = await runCrawlGuarded(env, "scheduled");
      return { ran: !("busy" in r) };
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    log: logger,
  };
}
