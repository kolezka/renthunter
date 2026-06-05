/** Retry an async fetch-returning fn on 429/5xx with exponential backoff.
 *  `fn` must return a Response; non-retryable statuses pass through untouched. */
// NOTE: withRetry only retries based on HTTP status. If `fn` itself rejects
// (e.g. AbortSignal.timeout expiry or a network-level error), the rejection
// propagates immediately and is NOT retried.
export async function withRetry(
  fn: () => Promise<Response>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  if (attempts <= 0) throw new Error("withRetry: attempts must be >= 1");
  let last: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fn();
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    last = res;
    if (i < attempts - 1) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** i;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return last!;
}
