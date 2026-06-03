# Paginated + Virtualized Infinite Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Oferty list one page at a time and render only the rows near the viewport, with infinite scroll across both the card grid and the table view.

**Architecture:** The backend keeps ranking/sorting the full active set in memory (vector cosine ranking must see every embedding), then slices the requested window and reports the total. The frontend accumulates pages, virtualizes the DOM by row using `@tanstack/virtual-core` (window scrolling) wrapped in a Svelte 5 rune, and fetches the next page when the last visible row nears the end.

**Tech Stack:** Bun, `postgres-js` + Drizzle (tests on PGlite), Svelte 5 (runes), `@tanstack/virtual-core`.

**Spec:** `docs/superpowers/specs/2026-06-03-paginated-virtual-scroll-design.md`

---

## File Structure

- `src/db/queries.ts` — `listOffers` / `searchOffers` return `Page<Offer> = { items, total }`; add deterministic ordering + `id` tiebreaker.
- `src/api/server.ts` — parse/clamp `limit`/`offset`, pass to queries, return `{ items, total }`.
- `web/lib/api.ts` — `Page<T>` type; `getOffers` / `searchOffers` take `(offset, limit)` and return `Page<Offer>`.
- `web/lib/virtual.svelte.ts` *(new)* — pure helpers (`columnsForWidth`, `chunkRows`) + `createWindowVirtualizer` rune wrapper.
- `web/VirtualList.svelte` *(new)* — windowed row renderer (cards rows and table rows).
- `web/Dashboard.svelte` — paged accumulation, infinite scroll, both views via the virtualizer.
- `package.json` — add `@tanstack/virtual-core`.
- `test/queries.test.ts`, `test/api.test.ts`, `test/virtual.test.ts` *(new)*.

> **Note on the public limit cap:** the spec mentions a `[1,100]` public cap with a `500` carve-out for the rescore reconcile. To avoid a special-case param, this plan uses a single hard clamp of `[1,500]` (default 50). Normal client calls pass 50; the reconcile passes the loaded count (≤500). This is a deliberate simplification of the spec.

---

## Task 1: Backend — paginate `listOffers` and `searchOffers`

**Files:**
- Modify: `src/db/queries.ts` (`listOffers` ~101-107, `searchOffers` ~175-202, add `Page` type near `SearchParams` ~164)
- Modify: `src/api/server.ts:117` and `src/api/server.ts:107-113` (callers must use `.items` — done fully in Task 2; here just keep it compiling)
- Test: `test/queries.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests to `test/queries.test.ts` (the file already imports `listOffers`, `searchOffers`, `upsertOffer`):

```ts
test("listOffers paginates with stable order and reports total", async () => {
  for (let i = 1; i <= 5; i++) {
    await upsertOffer({ externalId: String(i), url: "u", title: `t${i}`, score: i });
  }
  const page = await listOffers({ limit: 2, offset: 0 });
  expect(page.total).toBe(5);
  expect(page.items.length).toBe(2);
  // highest score first (5 then 4)
  expect(page.items.map((o) => o.externalId)).toEqual(["5", "4"]);

  const page2 = await listOffers({ limit: 2, offset: 2 });
  expect(page2.items.map((o) => o.externalId)).toEqual(["3", "2"]);

  // no overlap across pages
  const ids = new Set([...page.items, ...page2.items].map((o) => o.externalId));
  expect(ids.size).toBe(4);
});

test("listOffers without params returns all items with total", async () => {
  await upsertOffer({ externalId: "1", url: "u", title: "t1" });
  await upsertOffer({ externalId: "2", url: "u", title: "t2" });
  const page = await listOffers();
  expect(page.total).toBe(2);
  expect(page.items.length).toBe(2);
});

test("searchOffers paginates after ranking and reports total", async () => {
  for (let i = 1; i <= 4; i++) {
    await upsertOffer({ externalId: String(i), url: "u", title: `t${i}`, price: i * 1000 });
  }
  const page = await searchOffers({ sort: "price" }, { limit: 2, offset: 0 });
  expect(page.total).toBe(4);
  expect(page.items.map((o) => o.price)).toEqual([1000, 2000]);
  const page2 = await searchOffers({ sort: "price" }, { limit: 2, offset: 2 });
  expect(page2.items.map((o) => o.price)).toEqual([3000, 4000]);
});

test("searchOffers slices after cosine ranking", async () => {
  await upsertOffer({ externalId: "near", url: "u", title: "near", embedding: [1, 0] });
  await upsertOffer({ externalId: "far", url: "u", title: "far", embedding: [0, 1] });
  const page = await searchOffers({ queryEmbedding: [0.9, 0.1] }, { limit: 1, offset: 0 });
  expect(page.total).toBe(2);
  expect(page.items.map((o) => o.externalId)).toEqual(["near"]);
});
```

Update the **existing** call sites in the same file that now break (they used the array return):
- Line ~42: `const all = await listOffers();` → `const all = (await listOffers()).items;`
- Line ~61: same change.
- Line ~73: `const ids = (await listOffers()).map(...)` → `const ids = (await listOffers()).items.map(...)`
- Lines ~166, ~172, ~178, ~184: each `const r = await searchOffers({...});` → `const r = (await searchOffers({...})).items;`

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/queries.test.ts`
Expected: FAIL — the new tests fail (`page.total` undefined / `listOffers({...})` arg not accepted) and the type changes haven't been made.

- [ ] **Step 3: Implement pagination in `src/db/queries.ts`**

Add the page types just above `SearchParams` (~line 164):

```ts
export interface PageParams { limit: number; offset: number }
export interface Page<T> { items: T[]; total: number }

function paginate<T>(rows: T[], page?: PageParams): Page<T> {
  if (!page) return { items: rows, total: rows.length };
  return { items: rows.slice(page.offset, page.offset + page.limit), total: rows.length };
}
```

Replace `listOffers` (~101-107):

```ts
export async function listOffers(page?: PageParams): Promise<Page<Offer>> {
  // NULLS LAST so unscored offers don't float above scored ones (Postgres defaults NULLS FIRST on DESC).
  // id desc is the final tiebreaker so a row can't drift between page fetches.
  const rows = await db
    .select()
    .from(offers)
    .orderBy(sql`${offers.score} desc nulls last`, desc(offers.lastSeen), desc(offers.id));
  return paginate(rows, page);
}
```

Replace the body of `searchOffers` (~175-202) signature and ending:

```ts
export async function searchOffers(params: SearchParams, page?: PageParams): Promise<Page<Offer>> {
  const conds = [eq(offers.status, "active")];
  if (params.districts?.length) conds.push(inArray(offers.districtCanonical, params.districts));
  if (params.kinds?.length) conds.push(inArray(offers.kind, params.kinds));
  if (params.sources?.length) conds.push(inArray(offers.source, params.sources));
  if (params.features?.length) {
    const pgLiteral = "{" + params.features.map((f) => f.replace(/\\/g, "\\\\").replace(/"/g, '\\"')).join(",") + "}";
    conds.push(sql`${offers.features} @> ${pgLiteral}::text[]`);
  }

  // Deterministic base order so JS sorts (stable in ES2019+) and cosine tie-breaks are reproducible across pages.
  const rows = await db.select().from(offers).where(and(...conds)).orderBy(desc(offers.id));

  if (params.queryEmbedding && params.queryEmbedding.length) {
    return paginate(rankByCosine(rows, params.queryEmbedding, (o) => o.embedding ?? null), page);
  }

  const sorted = [...rows];
  switch (params.sort) {
    case "newest": sorted.sort((a, b) => +new Date(b.firstSeen) - +new Date(a.firstSeen) || b.id - a.id); break;
    case "price": sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || b.id - a.id); break;
    case "area": sorted.sort((a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity) || b.id - a.id); break;
    default: sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || +new Date(b.lastSeen) - +new Date(a.lastSeen) || b.id - a.id);
  }
  return paginate(sorted, page);
}
```

To keep `src/api/server.ts` compiling for now, change line 117 `return json(await listOffers());` → `return json((await listOffers()).items);` and line 113 `return json(results);` is preceded by `const results = await searchOffers({...});` → make it `const results = (await searchOffers({...})).items;`. (Task 2 replaces these properly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/queries.test.ts`
Expected: PASS (all tests, including the updated existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts src/api/server.ts test/queries.test.ts
git commit -m "feat(db): paginate listOffers/searchOffers with stable ordering"
```

---

## Task 2: Backend — API returns `{ items, total }` with clamped limit/offset

**Files:**
- Modify: `src/api/server.ts` (the `/api/offers/search` block ~89-114 and `/api/offers` block ~116-118)
- Test: `test/api.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/api.test.ts`. In `beforeAll`, after `ensureConfig`, seed offers (insert near the existing seeding, before `createServer`):

```ts
  for (let i = 1; i <= 3; i++) {
    await upsertOffer({ externalId: `p${i}`, url: "u", title: `paged ${i}`, score: i });
  }
```

(`upsertOffer` is already imported on line 5.) Then add tests:

```ts
test("GET /api/offers returns a page envelope", async () => {
  const res = await fetch(`${base}/api/offers?limit=2&offset=0`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: unknown[]; total: number };
  expect(body.total).toBe(3);
  expect(body.items.length).toBe(2);
});

test("GET /api/offers clamps limit and coerces negative offset", async () => {
  const res = await fetch(`${base}/api/offers?limit=99999&offset=-5`);
  const body = (await res.json()) as { items: unknown[]; total: number };
  expect(body.items.length).toBe(3); // clamped large limit returns all 3
  expect(body.total).toBe(3);
});

test("GET /api/offers/search returns a page envelope", async () => {
  const res = await fetch(`${base}/api/offers/search?sort=score&limit=1&offset=0`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: unknown[]; total: number };
  expect(body.total).toBe(3);
  expect(body.items.length).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/api.test.ts`
Expected: FAIL — `body.total` is undefined (endpoints currently return a bare array).

- [ ] **Step 3: Implement param parsing and `{ items, total }` responses**

In `src/api/server.ts`, add a helper just below the `json` helper (~line 39):

```ts
// limit: [1,500] (default 50); 500 ceiling covers the dashboard's rescore-reconcile
// which re-fetches the whole loaded window in one call. offset coerced to >= 0.
function parsePage(sp: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 500);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);
  return { limit, offset };
}
```

In the `/api/offers/search` block, replace the `const results = await searchOffers({...}); return json(results);` tail with:

```ts
        const page = await searchOffers({
          q, queryEmbedding,
          districts: list("districts"), kinds: list("kinds"),
          features: list("features"), sources: list("sources"),
          sort,
        }, parsePage(sp));
        return json(page);
```

Replace the `/api/offers` block (~116-118):

```ts
      if (path === "/api/offers" && req.method === "GET") {
        return json(await listOffers(parsePage(url.searchParams)));
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat(api): /api/offers and /search return {items,total} with clamped paging"
```

---

## Task 3: Frontend data layer — `Page<T>` type and paged fetchers

**Files:**
- Modify: `web/lib/api.ts` (`getOffers` ~33-35, `searchOffers` ~101-109)

- [ ] **Step 1: Add the `Page` type and update fetchers**

In `web/lib/api.ts`, add near the top (after the `Offer` interface, ~line 19):

```ts
export interface Page<T> { items: T[]; total: number }
```

Replace `getOffers` (~33-35):

```ts
export async function getOffers(offset = 0, limit = 50): Promise<Page<Offer>> {
  return (await fetch(`/api/offers?limit=${limit}&offset=${offset}`)).json();
}
```

Replace `searchOffers` (~101-109):

```ts
export async function searchOffers(query: SearchQuery, offset = 0, limit = 50): Promise<Page<Offer>> {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  for (const k of ["districts", "kinds", "features", "sources"] as const) {
    const v = query[k]; if (v && v.length) p.set(k, v.join(","));
  }
  if (query.sort) p.set("sort", query.sort);
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  return (await fetch(`/api/offers/search?${p.toString()}`)).json();
}
```

- [ ] **Step 2: Verify it compiles (build will fail at Dashboard until Task 7 — that's expected)**

This task has no standalone test; correctness is verified by the type changes consumed in Task 7. Do **not** run `bun run build` yet (Dashboard still uses the old shape). Proceed.

- [ ] **Step 3: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(web): page envelope + offset/limit in getOffers/searchOffers"
```

---

## Task 4: Frontend — pure virtual helpers (`columnsForWidth`, `chunkRows`)

**Files:**
- Create: `web/lib/virtual.svelte.ts`
- Test: `test/virtual.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

Create `test/virtual.test.ts`:

```ts
import { test, expect } from "bun:test";
import { columnsForWidth, chunkRows } from "../web/lib/virtual.svelte";

test("columnsForWidth forces 1 column below 560px", () => {
  expect(columnsForWidth(320)).toBe(1);
  expect(columnsForWidth(559)).toBe(1);
});

test("columnsForWidth derives columns from min card width + gap", () => {
  // (width + gap) / (290 + 18) = floor
  expect(columnsForWidth(600)).toBe(2);   // 618/308 = 2.00
  expect(columnsForWidth(940)).toBe(3);   // 958/308 = 3.11
  expect(columnsForWidth(1280)).toBe(4);  // 1298/308 = 4.21
});

test("columnsForWidth never returns less than 1", () => {
  expect(columnsForWidth(0)).toBe(1);
});

test("chunkRows splits items into rows of `cols`", () => {
  expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(chunkRows([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  expect(chunkRows([], 3)).toEqual([]);
});

test("chunkRows treats cols < 1 as 1", () => {
  expect(chunkRows([1, 2], 0)).toEqual([[1], [2]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/virtual.test.ts`
Expected: FAIL — module `web/lib/virtual.svelte` not found.

- [ ] **Step 3: Implement the pure helpers**

Create `web/lib/virtual.svelte.ts` with **only** the pure helpers for now (the rune wrapper is added in Task 5):

```ts
/** Columns that fit `width` px given a min card width and gap, matching the
 *  CSS grid `repeat(auto-fill, minmax(290px,1fr))` with an 18px gap and the
 *  `<560px → single column` rule used in Dashboard.svelte. */
export function columnsForWidth(width: number, minCardWidth = 290, gap = 18): number {
  if (width < 560) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

/** Group a flat list into rows of `cols` items (last row may be short). */
export function chunkRows<T>(items: T[], cols: number): T[][] {
  const n = Math.max(1, Math.floor(cols));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/virtual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/virtual.svelte.ts test/virtual.test.ts
git commit -m "feat(web): pure column/row helpers for virtualization"
```

---

## Task 5: Frontend — add `@tanstack/virtual-core` and the window virtualizer rune

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `web/lib/virtual.svelte.ts` (append `createWindowVirtualizer`)

- [ ] **Step 1: Install the dependency**

Run: `bun add @tanstack/virtual-core`
Expected: `@tanstack/virtual-core` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Inspect the installed API surface**

Run: `grep -E "export (declare )?(class|function|const) (Virtualizer|observeWindowRect|observeWindowOffset|windowScroll|measureElement)" node_modules/@tanstack/virtual-core/dist/esm/index.d.ts`
Expected: lines confirming `Virtualizer`, `observeWindowRect`, `observeWindowOffset`, `windowScroll`, `measureElement` are exported. If a name differs in the installed version, adjust the imports in Step 3 to match (the rest of the wrapper is unaffected).

- [ ] **Step 3: Append the rune wrapper to `web/lib/virtual.svelte.ts`**

```ts
import {
  Virtualizer,
  observeWindowRect,
  observeWindowOffset,
  windowScroll,
  measureElement,
  type VirtualItem,
} from "@tanstack/virtual-core";

export interface WindowVirtualizerOptions {
  /** reactive row count (e.g. () => rows.length) */
  count: () => number;
  /** estimated row height in px */
  estimateSize: () => number;
  /** distance from top of document to the list container (scroll-margin) */
  scrollMargin: () => number;
  overscan?: number;
}

/** Window-scrolling virtualizer bound to Svelte 5 runes. Returns reactive
 *  `virtualItems` / `totalSize` and a `measureElement` action for dynamic row
 *  heights. Call this during component init (it uses $state/$effect). */
export function createWindowVirtualizer(opts: WindowVirtualizerOptions) {
  let virtualItems = $state<VirtualItem[]>([]);
  let totalSize = $state(0);

  const instance = new Virtualizer<Window, Element>({
    count: opts.count(),
    getScrollElement: () => (typeof window !== "undefined" ? window : null),
    estimateSize: opts.estimateSize,
    scrollMargin: opts.scrollMargin(),
    overscan: opts.overscan ?? 4,
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    measureElement,
    onChange: (inst) => {
      virtualItems = inst.getVirtualItems();
      totalSize = inst.getTotalSize();
    },
  });

  // Mount: wires up the window scroll/resize observers; cleans up on destroy.
  $effect(() => instance._didMount());

  // Re-sync options whenever reactive inputs change, then recompute the window.
  $effect(() => {
    instance.setOptions({
      ...instance.options,
      count: opts.count(),
      scrollMargin: opts.scrollMargin(),
      estimateSize: opts.estimateSize,
    });
    instance._willUpdate();
    virtualItems = instance.getVirtualItems();
    totalSize = instance.getTotalSize();
  });

  return {
    get virtualItems() { return virtualItems; },
    get totalSize() { return totalSize; },
    /** use as `<div use:vrow={virtualizer.measureElement}>` or call directly */
    measureElement: (node: Element) => instance.measureElement(node),
  };
}
```

- [ ] **Step 4: Verify it type-checks via the build of a trivial importer**

This wrapper can't be unit-tested meaningfully (it needs a live DOM + scroll); it is verified end-to-end in Task 8. For now confirm the module parses:
Run: `bun build web/lib/virtual.svelte.ts --target=browser --outfile=/tmp/vc-check.js`
Expected: build succeeds (no unresolved imports / syntax errors).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock web/lib/virtual.svelte.ts
git commit -m "feat(web): window virtualizer rune over @tanstack/virtual-core"
```

---

## Task 6: Frontend — `VirtualList.svelte` windowed row renderer

**Files:**
- Create: `web/VirtualList.svelte`

This component owns the virtualizer + ResizeObserver and renders virtual **rows**. The parent passes the flat `items`, the `mode` (`"cards"` | `"table"`), a row `snippet`, and an `onLoadMore` callback. For `cards` each virtual row is a slice of `cols` items; for `table` each virtual row is one item. The row contents are provided by the parent via a Svelte snippet so this file stays view-agnostic.

- [ ] **Step 1: Create the component**

Create `web/VirtualList.svelte`:

```svelte
<script lang="ts">
  import { createWindowVirtualizer, columnsForWidth, chunkRows } from "./lib/virtual.svelte";
  import type { Offer } from "./lib/api";
  import type { Snippet } from "svelte";

  let {
    items,
    mode,
    row,
    onLoadMore,
    hasMore = false,
    estimateSize = mode === "table" ? 64 : 360,
  }: {
    items: Offer[];
    mode: "cards" | "table";
    row: Snippet<[Offer[]]>; // receives the offers in this virtual row (1 for table, `cols` for cards)
    onLoadMore: () => void;
    hasMore?: boolean;
    estimateSize?: number;
  } = $props();

  let container = $state<HTMLElement | null>(null);
  let cols = $state(1);

  // Track container width → column count (cards only; table is always 1 column).
  $effect(() => {
    const el = container;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      cols = mode === "table" ? 1 : columnsForWidth(el.clientWidth);
    });
    ro.observe(el);
    cols = mode === "table" ? 1 : columnsForWidth(el.clientWidth);
    return () => ro.disconnect();
  });

  const rows = $derived(chunkRows(items, cols));

  // scroll-margin = container's distance from top of document, so window coords map correctly.
  function scrollMargin() {
    return container ? container.getBoundingClientRect().top + window.scrollY : 0;
  }

  const v = createWindowVirtualizer({
    count: () => rows.length,
    estimateSize: () => estimateSize,
    scrollMargin,
    overscan: 4,
  });

  // Infinite scroll: when the last rendered virtual row is within the overscan of the end.
  $effect(() => {
    const vis = v.virtualItems;
    const last = vis[vis.length - 1];
    if (!last) return;
    if (hasMore && last.index >= rows.length - 1) onLoadMore();
  });
</script>

<div bind:this={container} style="position:relative; width:100%; height:{v.totalSize}px;">
  {#each v.virtualItems as vi (vi.key)}
    <div
      data-index={vi.index}
      use:measure={v.measureElement}
      style="position:absolute; top:0; left:0; width:100%; transform:translateY({vi.start - scrollMargin()}px);"
    >
      {@render row(rows[vi.index] ?? [])}
    </div>
  {/each}
</div>

<script module lang="ts">
  // Svelte action that registers a node with the virtualizer for dynamic measurement.
  function measure(node: HTMLElement, fn: (n: Element) => void) {
    fn(node);
    return { update: (f: (n: Element) => void) => f(node) };
  }
</script>
```

> Implementation note: `vi.start` is in virtualizer coordinates that already include `scrollMargin`; the absolute child is positioned relative to the `container`, so subtract `scrollMargin()` to convert back to container-local offset. If rows visually overlap or gap during manual verification (Task 8), this offset is the first thing to check.

- [ ] **Step 2: Verify the component builds**

Run: `bun run build`
Expected: build may still fail **only** because `Dashboard.svelte` hasn't been wired yet (Task 7). If the error mentions `VirtualList.svelte` itself, fix it; if it only mentions `Dashboard.svelte`, that's expected — proceed.

- [ ] **Step 3: Commit**

```bash
git add web/VirtualList.svelte
git commit -m "feat(web): VirtualList windowed row renderer (cards + table)"
```

---

## Task 7: Frontend — wire paged accumulation + infinite scroll into Dashboard

**Files:**
- Modify: `web/Dashboard.svelte`

- [ ] **Step 1: Replace the offers state and loaders (script section)**

In `web/Dashboard.svelte`, replace the `let offers ... = $state([])` line and the `getOffers`/`onSearch`/`onMount`/`handleEvent`-reconcile usages.

Add/replace state near the top of `<script>` (after line 8):

```ts
  import VirtualList from "./VirtualList.svelte";
  import type { Page } from "./lib/api";

  let offers: Offer[] = $state([]);
  let total = $state(0);
  let loadingMore = $state(false);
  let currentQuery = $state<SearchQuery | null>(null);
  const PAGE = 50;
  const hasMore = $derived(offers.length < total);

  async function fetchPage(offset: number): Promise<Page<Offer>> {
    return currentQuery ? searchOffers(currentQuery, offset, PAGE) : getOffers(offset, PAGE);
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const page = await fetchPage(offers.length);
      offers = [...offers, ...page.items];
      total = page.total;
    } finally {
      loadingMore = false;
    }
  }

  async function resetAndLoad() {
    loading = true;
    try {
      const page = await fetchPage(0);
      offers = page.items;
      total = page.total;
    } finally {
      loading = false;
    }
  }
```

Replace `onSearch` (~126-129):

```ts
  async function onSearch(query: SearchQuery) {
    currentQuery = query;
    await resetAndLoad();
  }
```

Replace the `onMount` body (~131-136) `offers = await getOffers();` line:

```ts
  onMount(async () => {
    await resetAndLoad();
    facets = await getFacets();
    connectWs();
  });
```

Replace the `rescore:done` reconcile inside `handleEvent` (~80-81) — instead of `getOffers().then((o) => (offers = o))`:

```ts
      // reconcile the already-loaded window without dropping scroll position
      fetchPage(0)
        .then((page) => { offers = page.items.slice(0, offers.length); total = page.total; });
```

> Note: `fetchPage(0)` requests `PAGE` (50) items. If more than 50 are loaded, call it with the loaded count instead. Replace the reconcile with the loaded-window version:

```ts
      (currentQuery
        ? searchOffers(currentQuery, 0, Math.max(offers.length, PAGE))
        : getOffers(0, Math.max(offers.length, PAGE))
      ).then((page) => { offers = page.items; total = page.total; });
```

(`Math.max(offers.length, PAGE)` ≤ 500 in practice; the server clamps at 500.)

- [ ] **Step 2: Replace the count badge**

Replace the badge (~line 156) `{offers.length}` with:

```svelte
      <span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] px-[11px] py-[3px] text-[0.85rem] font-bold text-ink-2 [font-variant-numeric:tabular-nums]">{offers.length} / {total}</span>
```

- [ ] **Step 3: Replace the cards block with VirtualList**

Replace the `{:else if view === "cards"}` block (~218-277). Keep the existing `<article>` markup verbatim inside a snippet:

```svelte
{:else if view === "cards"}
  <VirtualList items={offers} mode="cards" {hasMore} onLoadMore={loadMore} row={cardRow} />

{:else}
```

Define the `cardRow` snippet — place it just before the closing `</script>`-adjacent markup, i.e. immediately after the `openBtn` const block, inside the markup area add:

```svelte
{#snippet cardRow(rowOffers: Offer[])}
  <div class="grid gap-[18px]" style="grid-template-columns: repeat({rowOffers.length}, minmax(0,1fr));">
    {#each rowOffers as o (o.id)}
      <article
        class="glass relative flex cursor-pointer flex-col gap-3 rounded-[var(--radius-glass)] p-5 transition-[transform,border-color,background] duration-[400ms] {spring} hover:-translate-y-[5px] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-fill-strong)]"
        onclick={() => openDetail(o)}
        role="button" tabindex="0"
        onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openDetail(o)}
      >
        {#if o.notified}
          <span class="pointer-events-none absolute inset-0 rounded-[var(--radius-glass)] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4),0_0_30px_-6px_rgba(52,211,153,0.35)]"></span>
        {/if}
        {#if o.images?.length}
          <img src={o.images[0]} alt={o.title} loading="lazy" class="-mx-5 -mt-5 mb-1 h-[150px] w-[calc(100%+40px)] rounded-t-[var(--radius-glass)] object-cover" />
        {/if}
        <header class="flex items-center justify-between">
          <span class="inline-flex min-w-[54px] flex-col items-center justify-center rounded-[14px] border px-[10px] py-[7px] font-display text-[1.35rem] font-extrabold leading-none [font-variant-numeric:tabular-nums] {tierClass[tier(o.score)]}" title={o.scoreReasons ?? ""}>
            {o.score ?? "–"}
            <small class="mt-[3px] font-sans text-[0.55rem] font-semibold uppercase tracking-[0.12em] opacity-70">score</small>
          </span>
          <div class="flex items-center gap-[7px]">
            <span class="rounded-full border px-[9px] py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] {sourceClass(o.source)}" title="Źródło: {sourceLabel(o.source)}">{sourceLabel(o.source)}</span>
            {#if o.notified}<span class="rounded-full border border-good/30 bg-good/10 px-[9px] py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-good" title="Powiadomienie wysłane">powiadomiono</span>{/if}
          </div>
        </header>
        <h2 class="m-0 line-clamp-2 text-[0.98rem] font-semibold leading-[1.4] text-ink" title={o.title}>{o.title}</h2>
        <div class="font-display text-[1.85rem] font-bold tracking-[-0.02em] [font-variant-numeric:tabular-nums]">{fmtPln(o.price)} <span class="text-[0.95rem] font-semibold text-ink-3">zł</span></div>
        <div class="flex flex-wrap gap-[7px]">
          {#if o.area != null}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.area} m²</span>{/if}
          {#if o.rooms != null}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.rooms} pok.</span>{/if}
          {#if o.district}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.district}</span>{/if}
          {#each o.features ?? [] as f (f)}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{f}</span>{/each}
        </div>
        <footer class="mt-auto flex items-center justify-between gap-[10px] pt-[6px]">
          <span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span>
          <div class="flex items-center gap-[8px]">
            <button onclick={(e) => { e.stopPropagation(); onRefresh(o); }} disabled={refreshingIds.has(o.externalId)} title="Odśwież i przelicz ocenę" aria-label="Odśwież ofertę" class="grid h-9 w-9 place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors hover:text-ink disabled:opacity-50">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={refreshingIds.has(o.externalId) ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <a class={openBtn} href={o.url} target="_blank" rel="noreferrer" onclick={(e) => e.stopPropagation()}>
              Otwórz
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
            </a>
          </div>
        </footer>
      </article>
    {/each}
  </div>
{/snippet}
```

> The `animate-rise` / staggered `animation-delay` was removed from cards because virtualized rows mount/unmount continuously and per-item entrance animation would re-fire on every scroll. This is intentional.

- [ ] **Step 4: Replace the table block with VirtualList**

Replace the final `{:else}` table block (~279-325). The `<thead>` stays static; the `<tbody>` rows come from VirtualList. Because VirtualList renders rows as absolutely-positioned divs, the table is rendered as a CSS grid "table" is overkill — instead wrap the VirtualList **inside** the scvroll flow and let each virtual row be a full-width `<div>` styled like a row. Replace with:

```svelte
{:else}
  <div class="glass overflow-hidden rounded-[var(--radius-glass)]">
    <div class="grid grid-cols-[56px_64px_2fr_90px_110px_70px_70px_1fr_1.4fr_110px_90px_110px_120px] border-b border-[var(--glass-border)] bg-white/[0.03] px-4 py-[14px] text-[0.72rem] font-bold uppercase tracking-[0.07em] text-ink-3">
      <div></div><div>Score</div><div>Tytuł</div><div>Źródło</div><div class="text-right">Cena</div><div class="text-right">m²</div><div class="text-right">Pok.</div><div>Dzielnica</div><div>AI</div><div>Dodano</div><div>Powiad.</div><div>Status</div><div></div>
    </div>
    <VirtualList items={offers} mode="table" {hasMore} onLoadMore={loadMore} row={tableRow} />
  </div>
{/if}
```

> The original `<table>` is replaced by a CSS-grid row layout so virtual rows can be absolutely positioned without breaking table semantics (a real `<table>` cannot host `position:absolute` rows cleanly). Column widths are fixed via `grid-cols`. If precise column alignment matters more than virtualization for the table, the alternative spacer-`<tr>` approach is documented in the spec — not used here.

Add the `tableRow` snippet after `cardRow`:

```svelte
{#snippet tableRow(rowOffers: Offer[])}
  {@const o = rowOffers[0]}
  {#if o}
    <div
      class="grid grid-cols-[56px_64px_2fr_90px_110px_70px_70px_1fr_1.4fr_110px_90px_110px_120px] items-center gap-0 border-b border-white/[0.06] px-4 py-[13px] text-[0.9rem] text-ink-2 cursor-pointer transition-colors hover:bg-white/[0.04] {o.notified ? 'shadow-[inset_3px_0_0_0_var(--color-good)]' : ''}"
      onclick={() => openDetail(o)} role="button" tabindex="0"
      onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openDetail(o)}
    >
      <div>{#if o.images?.length}<img src={o.images[0]} alt="" loading="lazy" class="h-10 w-14 rounded-[7px] object-cover" />{:else}<div class="h-10 w-14 rounded-[7px] border border-[var(--glass-border)] bg-[var(--glass-fill)]"></div>{/if}</div>
      <div><span class="inline-grid min-w-[38px] place-items-center rounded-[9px] border px-2 py-1 text-[0.85rem] font-extrabold [font-variant-numeric:tabular-nums] {tierClass[tier(o.score)]}">{o.score ?? "–"}</span></div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap !text-ink pr-3" title={o.title}>{o.title}</div>
      <div><span class="rounded-full border px-[8px] py-[2px] text-[0.66rem] font-bold uppercase tracking-[0.04em] {sourceClass(o.source)}">{sourceLabel(o.source)}</span></div>
      <div class="text-right font-semibold !text-ink [font-variant-numeric:tabular-nums]">{fmtPln(o.price)} zł</div>
      <div class="text-right [font-variant-numeric:tabular-nums]">{o.area ?? "–"}</div>
      <div class="text-right [font-variant-numeric:tabular-nums]">{o.rooms ?? "–"}</div>
      <div>{o.district ?? "–"}</div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap text-ink-3 pr-3" title={o.scoreReasons ?? ""}>{o.scoreReasons ?? "–"}</div>
      <div class="whitespace-nowrap text-ink-3">{relativeDate(o.firstSeen)}</div>
      <div>{#if o.notified}<span class="rounded-full border border-good/30 bg-good/10 px-[8px] py-[2px] text-[0.66rem] font-bold uppercase text-good">tak</span>{:else}<span class="text-ink-3">–</span>{/if}</div>
      <div><span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span></div>
      <div>
        <button onclick={(e) => { e.stopPropagation(); onRefresh(o); }} disabled={refreshingIds.has(o.externalId)} title="Odśwież" aria-label="Odśwież ofertę" class="mr-3 align-middle text-ink-3 transition-colors hover:text-ink disabled:opacity-50">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline {refreshingIds.has(o.externalId) ? 'animate-spin' : ''}"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>
        <a class="font-semibold text-ink no-underline hover:text-[var(--color-aurora-indigo)]" href={o.url} target="_blank" rel="noreferrer" onclick={(e) => e.stopPropagation()}>otwórz ↗</a>
      </div>
    </div>
  {/if}
{/snippet}
```

- [ ] **Step 5: Add a loading-more sentinel under the list**

Immediately after the `{/if}` that closes the cards/table/empty block (before the `{#if selected}` block ~line 327), add:

```svelte
{#if loadingMore}
  <div class="mt-4 flex justify-center py-4 text-ink-3" aria-live="polite">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/></svg>
  </div>
{/if}
```

- [ ] **Step 6: Build and verify it compiles**

Run: `bun run build`
Expected: `SPA built -> web/dist` with no errors.

- [ ] **Step 7: Run the full test suite (nothing should regress)**

Run: `bun test`
Expected: PASS (backend pagination + virtual helpers + all pre-existing tests).

- [ ] **Step 8: Commit**

```bash
git add web/Dashboard.svelte
git commit -m "feat(web): paged infinite scroll + virtualized cards & table"
```

---

## Task 8: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Seed enough data and start the server**

Ensure the dev DB has many active offers (run a crawl, or rely on existing data). Start:
Run: `DATABASE_URL=postgres://wynajem:wynajem@localhost:5432/wynajem bun run dev`
Expected: server starts; open `http://localhost:<port>`.

- [ ] **Step 2: Verify card-view infinite scroll + windowing**

In the browser (cards view):
- Count badge shows `N / total` where N starts at 50 (or `total` if fewer).
- Scrolling down loads more (badge N grows; spinner flashes) until N === total.
- DevTools → Elements: the number of rendered `<article>` nodes stays bounded (~a few rows of cards), not the full set, while scrolling.
- Resize the window narrower/wider: column count changes and cards reflow without overlap or gaps.

- [ ] **Step 3: Verify table-view**

Toggle to "Tabela": rows render aligned to the header columns, infinite scroll works, rendered row count stays bounded while scrolling.

- [ ] **Step 4: Verify search/sort reset + rescore reconcile**

- Type a district query (e.g. "Wrzeszcz") in the search bar → list resets to page 0, badge total updates.
- Change sort → list resets correctly.
- Click "Przelicz oceny" → scores update in place via WS without the list jumping to the top or losing loaded rows.

- [ ] **Step 5: If any overlap/gap/jump is observed**

Recheck the `transform:translateY({vi.start - scrollMargin()})` math in `VirtualList.svelte` and the `scrollMargin()` value (it must equal the container's document-top offset). Fix, `bun run build`, re-verify.

- [ ] **Step 6: Final commit (if Step 5 required changes)**

```bash
git add web/VirtualList.svelte web/Dashboard.svelte
git commit -m "fix(web): correct virtual row offset / scroll margin"
```

- [ ] **Step 7: Update the graph**

Run: `graphify update .`
Expected: graph rebuilt (AST-only, no API cost).

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Backend `{items,total}` + slice-after-rank → Task 1, 2. ✓
- `limit`/`offset` validation → Task 2 (single `[1,500]` clamp; documented deviation from the 100/500 split). ✓
- `id` tiebreaker / stable order → Task 1. ✓
- `Page<T>` + paged fetchers → Task 3. ✓
- Paged accumulation, `hasMore`, count badge `loaded/total`, reset-on-query → Task 7. ✓
- `@tanstack/virtual-core` window virtualizer rune → Task 5. ✓
- Row windowing for cards (ResizeObserver cols) and table → Task 6, 7. ✓
- Infinite scroll on last visible row → Task 6. ✓
- Preserve WS rescore/refresh patching + reconcile loaded window → Task 7. ✓
- View toggle reuses offers → Task 7 (same `offers` passed to both). ✓
- Empty + skeleton states preserved → Task 7 (blocks left intact). ✓
- Pure-helper unit tests + backend tests → Task 1, 2, 4. ✓

**Placeholder scan:** No TBD/TODO; all code steps contain full code. ✓

**Type consistency:** `Page<T>`/`PageParams` defined in Task 1, mirrored in `web/lib/api.ts` Task 3; `createWindowVirtualizer`, `columnsForWidth`, `chunkRows` defined in Tasks 4–5 and consumed in Task 6; `VirtualList` props (`items`, `mode`, `row`, `onLoadMore`, `hasMore`) consistent between Task 6 definition and Task 7 usage. ✓

**Known deviations from spec (intentional, documented above):**
1. Single `[1,500]` limit clamp instead of `[1,100]` + `500` carve-out.
2. Table view rendered as a CSS-grid row layout rather than a semantic `<table>` (required for absolute-positioned virtual rows); spacer-`<tr>` alternative noted.
3. Card entrance `animate-rise` stagger removed (would re-fire on every virtualized mount).
