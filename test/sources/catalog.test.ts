import { test, expect } from "bun:test";
import { SOURCE_CATALOG, type SourceMeta } from "../../src/scraper/sources/catalog";
import { SOURCES } from "../../src/scraper/sources/registry";
import { SOURCE_LABEL } from "../../web/lib/api";
import { SOURCE_HOSTS } from "../../web/lib/searchUrls";

// The catalog is the single source of truth for source id/label/host metadata,
// consumed by both the backend registry and the frontend. These guards fail if a
// source is added to the catalog but not wired through, or vice versa.

test("every catalog id is registered as a backend Source with the same hosts", () => {
  const metas: readonly SourceMeta[] = SOURCE_CATALOG;
  for (const meta of metas) {
    const src = SOURCES.find((s) => s.id === meta.id);
    expect(src).toBeDefined();
    expect(src!.hosts).toEqual([...meta.hosts]);
    expect(src!.hostSuffixes ?? undefined).toEqual(
      meta.hostSuffixes ? [...meta.hostSuffixes] : undefined,
    );
  }
});

test("backend SOURCES and catalog cover exactly the same ids", () => {
  expect(SOURCES.map((s) => s.id).sort()).toEqual(
    SOURCE_CATALOG.map((m) => m.id).sort(),
  );
});

test("frontend SOURCE_LABEL and SOURCE_HOSTS are derived from the catalog", () => {
  for (const meta of SOURCE_CATALOG) {
    expect(SOURCE_LABEL[meta.id]).toBe(meta.label);
    expect(SOURCE_HOSTS[meta.id]).toEqual([...meta.hosts]);
  }
  // No extra keys beyond the catalog.
  expect(Object.keys(SOURCE_LABEL).sort()).toEqual(SOURCE_CATALOG.map((m) => m.id).sort());
  expect(Object.keys(SOURCE_HOSTS).sort()).toEqual(SOURCE_CATALOG.map((m) => m.id).sort());
});
