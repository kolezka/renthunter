import type { FeatureFacet } from "./api";

/** How many of the most-common features show as one-tap "Popular" chips. */
export const POPULAR_COUNT = 8;

/** The first `limit` features. Input is already count-descending from the server. */
export function popularFeatures(features: FeatureFacet[], limit = POPULAR_COUNT): FeatureFacet[] {
  return features.slice(0, limit);
}

/** Case-insensitive substring filter over feature values, preserving input order. */
export function filterFeatures(features: FeatureFacet[], query: string): FeatureFacet[] {
  const q = query.trim().toLowerCase();
  if (!q) return features;
  return features.filter((f) => f.value.toLowerCase().includes(q));
}

/** Add `value` if absent, remove it if present. Returns a new array. */
export function toggleFeature(selected: string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}
