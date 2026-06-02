import { test, expect } from "bun:test";
import { resolveSource, allowedHosts } from "../../src/scraper/sources/registry";

test("resolveSource dispatches trojmiasto by host", () => {
  expect(resolveSource("https://ogloszenia.trojmiasto.pl/x.html")?.id).toBe("trojmiasto");
});

test("resolveSource tolerates www. prefix and returns null for unknown host", () => {
  expect(resolveSource("https://www.unknown.example/x")).toBeNull();
});

test("allowedHosts includes every source host", () => {
  expect(allowedHosts().has("ogloszenia.trojmiasto.pl")).toBe(true);
});
