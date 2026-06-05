<script lang="ts">
  let { images, title }: { images: string[]; title: string } = $props();

  // Local to this component: when the parent re-creates it via {#key offer.id},
  // these reset to their initializers automatically — no reset $effect needed.
  let idx = $state(0);
  let broken = $state(new Set<number>());

  // Next non-broken index from `from` (wraps). If all are broken it returns a
  // broken index, but the markup renders a placeholder there — no onerror loop.
  function nextLive(from: number): number {
    const all = images ?? [];
    if (!all.length) return 0;
    let next = ((from % all.length) + all.length) % all.length;
    for (let tries = all.length; broken.has(next) && tries > 0; tries--) next = (next + 1) % all.length;
    return next;
  }
  function markBroken(i: number) { broken = new Set(broken).add(i); idx = nextLive(idx); }
  function go(n: number) { if ((images ?? []).length) idx = nextLive(n); }
</script>

<!-- Known minor limitation: these arrow-key handlers stay live even if the
     Settings modal is somehow opened on top of an open OfferDetail, advancing
     the hidden gallery. The normal path is unreachable — the OfferDetail
     backdrop (fixed inset-0 z-50) covers the settings button, so it can't be
     clicked while a detail is open. Only a keyboard-focus + Enter on the
     covered button could trigger it. Deferred (would need an `active` prop
     threaded App→Dashboard→OfferDetail→Gallery for a negligible edge case). -->
<svelte:window onkeydown={(e) => { if (e.key === "ArrowRight") go(idx + 1); if (e.key === "ArrowLeft") go(idx - 1); }} />

{#if (images ?? []).length}
  <div class="relative mb-4 overflow-hidden rounded-[16px] border border-[var(--glass-border)] bg-black/30">
    {#each images as src, i (src)}
      {#if i === idx}
        {#if broken.has(i)}
          <div class="grid h-[clamp(220px,42vh,460px)] w-full place-items-center text-ink-3">Image unavailable</div>
        {:else}
          <img {src} alt={title} loading="lazy" class="h-[clamp(220px,42vh,460px)] w-full object-cover" onerror={() => markBroken(i)} />
        {/if}
      {/if}
    {/each}
    {#if images.length > 1}
      <button class="absolute left-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65" onclick={() => go(idx - 1)} aria-label="Previous">‹</button>
      <button class="absolute right-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65" onclick={() => go(idx + 1)} aria-label="Next">›</button>
      <div class="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[0.72rem] font-semibold text-white">{idx + 1} / {images.length}</div>
    {/if}
  </div>
  {#if images.length > 1}
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      {#each images as src, i (src)}
        {#if !broken.has(i)}
          <button class="h-14 w-20 flex-shrink-0 overflow-hidden rounded-[10px] border-2 {i === idx ? 'border-[var(--color-aurora-indigo)]' : 'border-transparent'}" onclick={() => (idx = i)} aria-label={`Photo ${i + 1}`}>
            <img {src} alt="" loading="lazy" class="h-full w-full object-cover" onerror={() => markBroken(i)} />
          </button>
        {/if}
      {/each}
    </div>
  {/if}
{:else}
  <div class="mb-4 grid h-[200px] w-full place-items-center rounded-[16px] border border-dashed border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-3">
    No photos — refresh the offer to fetch them
  </div>
{/if}
