export interface Offer {
  id: number; externalId: string; title: string;
  price: number | null; area: number | null; rooms: number | null;
  district: string | null; url: string; score: number | null;
  scoreReasons: string | null; status: string; notified: boolean;
  firstSeen: string; lastSeen: string;
  images: string[]; description: string | null;
  source: string;
}
export interface Config {
  searchUrls: string[]; minPrice: number | null; maxPrice: number | null;
  minArea: number | null; minRooms: number | null;
  maxArea: number | null; maxRooms: number | null;
  aiCriteria: string;
  scoreThreshold: number; pollIntervalMin: number;
  appriseUrls: string[]; deepseekEnabled: boolean;
  listPages: number; maxDetailFetchesPerRun: number;
  requestDelayMs: number; concurrencyLimit: number;
}

export async function getOffers(): Promise<Offer[]> {
  return (await fetch("/api/offers")).json();
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
