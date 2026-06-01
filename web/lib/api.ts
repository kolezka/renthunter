export interface Offer {
  id: number; externalId: string; title: string;
  price: number | null; area: number | null; rooms: number | null;
  district: string | null; url: string; score: number | null;
  scoreReasons: string | null; status: string; notified: boolean;
  firstSeen: string; lastSeen: string;
}
export interface Config {
  searchUrl: string; minPrice: number | null; maxPrice: number | null;
  minArea: number | null; minRooms: number | null; aiCriteria: string;
  scoreThreshold: number; pollIntervalMin: number;
  appriseUrls: string[]; deepseekEnabled: boolean;
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
  return res.json();
}
