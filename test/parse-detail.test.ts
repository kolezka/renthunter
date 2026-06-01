import { test, expect } from "bun:test";
import { parseDetail } from "../src/scraper/parse";

test("parseDetail extracts structured fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/detail.html").text();
  const d = parseDetail(html);
  expect(d.title.length).toBeGreaterThan(0);
  expect(d.price === null || d.price > 0).toBe(true);
  expect(d.area === null || d.area > 0).toBe(true);
  expect(d.rooms === null || d.rooms! >= 1).toBe(true);
  expect(typeof d.description).toBe("string");
});
