import { getCurrentRun, cancelCurrentRun, type RunSnapshot } from "./api";

let current = $state<RunSnapshot | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let starts = 0;
let inflight = false;

async function poll() {
  if (inflight) return;
  inflight = true;
  try {
    current = (await getCurrentRun()).run;
  } catch {
    // transient fetch failure: keep the last snapshot; next tick retries
  } finally {
    inflight = false;
  }
}

/** Shared current-run poller. start/stop are ref-counted so the header chip
 *  and the dashboard can both depend on it. */
export const runStatus = {
  get current(): RunSnapshot | null {
    return current;
  },
  start() {
    starts++;
    if (timer) return;
    poll();
    timer = setInterval(() => {
      if (!document.hidden) poll();
    }, 2000);
  },
  stop() {
    starts = Math.max(0, starts - 1);
    if (starts === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  },
  async cancel() {
    if (!current) return;
    current = { ...current, cancelling: true }; // optimistic; server confirms
    try {
      await cancelCurrentRun();
    } catch {
      // degrade contract: errors surface as {error}; next poll re-syncs state
    }
    await poll();
  },
};
