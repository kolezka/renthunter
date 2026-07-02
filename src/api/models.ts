/** Fetches the model list from a LiteLLM/OpenAI-compatible proxy (`GET {base}/v1/models`).
 *  Failures are DATA, not exceptions: the UI treats an unreachable proxy as a degraded
 *  state (free-text model inputs), so every path returns { models, error? } and the
 *  API key is never part of the result. */

export interface AiModelsResult {
  models: string[];
  error?: string;
}

export interface FetchModelsOpts {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function fetchAiModels(opts: FetchModelsOpts): Promise<AiModelsResult> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${opts.baseUrl}/v1/models`, {
      headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      // Never auto-follow redirects: the Authorization header must not leak to a
      // 3xx Location the proxy points at, on- or off-host. A redirect is treated
      // as an error result below (via the !res.ok branch), not a followed hop.
      redirect: "manual",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { models: [], error: "LiteLLM request timed out" };
    }
    // Don't echo error details — they may contain secrets. Timeout is special-cased above.
    return { models: [], error: "LiteLLM unreachable" };
  }
  if (!res.ok) return { models: [], error: `LiteLLM returned HTTP ${res.status}` };

  let body: { data?: Array<{ id?: unknown }> };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { models: [], error: "LiteLLM returned invalid JSON" };
  }
  const ids = (Array.isArray(body?.data) ? body.data : [])
    .map((m) => (typeof m?.id === "string" ? m.id : null))
    .filter((x): x is string => Boolean(x));
  return { models: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
}

export const MODELS_CACHE_TTL_MS = 60_000;
/** Bound the cache so distinct endpoint overrides can't grow it without limit.
 *  Well above any realistic set of proxies an operator would test. */
export const MODELS_CACHE_MAX = 64;

interface CacheEntry { at: number; result: AiModelsResult }
const cache = new Map<string, CacheEntry>();

/** Cached wrapper so opening the settings modal repeatedly doesn't hammer the proxy.
 *  Errors are never served from cache — a transient failure shouldn't stick for 60s.
 *  The cache is a bounded insertion-order LRU: each fetched entry is (re)inserted at
 *  the most-recent end, and the oldest is evicted once MODELS_CACHE_MAX is exceeded. */
export async function getAiModels(
  opts: FetchModelsOpts & { fresh?: boolean; now?: () => number },
): Promise<AiModelsResult> {
  const now = opts.now ?? Date.now;
  const hit = cache.get(opts.baseUrl);
  if (!opts.fresh && hit && !hit.result.error && now() - hit.at < MODELS_CACHE_TTL_MS) {
    return hit.result;
  }
  const result = await fetchAiModels(opts);
  // delete-then-set moves a re-fetched key to the most-recent end of the Map's
  // insertion order, so eviction below drops the genuinely least-recently-fetched.
  cache.delete(opts.baseUrl);
  cache.set(opts.baseUrl, { at: now(), result });
  while (cache.size > MODELS_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return result;
}

export function clearModelsCache(): void {
  cache.clear();
}
