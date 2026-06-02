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
    await releaseRunLock(holder);
  }
}
