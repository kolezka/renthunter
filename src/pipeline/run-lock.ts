import { acquireRunLock, releaseRunLock } from "../db/queries";

/** Lease timeout. Must exceed the longest possible run (trigger maxDuration=300s). */
export const RUN_LOCK_STALE_MS = 15 * 60 * 1000;

/**
 * Run `fn` only if the cross-process run lock can be acquired. Releases the lock
 * afterward (even on throw). Returns { ran:false } without calling fn when held.
 */
export async function withRunLock<T>(
  holder: string,
  source: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const acquired = await acquireRunLock(holder, source, RUN_LOCK_STALE_MS);
  if (!acquired) return { ran: false };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    // Swallow release failures so they can't replace a real error thrown by fn
    // (mirrors the trigger task's pruneLogs guard). A leaked lease self-heals via
    // the stale timeout.
    await releaseRunLock(holder).catch((err) => console.error("releaseRunLock failed:", err));
  }
}
