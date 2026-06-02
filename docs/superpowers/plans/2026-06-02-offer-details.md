# Offer Details, Photos & Scoring Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a photo gallery, richer offer table, and a click-through detail modal with a scoring summary to the Svelte panel.

**Architecture:** Store an `images` text[] on offers, parsed from the detail page's JSON-LD `image` array (og:image fallback). Surface a thumbnail + extra columns in the table/cards, and a detail modal (reusing the Config-modal scaffolding for aurora-perf) that shows the gallery, full description, and score summary — using the offer object already loaded by `/api/offers` (no new endpoint).

**Tech Stack:** Bun, TypeScript, Drizzle (postgres-js), `bun:test`, Svelte 5 runes, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-02-offer-details-design.md`

---

## File Structure

- `src/db/schema.ts` — add `images` text[] to offers (modify).
- `drizzle/` — generated migration.
- `src/scraper/parse.ts` — `OfferDetail.images` + parse logic (modify).
- `src/db/queries.ts` — `upsertOffer` merges `images` (modify).
- `src/pipeline/check.ts` — `processOffer` puts `images` on the NewOffer (modify).
- `src/pipeline/refresh.ts` — `refreshOffer` puts `images` on the NewOffer (modify).
- `web/lib/api.ts` — `Offer.images` + `Offer.description` (modify).
- `web/lib/format.ts` — shared `fmtPln`/`tier`/`tierClass`/`relativeDate` (create).
- `web/OfferDetail.svelte` — detail modal: gallery + scoring summary (create).
- `web/Dashboard.svelte` — thumbnail, new columns, row/card click → modal (modify).
- Tests: `test/parse-detail.test.ts`, `test/check.test.ts`, `test/refresh.test.ts`.

---

## Task 1: Add `images` column to offers

**Files:**
- Modify: `src/db/schema.ts:5-21`

- [ ] **Step 1: Add the column**

In `src/db/schema.ts`, inside the `offers` table, add an `images` column right after the `description` line:

```ts
  description: text("description"),
  images: text("images").array().notNull().default([]),
```

- [ ] **Step 2: Generate + apply migration**

Run: `bun run db:generate && bun run db:push`
Expected: migration adds `images` to `offers`; `db:push` applies it (no error).

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean (`Offer`/`NewOffer` now include `images: string[]`).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): offers.images photo url array"
```

---

## Task 2: Parse the image gallery

**Files:**
- Modify: `src/scraper/parse.ts:6-13` (interface), `parseDetail` return
- Test: `test/parse-detail.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/parse-detail.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/parse-detail.test.ts`
Expected: FAIL — `d.images` is undefined (`Array.isArray` false / type error).

- [ ] **Step 3: Implement**

In `src/scraper/parse.ts`, add `images` to the `OfferDetail` interface (after `description`):

```ts
export interface OfferDetail {
  title: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  district: string | null;
  description: string;
  images: string[];
}
```

In `parseDetail`, just before the final `return { title, price, area, rooms, district, description };`, add image extraction and include it in the return:

```ts
  // Images: JSON-LD `image` array (full gallery), fallback to og:image.
  let images: string[] = [];
  const ldImage = ld?.image;
  if (Array.isArray(ldImage)) {
    images = ldImage
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
            ? String((x as Record<string, unknown>).url ?? (x as Record<string, unknown>).contentUrl ?? "")
            : "",
      )
      .filter(Boolean);
  } else if (typeof ldImage === "string") {
    images = [ldImage];
  }
  if (images.length === 0) {
    const og = metaContent(html, "og:image");
    if (og) images = [og];
  }
  images = [...new Set(images)].slice(0, 12);

  return { title, price, area, rooms, district, description, images };
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/parse-detail.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/parse.ts test/parse-detail.test.ts
git commit -m "feat(scraper): parse offer image gallery"
```

---

## Task 3: Persist images via upsertOffer

**Files:**
- Modify: `src/db/queries.ts:26-46`

- [ ] **Step 1: Add images to the conflict-update set**

In `src/db/queries.ts`, in `upsertOffer`'s `onConflictDoUpdate.set`, add an `images` line after `description`:

```ts
        description: o.description ?? sql`${offers.description}`,
        images: o.images ?? sql`${offers.images}`,
```

(The insert path already carries `images` via `...o`.)

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(db): upsertOffer preserves/updates images"
```

---

## Task 4: Thread images through the pipeline

**Files:**
- Modify: `src/pipeline/check.ts` (processOffer `base`), `src/pipeline/refresh.ts` (`row`)
- Test: `test/check.test.ts`, `test/refresh.test.ts`

- [ ] **Step 1: Update the test mocks + add assertions**

In `test/check.test.ts`, the `makeDeps` default `parseDetail` returns an object missing `images` — update it (and add an assertion). Change the default `parseDetail` line to include images:

```ts
    parseDetail: () => ({ title: "Ładne 2pok", price: 3500, area: 50, rooms: 2, district: "Wrzeszcz", description: "blisko SKM", images: ["https://img/1.jpg", "https://img/2.jpg"] }),
```

Also update the two inline `parseDetail` overrides in the same file (the "failing offer is isolated" test and the "failing hard filters" test) to include `images: []` so they satisfy the `OfferDetail` type. For the isolated-failure test:

```ts
      return { title: "OK 2pok", price: 3500, area: 50, rooms: 2, district: "W", description: "blisko SKM", images: [] };
```

For the hard-filters test:

```ts
    parseDetail: () => ({ title: "1pok", price: 3500, area: 50, rooms: 1, district: "X", description: "", images: [] }),
```

Append an assertion test:

```ts
test("images from parseDetail are persisted on the upserted offer", async () => {
  const { deps, upserts } = makeDeps();
  await runCheck(deps);
  expect(upserts[0].images).toEqual(["https://img/1.jpg", "https://img/2.jpg"]);
});
```

In `test/refresh.test.ts`, update the default `parseDetail` mock to include images and assert it persists. Change:

```ts
    parseDetail: () => ({ title: "Re 2pok", price: 3400, area: 48, rooms: 2, district: "Oliwa", description: "blisko SKM", images: ["https://img/a.jpg"] }),
```

Append:

```ts
test("refreshOffer persists images", async () => {
  const { deps, upserts } = makeDeps();
  await refreshOffer("100", deps);
  expect(upserts[0].images).toEqual(["https://img/a.jpg"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/check.test.ts test/refresh.test.ts`
Expected: FAIL — `upserts[0].images` is undefined (pipeline doesn't copy images yet).

- [ ] **Step 3: Implement**

In `src/pipeline/check.ts`, in `processOffer`, add `images` to the `base` NewOffer (after `description`):

```ts
    const base: NewOffer = {
      externalId: item.externalId,
      url: item.url,
      title: d.title,
      price: d.price,
      area: d.area,
      rooms: d.rooms,
      district: d.district,
      description: d.description,
      images: d.images,
    };
```

In `src/pipeline/refresh.ts`, add `images` to the `row` NewOffer (after `description`):

```ts
  const row: NewOffer = {
    externalId,
    url: existing.url,
    title: d.title,
    price: d.price,
    area: d.area,
    rooms: d.rooms,
    district: d.district,
    description: d.description,
    images: d.images,
    score,
    scoreReasons: reasons,
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/check.test.ts test/refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/check.ts src/pipeline/refresh.ts test/check.test.ts test/refresh.test.ts
git commit -m "feat(pipeline): carry offer images through crawl + refresh"
```

---

## Task 5: Web types + shared formatters

**Files:**
- Modify: `web/lib/api.ts:1-7`
- Create: `web/lib/format.ts`

- [ ] **Step 1: Extend the Offer type**

In `web/lib/api.ts`, replace the `Offer` interface (lines 1-7) with:

```ts
export interface Offer {
  id: number; externalId: string; title: string;
  price: number | null; area: number | null; rooms: number | null;
  district: string | null; url: string; score: number | null;
  scoreReasons: string | null; status: string; notified: boolean;
  firstSeen: string; lastSeen: string;
  images: string[]; description: string | null;
}
```

- [ ] **Step 2: Create shared formatters**

Create `web/lib/format.ts`:

```ts
const pln = new Intl.NumberFormat("pl-PL");
export const fmtPln = (n: number | null) => (n == null ? "–" : pln.format(n));

export type Tier = "good" | "mid" | "bad" | "none";
export function tier(score: number | null): Tier {
  if (score == null) return "none";
  if (score >= 75) return "good";
  if (score >= 50) return "mid";
  return "bad";
}
export const tierClass: Record<Tier, string> = {
  good: "text-good bg-good/10 border-good/30",
  mid: "text-mid bg-mid/10 border-mid/30",
  bad: "text-bad bg-bad/10 border-bad/30",
  none: "text-ink-3 bg-[var(--glass-fill)] border-[var(--glass-border)]",
};

/** Polish relative date, e.g. "dziś", "wczoraj", "3 dni temu", "2 tyg. temu". */
export function relativeDate(iso: string): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "dziś";
  if (days === 1) return "wczoraj";
  if (days < 7) return `${days} dni temu`;
  if (days < 30) return `${Math.floor(days / 7)} tyg. temu`;
  return d.toLocaleDateString("pl-PL");
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/lib/api.ts web/lib/format.ts
git commit -m "feat(web): Offer images/description + shared formatters"
```

---

## Task 6: OfferDetail modal component

**Files:**
- Create: `web/OfferDetail.svelte`

- [ ] **Step 1: Create the component**

Create `web/OfferDetail.svelte`:

```svelte
<script lang="ts">
  import type { Offer } from "./lib/api";
  import { fmtPln, tier, tierClass, relativeDate } from "./lib/format";

  let { offer, onClose, onRefresh, refreshing = false }: {
    offer: Offer;
    onClose: () => void;
    onRefresh: (o: Offer) => void;
    refreshing?: boolean;
  } = $props();

  let idx = $state(0);
  let broken = $state(new Set<number>());
  const images = $derived((offer.images ?? []).filter((_, i) => !broken.has(i)));
  function markBroken(i: number) { broken = new Set(broken).add(i); if (idx >= images.length) idx = 0; }
  function go(n: number) { const len = (offer.images ?? []).length; if (len) idx = (n + len) % len; }

  // Same scaffolding as the Config modal: freeze the aurora + lock scroll while open.
  $effect(() => {
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("modal-open");
    return () => {
      document.body.style.overflow = "";
      document.documentElement.classList.remove("modal-open");
    };
  });

  const tagCls = "rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.8rem] font-medium text-ink-2";
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") go(idx + 1); if (e.key === "ArrowLeft") go(idx - 1); }} />

<div
  class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-md sm:p-8"
  role="dialog" aria-modal="true" aria-label="Szczegóły oferty"
  onclick={(e) => e.target === e.currentTarget && onClose()}
>
  <div class="relative my-auto w-full max-w-[860px] rounded-[var(--radius-glass)] border border-[var(--glass-border)] bg-[rgba(14,19,34,0.92)] p-5 shadow-[var(--shadow-lift),var(--inset-sheen)] animate-pop sm:p-7">
    <header class="mb-4 flex items-start justify-between gap-4">
      <h2 class="m-0 font-display text-[1.4rem] font-extrabold leading-tight tracking-[-0.02em]">{offer.title}</h2>
      <button class="grid h-9 w-9 flex-shrink-0 cursor-pointer place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors hover:bg-[var(--glass-fill-strong)] hover:text-ink" onclick={onClose} aria-label="Zamknij">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </header>

    <!-- Gallery -->
    {#if (offer.images ?? []).length}
      <div class="relative mb-4 overflow-hidden rounded-[16px] border border-[var(--glass-border)] bg-black/30">
        {#each offer.images as src, i (src)}
          {#if i === idx}
            <img {src} alt={offer.title} loading="lazy" class="h-[clamp(220px,42vh,460px)] w-full object-cover" onerror={() => markBroken(i)} />
          {/if}
        {/each}
        {#if offer.images.length > 1}
          <button class="absolute left-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65" onclick={() => go(idx - 1)} aria-label="Poprzednie">‹</button>
          <button class="absolute right-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65" onclick={() => go(idx + 1)} aria-label="Następne">›</button>
          <div class="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[0.72rem] font-semibold text-white">{idx + 1} / {offer.images.length}</div>
        {/if}
      </div>
      {#if offer.images.length > 1}
        <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
          {#each offer.images as src, i (src)}
            <button class="h-14 w-20 flex-shrink-0 overflow-hidden rounded-[10px] border-2 {i === idx ? 'border-[var(--color-aurora-indigo)]' : 'border-transparent'}" onclick={() => (idx = i)} aria-label={`Zdjęcie ${i + 1}`}>
              <img {src} alt="" loading="lazy" class="h-full w-full object-cover" />
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="mb-4 grid h-[200px] w-full place-items-center rounded-[16px] border border-dashed border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-3">
        Brak zdjęć — odśwież ofertę, aby je pobrać
      </div>
    {/if}

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="font-display text-[1.9rem] font-bold tracking-[-0.02em] [font-variant-numeric:tabular-nums]">{fmtPln(offer.price)} <span class="text-[0.95rem] font-semibold text-ink-3">zł</span></div>
      {#if offer.area != null}<span class={tagCls}>{offer.area} m²</span>{/if}
      {#if offer.rooms != null}<span class={tagCls}>{offer.rooms} pok.</span>{/if}
      {#if offer.district}<span class={tagCls}>{offer.district}</span>{/if}
      <span class={tagCls}>{relativeDate(offer.firstSeen)}</span>
    </div>

    <!-- Scoring summary -->
    <section class="mb-4 rounded-[16px] border border-[var(--glass-border)] bg-white/[0.04] p-4">
      <div class="flex items-center gap-4">
        <span class="inline-flex min-w-[64px] flex-col items-center justify-center rounded-[14px] border px-3 py-2 font-display text-[1.7rem] font-extrabold leading-none [font-variant-numeric:tabular-nums] {tierClass[tier(offer.score)]}">
          {offer.score ?? "–"}
          <small class="mt-[3px] font-sans text-[0.55rem] font-semibold uppercase tracking-[0.12em] opacity-70">score</small>
        </span>
        <div>
          <div class="font-display text-[1rem] font-bold">Podsumowanie scoringu</div>
          <p class="m-0 mt-1 text-[0.9rem] leading-relaxed text-ink-2">{offer.scoreReasons ?? "Brak oceny AI dla tej oferty."}</p>
        </div>
      </div>
    </section>

    {#if offer.description}
      <section class="mb-4">
        <h3 class="m-0 mb-2 font-display text-[0.95rem] font-bold text-ink-2">Opis</h3>
        <p class="m-0 whitespace-pre-line text-[0.92rem] leading-relaxed text-ink-2">{offer.description}</p>
      </section>
    {/if}

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-4">
      <span class="text-[0.78rem] text-ink-3">Status: {offer.status} · ostatnio: {relativeDate(offer.lastSeen)}</span>
      <div class="flex items-center gap-3">
        <button onclick={() => onRefresh(offer)} disabled={refreshing} class="inline-flex items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-2 text-[0.85rem] font-semibold text-ink-2 transition-colors hover:text-ink disabled:opacity-50">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={refreshing ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
          {refreshing ? "Odświeżanie…" : "Odśwież"}
        </button>
        <a class="inline-flex items-center gap-2 rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-4 py-2 text-[0.85rem] font-semibold text-ink no-underline" href={offer.url} target="_blank" rel="noreferrer">
          Otwórz w trojmiasto
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
        </a>
      </div>
    </footer>
  </div>
</div>
```

- [ ] **Step 2: Build to verify it compiles**

Run: `bun run build`
Expected: SPA builds, no Svelte errors.

- [ ] **Step 3: Commit**

```bash
git add web/OfferDetail.svelte
git commit -m "feat(web): OfferDetail modal with gallery + scoring summary"
```

---

## Task 7: Wire the table/cards to the modal

**Files:**
- Modify: `web/Dashboard.svelte`

- [ ] **Step 1: Update the script block**

In `web/Dashboard.svelte`, change the imports and replace the inline `tier`/`tierClass`/`pln`/`fmt` definitions with the shared ones, and add modal state + helpers.

Change the top imports to:

```ts
  import { onMount } from "svelte";
  import { getOffers, runCrawler, refreshOffer, type Offer } from "./lib/api";
  import { fmtPln, tier, tierClass, relativeDate } from "./lib/format";
  import OfferDetail from "./OfferDetail.svelte";
```

Delete the now-duplicated local definitions in the script: the `tier` function, the `tierClass` record, and the `const pln`/`const fmt` lines (they live in `./lib/format` now).

Add detail-modal state after the `refreshingIds` state:

```ts
  let selected = $state<Offer | null>(null);
  function openDetail(o: Offer) { selected = o; }
  function closeDetail() { selected = null; }
```

In `onRefresh`, after `offers = offers.map(...)`, also keep the open modal in sync — replace the body of the `try` with:

```ts
    try {
      const updated = await refreshOffer(o.externalId);
      offers = offers.map((x) => (x.id === updated.id ? updated : x));
      if (selected && selected.id === updated.id) selected = updated;
    } catch (e) {
```

- [ ] **Step 2: Replace `fmt(` usages and render the modal**

In the markup, replace every `{fmt(o.price)}` with `{fmtPln(o.price)}` (two occurrences: the card price and the table price).

At the very end of the file (after the final `{/if}` that closes the cards/table block), add the modal mount:

```svelte
{#if selected}
  <OfferDetail
    offer={selected}
    onClose={closeDetail}
    onRefresh={onRefresh}
    refreshing={refreshingIds.has(selected.externalId)}
  />
{/if}
```

- [ ] **Step 3: Make cards clickable + add a thumbnail**

Replace the card `<article …>` opening tag (the one with `class="glass relative flex flex-col gap-3 …"`) so it opens the detail on click, and add `cursor-pointer`:

```svelte
      <article
        class="glass relative flex cursor-pointer flex-col gap-3 rounded-[var(--radius-glass)] p-5 animate-rise transition-[transform,border-color,background] duration-[400ms] {spring} hover:-translate-y-[5px] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-fill-strong)]"
        style="animation-delay:{Math.min(i, 12) * 45}ms"
        onclick={() => openDetail(o)}
        role="button" tabindex="0"
        onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openDetail(o)}
      >
```

Add a thumbnail at the top of the card, immediately after the `{#if o.notified}…{/if}` glow span and before `<header …>`:

```svelte
        {#if o.images?.length}
          <img src={o.images[0]} alt={o.title} loading="lazy" class="-mx-5 -mt-5 mb-1 h-[150px] w-[calc(100%+40px)] rounded-t-[var(--radius-glass)] object-cover" />
        {/if}
```

Stop the Refresh/Otwórz controls from also opening the modal — add `onclick` propagation stops. On the card refresh `<button>`, change its `onclick` to:

```svelte
              onclick={(e) => { e.stopPropagation(); onRefresh(o); }}
```

On the card "Otwórz" `<a>`, add `onclick={(e) => e.stopPropagation()}`.

- [ ] **Step 4: Add table columns + row click**

Update the table header `<tr>` to add the new columns — replace the header row contents:

```svelte
          <th></th><th>Score</th><th>Tytuł</th><th class="!text-right">Cena</th><th class="!text-right">m²</th>
          <th class="!text-right">Pok.</th><th>Dzielnica</th><th>AI</th><th>Dodano</th><th>Powiad.</th><th>Status</th><th></th>
```

Replace the table body row (`<tr …>…</tr>` inside `{#each offers as o (o.id)}`) with a clickable row carrying the new cells:

```svelte
          <tr class="cursor-pointer transition-colors hover:bg-white/[0.04] {o.notified ? 'shadow-[inset_3px_0_0_0_var(--color-good)]' : ''}" onclick={() => openDetail(o)}>
            <td>
              {#if o.images?.length}
                <img src={o.images[0]} alt="" loading="lazy" class="h-10 w-14 rounded-[7px] object-cover" />
              {:else}
                <div class="h-10 w-14 rounded-[7px] border border-[var(--glass-border)] bg-[var(--glass-fill)]"></div>
              {/if}
            </td>
            <td><span class="inline-grid min-w-[38px] place-items-center rounded-[9px] border px-2 py-1 text-[0.85rem] font-extrabold [font-variant-numeric:tabular-nums] {tierClass[tier(o.score)]}">{o.score ?? "–"}</span></td>
            <td class="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap !text-ink" title={o.title}>{o.title}</td>
            <td class="text-right font-semibold !text-ink [font-variant-numeric:tabular-nums]">{fmtPln(o.price)} zł</td>
            <td class="text-right [font-variant-numeric:tabular-nums]">{o.area ?? "–"}</td>
            <td class="text-right [font-variant-numeric:tabular-nums]">{o.rooms ?? "–"}</td>
            <td>{o.district ?? "–"}</td>
            <td class="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-ink-3" title={o.scoreReasons ?? ""}>{o.scoreReasons ?? "–"}</td>
            <td class="whitespace-nowrap text-ink-3">{relativeDate(o.firstSeen)}</td>
            <td>{#if o.notified}<span class="rounded-full border border-good/30 bg-good/10 px-[8px] py-[2px] text-[0.66rem] font-bold uppercase text-good">tak</span>{:else}<span class="text-ink-3">–</span>{/if}</td>
            <td><span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span></td>
            <td>
              <button
                onclick={(e) => { e.stopPropagation(); onRefresh(o); }}
                disabled={refreshingIds.has(o.externalId)}
                title="Odśwież" aria-label="Odśwież ofertę"
                class="mr-3 align-middle text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline {refreshingIds.has(o.externalId) ? 'animate-spin' : ''}"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
              </button>
              <a class="font-semibold text-ink no-underline hover:text-[var(--color-aurora-indigo)]" href={o.url} target="_blank" rel="noreferrer" onclick={(e) => e.stopPropagation()}>otwórz ↗</a>
            </td>
          </tr>
```

- [ ] **Step 5: Build + typecheck**

Run: `bunx tsc --noEmit && bun run build`
Expected: clean; SPA builds.

- [ ] **Step 6: Commit**

```bash
git add web/Dashboard.svelte
git commit -m "feat(web): clickable offers -> detail modal, thumbnails, richer table"
```

---

## Task 8: Full verification

**Files:** none

- [ ] **Step 1: Suite + typecheck + build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all tests pass; tsc clean; SPA builds.

- [ ] **Step 2: Visual smoke (dev stack already running on :3000)**

Open `http://localhost:3000`: a row/card click opens the modal with the scoring summary; table shows thumbnail/AI/date/notification columns. (Existing offers may show the "Brak zdjęć" placeholder until refreshed — expected.)

- [ ] **Step 3: Commit any stray changes**

```bash
git add -A && git commit -m "chore: offer details verification" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** images column → Task 1; gallery parse → Task 2; persist → Task 3/4; web types → Task 5; detail modal + scoring summary + gallery (aurora-perf scaffolding reused) → Task 6; thumbnails + new columns (AI/dates/notified) + click-to-open → Task 7.
- **Type consistency:** `OfferDetail.images` (parse) → `NewOffer.images` (schema `$inferInsert`) → `Offer.images` (web) → `OfferDetail.svelte` props. `fmtPln`/`tier`/`tierClass`/`relativeDate` defined once in `web/lib/format.ts`, imported by Dashboard + OfferDetail.
- **Modal perf:** OfferDetail reuses the Config modal's single-backdrop-filter + `modal-open` aurora freeze (per the known glass-perf gotcha).
- Backfill of existing offers' images happens via the Refresh button / next successful crawl (live crawl currently 403-blocked — separate concern).
