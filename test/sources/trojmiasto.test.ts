import { test, expect } from "bun:test";
import { trojmiasto } from "../../src/scraper/sources/trojmiasto";

test("trojmiasto.parseList namespaces externalId and tags source", async () => {
  const html = await Bun.file("test/fixtures/list.html").text();
  const items = trojmiasto.parseList(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.source).toBe("trojmiasto");
    expect(it.externalId).toMatch(/^trojmiasto:\d+$/);
    expect(it.url).toContain("trojmiasto.pl");
  }
});

test("trojmiasto.listPageUrls uses strona pagination", () => {
  const base = "https://ogloszenia.trojmiasto.pl/x.html";
  const urls = trojmiasto.listPageUrls(base, 2);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("strona=2");
});

test("trojmiasto.parseDetail extracts fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/detail.html").text();
  const d = trojmiasto.parseDetail(html);
  expect(d.title.length).toBeGreaterThan(0);
  expect(d.price === null || d.price > 0).toBe(true);
  expect(d.area === null || d.area > 0).toBe(true);
  expect(Array.isArray(d.images)).toBe(true);
});
