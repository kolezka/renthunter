import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  RECENCY_PRESETS, presetToHours, loadRecencyPreset, saveRecencyPreset, DEFAULT_RECENCY,
} from "../web/lib/recency";

// Minimal localStorage stub (bun test has no DOM by default).
let store: Record<string, string>;
beforeEach(() => {
  store = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
});
afterEach(() => { delete (globalThis as any).localStorage; });

test("presetToHours maps windows; All time -> null", () => {
  expect(presetToHours("24h")).toBe(24);
  expect(presetToHours("7d")).toBe(168);
  expect(presetToHours("30d")).toBe(720);
  expect(presetToHours("all")).toBeNull();
});

test("RECENCY_PRESETS lists the four windows with 24h first", () => {
  expect(RECENCY_PRESETS.map((p) => p.key)).toEqual(["24h", "7d", "30d", "all"]);
});

test("loadRecencyPreset defaults to 24h when nothing stored", () => {
  expect(loadRecencyPreset()).toBe("24h");
  expect(DEFAULT_RECENCY).toBe("24h");
});

test("saveRecencyPreset round-trips a valid key", () => {
  saveRecencyPreset("30d");
  expect(loadRecencyPreset()).toBe("30d");
});

test("loadRecencyPreset ignores an unknown stored value", () => {
  store["tw:offers-recency"] = "bogus";
  expect(loadRecencyPreset()).toBe("24h");
});
