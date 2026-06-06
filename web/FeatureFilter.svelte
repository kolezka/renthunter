<script lang="ts">
  import type { FeatureFacet } from "./lib/api";
  import { POPULAR_COUNT, popularFeatures, filterFeatures, toggleFeature } from "./lib/featureFilter";

  let { features, selected, onChange }:
    { features: FeatureFacet[]; selected: string[]; onChange: (next: string[]) => void } = $props();

  let query = $state("");
  let open = $state(false);
  let boxEl = $state<HTMLDivElement | null>(null);

  const popular = $derived(popularFeatures(features));
  const matches = $derived(filterFeatures(features, query));
  const moreCount = $derived(Math.max(0, features.length - POPULAR_COUNT));

  function pick(value: string) { onChange(toggleFeature(selected, value)); }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && matches.length) { pick(matches[0]!.value); query = ""; }
    else if (e.key === "Escape") { open = false; }
  }

  // Close the popover on outside click.
  function onDocClick(e: MouseEvent) {
    if (open && boxEl && !boxEl.contains(e.target as Node)) open = false;
  }
  $effect(() => {
    if (!open) return;
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  });

  const chip = (on: boolean) =>
    `rounded-full border px-[12px] py-[5px] text-[0.8rem] font-semibold transition-colors ${on
      ? "border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] text-ink shadow-[var(--inset-sheen)]"
      : "border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-3 hover:text-ink"}`;
</script>

{#if features.length}
  <div class="flex flex-col gap-2" bind:this={boxEl}>
    <!-- selection box: chips for selected + inline search input -->
    <div class="flex flex-wrap items-center gap-2 rounded-2xl border border-[rgba(120,170,255,0.35)] bg-[var(--glass-fill)] px-3 py-2">
      {#each selected as s (s)}
        <button class={chip(true)} onclick={() => pick(s)}>{s} ✕</button>
      {/each}
      <input
        bind:value={query}
        onfocus={() => (open = true)}
        onkeydown={onKey}
        placeholder="Add feature…"
        class="min-w-[140px] flex-1 bg-transparent px-1 py-[3px] text-[0.85rem] text-ink outline-none placeholder:text-ink-3"
      />
      {#if moreCount > 0}
        <button class="rounded-full px-3 py-[5px] text-[0.78rem] font-semibold text-ink-2 hover:text-ink"
          onclick={() => (open = !open)}>+{moreCount} more {open ? "▴" : "▾"}</button>
      {/if}
    </div>

    <!-- popular quick chips (hidden while searching) -->
    {#if !query}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[0.7rem] uppercase tracking-wide text-ink-3">Popular</span>
        {#each popular as f (f.value)}
          <button class={chip(selected.includes(f.value))} onclick={() => pick(f.value)}>{f.value}</button>
        {/each}
      </div>
    {/if}

    <!-- popover: full searchable checklist with counts -->
    {#if open}
      <div class="max-h-[260px] overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--glass-fill-strong)] p-1">
        {#each matches as f (f.value)}
          <button
            class="flex w-full items-center justify-between rounded-lg px-3 py-[6px] text-left text-[0.83rem] text-ink-2 hover:bg-[var(--glass-fill)]"
            onclick={() => pick(f.value)}>
            <span>{selected.includes(f.value) ? "☑" : "☐"} {f.value}</span>
            <span class="text-ink-3">{f.count}</span>
          </button>
        {:else}
          <div class="px-3 py-2 text-[0.83rem] text-ink-3">No matching features</div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
