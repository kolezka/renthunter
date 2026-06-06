import { test, expect } from "bun:test";
import { POPULAR_COUNT, popularFeatures, filterFeatures, toggleFeature } from "../web/lib/featureFilter";
import type { FeatureFacet } from "../web/lib/api";

const facets: FeatureFacet[] = [
  { value: "balkon", count: 9 },
  { value: "parking", count: 7 },
  { value: "winda", count: 5 },
  { value: "garaz", count: 2 },
];

test("popularFeatures takes the first N (already count-desc from server)", () => {
  expect(popularFeatures(facets, 2)).toEqual([
    { value: "balkon", count: 9 },
    { value: "parking", count: 7 },
  ]);
});

test("popularFeatures defaults to POPULAR_COUNT and never exceeds input length", () => {
  expect(popularFeatures(facets)).toHaveLength(Math.min(POPULAR_COUNT, facets.length));
});

test("filterFeatures does case-insensitive substring match, preserving order", () => {
  expect(filterFeatures(facets, "AR")).toEqual([
    { value: "parking", count: 7 },
    { value: "garaz", count: 2 },
  ]);
});

test("filterFeatures returns all for empty/whitespace query", () => {
  expect(filterFeatures(facets, "   ")).toEqual(facets);
});

test("toggleFeature adds when absent and removes when present, immutably", () => {
  const sel = ["balkon"];
  expect(toggleFeature(sel, "winda")).toEqual(["balkon", "winda"]);
  expect(toggleFeature(sel, "balkon")).toEqual([]);
  expect(sel).toEqual(["balkon"]); // original untouched
});
