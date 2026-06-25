import { SOURCE_CATALOG, type SourceId } from "../../src/scraper/sources/catalog";

// Source identity, labels and hosts come from the shared catalog (the single
// source of truth, also used by the backend) — keep no separate list here.
export type Source = SourceId;
export const SOURCE_LABEL: Record<Source, string> = Object.fromEntries(
  SOURCE_CATALOG.map((m) => [m.id, m.label]),
) as Record<Source, string>;

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
  scoreThreshold: number; pollIntervalMin: number; rescoreIntervalMin: number;
  appriseUrls: string[]; deepseekEnabled: boolean;
  listPages: number; maxDetailFetchesPerRun: number;
  requestDelayMs: number; concurrencyLimit: number;
  extractEnabled: boolean;
  embedEnabled: boolean;
  scorerModel: string;
  embedModel: string;
  aiBaseUrl: string;
  // Read-only, server-derived (never sent back on save):
  aiKeyConfigured?: boolean;
  aiBaseUrlEffective?: string;
}

export interface Page<T> { items: T[]; total: number }

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}
async function postJson<T>(url: string, body: unknown, label: string, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${label} failed (HTTP ${res.status})`);
  return data as T;
}

export async function getOffers(offset = 0, limit = 50): Promise<Page<Offer>> {
  return getJson<Page<Offer>>(`/api/offers?limit=${limit}&offset=${offset}`);
}
export async function getConfig(): Promise<Config> {
  return getJson<Config>("/api/config");
}
export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  // On validation failure the API returns { error } with a 4xx — surface it
  // instead of silently overwriting the form state with the error object.
  return postJson<Config>("/api/config", patch, "Save", "PUT");
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
  return getJson<LogEntry[]>(`/api/logs?limit=${limit}`);
}

export async function runCrawler(): Promise<{ runId: string }> {
  return postJson<{ runId: string }>("/api/run", {}, "Run");
}

export async function refreshOffer(externalId: string): Promise<Offer> {
  return postJson<Offer>(`/api/offers/${encodeURIComponent(externalId)}/refresh`, {}, "Refresh");
}

export interface RescoreSummary { scored: number; errors: number }
export type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };

export async function rescoreAll(): Promise<{ runId: string }> {
  return postJson<{ runId: string }>("/api/rescore", {}, "Rescore");
}

export interface FeatureFacet { value: string; count: number }
export interface Facets {
  districts: string[]; kinds: string[]; sources: string[];
  features: FeatureFacet[];
}
export interface SearchQuery {
  q?: string; districts?: string[]; kinds?: string[]; features?: string[]; sources?: string[];
  sort?: "score" | "newest" | "price" | "area";
}
export async function getFacets(): Promise<Facets> {
  return getJson<Facets>("/api/offers/facets");
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
  return getJson<Page<Offer>>(`/api/offers/search?${p.toString()}`);
}

export interface OfferSnapshot { id: number; offerId: number; capturedAt: string; data: Record<string, unknown> }
export async function getOfferHistory(externalId: string, signal?: AbortSignal): Promise<OfferSnapshot[]> {
  return getJson<OfferSnapshot[]>(`/api/offers/${encodeURIComponent(externalId)}/history`, signal);
}
