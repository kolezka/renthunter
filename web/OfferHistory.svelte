<script lang="ts">
  import { onMount } from "svelte";
  import { getOfferHistory, type OfferSnapshot } from "./lib/api";
  import { relativeDate } from "./lib/format";
  let { externalId }: { externalId: string } = $props();

  let snaps = $state<OfferSnapshot[]>([]);
  let loaded = $state(false);
  let error = $state("");
  onMount(() => {
    const ctl = new AbortController();
    getOfferHistory(externalId, ctl.signal)
      .then((s) => { snaps = s; loaded = true; })
      .catch((e) => { if (!ctl.signal.aborted) { error = (e as Error).message; loaded = true; } });
    return () => ctl.abort();
  });

  const prices = $derived(
    snaps.map((s) => Number((s.data as any).price)).filter((n) => Number.isFinite(n)),
  );
  function points(vals: number[]): string {
    if (vals.length < 2) return "";
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    return vals.map((v, i) => `${(i / (vals.length - 1)) * 320},${60 - ((v - min) / span) * 50}`).join(" ");
  }
  const changes = $derived.by(() => {
    const out: { field: string; from: unknown; to: unknown; at: string }[] = [];
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1].data as any, b = snaps[i].data as any;
      for (const k of Object.keys(b)) {
        const same = Array.isArray(a[k])
          ? JSON.stringify([...a[k]].sort()) === JSON.stringify([...(b[k] ?? [])].sort())
          : a[k] === b[k];
        if (!same) out.push({ field: k, from: a[k], to: b[k], at: snaps[i].capturedAt });
      }
    }
    return out.reverse();
  });
</script>

{#if error}
  <section class="mb-4 rounded-[16px] border border-[var(--glass-border)] bg-white/[0.04] p-4">
    <p class="m-0 text-sm text-red-400">Failed to load history.</p>
  </section>
{:else if loaded && snaps.length > 1}
  <section class="mb-4 rounded-[16px] border border-[var(--glass-border)] bg-white/[0.04] p-4">
    <h3 class="m-0 mb-3 font-display text-[0.95rem] font-bold text-ink-2">Historia zmian</h3>
    {#if prices.length > 1}
      <svg viewBox="0 0 320 64" preserveAspectRatio="none" class="mb-3 h-[64px] w-full">
        <polyline points={points(prices)} fill="none" stroke="var(--color-aurora-indigo, #7dd3fc)" stroke-width="2" />
      </svg>
    {/if}
    <ul class="m-0 list-none p-0">
      {#each changes as c}
        <li class="flex items-start gap-[10px] border-t border-white/[0.07] py-[9px] text-[0.85rem]">
          <span class="rounded-[6px] border border-[var(--glass-border)] px-[7px] py-[1px] text-[0.66rem] uppercase tracking-[0.05em] text-ink-3">{c.field}</span>
          <span class="text-ink-2">
            {#if c.field === "description"}zmieniono opis{:else}<span class="text-[#f0a4a4] line-through">{String(c.from ?? "–")}</span> → <span class="font-semibold text-[#9be3b0]">{String(c.to ?? "–")}</span>{/if}
          </span>
          <span class="ml-auto whitespace-nowrap text-[0.72rem] text-ink-3">{relativeDate(c.at)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
