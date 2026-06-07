import { test, expect } from "bun:test";
import { nieruchomosciOnline } from "../../src/scraper/sources/nieruchomosci-online";

test("parseList extracts city-subdomain detail links, namespaced & deduped", async () => {
  const html = await Bun.file("test/fixtures/nieruchomosci-online-list.html").text();
  const items = nieruchomosciOnline.parseList(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.source).toBe("nieruchomosci-online");
    expect(it.externalId).toMatch(/^nieruchomosci-online:\d+$/);
    expect(it.url).toMatch(/^https:\/\/[a-z0-9-]+\.nieruchomosci-online\.pl\/.*\d+\.html$/);
  }
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("listPageUrls paginates with &p=N", () => {
  const base =
    "https://www.nieruchomosci-online.pl/szukaj.html?3,mieszkanie,wynajem,,Gdańsk";
  const urls = nieruchomosciOnline.listPageUrls(base, 2);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("p=2");
});
