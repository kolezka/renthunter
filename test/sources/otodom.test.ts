import { test, expect } from "bun:test";
import { otodom } from "../../src/scraper/sources/otodom";

test("otodom.parseList reads __NEXT_DATA__ items, namespaced, absolute urls", async () => {
  const html = await Bun.file("test/fixtures/otodom-list.html").text();
  const items = otodom.parseList(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.source).toBe("otodom");
    expect(it.externalId).toMatch(/^otodom:\d+$/);
    expect(it.url.startsWith("https://www.otodom.pl/pl/oferta/")).toBe(true);
  }
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("otodom.listPageUrls paginates with &page=N", () => {
  const base =
    "https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/pomorskie/gdansk/gdansk/gdansk?limit=36";
  const urls = otodom.listPageUrls(base, 2);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("page=2");
});

test("otodom.parseDetail extracts core fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/otodom-detail.html").text();
  const d = otodom.parseDetail(html);
  expect(d.title.length).toBeGreaterThan(0);
  expect(d.price === null || d.price > 0).toBe(true);
  expect(d.area === null || d.area > 0).toBe(true);
  expect(Array.isArray(d.images)).toBe(true);

  // Ground-truth values captured from the live fixture.
  expect(d.title).toContain("Apartament");
  expect(d.price).toBe(3000);
  expect(d.area).toBe(45);
  expect(d.rooms).toBe(2);
  expect(d.district).toBe("Śródmieście");
  expect(d.images.length).toBe(10);
});
