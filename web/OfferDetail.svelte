<script lang="ts">
  import { SOURCE_LABEL, type Offer } from "./lib/api";
  import { fmtPln, tier, tierClass, relativeDate } from "./lib/format";
  import OfferHistory from "./OfferHistory.svelte";
  import Gallery from "./Gallery.svelte";

  let { offer, onClose, onRefresh, refreshing = false }: {
    offer: Offer;
    onClose: () => void;
    onRefresh: (o: Offer) => void;
    refreshing?: boolean;
  } = $props();

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

<svelte:window onkeydown={(e) => { if (e.key === "Escape") onClose(); }} />

<div
  class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-md sm:p-8"
  role="dialog" aria-modal="true" aria-label="Offer details"
  onclick={(e) => e.target === e.currentTarget && onClose()}
>
  <div class="relative my-auto w-full max-w-[860px] rounded-[var(--radius-glass)] border border-[var(--glass-border)] bg-[rgba(14,19,34,0.92)] p-5 shadow-[var(--shadow-lift),var(--inset-sheen)] animate-pop sm:p-7">
    <header class="mb-4 flex items-start justify-between gap-4">
      <h2 class="m-0 font-display text-[1.4rem] font-extrabold leading-tight tracking-[-0.02em]">{offer.title}</h2>
      <button class="grid h-9 w-9 flex-shrink-0 cursor-pointer place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors hover:bg-[var(--glass-fill-strong)] hover:text-ink" onclick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </header>

    <!-- Gallery: keyed by offer.id so its internal idx/broken state resets when
         the user switches offers, without a reset $effect. -->
    {#key offer.id}
      <Gallery images={offer.images ?? []} title={offer.title} />
    {/key}

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="font-display text-[1.9rem] font-bold tracking-[-0.02em] [font-variant-numeric:tabular-nums]">{fmtPln(offer.price)} <span class="text-[0.95rem] font-semibold text-ink-3">PLN</span></div>
      {#if offer.area != null}<span class={tagCls}>{offer.area} m²</span>{/if}
      {#if offer.rooms != null}<span class={tagCls}>{offer.rooms} rooms</span>{/if}
      {#if offer.district}<span class={tagCls}>{offer.district}</span>{/if}
      {#each offer.features ?? [] as f (f)}<span class={tagCls}>{f}</span>{/each}
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
          <div class="font-display text-[1rem] font-bold">Scoring summary</div>
          <p class="m-0 mt-1 text-[0.9rem] leading-relaxed text-ink-2">{offer.scoreReasons ?? "No AI score for this offer."}</p>
        </div>
      </div>
    </section>

    <OfferHistory externalId={offer.externalId} />

    {#if offer.description}
      <section class="mb-4">
        <h3 class="m-0 mb-2 font-display text-[0.95rem] font-bold text-ink-2">Description</h3>
        <p class="m-0 whitespace-pre-line text-[0.92rem] leading-relaxed text-ink-2">{offer.description}</p>
      </section>
    {/if}

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-4">
      <span class="text-[0.78rem] text-ink-3">Status: {offer.status} · last seen: {relativeDate(offer.lastSeen)}</span>
      <div class="flex items-center gap-3">
        <button onclick={() => onRefresh(offer)} disabled={refreshing} class="inline-flex items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-2 text-[0.85rem] font-semibold text-ink-2 transition-colors hover:text-ink disabled:opacity-50">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={refreshing ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <a class="inline-flex items-center gap-2 rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-4 py-2 text-[0.85rem] font-semibold text-ink no-underline" href={offer.url} target="_blank" rel="noreferrer">
          Open in {SOURCE_LABEL[offer.source] ?? offer.source}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
        </a>
      </div>
    </footer>
  </div>
</div>
