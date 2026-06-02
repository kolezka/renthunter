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

test("parseDetail extracts the image gallery from JSON-LD", async () => {
  const html = await Bun.file("test/fixtures/detail.html").text();
  const d = parseDetail(html);
  expect(Array.isArray(d.images)).toBe(true);
  expect(d.images.length).toBeGreaterThan(1);
  expect(d.images[0]).toMatch(/^https?:\/\//);
  // de-duplicated
  expect(new Set(d.images).size).toBe(d.images.length);
});

test("parseDetail falls back to og:image when JSON-LD has no images", () => {
  const html = `<html><head><meta property="og:image" content="https://x/p.jpg"></head><body></body></html>`;
  const d = parseDetail(html);
  expect(d.images).toEqual(["https://x/p.jpg"]);
});
