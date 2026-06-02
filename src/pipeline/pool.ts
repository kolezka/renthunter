/**
 * Run `worker` over `items` with at most `limit` concurrent invocations.
 * Resolves once every item has been processed. The worker is responsible for
 * its own error handling — a thrown worker rejects the whole pool.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.floor(limit));
  let next = 0;
  async function runner(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!, i);
    }
  }
  const runners = Array.from({ length: Math.min(size, items.length) }, () => runner());
  await Promise.all(runners);
}
