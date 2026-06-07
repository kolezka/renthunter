import { test, expect } from "bun:test";
import { resolveSource, allowedHosts } from "../../src/scraper/sources/registry";

test("resolveSource dispatches trojmiasto by host", () => {
  expect(resolveSource("https://ogloszenia.trojmiasto.pl/x.html")?.id).toBe("trojmiasto");
});

test("resolveSource tolerates www. prefix and returns null for unknown host", () => {
  expect(resolveSource("https://www.ogloszenia.trojmiasto.pl/x.html")?.id).toBe("trojmiasto");
  expect(resolveSource("https://www.unknown.example/x")).toBeNull();
});

test("allowedHosts includes every source host", () => {
  expect(allowedHosts().has("ogloszenia.trojmiasto.pl")).toBe(true);
});

test("resolveSource matches nieruchomosci-online city subdomains by suffix", () => {
  expect(
    resolveSource("https://gdansk.nieruchomosci-online.pl/mieszkanie,m3/123.html")?.id,
  ).toBe("nieruchomosci-online");
  expect(
    resolveSource("https://www.nieruchomosci-online.pl/szukaj.html?3,mieszkanie")?.id,
  ).toBe("nieruchomosci-online");
});

test("allowedHosts includes the nieruchomosci-online host", () => {
  expect(allowedHosts().has("nieruchomosci-online.pl")).toBe(true);
});
