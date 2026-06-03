export type Source = "trojmiasto" | "olx" | "otodom";
export const SOURCE_LABEL: Record<Source, string> = {
  trojmiasto: "Trójmiasto",
  olx: "OLX",
  otodom: "Otodom",
};

export interface Offer {
  id: number; externalId: string; title: string;
  price: number | null; area: number | null; rooms: number | null;
  district: string | null; url: string; score: number | null;
  scoreReasons: string | null; status: string; notified: boolean;
  firstSeen: string; lastSeen: string;
  images: string[]; description: string | null;
  source: Source;
  kind: string | null;
  districtCanonical: string | null;
  features: string[];
}
export interface Config {
  searchUrls: string[]; minPrice: number | null; maxPrice: number | null;
  minArea: number | null; minRooms: number | null;
  maxArea: number | null; maxRooms: number | null;
  aiCriteria: string;
  outputLanguage: string;
  scoreThreshold: number; pollIntervalMin: number;
  appriseUrls: string[]; deepseekEnabled: boolean;
  listPages: number; maxDetailFetchesPerRun: number;
  requestDelayMs: number; concurrencyLimit: number;
  extractEnabled: boolean;
  embedEnabled: boolean;
}

export interface Page<T> { items: T[]; total: number }

export async function getOffers(offset = 0, limit = 50): Promise<Page<Offer>> {
  return (await fetch(`/api/offers?limit=${limit}&offset=${offset}`)).json();
}
export async function getConfig(): Promise<Config> {
  return (await fetch("/api/config")).json();
}
export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  // On validation failure the API returns { error } with a 4xx — surface it
  // instead of silently overwriting the form state with the error object.
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Save failed (HTTP ${res.status})`);
  return data as Config;
}

export interface LogEntry {
  id: number;
  ts: string;
  runId: string | null;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  context: Record<string, unknown> | null;
}

export async function getLogs(limit = 300): Promise<LogEntry[]> {
  return (await fetch(`/api/logs?limit=${limit}`)).json();
}

export async function runCrawler(): Promise<{ runId: string }> {
  const res = await fetch("/api/run", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Run failed (HTTP ${res.status})`);
  return data as { runId: string };
}

export async function refreshOffer(externalId: string): Promise<Offer> {
  const res = await fetch(`/api/offers/${encodeURIComponent(externalId)}/refresh`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Refresh failed (HTTP ${res.status})`);
  return data as Offer;
}

export interface RescoreSummary { scored: number; errors: number }
export type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };

export async function rescoreAll(): Promise<{ runId: string }> {
  const res = await fetch("/api/rescore", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Rescore failed (HTTP ${res.status})`);
  return data as { runId: string };
}

export interface Facets { districts: string[]; kinds: string[]; features: string[]; sources: string[] }
export interface SearchQuery {
  q?: string; districts?: string[]; kinds?: string[]; features?: string[]; sources?: string[];
  sort?: "score" | "newest" | "price" | "area";
}
export async function getFacets(): Promise<Facets> {
  return (await fetch("/api/offers/facets")).json();
}
export async function searchOffers(query: SearchQuery, offset = 0, limit = 50): Promise<Page<Offer>> {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  for (const k of ["districts", "kinds", "features", "sources"] as const) {
    const v = query[k]; if (v && v.length) p.set(k, v.join(","));
  }
  if (query.sort) p.set("sort", query.sort);
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  return (await fetch(`/api/offers/search?${p.toString()}`)).json();
}

export interface OfferSnapshot { id: number; offerId: number; capturedAt: string; data: Record<string, unknown> }
export async function getOfferHistory(externalId: string): Promise<OfferSnapshot[]> {
  return (await fetch(`/api/offers/${encodeURIComponent(externalId)}/history`)).json();
}
