export const TRACKED_KEYS = [
  "price", "area", "rooms", "district", "districtCanonical",
  "kind", "title", "description", "features",
] as const;

export type TrackedSnapshot = Record<(typeof TRACKED_KEYS)[number], unknown>;

export function trackedFields(o: Record<string, unknown>): TrackedSnapshot {
  const out = {} as TrackedSnapshot;
  for (const k of TRACKED_KEYS) out[k] = o[k] ?? null;
  return out;
}

function eq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  }
  return a === b;
}

/** True if any tracked field differs, or there is no prior snapshot. */
export function hasTrackedChange(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): boolean {
  if (!prev) return true;
  const p = trackedFields(prev), n = trackedFields(next);
  return TRACKED_KEYS.some((k) => !eq(p[k], n[k]));
}
