import { TIMEOUTS } from "./timeout";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface BrowserlessConfig {
  /** Base URL of the browserless instance, e.g. "http://192.168.1.50:3000". */
  url: string;
  /** Optional ?token=… if the instance requires auth. */
  token?: string;
}

export interface FetchPageOptions {
  timeoutMs?: number;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** When set (non-empty url), route the fetch through browserless /content. */
  browserless?: BrowserlessConfig;
}

/** Build the POST request to a browserless /content endpoint that renders the
 *  target URL (stealth + networkidle) and returns its HTML. Pure — unit-tested. */
export function buildBrowserlessRequest(
  url: string,
  cfg: BrowserlessConfig,
): { endpoint: string; init: RequestInit } {
  const base = cfg.url.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (cfg.token) params.set("token", cfg.token);
  params.set("stealth", "true");
  params.set("blockAds", "true");
  const endpoint = `${base}/content?${params.toString()}`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      gotoOptions: { waitUntil: "networkidle2" },
      bestAttempt: true,
    }),
  };
  return { endpoint, init };
}

export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const useBrowserless = Boolean(opts.browserless?.url);
  const timeoutMs = opts.timeoutMs ?? (useBrowserless ? TIMEOUTS.render : TIMEOUTS.scrape);
  const signal = AbortSignal.timeout(timeoutMs);

  if (useBrowserless) {
    const { endpoint, init } = buildBrowserlessRequest(url, opts.browserless!);
    const res = await doFetch(endpoint, { ...init, signal });
    if (!res.ok) throw new Error(`fetchPage ${url} via browserless -> HTTP ${res.status}`);
    return res.text();
  }

  const res = await doFetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9" },
    signal,
  });
  if (!res.ok) throw new Error(`fetchPage ${url} -> HTTP ${res.status}`);
  return res.text();
}
