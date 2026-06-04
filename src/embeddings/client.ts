import { TIMEOUTS } from "../scraper/timeout";
import { withRetry } from "../scraper/retry";

export interface EmbedOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** Call an OpenAI-compatible POST {baseUrl}/embeddings and return the vector. */
export async function embed(text: string, opts: EmbedOptions): Promise<number[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await withRetry(() =>
    doFetch(`${opts.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      signal: AbortSignal.timeout(TIMEOUTS.ai),
      body: JSON.stringify({ model: opts.model, input: text }),
    }),
  );
  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}`);
  const data: any = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) throw new Error("Embeddings: malformed response");
  const nums = vec.map(Number);
  if (!nums.every((n: number) => Number.isFinite(n))) throw new Error("Embeddings: non-numeric vector element");
  return nums;
}
