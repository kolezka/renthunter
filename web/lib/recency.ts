// Recency ("Posted within") presets for the Offers filter panel. The chosen
// preset is persisted so the page reopens with the user's last window; a
// first-ever visit defaults to the last 24 hours.
export type RecencyKey = "24h" | "7d" | "30d" | "all";

export interface RecencyPreset { key: RecencyKey; label: string; hours: number | null }

export const RECENCY_PRESETS: RecencyPreset[] = [
  { key: "24h", label: "Last 24h", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 168 },
  { key: "30d", label: "Last 30 days", hours: 720 },
  { key: "all", label: "All time", hours: null },
];

export const DEFAULT_RECENCY: RecencyKey = "24h";

const STORE_KEY = "tw:offers-recency";

/** Hours for a preset key; null (All time) means "no recency filter". */
export function presetToHours(key: RecencyKey): number | null {
  return RECENCY_PRESETS.find((p) => p.key === key)?.hours ?? null;
}

export function loadRecencyPreset(): RecencyKey {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && RECENCY_PRESETS.some((p) => p.key === v)) return v as RecencyKey;
  } catch { /* localStorage unavailable — fall through to default */ }
  return DEFAULT_RECENCY;
}

export function saveRecencyPreset(key: RecencyKey): void {
  try { localStorage.setItem(STORE_KEY, key); } catch { /* ignore */ }
}
