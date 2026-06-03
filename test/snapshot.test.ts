import { test, expect } from "bun:test";
import { trackedFields, hasTrackedChange } from "../src/db/snapshot";

const base = {
  price: 3000, area: 40, rooms: 2, district: "Gdańsk", districtCanonical: "Gdańsk Wrzeszcz",
  kind: "mieszkanie", title: "T", description: "D", features: ["balkon"],
};

test("hasTrackedChange is true when no previous snapshot exists", () => {
  expect(hasTrackedChange(null, base)).toBe(true);
});

test("hasTrackedChange detects a price change", () => {
  expect(hasTrackedChange(base, { ...base, price: 2900 })).toBe(true);
});

test("hasTrackedChange treats equal feature sets as unchanged, different as changed", () => {
  expect(hasTrackedChange(base, { ...base, features: ["balkon"] })).toBe(false);
  expect(hasTrackedChange(base, { ...base, features: ["balkon", "garaż"] })).toBe(true);
});

test("trackedFields picks only the tracked keys", () => {
  const snap = trackedFields({ ...base, id: 1, url: "u", extra: "x" } as any);
  expect(Object.keys(snap).sort()).toEqual(
    ["area", "description", "district", "districtCanonical", "features", "kind", "price", "rooms", "title"].sort(),
  );
});

test("hasTrackedChange detects reshuffled multi-word features (no space-join collision)", () => {
  expect(hasTrackedChange({ ...base, features: ["a b", "c"] }, { ...base, features: ["a", "b c"] })).toBe(true);
});

test("hasTrackedChange treats equal multi-word feature sets (any order) as unchanged", () => {
  expect(hasTrackedChange(
    { ...base, features: ["miejsce parkingowe", "balkon"] },
    { ...base, features: ["balkon", "miejsce parkingowe"] },
  )).toBe(false);
});
