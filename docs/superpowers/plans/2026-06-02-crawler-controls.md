# Crawler Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable in-process crawl concurrency, more config options (upper-bound filters, list pages, fetch cap, request delay), a "run crawler" button, and a per-offer "refresh" button.

**Architecture:** One shared `runCheck` pipeline runs the sequential `for` loop as a bounded in-process worker pool sized by `config.concurrencyLimit`. The same pipeline backs both the scheduled trigger.dev task and a new in-process `POST /api/run` endpoint (single-flight guarded). A new `refreshOffer` pipeline re-scrapes one offer behind `POST /api/offers/:externalId/refresh`. New config fields are stored in Postgres, validated, and edited in the Svelte Config panel.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (postgres), `bun:test`, Svelte 5 (runes), Tailwind, trigger.dev v4.

**Spec:** `docs/superpowers/specs/2026-06-02-crawler-controls-design.md`

---

## File Structure

- `src/db/schema.ts` — add 6 columns to `config` table (modify).
- `drizzle/` — generated migration (create via drizzle-kit).
- `src/api/validate.ts` — whitelist + range-validate the new fields (modify).
- `src/pipeline/filter.ts` — `maxArea` / `maxRooms` upper bounds (modify).
- `src/pipeline/pool.ts` — bounded worker-pool helper (create).
- `src/scraper/parse.ts` — `listPageUrls()` pagination helper (modify).
- `src/pipeline/check.ts` — extract `processOffer` + `maybeScore`, multi-page, cap, pool, delay (modify).
- `src/db/queries.ts` — `getOfferByExternalId()` (modify).
- `src/pipeline/refresh.ts` — `refreshOffer()` single-offer pipeline (create).
- `src/pipeline/deps.ts` — `buildDeps()` composition factory (create).
- `trigger/check-offers.ts` — use `buildDeps`, set machine preset (modify).
- `src/api/server.ts` — `POST /api/run` (single-flight) + `POST /api/offers/:externalId/refresh` (modify).
- `web/lib/api.ts` — new `Config` fields + `runCrawler()` / `refreshOffer()` clients (modify).
- `web/Config.svelte` — `maxArea`/`maxRooms` + "Wydajność" fieldset (modify).
- `web/Dashboard.svelte` — run button + per-offer refresh button (modify).
- Tests: `test/pool.test.ts`, `test/parse-list.test.ts`, `test/filter.test.ts`, `test/validate.test.ts`, `test/check.test.ts`, `test/refresh.test.ts`, `test/queries.test.ts`, `test/api.test.ts`.

---

## Task 1: Add config columns to schema

**Files:**
- Modify: `src/db/schema.ts:23-35`

- [ ] **Step 1: Add the six columns to the `config` table**

In `src/db/schema.ts`, replace the `config` table definition (lines 23-35) with:

```ts
export const config = pgTable("config", {
  id: integer("id").primaryKey().default(1),
  searchUrl: text("search_url").notNull(),
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  minArea: doublePrecision("min_area"),
  minRooms: integer("min_rooms"),
  maxArea: doublePrecision("max_area"),
  maxRooms: integer("max_rooms"),
  aiCriteria: text("ai_criteria").notNull().default(""),
  scoreThreshold: integer("score_threshold").notNull().default(70),
  pollIntervalMin: integer("poll_interval_min").notNull().default(5),
  appriseUrls: text("apprise_urls").array().notNull().default([]),
  deepseekEnabled: boolean("deepseek_enabled").notNull().default(true),
  listPages: integer("list_pages").notNull().default(1),
  maxDetailFetchesPerRun: integer("max_detail_fetches_per_run").notNull().default(30),
  requestDelayMs: integer("request_delay_ms").notNull().default(0),
  concurrencyLimit: integer("concurrency_limit").notNull().default(1),
});
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new SQL file appears under `drizzle/` adding the 6 columns; command exits 0.

- [ ] **Step 3: Apply the migration to the dev DB**

Run: `bun run db:migrate`
Expected: "migrations applied" / no error (requires `DATABASE_URL` reachable).

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (the `Config` inferred type now includes the new fields).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add crawl-control config columns"
```

---

## Task 2: Validate the new config fields

**Files:**
- Modify: `src/api/validate.ts:4-7,56-74`
- Test: `test/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/validate.test.ts`:

```ts
test("accepts new crawl-control fields within range", () => {
  const r = validateConfigPatch({
    maxArea: 80, maxRooms: 4, listPages: 3,
    maxDetailFetchesPerRun: 50, requestDelayMs: 250, concurrencyLimit: 8,
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.patch.concurrencyLimit).toBe(8);
});

test("rejects out-of-range crawl-control fields", () => {
  expect(validateConfigPatch({ concurrencyLimit: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ concurrencyLimit: 17 }).ok).toBe(false);
  expect(validateConfigPatch({ listPages: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ listPages: 11 }).ok).toBe(false);
  expect(validateConfigPatch({ maxDetailFetchesPerRun: 0 }).ok).toBe(false);
  expect(validateConfigPatch({ requestDelayMs: -1 }).ok).toBe(false);
  expect(validateConfigPatch({ requestDelayMs: 10001 }).ok).toBe(false);
  expect(validateConfigPatch({ maxArea: -1 }).ok).toBe(false);
  expect(validateConfigPatch({ maxArea: null }).ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/validate.test.ts`
Expected: FAIL — new fields are dropped by the whitelist so `concurrencyLimit` is `undefined` / range rejections don't happen.

- [ ] **Step 3: Extend the whitelist and add range checks**

In `src/api/validate.ts`, replace the `EDITABLE` array (lines 4-7):

```ts
const EDITABLE: (keyof Config)[] = [
  "searchUrl", "minPrice", "maxPrice", "minArea", "minRooms",
  "maxArea", "maxRooms",
  "aiCriteria", "scoreThreshold", "pollIntervalMin", "appriseUrls", "deepseekEnabled",
  "listPages", "maxDetailFetchesPerRun", "requestDelayMs", "concurrencyLimit",
];
```

Then change the min-fields loop (currently line 56) to include the new nullable number fields:

```ts
  for (const k of ["minPrice", "maxPrice", "minArea", "minRooms", "maxArea", "maxRooms"] as const) {
    if (k in patch && !isNonNegNumberOrNull(patch[k])) {
      return { ok: false, error: `${k} must be a non-negative number or null` };
    }
  }
```

And add these bounded-integer checks just before the final `return { ok: true, ... }`:

```ts
  const intRanges: Record<string, [number, number]> = {
    listPages: [1, 10],
    maxDetailFetchesPerRun: [1, 500],
    requestDelayMs: [0, 10000],
    concurrencyLimit: [1, 16],
  };
  for (const [k, [lo, hi]] of Object.entries(intRanges)) {
    if (k in patch) {
      const v = patch[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) {
        return { ok: false, error: `${k} must be an integer ${lo}-${hi}` };
      }
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/validate.ts test/validate.test.ts
git commit -m "feat(api): validate crawl-control config fields"
```

---

## Task 3: Upper-bound filters (maxArea, maxRooms)

**Files:**
- Modify: `src/pipeline/filter.ts:1-19`
- Test: `test/filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/filter.test.ts`:

```ts
const cfgMax = { minPrice: null, maxPrice: null, minArea: null, minRooms: null, maxArea: 60, maxRooms: 3 };

test("rejects above maxArea", () => {
  expect(passesFilters({ price: 3000, area: 75, rooms: 2 }, cfgMax)).toBe(false);
});

test("rejects above maxRooms", () => {
  expect(passesFilters({ price: 3000, area: 50, rooms: 5 }, cfgMax)).toBe(false);
});

test("passes within max bounds", () => {
  expect(passesFilters({ price: 3000, area: 55, rooms: 3 }, cfgMax)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/filter.test.ts`
Expected: FAIL — `maxArea`/`maxRooms` are not checked (and not on `FilterBounds`).

- [ ] **Step 3: Add the bounds**

Replace `src/pipeline/filter.ts` lines 1-19 with:

```ts
export interface FilterBounds {
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  minRooms: number | null;
  maxArea: number | null;
  maxRooms: number | null;
}
export interface FilterableOffer {
  price: number | null;
  area: number | null;
  rooms: number | null;
}

export function passesFilters(o: FilterableOffer, b: FilterBounds): boolean {
  if (b.minPrice != null && o.price != null && o.price < b.minPrice) return false;
  if (b.maxPrice != null && o.price != null && o.price > b.maxPrice) return false;
  if (b.minArea != null && o.area != null && o.area < b.minArea) return false;
  if (b.minRooms != null && o.rooms != null && o.rooms < b.minRooms) return false;
  if (b.maxArea != null && o.area != null && o.area > b.maxArea) return false;
  if (b.maxRooms != null && o.rooms != null && o.rooms > b.maxRooms) return false;
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/filter.test.ts`
Expected: PASS (existing `cfg` literal has no `maxArea`/`maxRooms`, which TypeScript would flag — the test file's `cfg` is a plain object passed positionally; add `maxArea: null, maxRooms: null` to the existing `cfg` on line 4 of `test/filter.test.ts` so it satisfies `FilterBounds`).

Updated line 4:
```ts
const cfg = { minPrice: 1000, maxPrice: 4000, minArea: 35, minRooms: 2, maxArea: null, maxRooms: null };
```

Re-run: `bun test test/filter.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/filter.ts test/filter.test.ts
git commit -m "feat(filter): maxArea and maxRooms upper bounds"
```

---

## Task 4: Bounded worker-pool helper

**Files:**
- Create: `src/pipeline/pool.ts`
- Test: `test/pool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/pool.test.ts`:

```ts
import { test, expect } from "bun:test";
import { runPool } from "../src/pipeline/pool";

test("processes every item exactly once", async () => {
  const seen: number[] = [];
  await runPool([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
  expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
});

test("never exceeds the concurrency limit", async () => {
  let active = 0, peak = 0;
  await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  expect(peak).toBeLessThanOrEqual(3);
});

test("limit < 1 is treated as 1", async () => {
  const seen: number[] = [];
  await runPool([1, 2], 0, async (n) => { seen.push(n); });
  expect(seen.sort()).toEqual([1, 2]);
});

test("empty input resolves without error", async () => {
  await runPool([], 4, async () => { throw new Error("should not run"); });
  expect(true).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/pool.test.ts`
Expected: FAIL — module `../src/pipeline/pool` not found.

- [ ] **Step 3: Implement the pool**

Create `src/pipeline/pool.ts`:

```ts
/**
 * Run `worker` over `items` with at most `limit` concurrent invocations.
 * Resolves once every item has been processed. The worker is responsible for
 * its own error handling — a thrown worker rejects the whole pool.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.floor(limit));
  let next = 0;
  async function runner(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!, i);
    }
  }
  const runners = Array.from({ length: Math.min(size, items.length) }, () => runner());
  await Promise.all(runners);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/pool.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pool.ts test/pool.test.ts
git commit -m "feat(pipeline): bounded worker-pool helper"
```

---

## Task 5: List pagination helper

**Files:**
- Modify: `src/scraper/parse.ts` (append `listPageUrls`)
- Test: `test/parse-list.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/parse-list.test.ts`:

```ts
import { listPageUrls } from "../src/scraper/parse";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/parse-list.test.ts`
Expected: FAIL — `listPageUrls` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/scraper/parse.ts`:

```ts
/**
 * Build URLs for the first `pages` list pages. Page 1 is the search URL
 * verbatim; subsequent pages set the trojmiasto `strona` query param.
 * NOTE: the pagination param is `strona` — verify against a live page-2 URL
 * (Step 4) and change the single `set("strona", …)` line if the site differs.
 */
export function listPageUrls(searchUrl: string, pages: number): string[] {
  const n = Math.max(1, Math.floor(pages));
  const urls = [searchUrl];
  for (let p = 2; p <= n; p++) {
    const u = new URL(searchUrl);
    u.searchParams.set("strona", String(p));
    urls.push(u.toString());
  }
  return urls;
}
```

- [ ] **Step 4: Run to verify it passes, then verify the live pagination param**

Run: `bun test test/parse-list.test.ts`
Expected: PASS.

Then confirm the real pagination param against the site (one-off investigation called out in the spec):

```bash
curl -s "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/" | grep -oE 'strona[=,][0-9]+' | head
```
Expected: matches like `strona=2` (query) confirm the helper. If instead the site uses a path segment (e.g. `,strona,2`), update only the loop body in `listPageUrls` to construct that form and adjust the test's `toContain` assertions accordingly, then re-run Step 3-4.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/parse.ts test/parse-list.test.ts
git commit -m "feat(scraper): list pagination url helper"
```

---

## Task 6: Refactor check.ts — processOffer, maybeScore, multi-page, cap, pool, delay

**Files:**
- Modify: `src/pipeline/check.ts`
- Test: `test/check.test.ts`

- [ ] **Step 1: Update the shared test config and add new behavior tests**

In `test/check.test.ts`, replace `baseConfig` (lines 5-10) so it carries the new fields (concurrency 1 = unchanged behavior):

```ts
const baseConfig = {
  id: 1, searchUrl: "https://search",
  minPrice: null, maxPrice: 4000, minArea: 30, minRooms: 2,
  maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: ["json://x"], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 1,
};
```

Append these tests:

```ts
test("maxDetailFetchesPerRun caps how many fresh offers are processed", async () => {
  const cfg = { ...baseConfig, maxDetailFetchesPerRun: 1 };
  const { deps, upserts } = makeDeps({
    getConfig: async () => cfg as any,
    parseListUrls: () => [
      { externalId: "1", url: "https://x/a-ogl1.html" },
      { externalId: "2", url: "https://x/b-ogl2.html" },
    ],
  });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(1);
  expect(upserts.length).toBe(1);
});

test("concurrencyLimit > 1 still processes every fresh offer once", async () => {
  const cfg = { ...baseConfig, concurrencyLimit: 4, maxDetailFetchesPerRun: 30 };
  const ids = ["1", "2", "3", "4", "5"];
  const { deps, upserts } = makeDeps({
    getConfig: async () => cfg as any,
    parseListUrls: () => ids.map((i) => ({ externalId: i, url: `https://x/o-ogl${i}.html` })),
  });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(5);
  expect(upserts.length).toBe(5);
});

test("listPages > 1 fetches and merges multiple list pages (dedup by externalId)", async () => {
  const pages: Record<string, string> = {
    "https://search": "<list1>",
    "https://search/?strona=2": "<list2>",
  };
  const fetched: string[] = [];
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, listPages: 2 }) as any,
    fetchPage: async (url) => {
      fetched.push(url);
      if (url.includes("ogl")) return "<detail>";
      return pages[url] ?? "<list>";
    },
    parseListUrls: (html) =>
      html === "<list2>"
        ? [{ externalId: "200", url: "https://x/b-ogl200.html" }]
        : [{ externalId: "100", url: "https://x/a-ogl100.html" }],
  });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(2);
  expect(fetched.some((u) => u.includes("strona=2"))).toBe(true);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `bun test test/check.test.ts`
Expected: FAIL — cap is not enforced, only one list page is fetched.

- [ ] **Step 3: Rewrite check.ts with the pool, cap, multi-page, delay, and extracted helpers**

Replace the body of `src/pipeline/check.ts` from the `import` lines and `runCheck` with:

```ts
import type { Config, NewOffer } from "../db/schema";
import { passesFilters } from "./filter";
import type { ListItem, OfferDetail } from "../scraper/parse";
import { listPageUrls } from "../scraper/parse";
import { runPool } from "./pool";
import type { Logger } from "../log/logger";

export interface CheckDeps {
  getConfig: () => Promise<Config>;
  getKnownExternalIds: () => Promise<Set<string>>;
  upsertOffer: (o: NewOffer) => Promise<void>;
  markNotified: (externalId: string) => Promise<void>;
  markInactive: (activeExternalIds: string[]) => Promise<void>;
  fetchPage: (url: string) => Promise<string>;
  parseListUrls: (html: string) => ListItem[];
  parseDetail: (html: string) => OfferDetail;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  sendNotification: (input: {
    appriseUrl: string; targets: string[]; title: string; body: string;
  }) => Promise<void>;
  appriseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  log: Logger;
}

export interface CheckSummary {
  listedCount: number;
  newCount: number;
  notifiedCount: number;
  errorCount: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Score a detail page if DeepSeek is enabled, else return nulls. */
export async function maybeScore(
  detail: OfferDetail,
  config: Config,
  deps: Pick<CheckDeps, "scoreOffer" | "deepseekApiKey" | "deepseekBaseUrl">,
): Promise<{ score: number | null; reasons: string | null }> {
  if (!config.deepseekEnabled) return { score: null, reasons: null };
  const r = await deps.scoreOffer(
    { description: detail.description, criteria: config.aiCriteria },
    { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
  );
  return { score: r.score, reasons: r.reasons };
}

/** Process one fresh offer: fetch detail, filter, score, upsert, notify.
 *  Returns whether it notified / errored. Never throws (errors are logged). */
export async function processOffer(
  item: ListItem,
  config: Config,
  deps: CheckDeps,
): Promise<{ notified: boolean; error: boolean }> {
  try {
    await sleep(config.requestDelayMs);
    const detailHtml = await deps.fetchPage(item.url);
    const d = deps.parseDetail(detailHtml);

    const base: NewOffer = {
      externalId: item.externalId,
      url: item.url,
      title: d.title,
      price: d.price,
      area: d.area,
      rooms: d.rooms,
      district: d.district,
      description: d.description,
    };

    if (!passesFilters(d, config)) {
      await deps.upsertOffer(base);
      return { notified: false, error: false };
    }

    const { score, reasons } = await maybeScore(d, config, deps);
    await deps.upsertOffer({ ...base, score, scoreReasons: reasons });

    const meetsThreshold = config.deepseekEnabled ? (score ?? 0) >= config.scoreThreshold : true;
    if (!meetsThreshold) return { notified: false, error: false };

    const title = `Nowa oferta: ${d.title}`.slice(0, 120);
    const body =
      `${d.price ?? "?"} zł · ${d.area ?? "?"} m² · ${d.rooms ?? "?"} pok · ${d.district ?? ""}\n` +
      (reasons ? `AI: ${reasons}\n` : "") +
      item.url;
    await deps.sendNotification({
      appriseUrl: deps.appriseUrl,
      targets: config.appriseUrls,
      title,
      body,
    });
    await deps.markNotified(item.externalId);
    return { notified: true, error: false };
  } catch (err) {
    await deps.log.log({
      level: "error",
      event: "offer.error",
      message: `failed processing offer ${item.externalId}`,
      context: { externalId: item.externalId, url: item.url, error: String(err) },
    });
    return { notified: false, error: true };
  }
}

export async function runCheck(deps: CheckDeps): Promise<CheckSummary> {
  try {
    await deps.log.log({ level: "info", event: "run.start", message: "check started" });
    const config = await deps.getConfig();

    // Fetch + merge every configured list page; parseListUrls dedups per page,
    // the Map below dedups across pages by externalId.
    const merged = new Map<string, ListItem>();
    for (const pageUrl of listPageUrls(config.searchUrl, config.listPages)) {
      await sleep(config.requestDelayMs);
      const html = await deps.fetchPage(pageUrl);
      for (const it of deps.parseListUrls(html)) {
        if (!merged.has(it.externalId)) merged.set(it.externalId, it);
      }
    }
    const items = [...merged.values()];
    const activeIds = items.map((i) => i.externalId);

    const known = await deps.getKnownExternalIds();
    const fresh = items.filter((i) => !known.has(i.externalId)).slice(0, config.maxDetailFetchesPerRun);

    let notifiedCount = 0;
    let errorCount = 0;
    await runPool(fresh, config.concurrencyLimit, async (item) => {
      const r = await processOffer(item, config, deps);
      if (r.notified) notifiedCount++;
      if (r.error) errorCount++;
    });

    await deps.markInactive(activeIds);

    const summary = { listedCount: items.length, newCount: fresh.length, notifiedCount, errorCount };
    await deps.log.log({
      level: "info",
      event: "run.finish",
      message: `check finished: ${summary.listedCount} listed, ${summary.newCount} new, ${summary.notifiedCount} notified, ${summary.errorCount} errors`,
      context: summary,
    });
    return summary;
  } catch (err) {
    await deps.log.log({
      level: "error",
      event: "run.error",
      message: `check aborted: ${String(err)}`,
      context: { error: String(err) },
    });
    throw err;
  }
}
```

Note: counter increments inside `runPool` are safe — JS runs each `worker` body to completion between awaits without preemption, and the `notifiedCount++` happens synchronously after the awaited `processOffer` resolves.

- [ ] **Step 4: Run the full pipeline test suite**

Run: `bun test test/check.test.ts`
Expected: PASS (original 9 + 3 new tests). The "failing offer is isolated" test still passes because `processOffer` catches and logs `offer.error` and returns `{ error: true }`.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/check.ts test/check.test.ts
git commit -m "feat(pipeline): concurrency pool, multi-page, fetch cap, request delay"
```

---

## Task 7: getOfferByExternalId query

**Files:**
- Modify: `src/db/queries.ts`
- Test: `test/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/queries.test.ts` (follow the file's existing imports/setup; it already imports from `./schema` and the `db` client — add `getOfferByExternalId` to the `../src/db/queries` import):

```ts
test("getOfferByExternalId returns the row or null", async () => {
  await upsertOffer({ externalId: "ext-1", url: "https://x/a-ogl1.html", title: "T" });
  const found = await getOfferByExternalId("ext-1");
  expect(found?.externalId).toBe("ext-1");
  expect(await getOfferByExternalId("nope")).toBeNull();
});
```

If `upsertOffer` / `getOfferByExternalId` are not yet imported in this file, add them to the existing `import { … } from "../src/db/queries";` line.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/queries.test.ts`
Expected: FAIL — `getOfferByExternalId` is not exported.

- [ ] **Step 3: Implement the query**

Append to `src/db/queries.ts`:

```ts
export async function getOfferByExternalId(externalId: string): Promise<Offer | null> {
  const rows = await db.select().from(offers).where(eq(offers.externalId, externalId)).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts test/queries.test.ts
git commit -m "feat(db): getOfferByExternalId query"
```

---

## Task 8: refreshOffer single-offer pipeline

**Files:**
- Create: `src/pipeline/refresh.ts`
- Test: `test/refresh.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/refresh.test.ts`:

```ts
import { test, expect } from "bun:test";
import { refreshOffer, type RefreshDeps } from "../src/pipeline/refresh";

const baseConfig = {
  id: 1, searchUrl: "https://search",
  minPrice: null, maxPrice: null, minArea: null, minRooms: null,
  maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: [], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 1,
};

function makeDeps(over: Partial<RefreshDeps> = {}): { deps: RefreshDeps; upserts: any[] } {
  const upserts: any[] = [];
  const deps: RefreshDeps = {
    getConfig: async () => baseConfig as any,
    getOffer: async () => ({ externalId: "100", url: "https://x/a-ogl100.html" } as any),
    fetchPage: async () => "<detail>",
    parseDetail: () => ({ title: "Re 2pok", price: 3400, area: 48, rooms: 2, district: "Oliwa", description: "blisko SKM" }),
    scoreOffer: async () => ({ score: 91, reasons: "świetna" }),
    upsertOffer: async (o) => { upserts.push(o); },
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    log: { log() {} },
    ...over,
  };
  return { deps, upserts };
}

test("refreshOffer re-scrapes, re-scores and upserts", async () => {
  const { deps, upserts } = makeDeps();
  const updated = await refreshOffer("100", deps);
  expect(upserts[0].score).toBe(91);
  expect(updated.title).toBe("Re 2pok");
  expect(updated.score).toBe(91);
});

test("refreshOffer skips scoring when deepseek disabled", async () => {
  let scored = false;
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, deepseekEnabled: false }) as any,
    scoreOffer: async () => { scored = true; return { score: 0, reasons: "" }; },
  });
  const updated = await refreshOffer("100", deps);
  expect(scored).toBe(false);
  expect(updated.score).toBeNull();
});

test("refreshOffer throws OfferNotFound for an unknown id", async () => {
  const { deps } = makeDeps({ getOffer: async () => null });
  await expect(refreshOffer("404", deps)).rejects.toThrow("offer not found");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/refresh.test.ts`
Expected: FAIL — module `../src/pipeline/refresh` not found.

- [ ] **Step 3: Implement refreshOffer**

Create `src/pipeline/refresh.ts`:

```ts
import type { Config, NewOffer, Offer } from "../db/schema";
import type { OfferDetail } from "../scraper/parse";
import { maybeScore } from "./check";
import type { Logger } from "../log/logger";

export interface RefreshDeps {
  getConfig: () => Promise<Config>;
  getOffer: (externalId: string) => Promise<Offer | null>;
  fetchPage: (url: string) => Promise<string>;
  parseDetail: (html: string) => OfferDetail;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  upsertOffer: (o: NewOffer) => Promise<void>;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  log: Logger;
}

/** Re-fetch one offer's detail page, re-score it, persist, and return the
 *  refreshed row. Throws "offer not found" if the externalId is unknown. */
export async function refreshOffer(externalId: string, deps: RefreshDeps): Promise<Offer> {
  const existing = await deps.getOffer(externalId);
  if (!existing) throw new Error("offer not found");

  const config = await deps.getConfig();
  const html = await deps.fetchPage(existing.url);
  const d = deps.parseDetail(html);
  const { score, reasons } = await maybeScore(d, config, deps);

  const row: NewOffer = {
    externalId,
    url: existing.url,
    title: d.title,
    price: d.price,
    area: d.area,
    rooms: d.rooms,
    district: d.district,
    description: d.description,
    score,
    scoreReasons: reasons,
  };
  await deps.upsertOffer(row);
  await deps.log.log({
    level: "info",
    event: "offer.refresh",
    message: `refreshed offer ${externalId}`,
    context: { externalId, score },
  });

  const updated = await deps.getOffer(externalId);
  return updated ?? ({ ...existing, ...row, score, scoreReasons: reasons } as Offer);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/refresh.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/refresh.ts test/refresh.test.ts
git commit -m "feat(pipeline): refreshOffer single-offer re-scrape"
```

---

## Task 9: buildDeps composition factory + trigger refactor

**Files:**
- Create: `src/pipeline/deps.ts`
- Modify: `trigger/check-offers.ts`

- [ ] **Step 1: Create the factory**

Create `src/pipeline/deps.ts`:

```ts
import type { AppConfig } from "../config";
import type { CheckDeps } from "./check";
import type { RefreshDeps } from "./refresh";
import type { Logger } from "../log/logger";
import { withLogging } from "../log/logger";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
  getOfferByExternalId,
} from "../db/queries";
import { fetchPage } from "../scraper/fetch";
import { parseListUrls, parseDetail } from "../scraper/parse";
import { scoreOffer } from "../scorer/deepseek";
import { sendNotification } from "../notify/apprise";

/** Compose the logged CheckDeps used by runCheck (trigger task + manual run). */
export function buildCheckDeps(env: AppConfig, logger: Logger): CheckDeps {
  return withLogging(
    {
      getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
      fetchPage, parseListUrls, parseDetail, scoreOffer, sendNotification,
      appriseUrl: env.appriseUrl,
      deepseekApiKey: env.deepseekApiKey,
      deepseekBaseUrl: env.deepseekBaseUrl,
      log: logger,
    },
    logger,
  );
}

/** Compose deps for the single-offer refresh path. */
export function buildRefreshDeps(env: AppConfig, logger: Logger): RefreshDeps {
  return {
    getConfig,
    getOffer: getOfferByExternalId,
    fetchPage,
    parseDetail,
    scoreOffer,
    upsertOffer,
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
    log: logger,
  };
}
```

- [ ] **Step 2: Refactor the trigger task to use buildCheckDeps and set a machine preset**

Replace `trigger/check-offers.ts` with:

```ts
import { schedules, logger as triggerLogger } from "@trigger.dev/sdk";
import { runCheck } from "../src/pipeline/check";
import { loadConfig } from "../src/config";
import { pruneLogs } from "../src/db/queries";
import { dbLogger, createRunLogger } from "../src/log/logger";
import { buildCheckDeps } from "../src/pipeline/deps";

export const checkOffers = schedules.task({
  id: "check-offers",
  cron: "*/5 * * * *",
  // More CPU headroom for the in-process concurrency pool (config.concurrencyLimit).
  // Machine is an infra property — it can't be DB-driven, so it lives here.
  machine: "small-2x",
  run: async () => {
    const env = loadConfig();
    const runId = crypto.randomUUID();
    const logger = createRunLogger(dbLogger, runId);
    const deps = buildCheckDeps(env, logger);

    try {
      const summary = await runCheck(deps);
      triggerLogger.info("check-offers done", {
        listedCount: summary.listedCount,
        newCount: summary.newCount,
        notifiedCount: summary.notifiedCount,
        errorCount: summary.errorCount,
      });
      return summary;
    } finally {
      await pruneLogs().catch((err) => console.error("pruneLogs failed:", err));
    }
  },
});
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS — no type errors; all existing + new tests green.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/deps.ts trigger/check-offers.ts
git commit -m "refactor(pipeline): buildDeps factory; trigger uses it + machine preset"
```

---

## Task 10: API endpoints — run + refresh

**Files:**
- Modify: `src/api/server.ts`
- Test: `test/api.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/api.test.ts`, change the server creation in `beforeAll` (line 16) to inject fakes (no network):

```ts
  server = createServer(0, {
    runCrawler: async () => "run-test-id",
    refreshOfferById: async (externalId) =>
      externalId === "100"
        ? ({ id: 1, externalId, title: "Refreshed", price: 3000, area: 40, rooms: 2,
             district: "X", url: "https://x/a-ogl100.html", score: 80, scoreReasons: "ok",
             status: "active", notified: false, firstSeen: "", lastSeen: "" } as any)
        : null,
  });
```

Append these tests:

```ts
test("POST /api/run starts a run and reports 202", async () => {
  const res = await fetch(`${base}/api/run`, { method: "POST" });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { runId: string };
  expect(typeof body.runId).toBe("string");
});

test("POST /api/offers/:id/refresh returns the updated offer", async () => {
  const res = await fetch(`${base}/api/offers/100/refresh`, { method: "POST" });
  expect(res.status).toBe(200);
  const o = (await res.json()) as Record<string, unknown>;
  expect(o.title).toBe("Refreshed");
});

test("POST refresh returns 404 for unknown offer", async () => {
  const res = await fetch(`${base}/api/offers/999/refresh`, { method: "POST" });
  expect(res.status).toBe(404);
});

test("POST refresh returns 400 for non-numeric id", async () => {
  const res = await fetch(`${base}/api/offers/abc/refresh`, { method: "POST" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/api.test.ts`
Expected: FAIL — `createServer` ignores the 2nd arg; `/api/run` and refresh routes 404.

- [ ] **Step 3: Add the options param, single-flight run, and refresh route**

In `src/api/server.ts`, add imports at the top (after the existing imports):

```ts
import type { Offer } from "../db/schema";
import { loadConfig } from "../config";
import { runCheck } from "../pipeline/check";
import { refreshOffer } from "../pipeline/refresh";
import { buildCheckDeps, buildRefreshDeps } from "../pipeline/deps";
import { dbLogger, createRunLogger } from "../log/logger";

export interface ServerOptions {
  runCrawler?: () => Promise<string>;
  refreshOfferById?: (externalId: string) => Promise<Offer | null>;
}

// Default in-process crawl: build logged deps and run the pipeline, returning a runId.
function defaultRunCrawler(): Promise<string> {
  const env = loadConfig();
  const runId = crypto.randomUUID();
  const logger = createRunLogger(dbLogger, runId);
  // Fire-and-forget: the caller gets the runId immediately; progress lands in logs.
  void runCheck(buildCheckDeps(env, logger)).catch((err) =>
    console.error("manual runCheck failed:", err),
  );
  return Promise.resolve(runId);
}

function defaultRefresh(externalId: string): Promise<Offer | null> {
  const env = loadConfig();
  const logger = createRunLogger(dbLogger, crypto.randomUUID());
  return refreshOffer(externalId, buildRefreshDeps(env, logger)).catch((err) => {
    if (String(err).includes("offer not found")) return null;
    throw err;
  });
}
```

Change the signature to `export function createServer(port: number, opts: ServerOptions = {})` and, at the top of the function body (before `return Bun.serve`), add the single-flight state and resolved handlers:

```ts
  const runCrawler = opts.runCrawler ?? defaultRunCrawler;
  const refreshOfferById = opts.refreshOfferById ?? defaultRefresh;
  let runInFlight = false;
```

Add these route handlers inside `fetch`, before the static-SPA block:

```ts
      if (path === "/api/run" && req.method === "POST") {
        if (runInFlight) return json({ error: "a run is already in progress" }, 409);
        runInFlight = true;
        try {
          const runId = await runCrawler();
          return json({ runId }, 202);
        } finally {
          // For the default fire-and-forget runner the pipeline keeps going in the
          // background; the flag only debounces rapid double-clicks at trigger time.
          runInFlight = false;
        }
      }

      const refreshMatch = path.match(/^\/api\/offers\/([^/]+)\/refresh$/);
      if (refreshMatch && req.method === "POST") {
        const externalId = decodeURIComponent(refreshMatch[1]!);
        if (!/^\d+$/.test(externalId)) return json({ error: "invalid offer id" }, 400);
        const updated = await refreshOfferById(externalId);
        if (!updated) return json({ error: "offer not found" }, 404);
        return json(updated);
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/api.test.ts`
Expected: PASS (existing 4 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat(api): POST /api/run (single-flight) and /api/offers/:id/refresh"
```

---

## Task 11: Web API client additions

**Files:**
- Modify: `web/lib/api.ts`

- [ ] **Step 1: Extend the Config type**

In `web/lib/api.ts`, replace the `Config` interface (lines 8-13) with:

```ts
export interface Config {
  searchUrl: string; minPrice: number | null; maxPrice: number | null;
  minArea: number | null; minRooms: number | null;
  maxArea: number | null; maxRooms: number | null;
  aiCriteria: string;
  scoreThreshold: number; pollIntervalMin: number;
  appriseUrls: string[]; deepseekEnabled: boolean;
  listPages: number; maxDetailFetchesPerRun: number;
  requestDelayMs: number; concurrencyLimit: number;
}
```

- [ ] **Step 2: Add the run + refresh clients**

Append to `web/lib/api.ts`:

```ts
export async function runCrawler(): Promise<{ runId: string }> {
  const res = await fetch("/api/run", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Run failed (HTTP ${res.status})`);
  return data as { runId: string };
}

export async function refreshOffer(externalId: string): Promise<Offer> {
  const res = await fetch(`/api/offers/${externalId}/refresh`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Refresh failed (HTTP ${res.status})`);
  return data as Offer;
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(web): runCrawler + refreshOffer API clients, Config fields"
```

---

## Task 12: Config panel — new fields

**Files:**
- Modify: `web/Config.svelte`

- [ ] **Step 1: Add maxArea / maxRooms to the Filtry fieldset**

In `web/Config.svelte`, inside the "Filtry" fieldset grid (after the `minRooms` label, around line 58), add:

```svelte
        <label class="grid gap-[7px]"><span class={labelSpan}>Max metraż</span><input type="number" bind:value={cfg.maxArea} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Max pokoje</span><input type="number" bind:value={cfg.maxRooms} class={control} /></label>
```

- [ ] **Step 2: Add a "Wydajność" fieldset**

After the "Ocena AI" fieldset (before the "Powiadomienia" fieldset, around line 80), add:

```svelte
    <fieldset class={panel}>
      <legend class={legend}>Wydajność</legend>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px]">
        <label class="grid gap-[7px]"><span class={labelSpan}>Workers (równolegle)</span><input type="number" min="1" max="16" bind:value={cfg.concurrencyLimit} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Strony listy</span><input type="number" min="1" max="10" bind:value={cfg.listPages} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Max pobrań / przebieg</span><input type="number" min="1" max="500" bind:value={cfg.maxDetailFetchesPerRun} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Opóźnienie (ms)</span><input type="number" min="0" max="10000" bind:value={cfg.requestDelayMs} class={control} /></label>
      </div>
    </fieldset>
```

- [ ] **Step 3: Build the SPA to verify it compiles**

Run: `bun run build`
Expected: build succeeds, no Svelte compile errors.

- [ ] **Step 4: Commit**

```bash
git add web/Config.svelte
git commit -m "feat(web): config fields for max bounds + performance"
```

---

## Task 13: Dashboard — run + refresh buttons

**Files:**
- Modify: `web/Dashboard.svelte`

- [ ] **Step 1: Import the new clients and add action state**

In `web/Dashboard.svelte`, change the import (line 3) and add state + handlers in the `<script>`:

```ts
  import { getOffers, runCrawler, refreshOffer, type Offer } from "./lib/api";
```

Add after the `loading` state (around line 6):

```ts
  let running = $state(false);
  let toast = $state("");
  let refreshingId = $state<string | null>(null);

  function flash(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ""), 2500);
  }

  async function onRun() {
    if (running) return;
    running = true;
    try {
      await runCrawler();
      flash("Crawler uruchomiony — wyniki pojawią się w logach.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Nie udało się uruchomić");
    } finally {
      running = false;
    }
  }

  async function onRefresh(o: Offer) {
    if (refreshingId) return;
    refreshingId = o.externalId;
    try {
      const updated = await refreshOffer(o.externalId);
      offers = offers.map((x) => (x.id === updated.id ? updated : x));
    } catch (e) {
      flash(e instanceof Error ? e.message : "Nie udało się odświeżyć");
    } finally {
      refreshingId = null;
    }
  }
```

- [ ] **Step 2: Add the "Uruchom crawler" button + toast to the header**

In the header `<section>` (around line 56), add a run button next to the view toggle group. Replace the closing of the `<div class="glass inline-flex …">` view group block's parent so the button sits beside it — insert before the view-toggle `<div class="glass inline-flex …">`:

```svelte
  <div class="flex items-center gap-3">
    <button
      onclick={onRun}
      disabled={running}
      class="inline-flex items-center gap-[7px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[16px] py-[8px] text-[0.85rem] font-semibold text-ink shadow-[var(--inset-sheen)] transition-[transform,background,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] hover:bg-[rgba(47,109,255,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={running ? "animate-spin" : ""}><path d="M5 3v4M3 5h4"/><path d="M12 5a7 7 0 1 1-7 7"/></svg>
      {running ? "Uruchamianie…" : "Uruchom crawler"}
    </button>
```

Then close that wrapper `</div>` after the existing view-toggle group `<div …role="group">…</div>`, and add the toast just below the header `<section>`:

```svelte
{#if toast}
  <div class="mb-4 animate-rise rounded-[12px] border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] px-4 py-3 text-[0.88rem] text-ink-2">{toast}</div>
{/if}
```

(The view-toggle group block already exists; this task only wraps it with the new flex container and prepends the run button.)

- [ ] **Step 3: Add a per-offer refresh button (cards + table)**

In the card `<footer>` (around line 118), add a refresh button before the "Otwórz" link:

```svelte
          <button
            onclick={() => onRefresh(o)}
            disabled={refreshingId === o.externalId}
            title="Odśwież i przelicz ocenę"
            aria-label="Odśwież ofertę"
            class="grid h-9 w-9 place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={refreshingId === o.externalId ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
          </button>
```

In the table action cell (around line 148), add before the "otwórz" link:

```svelte
              <button
                onclick={() => onRefresh(o)}
                disabled={refreshingId === o.externalId}
                title="Odśwież"
                aria-label="Odśwież ofertę"
                class="mr-3 align-middle text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline {refreshingId === o.externalId ? 'animate-spin' : ''}"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
              </button>
```

- [ ] **Step 4: Build and smoke-test the SPA**

Run: `bun run build`
Expected: build succeeds.

Then run the app and click through:
```bash
bun run dev
```
Manually verify (browser at the served port): the "Uruchom crawler" button shows a toast; a card's refresh button spins then updates that card. Stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add web/Dashboard.svelte
git commit -m "feat(web): run-crawler button and per-offer refresh"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: PASS — all suites (validate, filter, pool, parse-list, check, queries, refresh, api, plus untouched ones).

- [ ] **Step 2: Typecheck and build**

Run: `bunx tsc --noEmit && bun run build`
Expected: no type errors; SPA build succeeds.

- [ ] **Step 3: Verify the trigger task still loads (regression on the original Bun error)**

Run: `bun run trigger:dev` for ~10 seconds.
Expected: worker builds and `check-offers` is registered with no `ReferenceError`. Stop with Ctrl-C.

- [ ] **Step 4: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "chore: crawler controls — final verification" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** workers/concurrency → Task 4 + 6; new config options → Task 1, 2, 12; run-by-click → Task 10 (`/api/run`) + 13; update-offer-by-click → Task 7, 8, 10 (refresh) + 13. Machine preset → Task 9. Pagination unknown → Task 5 (with live verification step).
- **Single-flight** guards manual-vs-manual at trigger time (Task 10); manual-vs-scheduled overlap intentionally unlocked per spec (idempotent upserts).
- **Type consistency:** `maybeScore` (check.ts) is reused by `refresh.ts`; `buildCheckDeps`/`buildRefreshDeps` (deps.ts) feed `runCheck`/`refreshOffer`; `ServerOptions.refreshOfferById` returns `Offer | null` matching the 404 branch.
