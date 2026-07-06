<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getOffers, runCrawler, refreshOffer, rescoreAll, searchOffers, getFacets, SOURCE_LABEL, type Offer, type RescoreEvent, type Facets, type SearchQuery } from "./lib/api";
  import { fmtPln, tier, tierClass, relativeDate, fmtDateTime } from "./lib/format";
  import { runStatus } from "./lib/runStatus.svelte";
  import { loadRecencyPreset, presetToHours, type RecencyKey } from "./lib/recency";
  import OfferDetail from "./OfferDetail.svelte";
  import SearchBar from "./SearchBar.svelte";
  import VirtualList from "./VirtualList.svelte";
  import type { Page } from "./lib/api";

  // App owns the body scroll-lock for all modals; we report our offer-detail
  // open state up via this $bindable so it can lock/unlock in one place.
  let { detailOpen = $bindable(false) }: { detailOpen?: boolean } = $props();

  let offers: Offer[] = $state([]);
  let total = $state(0);
  let loadingMore = $state(false);
  // Seed the initial query from the persisted recency preset (default 24h) so the
  // very first load goes through the filtered searchOffers path — no plain
  // getOffers fetch, no reliance on child/parent onMount ordering.
  const initialRecency: RecencyKey = loadRecencyPreset();
  let currentQuery = $state<SearchQuery | null>({
    sort: "score",
    sinceHours: presetToHours(initialRecency) ?? undefined,
  });
  const PAGE = 50;
  const hasMore = $derived(offers.length < total);

  // Bumped on every query change; in-flight fetches that resolve against a stale
  // generation are discarded so a late page can't append to a newer result set.
  let queryGen = 0;

  async function fetchPage(offset: number): Promise<Page<Offer>> {
    return currentQuery ? searchOffers(currentQuery, offset, PAGE) : getOffers(offset, PAGE);
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    const gen = queryGen;
    try {
      const page = await fetchPage(offers.length);
      if (gen !== queryGen) return; // query changed while this page was in flight
      offers = [...offers, ...page.items];
      total = page.total;
    } finally {
      loadingMore = false;
    }
  }

  async function resetAndLoad() {
    const gen = ++queryGen;
    loading = true;
    try {
      const page = await fetchPage(0);
      if (gen !== queryGen) return; // a newer reset superseded this one
      offers = page.items;
      total = page.total;
    } finally {
      if (gen === queryGen) loading = false;
    }
  }
  let loading = $state(true);
  let running = $state(false);
  let toast = $state("");
  let refreshingIds = $state(new Set<string>());
  let selected = $state<Offer | null>(null);
  let rescoring = $state(false);
  const runActive = $derived(runStatus.current !== null);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let rescoreSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let wsRetry = 0;

  let facets = $state<Facets>({ districts: [], kinds: [], features: [], sources: [] });

  const SOURCE_CLASS: Record<string, string> = {
    trojmiasto: "border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.12)] text-[#7dd3fc]",
    olx: "border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.12)] text-[#6ee7b7]",
    otodom: "border-[rgba(168,139,250,0.38)] bg-[rgba(168,139,250,0.14)] text-[#c4b5fd]",
  };
  const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;
  const sourceClass = (s: string) =>
    SOURCE_CLASS[s] ?? "border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2";
  // Set detailOpen alongside `selected` (not via $effect) so App's scroll-lock
  // reacts in the same tick. Refresh/rescore reassign `selected` only when it's
  // already non-null, so detailOpen stays correct without touching those paths.
  function openDetail(o: Offer) { selected = o; detailOpen = true; }
  function closeDetail() { selected = null; detailOpen = false; }

  function flash(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    toast = msg;
    toastTimer = setTimeout(() => (toast = ""), 2500);
  }

  async function onRun() {
    if (running) return;
    running = true;
    try {
      await runCrawler();
      await runStatus.refresh();
      flash("Crawler started — results will appear in the logs.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to start");
    } finally {
      running = false;
    }
  }

  async function onRefresh(o: Offer) {
    if (refreshingIds.has(o.externalId)) return;
    refreshingIds = new Set(refreshingIds).add(o.externalId);
    try {
      const updated = await refreshOffer(o.externalId);
      offers = offers.map((x) => (x.id === updated.id ? updated : x));
      if (selected && selected.id === updated.id) selected = updated;
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      const next = new Set(refreshingIds);
      next.delete(o.externalId);
      refreshingIds = next;
    }
  }

  function handleEvent(e: RescoreEvent) {
    if (e.type === "rescore:start") {
      rescoring = true;
    } else if (e.type === "rescore:scored") {
      offers = offers.map((o) =>
        o.externalId === e.externalId ? { ...o, score: e.score, scoreReasons: e.reasons } : o,
      );
      if (selected && selected.externalId === e.externalId) {
        selected = { ...selected, score: e.score, scoreReasons: e.reasons };
      }
    } else if (e.type === "rescore:done") {
      if (rescoreSafetyTimer) { clearTimeout(rescoreSafetyTimer); rescoreSafetyTimer = null; }
      rescoring = false;
      flash(`Rescored ${e.summary.scored} offers`);
      // reconcile the loaded window; discard if the query changed or a loadMore
      // grew the list past this snapshot (don't shrink rows out from under the user)
      const gen = queryGen;
      const windowSize = Math.max(offers.length, PAGE);
      (currentQuery
        ? searchOffers(currentQuery, 0, windowSize)
        : getOffers(0, windowSize)
      ).then((page) => {
        if (gen !== queryGen || page.items.length < offers.length) return;
        offers = page.items;
        total = page.total;
      });
    }
  }

  function connectWs() {
    if (ws && ws.readyState < WebSocket.CLOSING) return; // already open or connecting
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => { wsRetry = 0; };
    ws.onmessage = (ev) => {
      let e: RescoreEvent;
      try { e = JSON.parse(ev.data) as RescoreEvent; } catch { return; }
      handleEvent(e);
    };
    ws.onclose = () => {
      ws = null;
      wsRetry = Math.min(wsRetry + 1, 30);
      reconnectTimer = setTimeout(connectWs, 1000 * wsRetry); // linear backoff, capped 30s
    };
  }

  async function onRescore() {
    if (rescoring) return;
    rescoring = true; // optimistic; the start event will confirm
    try {
      await rescoreAll();
      await runStatus.refresh();
      flash("Rescoring started…");
      if (rescoreSafetyTimer) clearTimeout(rescoreSafetyTimer);
      rescoreSafetyTimer = setTimeout(() => { rescoring = false; }, 5 * 60 * 1000); // safety net if rescore:done is missed
    } catch (e) {
      rescoring = false;
      flash(e instanceof Error ? e.message : "Failed to rescore");
    }
  }

  // Persisted table/cards preference.
  const STORE_KEY = "tw:offers-view";
  let view: "cards" | "table" = $state(
    (localStorage.getItem(STORE_KEY) as "cards" | "table") ?? "cards",
  );
  function setView(v: "cards" | "table") {
    view = v;
    localStorage.setItem(STORE_KEY, v);
  }

  async function onSearch(query: SearchQuery) {
    currentQuery = query;
    await resetAndLoad();
  }

  onMount(async () => {
    runStatus.start();
    await resetAndLoad();
    facets = await getFacets();
    connectWs();
  });

  onDestroy(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (rescoreSafetyTimer) clearTimeout(rescoreSafetyTimer);
    if (toastTimer) clearTimeout(toastTimer);
    if (ws) { ws.onclose = null; ws.close(); } // null onclose so teardown doesn't reconnect
    runStatus.stop();
  });

  const spring = "ease-[cubic-bezier(0.22,1.18,0.36,1)]";
  const vt = "inline-flex items-center gap-[7px] rounded-full border border-transparent bg-transparent px-[14px] py-[7px] text-[0.85rem] font-semibold cursor-pointer transition-colors duration-200";
  const vtActive = "text-ink bg-[var(--glass-fill-strong)] border-[var(--glass-border-strong)] shadow-[var(--inset-sheen)]";
  const vtIdle = "text-ink-2 hover:text-ink";
  const sk = "rounded-[10px] bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.10),rgba(255,255,255,0.04))] bg-[length:480px_100%] animate-shimmer";
  const openBtn = `inline-flex items-center gap-[6px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[14px] py-2 text-[0.85rem] font-semibold text-ink no-underline shadow-[var(--inset-sheen)] transition-[transform,background] duration-300 ${spring} hover:translate-x-[2px] hover:bg-[rgba(47,109,255,0.22)]`;
</script>

<section class="mb-[22px] flex flex-wrap items-center justify-between gap-4">
  <div class="flex items-baseline gap-3">
    <h1 class="m-0 font-display text-[clamp(1.6rem,4vw,2.3rem)] font-extrabold tracking-[-0.03em]">Offers</h1>
    {#if !loading}
      <span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] px-[11px] py-[3px] text-[0.85rem] font-bold text-ink-2 [font-variant-numeric:tabular-nums]">{offers.length} / {total}</span>
    {/if}
  </div>

  <div class="flex items-center gap-3">
    <button
      onclick={onRescore}
      disabled={rescoring || runActive}
      title={runActive ? "A run is already in progress" : "Rescore AI for active offers using the current criteria"}
      class="inline-flex items-center gap-[7px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[16px] py-[8px] text-[0.85rem] font-semibold text-ink shadow-[var(--inset-sheen)] transition-[transform,background,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] hover:bg-[rgba(47,109,255,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={rescoring ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
      {rescoring ? "Rescoring…" : "Rescore"}
    </button>
    <button
      onclick={onRun}
      disabled={running || runActive}
      title={runActive ? "A run is already in progress" : undefined}
      class="inline-flex items-center gap-[7px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[16px] py-[8px] text-[0.85rem] font-semibold text-ink shadow-[var(--inset-sheen)] transition-[transform,background,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] hover:bg-[rgba(47,109,255,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={running ? "animate-spin" : ""}><path d="M5 3v4M3 5h4"/><path d="M12 5a7 7 0 1 1-7 7"/></svg>
      {running ? "Starting…" : "Run crawler"}
    </button>
    <div class="glass inline-flex gap-[2px] rounded-full p-1" role="group" aria-label="Offers view">
      <button class="{vt} {view === 'cards' ? vtActive : vtIdle}" onclick={() => setView("cards")} aria-pressed={view === "cards"}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        Cards
      </button>
      <button class="{vt} {view === 'table' ? vtActive : vtIdle}" onclick={() => setView("table")} aria-pressed={view === "table"}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        Table
      </button>
    </div>
  </div>
</section>

{#if toast}
  <div class="mb-4 animate-rise rounded-[12px] border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] px-4 py-3 text-[0.88rem] text-ink-2">{toast}</div>
{/if}

<SearchBar {facets} {initialRecency} onChange={onSearch} />

{#if loading}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-[18px] max-[560px]:grid-cols-1">
    {#each Array(6) as _, i (i)}
      <div class="glass pointer-events-none flex flex-col gap-3 rounded-[var(--radius-glass)] p-5 animate-rise" style="animation-delay:{i * 60}ms">
        <div class="{sk} h-[48px] w-[54px] rounded-[14px]"></div>
        <div class="{sk} h-[13px] w-[70%]"></div>
        <div class="{sk} h-[13px] w-[40%]"></div>
        <div class="{sk} mt-1 h-[30px] w-[50%]"></div>
        <div class="{sk} mt-1 h-[22px] w-[80%] rounded-full"></div>
      </div>
    {/each}
  </div>
{:else if offers.length === 0}
  <div class="glass animate-rise rounded-[var(--radius-glass)] px-6 py-16 text-center">
    <div class="mx-auto mb-[18px] grid h-16 w-16 place-items-center rounded-[18px] border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] text-ink-2" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    </div>
    <h3 class="m-0 mb-[6px] font-display text-[1.2rem] font-bold">No offers</h3>
    <p class="m-0 text-ink-3">When the monitor finds matching apartments, they'll appear here.</p>
  </div>

{:else if view === "cards"}
  <VirtualList items={offers} mode="cards" {hasMore} onLoadMore={loadMore} row={cardRow} />

{:else}
  <div class="glass overflow-hidden rounded-[var(--radius-glass)]">
    <div class="grid grid-cols-[56px_64px_2fr_90px_110px_70px_70px_1fr_1.4fr_110px_90px_110px_120px] border-b border-[var(--glass-border)] bg-white/[0.03] px-4 py-[14px] text-[0.72rem] font-bold uppercase tracking-[0.07em] text-ink-3">
      <div></div><div>Score</div><div>Title</div><div>Source</div><div class="text-right">Price</div><div class="text-right">m²</div><div class="text-right">Rooms</div><div>District</div><div>AI</div><div>Added</div><div>Notif.</div><div>Status</div><div></div>
    </div>
    <VirtualList items={offers} mode="table" {hasMore} onLoadMore={loadMore} row={tableRow} />
  </div>
{/if}

{#snippet cardRow(rowOffers: Offer[])}
  <div class="grid gap-[18px] pb-[18px]" style="grid-template-columns: repeat({rowOffers.length}, minmax(0,1fr));">
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
            <span class="rounded-full border px-[9px] py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] {sourceClass(o.source)}" title="Source: {sourceLabel(o.source)}">{sourceLabel(o.source)}</span>
            {#if o.notified}<span class="rounded-full border border-good/30 bg-good/10 px-[9px] py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-good" title="Notification sent">notified</span>{/if}
          </div>
        </header>
        <h2 class="m-0 line-clamp-2 text-[0.98rem] font-semibold leading-[1.4] text-ink" title={o.title}>{o.title}</h2>
        <div class="font-display text-[1.85rem] font-bold tracking-[-0.02em] [font-variant-numeric:tabular-nums]">{fmtPln(o.price)} <span class="text-[0.95rem] font-semibold text-ink-3">PLN</span></div>
        <div class="flex flex-wrap gap-[7px]">
          {#if o.area != null}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.area} m²</span>{/if}
          {#if o.rooms != null}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.rooms} rooms</span>{/if}
          {#if o.district}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.district}</span>{/if}
          {#each o.features ?? [] as f (f)}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{f}</span>{/each}
        </div>
        <footer class="mt-auto flex items-center justify-between gap-[10px] pt-[6px]">
          <div class="flex flex-col gap-[3px]">
            <span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span>
            <span class="inline-flex items-center gap-[5px] text-[0.72rem] text-ink-3 [font-variant-numeric:tabular-nums]" title="Added: {fmtDateTime(o.firstSeen)}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              {relativeDate(o.firstSeen)}
            </span>
          </div>
          <div class="flex items-center gap-[8px]">
            <button onclick={(e) => { e.stopPropagation(); onRefresh(o); }} disabled={refreshingIds.has(o.externalId)} title="Refresh and rescore" aria-label="Refresh offer" class="grid h-9 w-9 place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors hover:text-ink disabled:opacity-50">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={refreshingIds.has(o.externalId) ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <a class={openBtn} href={o.url} target="_blank" rel="noreferrer" onclick={(e) => e.stopPropagation()}>
              Open
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
            </a>
          </div>
        </footer>
      </article>
    {/each}
  </div>
{/snippet}

{#snippet tableRow(rowOffers: Offer[])}
  {@const o = rowOffers[0]}
  {#if o}
    <div
      class="grid grid-cols-[56px_64px_2fr_90px_110px_70px_70px_1fr_1.4fr_110px_90px_110px_120px] items-center border-b border-white/[0.06] px-4 py-[13px] text-[0.9rem] text-ink-2 cursor-pointer transition-colors hover:bg-white/[0.04] {o.notified ? 'shadow-[inset_3px_0_0_0_var(--color-good)]' : ''}"
      onclick={() => openDetail(o)} role="button" tabindex="0"
      onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openDetail(o)}
    >
      <div>{#if o.images?.length}<img src={o.images[0]} alt="" loading="lazy" class="h-10 w-14 rounded-[7px] object-cover" />{:else}<div class="h-10 w-14 rounded-[7px] border border-[var(--glass-border)] bg-[var(--glass-fill)]"></div>{/if}</div>
      <div><span class="inline-grid min-w-[38px] place-items-center rounded-[9px] border px-2 py-1 text-[0.85rem] font-extrabold [font-variant-numeric:tabular-nums] {tierClass[tier(o.score)]}">{o.score ?? "–"}</span></div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap !text-ink pr-3" title={o.title}>{o.title}</div>
      <div><span class="rounded-full border px-[8px] py-[2px] text-[0.66rem] font-bold uppercase tracking-[0.04em] {sourceClass(o.source)}">{sourceLabel(o.source)}</span></div>
      <div class="text-right font-semibold !text-ink [font-variant-numeric:tabular-nums]">{fmtPln(o.price)} PLN</div>
      <div class="text-right [font-variant-numeric:tabular-nums]">{o.area ?? "–"}</div>
      <div class="text-right [font-variant-numeric:tabular-nums]">{o.rooms ?? "–"}</div>
      <div>{o.district ?? "–"}</div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap text-ink-3 pr-3" title={o.scoreReasons ?? ""}>{o.scoreReasons ?? "–"}</div>
      <div class="whitespace-nowrap text-ink-3" title="Added: {fmtDateTime(o.firstSeen)}">{relativeDate(o.firstSeen)}</div>
      <div>{#if o.notified}<span class="rounded-full border border-good/30 bg-good/10 px-[8px] py-[2px] text-[0.66rem] font-bold uppercase text-good">yes</span>{:else}<span class="text-ink-3">–</span>{/if}</div>
      <div><span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span></div>
      <div>
        <button onclick={(e) => { e.stopPropagation(); onRefresh(o); }} disabled={refreshingIds.has(o.externalId)} title="Refresh" aria-label="Refresh offer" class="mr-3 align-middle text-ink-3 transition-colors hover:text-ink disabled:opacity-50">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline {refreshingIds.has(o.externalId) ? 'animate-spin' : ''}"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>
        <a class="font-semibold text-ink no-underline hover:text-[var(--color-aurora-indigo)]" href={o.url} target="_blank" rel="noreferrer" onclick={(e) => e.stopPropagation()}>open ↗</a>
      </div>
    </div>
  {/if}
{/snippet}

{#if loadingMore}
  <div class="mt-4 flex justify-center py-4 text-ink-3" aria-live="polite">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/></svg>
  </div>
{/if}

{#if selected}
  <OfferDetail
    offer={selected}
    onClose={closeDetail}
    onRefresh={onRefresh}
    refreshing={refreshingIds.has(selected.externalId)}
  />
{/if}
