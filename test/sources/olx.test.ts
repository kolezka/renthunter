import { test, expect } from "bun:test";
import { olx } from "../../src/scraper/sources/olx";

test("olx.parseList returns only native offers, namespaced, absolute urls", async () => {
  const html = await Bun.file("test/fixtures/olx-list.html").text();
  const items = olx.parseList(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.source).toBe("olx");
    expect(it.externalId).toMatch(/^olx:[0-9A-Za-z]+$/);
    expect(it.url.startsWith("https://www.olx.pl/")).toBe(true);
    expect(it.url).not.toContain("otodom.pl");
  }
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("olx.listPageUrls paginates with &page=N", () => {
  const base = "https://www.olx.pl/nieruchomosci/?search[filter_float_price:to]=4100";
  const urls = olx.listPageUrls(base, 2);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("page=2");
});

test("olx.parseDetail extracts core fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/olx-detail.html").text();
  const d = olx.parseDetail(html);
  expect(d.title).toContain("Guderskiego");
  expect(d.price).toBe(2850);
  expect(d.area).toBe(47);
  expect(d.rooms).toBe(2);
  expect(d.images.length).toBeGreaterThan(0);
});
