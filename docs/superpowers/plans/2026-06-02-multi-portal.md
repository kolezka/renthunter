# Multi-portal Support (OLX + Otodom + trojmiasto) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the crawler scrape OLX, Otodom, and trojmiasto through a per-host parser registry, with portal-namespaced offer ids and a `source` column surfaced in the web UI.

**Architecture:** A `src/scraper/sources/` registry maps URL host → a `Source` object with pure `listPageUrls`/`parseList`/`parseDetail` methods. The pipeline (`runCheck`, `processOffer`, refresh) dispatches by host instead of using a single hardcoded parser. Offer `external_id`s become namespaced (`trojmiasto:NNN`, `olx:<token>`, `otodom:<id>`); existing rows are migrated. Parsers are pure `(html) → data` functions, unit-tested on saved fixtures.

**Tech Stack:** Bun, TypeScript, Drizzle ORM + postgres-js (PGlite in tests), Svelte 5 (web SPA). Tests via `bun test` on in-memory PGlite (`test/setup.ts`).

**Spec:** `docs/superpowers/specs/2026-06-02-multi-portal-design.md`

**Branch:** `feat/multi-portal` (already created, spec + fixtures committed).

---

## File Structure

**Create:**
- `src/scraper/sources/types.ts` — `SourceId`, `ListItem` (now with `source`), `OfferDetail` re-export, `Source` interface.
- `src/scraper/sources/registry.ts` — `SOURCES[]`, `resolveSource(url)`, `allowedHosts()`.
- `src/scraper/sources/trojmiasto.ts` — trojmiasto `Source` (wraps existing `parse.ts` logic, namespaces ids).
- `src/scraper/sources/olx.ts` — OLX `Source` (HTML-card list, `__PRERENDERED_STATE__`/JSON-LD detail).
- `src/scraper/sources/otodom.ts` — Otodom `Source` (`__NEXT_DATA__` JSON list + detail).
- `test/sources/registry.test.ts`, `test/sources/trojmiasto.test.ts`, `test/sources/olx.test.ts`, `test/sources/otodom.test.ts`.
- `drizzle/0004_multiportal.sql` + `drizzle/meta/0004_snapshot.json` (+ `_journal.json` entry).
- Fixtures: `test/fixtures/olx-detail.html`, `test/fixtures/otodom-detail.html`; trim `test/fixtures/{olx,otodom}-list.html`.

**Modify:**
- `src/db/schema.ts` — add `offers.source`.
- `src/pipeline/check.ts` — `CheckDeps`: drop `parseListUrls`/`parseDetail`, add `resolveSource`; `runCheck`/`processOffer` dispatch by source; set `source` on `NewOffer`.
- `src/pipeline/refresh.ts` — `RefreshDeps`: drop `parseDetail`, add `resolveSource`; pick parser by `existing.url`.
- `src/pipeline/deps.ts` — `buildCheckDeps`/`buildRefreshDeps` inject `resolveSource` instead of parsers.
- `src/api/validate.ts` — allow-list from `allowedHosts()`.
- `web/lib/api.ts` — `Offer.source`; encode externalId in refresh URL.
- `web/Dashboard.svelte` — source badge + filter.
- `web/Config.svelte` — hint text only.
- Tests: `test/check.test.ts`, `test/refresh.test.ts`, `test/validate.test.ts`.

**Note on `src/scraper/parse.ts`:** keep it (trojmiasto source imports its `parseDetail`/`listPageUrls`/`parseListUrls`/`extractExternalId`). The trojmiasto `Source` is a thin adapter, not a rewrite.

---

## Task 1: Sources scaffold + trojmiasto source (namespaced, nothing wired)

Build the registry and the trojmiasto `Source` returning namespaced ids. The pipeline and DB are untouched, so all existing tests stay green.

**Files:**
- Create: `src/scraper/sources/types.ts`, `src/scraper/sources/registry.ts`, `src/scraper/sources/trojmiasto.ts`
- Test: `test/sources/trojmiasto.test.ts`, `test/sources/registry.test.ts`

- [ ] **Step 1: Write the failing trojmiasto source test**

`test/sources/trojmiasto.test.ts`:
```ts
import { test, expect } from "bun:test";
import { trojmiasto } from "../../src/scraper/sources/trojmiasto";

test("trojmiasto.parseList namespaces externalId and tags source", async () => {
  const html = await Bun.file("test/fixtures/list.html").text();
  const items = trojmiasto.parseList(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.source).toBe("trojmiasto");
    expect(it.externalId).toMatch(/^trojmiasto:\d+$/);
    expect(it.url).toContain("trojmiasto.pl");
  }
});

test("trojmiasto.listPageUrls uses strona pagination", () => {
  const base = "https://ogloszenia.trojmiasto.pl/x.html";
  const urls = trojmiasto.listPageUrls(base, 2);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("strona=2");
});

test("trojmiasto.parseDetail extracts fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/detail.html").text();
  const d = trojmiasto.parseDetail(html);
  expect(d.title.length).toBeGreaterThan(0);
  expect(typeof d.price === "number" || d.price === null).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/sources/trojmiasto.test.ts`
Expected: FAIL — cannot resolve `../../src/scraper/sources/trojmiasto`.

- [ ] **Step 3: Create `types.ts`**

`src/scraper/sources/types.ts`:
```ts
import type { OfferDetail } from "../parse";

export type SourceId = "trojmiasto" | "olx" | "otodom";

export interface ListItem {
  externalId: string; // namespaced, e.g. "trojmiasto:123"
  url: string;        // absolute
  source: SourceId;
}

export type { OfferDetail };

export interface Source {
  id: SourceId;
  hosts: string[];
  listPageUrls(searchUrl: string, pages: number): string[];
  parseList(html: string): ListItem[];
  parseDetail(html: string): OfferDetail;
}
```

- [ ] **Step 4: Create `trojmiasto.ts`**

`src/scraper/sources/trojmiasto.ts`:
```ts
import type { Source, ListItem } from "./types";
import { parseListUrls, parseDetail, listPageUrls } from "../parse";

export const trojmiasto: Source = {
  id: "trojmiasto",
  hosts: ["ogloszenia.trojmiasto.pl"],
  listPageUrls,
  parseList(html: string): ListItem[] {
    return parseListUrls(html).map((it) => ({
      externalId: `trojmiasto:${it.externalId}`,
      url: it.url,
      source: "trojmiasto",
    }));
  },
  parseDetail,
};
```

- [ ] **Step 5: Run trojmiasto test to verify it passes**

Run: `bun test test/sources/trojmiasto.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing registry test**

`test/sources/registry.test.ts`:
```ts
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
```

- [ ] **Step 7: Run it to verify it fails**

Run: `bun test test/sources/registry.test.ts`
Expected: FAIL — cannot resolve `registry`.

- [ ] **Step 8: Create `registry.ts`**

`src/scraper/sources/registry.ts`:
```ts
import type { Source } from "./types";
import { trojmiasto } from "./trojmiasto";

export const SOURCES: Source[] = [trojmiasto];

/** Strip a leading "www." so "www.olx.pl" and "olx.pl" both match. */
function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

export function resolveSource(url: string): Source | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  const norm = normalizeHost(host);
  for (const s of SOURCES) {
    if (s.hosts.some((h) => normalizeHost(h) === norm)) return s;
  }
  return null;
}

export function allowedHosts(): Set<string> {
  return new Set(SOURCES.flatMap((s) => s.hosts));
}
```

- [ ] **Step 9: Run all tests to confirm nothing regressed**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS — existing suite unchanged + new source/registry tests green.

- [ ] **Step 10: Commit**

```bash
git add src/scraper/sources test/sources
git commit -m "feat(sources): registry + trojmiasto source (namespaced ids), unwired"
```

---

## Task 2: Atomic cutover — source column, migration, pipeline dispatch

Add `offers.source`, migrate existing ids to `trojmiasto:NNN`, and switch the pipeline + refresh to `resolveSource`. Code and DB change together so namespaced ids stay consistent (a migrated DB against a bare-id pipeline would re-notify every offer).

**Files:**
- Modify: `src/db/schema.ts`, `src/pipeline/check.ts`, `src/pipeline/refresh.ts`, `src/pipeline/deps.ts`, `test/check.test.ts`, `test/refresh.test.ts`
- Create: `drizzle/0004_multiportal.sql`, `drizzle/meta/0004_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Back up the dev DB (mandatory before migration work)**

Run: `make db-backup`
Expected: a dump file is written (see Makefile target). Confirm it exists and is non-empty before continuing. Do NOT run `make up-fresh` (destroys the volume).

- [ ] **Step 2: Add the `source` column to the schema**

`src/db/schema.ts` — in the `offers` table, after the `district` column (or anywhere in the table body), add:
```ts
  source: text("source").notNull().default("trojmiasto"),
```

- [ ] **Step 3: Hand-author the migration SQL**

`drizzle/0004_multiportal.sql`:
```sql
ALTER TABLE "offers" ADD COLUMN "source" text DEFAULT 'trojmiasto' NOT NULL;--> statement-breakpoint
UPDATE "offers" SET "external_id" = 'trojmiasto:' || "external_id" WHERE "external_id" NOT LIKE '%:%';
```

- [ ] **Step 4: Hand-author the snapshot + journal entry**

Copy `drizzle/meta/0003_snapshot.json` to `drizzle/meta/0004_snapshot.json`. In the copy:
- set `"id"` to `"a1b2c3d4-0004-4000-8000-000000000004"`,
- set `"prevId"` to `"a1b2c3d4-0003-4000-8000-000000000003"` (the 0003 `id`),
- in `tables["public.offers"].columns`, add:
```json
"source": { "name": "source", "type": "text", "primaryKey": false, "notNull": true, "default": "'trojmiasto'" }
```

Append to the `entries` array in `drizzle/meta/_journal.json` (after the `0003_multisource` object):
```json
{ "idx": 4, "version": "7", "when": 1780531200000, "tag": "0004_multiportal", "breakpoints": true }
```

- [ ] **Step 5: Apply the migration to the dev DB**

Run: `DATABASE_URL=postgres://wynajem:wynajem@localhost:5432/wynajem bun run db:migrate`
Expected: migration `0004_multiportal` applies cleanly. (PGlite tests run migrations automatically via `test/setup.ts`.)

- [ ] **Step 6: Update `check.test.ts` to inject `resolveSource` (failing)**

In `test/check.test.ts`, replace the `parseListUrls`/`parseDetail` deps in `makeDeps` with a fake source resolver. Change the two lines:
```ts
    parseListUrls: () => [{ externalId: "100", url: "https://x/a-ogl100.html" }],
    parseDetail: () => ({ title: "Ładne 2pok", price: 3500, area: 50, rooms: 2, district: "Wrzeszcz", description: "blisko SKM", images: ["https://img/1.jpg", "https://img/2.jpg"] }),
```
to:
```ts
    resolveSource: () => ({
      id: "trojmiasto",
      hosts: ["x"],
      listPageUrls: (u: string, pages: number) => {
        const urls = [u];
        for (let p = 2; p <= pages; p++) urls.push(`${u}/?strona=${p}`);
        return urls;
      },
      parseList: (html: string) =>
        html === "<list2>" ? [{ externalId: "200", url: "https://x/b-ogl200.html", source: "trojmiasto" }]
        : html === "<list-b>" ? [
            { externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" },
            { externalId: "200", url: "https://x/b-ogl200.html", source: "trojmiasto" },
          ]
        : [{ externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" }],
      parseDetail: (html: string) => {
        if (html === "boom") throw new Error("malformed detail page");
        return { title: "Ładne 2pok", price: 3500, area: 50, rooms: 2, district: "Wrzeszcz", description: "blisko SKM", images: ["https://img/1.jpg", "https://img/2.jpg"] };
      },
    }),
```
Then update the per-test overrides that used `parseListUrls`/`parseDetail` (the "isolated failing offer", "maxDetailFetchesPerRun", "concurrencyLimit", "listPages", "scrapes every source", "failing hard filters", "below threshold") to override `resolveSource` instead, returning a source whose `parseList`/`parseDetail` produce the same data. Keep the asserted ids as they are (`"100"`, `"good"`, etc.) — the fake source returns ids verbatim; only the real trojmiasto source namespaces.

> Note for the implementer: the simplest mechanical change is to define a `makeSource(over)` helper in the test file that returns a `Source` with sensible defaults and per-test overrides, then pass `resolveSource: () => makeSource({...})`. Repeat the full default bodies — do not reference other tasks.

- [ ] **Step 7: Run check tests to verify they fail**

Run: `bun test test/check.test.ts`
Expected: FAIL — `CheckDeps` has no `resolveSource` yet / `parseListUrls` removed.

- [ ] **Step 8: Refactor `check.ts` to dispatch by source**

`src/pipeline/check.ts`:
- Replace imports `import type { ListItem, OfferDetail } from "../scraper/parse"; import { listPageUrls } from "../scraper/parse";` with:
```ts
import type { ListItem } from "../scraper/sources/types";
import type { Source } from "../scraper/sources/types";
```
- In `CheckDeps`, remove `parseListUrls`, `parseDetail`, and the `listPageUrls` usage; add:
```ts
  resolveSource: (url: string) => Source | null;
```
- In `runCheck`, replace the source loop body:
```ts
    for (const searchUrl of config.searchUrls) {
      const src = deps.resolveSource(searchUrl);
      if (!src) {
        await deps.log.log({ level: "warn", event: "source.unknown", message: `no parser for ${searchUrl}`, context: { searchUrl } });
        continue;
      }
      for (const pageUrl of src.listPageUrls(searchUrl, config.listPages)) {
        await sleep(config.requestDelayMs);
        const html = await deps.fetchPage(pageUrl);
        for (const it of src.parseList(html)) {
          if (!merged.has(it.externalId)) merged.set(it.externalId, it);
        }
      }
    }
```
- In `processOffer`, resolve the detail parser per item and set `source`:
```ts
    const src = deps.resolveSource(item.url);
    if (!src) throw new Error(`no parser for ${item.url}`);
    await sleep(config.requestDelayMs);
    const detailHtml = await deps.fetchPage(item.url);
    const d = src.parseDetail(detailHtml);

    const base: NewOffer = {
      externalId: item.externalId,
      url: item.url,
      source: item.source,
      title: d.title, price: d.price, area: d.area, rooms: d.rooms,
      district: d.district, description: d.description, images: d.images,
    };
```

- [ ] **Step 9: Run check tests to verify they pass**

Run: `bun test test/check.test.ts`
Expected: PASS.

- [ ] **Step 10: Update `refresh.ts` + `refresh.test.ts` to dispatch by source**

In `src/pipeline/refresh.ts`:
- Replace `import type { OfferDetail } from "../scraper/parse";` with `import type { Source } from "../scraper/sources/types";`.
- In `RefreshDeps`, replace `parseDetail: (html: string) => OfferDetail;` with `resolveSource: (url: string) => Source | null;`.
- In `refreshOffer`, after `const html = await deps.fetchPage(existing.url);`:
```ts
  const src = deps.resolveSource(existing.url);
  if (!src) throw new Error(`no parser for ${existing.url}`);
  const d = src.parseDetail(html);
```
- Add `source: existing.source` to the `row: NewOffer`.

In `test/refresh.test.ts`, replace the injected `parseDetail` with:
```ts
    resolveSource: () => ({
      id: "trojmiasto", hosts: ["x"],
      listPageUrls: (u: string) => [u],
      parseList: () => [],
      parseDetail: () => ({ title: "Odświeżone", price: 3000, area: 45, rooms: 2, district: "W", description: "x", images: [] }),
    }),
```
Ensure any `existing` offer stub the test passes to `getOffer` includes `source: "trojmiasto"`.

- [ ] **Step 11: Wire `deps.ts` to inject `resolveSource`**

`src/pipeline/deps.ts`:
- Replace `import { parseListUrls, parseDetail } from "../scraper/parse";` with `import { resolveSource } from "../scraper/sources/registry";`.
- In `buildCheckDeps`, replace `parseListUrls, parseDetail,` with `resolveSource,`.
- In `buildRefreshDeps`, replace `parseDetail,` with `resolveSource,`.

- [ ] **Step 12: Full typecheck + suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS — all suites green on PGlite.

- [ ] **Step 13: Commit**

```bash
git add src/db/schema.ts src/pipeline drizzle test/check.test.ts test/refresh.test.ts
git commit -m "feat(pipeline): namespace offer ids + dispatch parsers by source; add offers.source + migration 0004"
```

---

## Task 3: SSRF allow-list from the registry

`validate.ts` derives its allowed scrape hosts from the registry, so adding a portal automatically extends the allow-list.

**Files:**
- Modify: `src/api/validate.ts`, `test/validate.test.ts`

- [ ] **Step 1: Add a failing test for a non-trojmiasto allowed host**

In `test/validate.test.ts`, add (note: OLX won't be allowed until its source exists in Task 4 — this test asserts the mechanism uses the registry, so for now assert trojmiasto passes and a random host fails):
```ts
import { allowedHosts } from "../src/scraper/sources/registry";

test("searchUrls validation uses the registry allow-list", () => {
  const host = [...allowedHosts()][0]!;
  const ok = validateConfigPatch({ searchUrls: [`https://${host}/x`] });
  expect(ok.ok).toBe(true);
  const bad = validateConfigPatch({ searchUrls: ["https://evil.example/x"] });
  expect(bad.ok).toBe(false);
});
```

- [ ] **Step 2: Run it to verify current behavior**

Run: `bun test test/validate.test.ts`
Expected: PASS for the existing single-host const, but it will keep passing — the point is to make the source the registry. Proceed to refactor and confirm it still passes.

- [ ] **Step 3: Refactor `validate.ts`**

`src/api/validate.ts`:
- Add import: `import { allowedHosts } from "../scraper/sources/registry";`.
- Remove `const ALLOWED_SEARCH_HOST = "ogloszenia.trojmiasto.pl";`.
- Replace the host check inside the `searchUrls` loop:
```ts
      if (!allowedHosts().has(u.hostname)) {
        return { ok: false, error: `searchUrls host not allowed: ${u.hostname}` };
      }
```

- [ ] **Step 4: Run validate tests**

Run: `bun test test/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/validate.ts test/validate.test.ts
git commit -m "feat(validate): derive SSRF allow-list from source registry"
```

---

## Task 4: OLX source

Parse OLX list cards (native `/d/oferta/...-ID<token>.html` only — skip spliced-in `otodom.pl` cards) and OLX detail pages. Register OLX so its host becomes allowed.

**Files:**
- Create: `src/scraper/sources/olx.ts`, `test/sources/olx.test.ts`, `test/fixtures/olx-detail.html`
- Modify: `src/scraper/sources/registry.ts`, `test/fixtures/olx-list.html` (trim)

- [ ] **Step 1: Capture an OLX detail fixture and trim the list fixture**

Pick a native OLX offer URL from the list fixture (`grep -oE '/d/oferta/[^"]*-ID[0-9A-Za-z]+\.html' test/fixtures/olx-list.html | head -1`), fetch it live with the browser UA, save to `test/fixtures/olx-detail.html`:
```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
curl -sS -A "$UA" -H "Accept-Language: pl-PL,pl;q=0.9" -o test/fixtures/olx-detail.html "https://www.olx.pl<PATH-FROM-GREP>"
```
Trim `test/fixtures/olx-list.html` to a few cards but KEEP at least one native `/d/oferta/...-ID...html` card and at least one `https://www.otodom.pl/...` cross-post card (to assert it's filtered). Verify the trimmed file still contains both with `grep`.

- [ ] **Step 2: Write the failing OLX test**

`test/sources/olx.test.ts`:
```ts
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
    expect(it.url).not.toContain("otodom.pl"); // cross-posts skipped
  }
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length); // unique
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
  expect(d.title.length).toBeGreaterThan(0);
  expect(d.price === null || typeof d.price === "number").toBe(true);
  expect(d.area === null || typeof d.area === "number").toBe(true);
  expect(Array.isArray(d.images)).toBe(true);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/sources/olx.test.ts`
Expected: FAIL — cannot resolve `olx`.

- [ ] **Step 4: Implement `olx.ts`**

`src/scraper/sources/olx.ts`. Implementation notes grounded in the live fetch:
- **List:** match native offer links only. Regex over the HTML:
  `/href="(\/d\/oferta\/[^"]*-ID([0-9A-Za-z]+)\.html)[^"]*"/g`. For each match, externalId = `olx:<token>`, url = `new URL(path, "https://www.olx.pl").toString()` with the query string stripped (drop `?search_reason=...`). Dedup by externalId in a `Map`. Cross-posted otodom cards have absolute `https://www.otodom.pl/...` hrefs and won't match the `/d/oferta/` pattern, so they're naturally excluded.
- **Detail:** prefer JSON in `window.__PRERENDERED_STATE__` if reliably parseable; otherwise fall back to JSON-LD `@type:Offer` / `og:` meta tags using the same helpers as `parse.ts` (`metaContent`, `firstJsonLd`). Extract title (`og:title`), price (JSON-LD `offers.price` or "NNN zł" pattern), area (m² pattern or OLX param block), rooms (rooms param or title), district (locality), images (JSON-LD `image[]` / `og:image`).

```ts
import type { Source, ListItem, OfferDetail } from "./types";

const OLX_ORIGIN = "https://www.olx.pl";

export function parseList(html: string): ListItem[] {
  const re = /href="(\/d\/oferta\/[^"]*-ID([0-9A-Za-z]+)\.html)[^"]*"/g;
  const seen = new Map<string, ListItem>();
  for (const m of html.matchAll(re)) {
    const token = m[2]!;
    const id = `olx:${token}`;
    if (seen.has(id)) continue;
    const url = new URL(m[1]!, OLX_ORIGIN);
    url.search = "";
    seen.set(id, { externalId: id, url: url.toString(), source: "olx" });
  }
  return [...seen.values()];
}

export function listPageUrls(searchUrl: string, pages: number): string[] {
  const n = Math.max(1, Math.floor(pages));
  const urls = [searchUrl];
  for (let p = 2; p <= n; p++) {
    const u = new URL(searchUrl);
    u.searchParams.set("page", String(p));
    urls.push(u.toString());
  }
  return urls;
}

export function parseDetail(html: string): OfferDetail {
  // See implementation notes; reuse meta/JSON-LD extraction. Return the OfferDetail shape.
  // (Implementer: write concrete extraction here, asserted by the fixture test.)
  // ...
}

export const olx: Source = { id: "olx", hosts: ["www.olx.pl", "olx.pl"], listPageUrls, parseList, parseDetail };
```

> The `parseDetail` body must be written concretely against `test/fixtures/olx-detail.html` so the Step 2 assertions pass (title non-empty, price/area numeric-or-null, images array). Use the same `metaContent`/`firstJsonLd` helpers as `parse.ts` (export them from `parse.ts` or copy into a shared `src/scraper/html.ts` if cleaner — extracting shared helpers is in scope here).

- [ ] **Step 5: Register OLX**

In `src/scraper/sources/registry.ts`:
```ts
import { olx } from "./olx";
export const SOURCES: Source[] = [trojmiasto, olx];
```

- [ ] **Step 6: Run OLX + registry + validate tests**

Run: `bun test test/sources/olx.test.ts test/sources/registry.test.ts test/validate.test.ts`
Expected: PASS — OLX parses, and `allowedHosts()` now includes `www.olx.pl`.

- [ ] **Step 7: Full typecheck + suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/scraper/sources/olx.ts src/scraper/sources/registry.ts test/sources/olx.test.ts test/fixtures/olx-list.html test/fixtures/olx-detail.html src/scraper/parse.ts src/scraper/html.ts
git commit -m "feat(sources): OLX list + detail parser (skips otodom cross-posts)"
```

---

## Task 5: Otodom source

Parse Otodom's `__NEXT_DATA__` JSON for both list and detail.

**Files:**
- Create: `src/scraper/sources/otodom.ts`, `test/sources/otodom.test.ts`, `test/fixtures/otodom-detail.html`
- Modify: `src/scraper/sources/registry.ts`, `test/fixtures/otodom-list.html` (trim)

- [ ] **Step 1: Capture an Otodom detail fixture and trim the list fixture**

Pick an offer slug from the list fixture (`grep -oE '/pl/oferta/[a-z0-9-]+' test/fixtures/otodom-list.html | head -1`), fetch live, save to `test/fixtures/otodom-detail.html`:
```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
curl -sS -A "$UA" -H "Accept-Language: pl-PL,pl;q=0.9" -o test/fixtures/otodom-detail.html "https://www.otodom.pl<SLUG-PATH>"
```
Trim `test/fixtures/otodom-list.html` so the `__NEXT_DATA__` script still contains a few `AdvertListItem` entries (the JSON must remain valid — trim by keeping the whole `__NEXT_DATA__` script and cutting other page chrome, not by editing inside the JSON).

- [ ] **Step 2: Write the failing Otodom test**

`test/sources/otodom.test.ts`:
```ts
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
});

test("otodom.listPageUrls paginates with &page=N", () => {
  const base = "https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/pomorskie/gdansk/gdansk/gdansk?limit=36";
  const urls = otodom.listPageUrls(base, 2);
  expect(urls[0]).toBe(base);
  expect(urls[1]).toContain("page=2");
});

test("otodom.parseDetail extracts core fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/otodom-detail.html").text();
  const d = otodom.parseDetail(html);
  expect(d.title.length).toBeGreaterThan(0);
  expect(d.price === null || typeof d.price === "number").toBe(true);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/sources/otodom.test.ts`
Expected: FAIL — cannot resolve `otodom`.

- [ ] **Step 4: Implement `otodom.ts`**

`src/scraper/sources/otodom.ts`. Notes grounded in the live fetch:
- A shared helper extracts the `__NEXT_DATA__` JSON:
  `html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)` → `JSON.parse(m[1])`.
- **List:** the list items live under `props.pageProps` — locate the array of `AdvertListItem` objects (search the parsed JSON for the array whose elements have `__typename === "AdvertListItem"`, or follow `props.pageProps.data.searchAds.items`). For each item: externalId = `otodom:${item.id}`, url = `https://www.otodom.pl/pl/oferta/${item.slug}`, source `"otodom"`. Dedup by id.
- **Detail:** parse `__NEXT_DATA__` on the offer page; read `props.pageProps.ad` (title, `target`/`characteristics` for price/area/rooms, `location` for district, `images[].large`). Map into `OfferDetail`. Price from `totalPrice.value` or `characteristics`. Write concretely against the fixture so Step 2 assertions pass.

```ts
import type { Source, ListItem, OfferDetail } from "./types";

const OTODOM_ORIGIN = "https://www.otodom.pl";

export function extractNextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("otodom: __NEXT_DATA__ not found");
  return JSON.parse(m[1]!);
}

export function parseList(html: string): ListItem[] {
  const data = extractNextData(html);
  // locate AdvertListItem[] — implementer pins the exact path from the fixture
  const items: any[] = /* e.g. */ data.props?.pageProps?.data?.searchAds?.items ?? [];
  const seen = new Map<string, ListItem>();
  for (const it of items) {
    if (!it?.id || !it?.slug) continue;
    const id = `otodom:${it.id}`;
    if (seen.has(id)) continue;
    seen.set(id, { externalId: id, url: `${OTODOM_ORIGIN}/pl/oferta/${it.slug}`, source: "otodom" });
  }
  return [...seen.values()];
}

export function listPageUrls(searchUrl: string, pages: number): string[] {
  const n = Math.max(1, Math.floor(pages));
  const urls = [searchUrl];
  for (let p = 2; p <= n; p++) {
    const u = new URL(searchUrl);
    u.searchParams.set("page", String(p));
    urls.push(u.toString());
  }
  return urls;
}

export function parseDetail(html: string): OfferDetail {
  const data = extractNextData(html);
  // implementer: map props.pageProps.ad → OfferDetail against the fixture
  // ...
}

export const otodom: Source = { id: "otodom", hosts: ["www.otodom.pl", "otodom.pl"], listPageUrls, parseList, parseDetail };
```

> Implementer: pin `searchAds.items` (and the detail `ad` path) to whatever the fixture actually contains — confirm with `bun -e 'const d=require("./...json"); ...'` against the extracted `__NEXT_DATA__`. The fixture test is the contract.

- [ ] **Step 5: Register Otodom**

In `src/scraper/sources/registry.ts`:
```ts
import { otodom } from "./otodom";
export const SOURCES: Source[] = [trojmiasto, olx, otodom];
```

- [ ] **Step 6: Run Otodom + registry tests**

Run: `bun test test/sources/otodom.test.ts test/sources/registry.test.ts`
Expected: PASS — `allowedHosts()` now includes `www.otodom.pl`.

- [ ] **Step 7: Full typecheck + suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/scraper/sources/otodom.ts src/scraper/sources/registry.ts test/sources/otodom.test.ts test/fixtures/otodom-list.html test/fixtures/otodom-detail.html
git commit -m "feat(sources): Otodom list + detail parser via __NEXT_DATA__"
```

---

## Task 6: Web UI — source badge + filter

Surface `source` on the dashboard: a per-offer badge and a client-side source filter.

**Files:**
- Modify: `web/lib/api.ts`, `web/Dashboard.svelte`, `web/Config.svelte`

- [ ] **Step 1: Add `source` to the `Offer` type and encode the refresh id**

`web/lib/api.ts`:
- In `interface Offer`, add `source: string;`.
- In `refreshOffer`, encode the (now colon-containing) externalId:
```ts
  const res = await fetch(`/api/offers/${encodeURIComponent(externalId)}/refresh`, { method: "POST" });
```

- [ ] **Step 2: Add the badge + filter to `Dashboard.svelte`**

`web/Dashboard.svelte`:
- Add a `let sourceFilter = $state("all")` rune.
- Derive the visible list: `const visible = $derived(sourceFilter === "all" ? offers : offers.filter((o) => o.source === sourceFilter))` (adapt to the file's existing offers variable/pattern).
- Render a small filter control (buttons or a `<select>`: All / trojmiasto / OLX / Otodom) styled with the existing dark-glass classes. Avoid stacking a new `backdrop-filter` over the aurora (see glass-perf note in the spec).
- On each offer card, render a badge showing `offer.source` (label map: `trojmiasto → "trójmiasto"`, `olx → "OLX"`, `otodom → "Otodom"`) with a distinct color per source.

> Adapt names to the actual `Dashboard.svelte` structure (offers state, card markup). Keep the filter purely client-side over already-loaded offers — no API change.

- [ ] **Step 3: Update the Config hint text**

`web/Config.svelte`: update the helper/label text near the `searchUrls` textarea to read e.g. "Linki wyszukiwań (jeden na linię) — OLX / Otodom / trojmiasto". No logic change.

- [ ] **Step 4: Build the SPA**

Run: `bun run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api.ts web/Dashboard.svelte web/Config.svelte
git commit -m "feat(web): source badge + client-side source filter on dashboard"
```

---

## Task 7: Full verification + Docker smoke

- [ ] **Step 1: Full local verification**

Run: `bunx tsc --noEmit && bun test && bun run build`
Expected: typecheck clean, all tests pass on PGlite, SPA builds.

- [ ] **Step 2: Smoke-test in dev Docker**

Run: `make up` (NOT `up-fresh`). Once the app is up:
- In the web UI, set `searchUrls` to one OLX, one Otodom, and one trojmiasto search URL (the spec's example URLs).
- Trigger a manual run ("Uruchom crawler" / `POST /api/run`).
- Confirm via the Logs page (or DB) that offers from all three sources are stored with the right `source` and namespaced `external_id`, and that the dashboard shows source badges and the filter works.
- Pick one OLX and one Otodom offer and use "odśwież" to confirm refresh dispatches the right detail parser.

Run: `make down` when finished.

- [ ] **Step 3: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(multi-portal): verification fixups"
```

- [ ] **Step 4: Integration**

Use the `superpowers:finishing-a-development-branch` skill to decide how to integrate `feat/multi-portal` (merge to `main` or open a PR).

---

## Self-Review notes

- **Spec coverage:** registry/dispatch (Tasks 1–2), namespacing + migration (Task 2), `source` column (Task 2), SSRF allow-list (Task 3), OLX parser incl. otodom-cross-post filtering (Task 4), Otodom `__NEXT_DATA__` parser (Task 5), refresh dispatch (Task 2 Step 10), UI badge + filter (Task 6), fixtures (Tasks 1/4/5), verification + Docker e2e (Task 7). All spec sections map to a task.
- **Type consistency:** `Source`/`ListItem`/`SourceId` defined once in Task 1 `types.ts` and used verbatim everywhere; `resolveSource` signature `(url: string) => Source | null` consistent across `CheckDeps`, `RefreshDeps`, `deps.ts`, and tests; `allowedHosts(): Set<string>` consistent in registry + validate.
- **Known soft spots (call out during execution):** OLX/Otodom `parseDetail` bodies are described, not fully literal, because their exact field paths must be pinned against the freshly-captured detail fixtures — the fixture tests are the contract that forces correctness. The Otodom `searchAds.items` path is a best guess from the list fixture and must be confirmed against the trimmed `__NEXT_DATA__` before the test will pass.
