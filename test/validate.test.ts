import { test, expect } from "bun:test";
import { validateConfigPatch, safeStaticPath } from "../src/api/validate";
import { allowedHosts } from "../src/scraper/sources/registry";
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

test("accepts an array of trojmiasto search urls", () => {
  const r = validateConfigPatch({
    searchUrls: [
      "https://ogloszenia.trojmiasto.pl/a.html",
      "https://ogloszenia.trojmiasto.pl/b.html",
    ],
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.patch.searchUrls?.length).toBe(2);
});

test("accepts an empty searchUrls array", () => {
  expect(validateConfigPatch({ searchUrls: [] }).ok).toBe(true);
});

test("rejects a searchUrls entry on a foreign host (SSRF)", () => {
  const bad = validateConfigPatch({ searchUrls: ["http://169.254.169.254/latest/meta-data"] });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error).toContain("host");
});

test("rejects non-url and non-http searchUrls entries", () => {
  expect(validateConfigPatch({ searchUrls: ["not a url"] }).ok).toBe(false);
  expect(validateConfigPatch({ searchUrls: ["file:///etc/passwd"] }).ok).toBe(false);
});

test("rejects searchUrls that is not an array of strings", () => {
  expect(validateConfigPatch({ searchUrls: "https://ogloszenia.trojmiasto.pl/a.html" }).ok).toBe(false);
});

test("rejects malformed apprise targets", () => {
  expect(validateConfigPatch({ appriseUrls: ["no-scheme"] }).ok).toBe(false);
  expect(validateConfigPatch({ appriseUrls: ["has space://x y"] }).ok).toBe(false);
  expect(validateConfigPatch({ appriseUrls: [123] as unknown as string[] }).ok).toBe(false);
});

test("rejects out-of-range numbers", () => {
  expect(validateConfigPatch({ scoreThreshold: 150 }).ok).toBe(false);
  expect(validateConfigPatch({ scoreThreshold: 50 }).ok).toBe(true);
  expect(validateConfigPatch({ pollIntervalMin: -1 }).ok).toBe(false);
  expect(validateConfigPatch({ pollIntervalMin: 0 }).ok).toBe(true);
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

test("searchUrls validation uses the registry allow-list", () => {
  const host = [...allowedHosts()][0]!;
  const ok = validateConfigPatch({ searchUrls: [`https://${host}/x`] });
  expect(ok.ok).toBe(true);
  const bad = validateConfigPatch({ searchUrls: ["https://evil.example/x"] });
  expect(bad.ok).toBe(false);
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
