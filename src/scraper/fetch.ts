import { TIMEOUTS } from "./timeout";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface FetchPageOptions {
  timeoutMs?: number;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUTS.scrape),
  });
  if (!res.ok) throw new Error(`fetchPage ${url} -> HTTP ${res.status}`);
  return res.text();
}
