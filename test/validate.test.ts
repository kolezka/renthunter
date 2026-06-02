import { test, expect } from "bun:test";
import { validateConfigPatch, safeStaticPath } from "../src/api/validate";
import { resolve } from "node:path";

test("accepts a valid patch and whitelists unknown keys", () => {
  const r = validateConfigPatch({
    maxPrice: 3800, aiCriteria: "balkon", appriseUrls: ["json://x", "tgram://t/c"],
    scoreThreshold: 70, deepseekEnabled: false, id: 999, bogus: "x",
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.patch.maxPrice).toBe(3800);
    expect("id" in r.patch).toBe(false);
    expect("bogus" in (r.patch as Record<string, unknown>)).toBe(false);
  }
});

test("accepts a trojmiasto searchUrl, rejects foreign host (SSRF guard)", () => {
  expect(validateConfigPatch({ searchUrl: "https://ogloszenia.trojmiasto.pl/x.html" }).ok).toBe(true);
  const bad = validateConfigPatch({ searchUrl: "http://169.254.169.254/latest/meta-data" });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error).toContain("host");
});

test("rejects non-url and non-http searchUrl", () => {
  expect(validateConfigPatch({ searchUrl: "not a url" }).ok).toBe(false);
  expect(validateConfigPatch({ searchUrl: "file:///etc/passwd" }).ok).toBe(false);
});

test("rejects malformed apprise targets", () => {
  expect(validateConfigPatch({ appriseUrls: ["no-scheme"] }).ok).toBe(false);
  expect(validateConfigPatch({ appriseUrls: ["has space://x y"] }).ok).toBe(false);
  expect(validateConfigPatch({ appriseUrls: [123] as unknown as string[] }).ok).toBe(false);
});

test("rejects out-of-range numbers", () => {
  expect(validateConfigPatch({ scoreThreshold: 150 }).ok).toBe(false);
  expect(validateConfigPatch({ scoreThreshold: 50 }).ok).toBe(true);
  expect(validateConfigPatch({ pollIntervalMin: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ minPrice: -5 }).ok).toBe(false);
  expect(validateConfigPatch({ minPrice: null }).ok).toBe(true);
});

test("safeStaticPath confines to root and blocks traversal", () => {
  const root = resolve("/tmp/dist");
  expect(safeStaticPath(root, "/index.html")).toBe(resolve(root, "index.html"));
  expect(safeStaticPath(root, "/assets/app.js")).toBe(resolve(root, "assets/app.js"));
  expect(safeStaticPath(root, "/../../etc/passwd")).toBeNull();
  expect(safeStaticPath(root, "/..%2f..%2fetc/passwd")).toBeNull();
  expect(safeStaticPath(root, "/a\0b")).toBeNull();
});

test("accepts new crawl-control fields within range", () => {
  const r = validateConfigPatch({
    maxArea: 80, maxRooms: 4, listPages: 3,
    maxDetailFetchesPerRun: 50, requestDelayMs: 250, concurrencyLimit: 8,
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.patch.concurrencyLimit).toBe(8);
});

test("rejects out-of-range crawl-control fields", () => {
  expect(validateConfigPatch({ concurrencyLimit: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ concurrencyLimit: 17 }).ok).toBe(false);
  expect(validateConfigPatch({ listPages: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ listPages: 11 }).ok).toBe(false);
  expect(validateConfigPatch({ maxDetailFetchesPerRun: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ requestDelayMs: -1 }).ok).toBe(false);
  expect(validateConfigPatch({ requestDelayMs: 10001 }).ok).toBe(false);
  expect(validateConfigPatch({ maxArea: -1 }).ok).toBe(false);
  expect(validateConfigPatch({ maxArea: null }).ok).toBe(true);
});
