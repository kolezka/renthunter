import { test, expect, describe } from "bun:test";
import { resolveSource, splitPasted, addUrls, normalizeHost } from "../web/lib/searchUrls";

describe("normalizeHost", () => {
  test("strips leading www. and lowercases", () => {
    expect(normalizeHost("WWW.Olx.PL")).toBe("olx.pl");
    expect(normalizeHost("ogloszenia.trojmiasto.pl")).toBe("ogloszenia.trojmiasto.pl");
  });
});

describe("resolveSource", () => {
  test("recognizes each supported source, with and without www.", () => {
    expect(resolveSource("https://ogloszenia.trojmiasto.pl/mieszkanie/wynajem/")).toBe("trojmiasto");
    expect(resolveSource("https://olx.pl/nieruchomosci/")).toBe("olx");
    expect(resolveSource("https://www.olx.pl/nieruchomosci/")).toBe("olx");
    expect(resolveSource("https://www.otodom.pl/pl/wyniki/wynajem")).toBe("otodom");
  });
  test("recognizes nieruchomosci-online by its www search host, with and without www.", () => {
    expect(
      resolveSource("https://www.nieruchomosci-online.pl/szukaj.html?3,mieszkanie,wynajem,,Gdańsk"),
    ).toBe("nieruchomosci-online");
    expect(resolveSource("https://nieruchomosci-online.pl/szukaj.html")).toBe("nieruchomosci-online");
  });
  test("returns null for unsupported host", () => {
    expect(resolveSource("https://www.allegro.pl/x")).toBeNull();
  });
  test("returns null for malformed URL", () => {
    expect(resolveSource("not a url")).toBeNull();
    expect(resolveSource("")).toBeNull();
  });
});

describe("splitPasted", () => {
  test("splits on newlines, commas, and whitespace, trimming empties", () => {
    expect(splitPasted("a\n b , c\t\nd")).toEqual(["a", "b", "c", "d"]);
    expect(splitPasted("   ")).toEqual([]);
    expect(splitPasted("https://olx.pl/x")).toEqual(["https://olx.pl/x"]);
  });
});

describe("addUrls", () => {
  test("appends recognized, non-duplicate URLs and preserves order", () => {
    const res = addUrls(["https://olx.pl/a"], ["https://www.otodom.pl/b"]);
    expect(res.urls).toEqual(["https://olx.pl/a", "https://www.otodom.pl/b"]);
    expect(res.added).toEqual(["https://www.otodom.pl/b"]);
    expect(res.skipped).toEqual([]);
  });
  test("skips unsupported hosts but keeps the valid ones (add valid, list rejects)", () => {
    const res = addUrls([], ["https://olx.pl/a", "https://allegro.pl/b"]);
    expect(res.added).toEqual(["https://olx.pl/a"]);
    expect(res.urls).toEqual(["https://olx.pl/a"]);
    expect(res.skipped).toEqual([{ url: "https://allegro.pl/b", reason: "unsupported" }]);
  });
  test("skips exact duplicates (already present and within the same batch)", () => {
    const res = addUrls(["https://olx.pl/a"], ["https://olx.pl/a", "https://otodom.pl/c", "https://otodom.pl/c"]);
    expect(res.added).toEqual(["https://otodom.pl/c"]);
    expect(res.urls).toEqual(["https://olx.pl/a", "https://otodom.pl/c"]);
    expect(res.skipped).toEqual([
      { url: "https://olx.pl/a", reason: "duplicate" },
      { url: "https://otodom.pl/c", reason: "duplicate" },
    ]);
  });
});
