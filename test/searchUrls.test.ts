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
  test("splits on newlines, comma separators, and whitespace, trimming empties", () => {
    expect(splitPasted("a\n b , c\t\nd")).toEqual(["a", "b", "c", "d"]);
    expect(splitPasted("   ")).toEqual([]);
    expect(splitPasted("https://olx.pl/x")).toEqual(["https://olx.pl/x"]);
  });
  // Regression: commas are valid INSIDE a URL path/query — Trójmiasto and
  // Nieruchomości-online filter URLs rely on them. A single pasted URL must
  // never be fragmented at its own commas; only commas *between* URLs separate.
  test("preserves commas inside a single URL (Trójmiasto filter path)", () => {
    const url =
      "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000,e1i,81_33_58_46_91_34_32_1_143_87_76_86_142_2_7_31_29_60_26_93,qi,40_.html";
    expect(splitPasted(url)).toEqual([url]);
  });
  test("preserves commas inside a single URL (Nieruchomości-online query)", () => {
    const url = "https://www.nieruchomosci-online.pl/szukaj.html?3,mieszkanie,wynajem,,Gdańsk";
    expect(splitPasted(url)).toEqual([url]);
  });
  test("still splits comma-separated URLs, with or without spaces", () => {
    const a = "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000.html";
    const b = "https://olx.pl/x";
    expect(splitPasted(`${a},${b}`)).toEqual([a, b]);
    expect(splitPasted(`${a}, ${b}`)).toEqual([a, b]);
    expect(splitPasted(`${a}\n${b}`)).toEqual([a, b]);
  });
});

describe("addUrls (comma-in-URL regression)", () => {
  test("adds the full comma-containing URL, not a truncated prefix", () => {
    const url =
      "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000,e1i,81_33,qi,40_.html";
    const res = addUrls([], splitPasted(url));
    expect(res.urls).toEqual([url]);
    expect(res.skipped).toEqual([]);
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
