import { test, expect } from "bun:test";
import { extractExternalId, parseListUrls, listPageUrls } from "../src/scraper/parse";

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

test("listPageUrls returns the base url unchanged for page 1", () => {
  const base = "https://ogloszenia.trojmiasto.pl/x.html";
  expect(listPageUrls(base, 1)).toEqual([base]);
});

test("listPageUrls appends strona param for further pages", () => {
  const base = "https://ogloszenia.trojmiasto.pl/x.html";
  const urls = listPageUrls(base, 3);
  expect(urls.length).toBe(3);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("strona=2");
  expect(urls[2]).toContain("strona=3");
});

test("listPageUrls clamps pages < 1 to a single url", () => {
  const base = "https://ogloszenia.trojmiasto.pl/x.html";
  expect(listPageUrls(base, 0)).toEqual([base]);
});
