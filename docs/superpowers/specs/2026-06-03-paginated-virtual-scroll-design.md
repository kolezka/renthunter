# Paginated + virtualized infinite scroll for the Oferty list

## Problem

The Oferty dashboard (`web/Dashboard.svelte`) fetches **every** offer in one request
(`getOffers()` / `searchOffers()` each return the full array) and renders all of them —
as cards in a responsive CSS grid or as table rows. With a large result set this means a
big JSON payload over the wire and a heavy DOM (thousands of nodes), which is both slow to
transfer and janky to scroll.

We want two complementary fixes:

1. **Server-side chunking** — send one page at a time, not the whole set.
2. **DOM windowing (virtual scroll)** — only render the rows near the viewport, regardless
   of how far the user has scrolled.

Driven by **infinite scroll**: more loads and renders automatically as the user scrolls.
Applies to **both** the card grid and the table view.

## Key constraint: ranking is in-memory

`searchOffers` loads all active rows from the DB and ranks/sorts them **in JavaScript** —
vector search (`rankByCosine`) is a brute-force cosine over every embedding, and the
non-vector sorts are JS `Array.sort`. So "server-side pagination" here means: **rank/sort
the full set server-side as today, then slice the requested window** and report the total.
The DB query itself stays a full scan; only the wire payload is paginated. This keeps
ranking correct (a page can't be ranked without seeing the whole set).

## Backend pagination contract

- `listOffers({ limit, offset })` → `{ items: Offer[]; total: number }`
- `searchOffers(params, { limit, offset })` → `{ items: Offer[]; total: number }`
  - The slice happens **after** ranking/sorting; `total` is the full ranked length.
- API endpoints return `{ items, total }`:
  - `GET /api/offers?limit=50&offset=0`
  - `GET /api/offers/search?…&limit=50&offset=0`
- Validation: `limit` clamped to `[1, 100]` (default 50); `offset` coerced to `≥ 0`.
- **Stable ordering:** add `offers.id desc` as the final tiebreaker in every sort and in the
  cosine-rank path, so an offer cannot drift between two page fetches. (Cross-page drift
  caused by a *new crawl landing mid-scroll* is still possible and is accepted, not solved —
  the user can reload to get a fresh consistent ordering.)

## Frontend data layer (`web/lib/api.ts`)

- `export interface Page<T> { items: T[]; total: number }`
- `getOffers(offset?: number, limit?: number): Promise<Page<Offer>>` (default `offset 0`, `limit 50`)
- `searchOffers(query: SearchQuery, offset?: number, limit?: number): Promise<Page<Offer>>`

## Dashboard paged state + infinite fetch (`web/Dashboard.svelte`)

Replace the single `offers` array with paged accumulation:

- `offers: Offer[]` — accumulated across fetched pages
- `total: number`
- `loadingMore: boolean`
- derived `hasMore = offers.length < total`
- `currentQuery: SearchQuery | null` — the active query; `null` means "list all" (`getOffers`)

Behaviour:

- **Reset on query change** — a search / sort / filter change clears `offers`, sets offset 0,
  and fetches page 0.
- **`loadMore()`** — fetches the next window (`offset = offers.length`), appends, advances.
  No-op while `loadingMore` or `!hasMore`.
- **Count badge** shows `{offers.length} / {total}`.

## Virtualization (`@tanstack/virtual-core` + Svelte 5 rune wrapper)

Use the framework-agnostic `@tanstack/virtual-core` (a stable plain class — no dependency on
the Svelte adapter's Svelte-5 readiness) bound to runes in `web/lib/virtual.svelte.ts`. A
`VirtualList.svelte` component renders the windowed rows.

- **Scrolling model:** window scrolling — the whole page scrolls as it does today (use
  virtual-core's window-scroll helpers), not a fixed-height inner pane.
- **Row model — both views virtualize by row:**
  - **Cards:** a `ResizeObserver` on the container computes `cols` from its width:
    `cols = max(1, floor((width + gap) / (minCardWidth + gap)))` with `minCardWidth = 290`,
    `gap = 18`, and the existing `<560px → 1 column` rule. Offers are chunked into rows of
    `cols`; each virtual row renders its slice inside the existing grid styles. Heights are
    measured dynamically (`measureElement`); `estimateSize ≈ 360`.
  - **Table:** `cols = 1`; each virtual item is one `<tr>`. The semantic `<table>` is
    preserved using the spacer-row technique — a top `<tr>` of height `virtualItems[0].start`
    and a bottom `<tr>` filling the remaining `totalSize`. Dynamic measurement;
    `estimateSize ≈ 64`.
  - Overscan ≈ 4 rows.
- **Infinite scroll:** when the last virtual row's index nears `rowCount` (within the overscan
  margin) and `hasMore && !loadingMore`, call `loadMore()`. A small spinner sentinel renders
  while a page is loading.

## Preserved interactions

- **WS `rescore:scored` and `refreshOffer`** still patch individual offers inside the
  accumulated `offers` array — unchanged.
- **`rescore:done` reconcile:** instead of reloading the entire list, re-fetch the
  **already-loaded window** (`offset 0, limit = offers.length`) and replace `offers`. The
  reconcile fetch is allowed to exceed the public `limit` cap of 100 via an internal clamp of
  500 (a query param the server honours up to 500 only for this reconcile path; documented in
  the server code).
- **View toggle (cards/table)** reuses the same accumulated `offers`; the virtualizer
  re-initialises (scroll resets to top — acceptable).
- **Resize** that changes the column count → `ResizeObserver` recomputes `cols` → rows
  re-chunk and the virtualizer re-measures reactively.
- **Empty state** (`total === 0`) and the **initial skeleton** are kept as they are.

## Edge cases

- `total === 0` → existing empty state.
- Vector search + pagination → rank the full set, then slice; correct by construction.
- Column-count change on resize → row count changes; virtualizer re-measures.
- New crawl mid-scroll can shift offsets → possible duplicate/skipped item across a page
  boundary. Accepted; reload gives a fresh ordering.

## Testing

- **Backend (PGlite, `bun test`):**
  - `listOffers` / `searchOffers` return correct `items` and `total` across `limit`/`offset`.
  - Ordering is stable with the `id` tiebreaker.
  - Vector-rank path slices **after** ranking.
  - Server clamps `limit` to `[1,100]` (500 for the reconcile path) and `offset ≥ 0`.
- **Frontend (`bun test`):** extract the column-count and row-chunking logic into pure
  functions in `web/lib/virtual.svelte.ts` and unit-test them (various widths, item counts,
  the `<560px` rule, remainder rows).

## Files touched

- `src/db/queries.ts` — paginate `listOffers` / `searchOffers`; add `id` tiebreaker.
- `src/api/server.ts` — parse/validate `limit`/`offset`; return `{ items, total }`.
- `web/lib/api.ts` — `Page<T>`; updated `getOffers` / `searchOffers`.
- `web/lib/virtual.svelte.ts` *(new)* — rune wrapper over `@tanstack/virtual-core` + pure
  column/row helpers.
- `web/VirtualList.svelte` *(new)* — windowed row renderer for cards and table.
- `web/Dashboard.svelte` — paged accumulation, infinite scroll, both views via the virtualizer.
- `package.json` — add `@tanstack/virtual-core`.
- `test/` — backend pagination tests + frontend virtual-helper tests.
