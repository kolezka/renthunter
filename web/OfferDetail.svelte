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

  // Reset gallery state whenever the offer changes (e.g. a refresh returning a
  // different image set) so idx can't point past the new array.
  $effect(() => {
    offer.id; offer.images;
    idx = 0;
    broken = new Set<number>();
  });

  // Next non-broken index from `from` (wraps). If all are broken it returns a
  // broken index, but the markup renders a placeholder there — no onerror loop.
  function nextLive(from: number): number {
    const all = offer.images ?? [];
    if (!all.length) return 0;
    let next = ((from % all.length) + all.length) % all.length;
    for (let tries = all.length; broken.has(next) && tries > 0; tries--) next = (next + 1) % all.length;
    return next;
  }
  function markBroken(i: number) { broken = new Set(broken).add(i); idx = nextLive(idx); }
  function go(n: number) { if ((offer.images ?? []).length) idx = nextLive(n); }

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
            {#if broken.has(i)}
              <div class="grid h-[clamp(220px,42vh,460px)] w-full place-items-center text-ink-3">Obraz niedostępny</div>
            {:else}
              <img {src} alt={offer.title} loading="lazy" class="h-[clamp(220px,42vh,460px)] w-full object-cover" onerror={() => markBroken(i)} />
            {/if}
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
            {#if !broken.has(i)}
              <button class="h-14 w-20 flex-shrink-0 overflow-hidden rounded-[10px] border-2 {i === idx ? 'border-[var(--color-aurora-indigo)]' : 'border-transparent'}" onclick={() => (idx = i)} aria-label={`Zdjęcie ${i + 1}`}>
                <img {src} alt="" loading="lazy" class="h-full w-full object-cover" onerror={() => markBroken(i)} />
              </button>
            {/if}
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
