<script lang="ts">
  import { onMount } from "svelte";
  import { getOffers, runCrawler, refreshOffer, type Offer } from "./lib/api";

  let offers: Offer[] = $state([]);
  let loading = $state(true);
  let running = $state(false);
  let toast = $state("");
  let refreshingIds = $state(new Set<string>());

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
    if (refreshingIds.has(o.externalId)) return;
    refreshingIds = new Set(refreshingIds).add(o.externalId);
    try {
      const updated = await refreshOffer(o.externalId);
      offers = offers.map((x) => (x.id === updated.id ? updated : x));
    } catch (e) {
      flash(e instanceof Error ? e.message : "Nie udało się odświeżyć");
    } finally {
      const next = new Set(refreshingIds);
      next.delete(o.externalId);
      refreshingIds = next;
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

  onMount(async () => {
    offers = await getOffers();
    loading = false;
  });

  // Score → semantic tier.
  function tier(score: number | null): "good" | "mid" | "bad" | "none" {
    if (score == null) return "none";
    if (score >= 75) return "good";
    if (score >= 50) return "mid";
    return "bad";
  }
  const tierClass: Record<string, string> = {
    good: "text-good bg-good/10 border-good/30",
    mid: "text-mid bg-mid/10 border-mid/30",
    bad: "text-bad bg-bad/10 border-bad/30",
    none: "text-ink-3 bg-[var(--glass-fill)] border-[var(--glass-border)]",
  };

  const pln = new Intl.NumberFormat("pl-PL");
  const fmt = (n: number | null) => (n == null ? "–" : pln.format(n));

  const spring = "ease-[cubic-bezier(0.22,1.18,0.36,1)]";
  const vt = "inline-flex items-center gap-[7px] rounded-full border border-transparent bg-transparent px-[14px] py-[7px] text-[0.85rem] font-semibold cursor-pointer transition-colors duration-200";
  const vtActive = "text-ink bg-[var(--glass-fill-strong)] border-[var(--glass-border-strong)] shadow-[var(--inset-sheen)]";
  const vtIdle = "text-ink-2 hover:text-ink";
  const sk = "rounded-[10px] bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.10),rgba(255,255,255,0.04))] bg-[length:480px_100%] animate-shimmer";
  const openBtn = `inline-flex items-center gap-[6px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[14px] py-2 text-[0.85rem] font-semibold text-ink no-underline shadow-[var(--inset-sheen)] transition-[transform,background] duration-300 ${spring} hover:translate-x-[2px] hover:bg-[rgba(47,109,255,0.22)]`;
</script>

<section class="mb-[22px] flex flex-wrap items-center justify-between gap-4">
  <div class="flex items-baseline gap-3">
    <h1 class="m-0 font-display text-[clamp(1.6rem,4vw,2.3rem)] font-extrabold tracking-[-0.03em]">Oferty</h1>
    {#if !loading}
      <span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] px-[11px] py-[3px] text-[0.85rem] font-bold text-ink-2 [font-variant-numeric:tabular-nums]">{offers.length}</span>
    {/if}
  </div>

  <div class="flex items-center gap-3">
    <button
      onclick={onRun}
      disabled={running}
      class="inline-flex items-center gap-[7px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[16px] py-[8px] text-[0.85rem] font-semibold text-ink shadow-[var(--inset-sheen)] transition-[transform,background,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] hover:bg-[rgba(47,109,255,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={running ? "animate-spin" : ""}><path d="M5 3v4M3 5h4"/><path d="M12 5a7 7 0 1 1-7 7"/></svg>
      {running ? "Uruchamianie…" : "Uruchom crawler"}
    </button>
    <div class="glass inline-flex gap-[2px] rounded-full p-1" role="group" aria-label="Widok ofert">
      <button class="{vt} {view === 'cards' ? vtActive : vtIdle}" onclick={() => setView("cards")} aria-pressed={view === "cards"}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        Karty
      </button>
      <button class="{vt} {view === 'table' ? vtActive : vtIdle}" onclick={() => setView("table")} aria-pressed={view === "table"}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        Tabela
      </button>
    </div>
  </div>
</section>

{#if toast}
  <div class="mb-4 animate-rise rounded-[12px] border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] px-4 py-3 text-[0.88rem] text-ink-2">{toast}</div>
{/if}

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
    <h3 class="m-0 mb-[6px] font-display text-[1.2rem] font-bold">Brak ofert</h3>
    <p class="m-0 text-ink-3">Gdy monitor znajdzie pasujące mieszkania, pojawią się tutaj.</p>
  </div>

{:else if view === "cards"}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-[18px] max-[560px]:grid-cols-1">
    {#each offers as o, i (o.id)}
      <article
        class="glass relative flex flex-col gap-3 rounded-[var(--radius-glass)] p-5 animate-rise transition-[transform,border-color,background] duration-[400ms] {spring} hover:-translate-y-[5px] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-fill-strong)]"
        style="animation-delay:{Math.min(i, 12) * 45}ms"
      >
        {#if o.notified}
          <span class="pointer-events-none absolute inset-0 rounded-[var(--radius-glass)] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4),0_0_30px_-6px_rgba(52,211,153,0.35)]"></span>
        {/if}

        <header class="flex items-center justify-between">
          <span class="inline-flex min-w-[54px] flex-col items-center justify-center rounded-[14px] border px-[10px] py-[7px] font-display text-[1.35rem] font-extrabold leading-none [font-variant-numeric:tabular-nums] {tierClass[tier(o.score)]}" title={o.scoreReasons ?? ""}>
            {o.score ?? "–"}
            <small class="mt-[3px] font-sans text-[0.55rem] font-semibold uppercase tracking-[0.12em] opacity-70">score</small>
          </span>
          {#if o.notified}<span class="rounded-full border border-good/30 bg-good/10 px-[9px] py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-good" title="Powiadomienie wysłane">powiadomiono</span>{/if}
        </header>

        <h2 class="m-0 line-clamp-2 text-[0.98rem] font-semibold leading-[1.4] text-ink" title={o.title}>{o.title}</h2>

        <div class="font-display text-[1.85rem] font-bold tracking-[-0.02em] [font-variant-numeric:tabular-nums]">{fmt(o.price)} <span class="text-[0.95rem] font-semibold text-ink-3">zł</span></div>

        <div class="flex flex-wrap gap-[7px]">
          {#if o.area != null}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.area} m²</span>{/if}
          {#if o.rooms != null}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.rooms} pok.</span>{/if}
          {#if o.district}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{o.district}</span>{/if}
        </div>

        <footer class="mt-auto flex items-center justify-between gap-[10px] pt-[6px]">
          <span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span>
          <div class="flex items-center gap-[8px]">
            <button
              onclick={() => onRefresh(o)}
              disabled={refreshingIds.has(o.externalId)}
              title="Odśwież i przelicz ocenę"
              aria-label="Odśwież ofertę"
              class="grid h-9 w-9 place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={refreshingIds.has(o.externalId) ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <a class={openBtn} href={o.url} target="_blank" rel="noreferrer">
              Otwórz
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
            </a>
          </div>
        </footer>
      </article>
    {/each}
  </div>

{:else}
  <div class="glass animate-rise overflow-hidden rounded-[var(--radius-glass)]">
    <table class="w-full border-collapse">
      <thead>
        <tr class="[&>th]:border-b [&>th]:border-[var(--glass-border)] [&>th]:bg-white/[0.03] [&>th]:px-4 [&>th]:py-[14px] [&>th]:text-left [&>th]:text-[0.72rem] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.07em] [&>th]:text-ink-3">
          <th>Score</th><th>Tytuł</th><th class="!text-right">Cena</th><th class="!text-right">m²</th>
          <th class="!text-right">Pok.</th><th>Dzielnica</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody class="[&_tr:last-child>td]:border-0 [&>tr>td]:border-b [&>tr>td]:border-white/[0.06] [&>tr>td]:px-4 [&>tr>td]:py-[13px] [&>tr>td]:text-[0.9rem] [&>tr>td]:text-ink-2">
        {#each offers as o (o.id)}
          <tr class="transition-colors hover:bg-white/[0.04] {o.notified ? 'shadow-[inset_3px_0_0_0_var(--color-good)]' : ''}">
            <td><span class="inline-grid min-w-[38px] place-items-center rounded-[9px] border px-2 py-1 text-[0.85rem] font-extrabold [font-variant-numeric:tabular-nums] {tierClass[tier(o.score)]}">{o.score ?? "–"}</span></td>
            <td class="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap !text-ink" title={o.title}>{o.title}</td>
            <td class="text-right font-semibold !text-ink [font-variant-numeric:tabular-nums]">{fmt(o.price)} zł</td>
            <td class="text-right [font-variant-numeric:tabular-nums]">{o.area ?? "–"}</td>
            <td class="text-right [font-variant-numeric:tabular-nums]">{o.rooms ?? "–"}</td>
            <td>{o.district ?? "–"}</td>
            <td><span class="text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-ink-3">{o.status}</span></td>
            <td>
              <button
                onclick={() => onRefresh(o)}
                disabled={refreshingIds.has(o.externalId)}
                title="Odśwież"
                aria-label="Odśwież ofertę"
                class="mr-3 align-middle text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline {refreshingIds.has(o.externalId) ? 'animate-spin' : ''}"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
              </button>
              <a class="font-semibold text-ink no-underline hover:text-[var(--color-aurora-indigo)]" href={o.url} target="_blank" rel="noreferrer">otwórz ↗</a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
