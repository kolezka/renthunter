import { test, expect } from "bun:test";
import { extractExternalId, parseListUrls } from "../src/scraper/parse";

test("extractExternalId pulls digits from ogl link", () => {
  expect(extractExternalId("https://ogloszenia.trojmiasto.pl/x/foo-ogl66438940.html")).toBe("66438940");
  expect(extractExternalId("https://example.com/no-id.html")).toBeNull();
});

test("parseListUrls returns unique offer links from fixture", async () => {
  const html = await Bun.file("test/fixtures/list.html").text();
  const items = parseListUrls(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.externalId).toMatch(/^\d+$/);
    expect(it.url).toContain("trojmiasto.pl");
    expect(it.url).toContain("-ogl");
  }
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length);
});
