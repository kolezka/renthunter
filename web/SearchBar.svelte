<script lang="ts">
  import { onDestroy } from "svelte";
  import { SOURCE_LABEL, type Facets, type SearchQuery } from "./lib/api";
  import FeatureFilter from "./FeatureFilter.svelte";
  import { RECENCY_PRESETS, presetToHours, saveRecencyPreset, type RecencyKey } from "./lib/recency";

  let { facets, onChange, initialRecency = "24h" as RecencyKey }:
    { facets: Facets; onChange: (q: SearchQuery) => void; initialRecency?: RecencyKey } = $props();

  let q = $state("");
  let districts = $state<string[]>([]);
  let kinds = $state<string[]>([]);
  let features = $state<string[]>([]);
  let sources = $state<string[]>([]);
  let sort = $state<SearchQuery["sort"]>("score");
  let recency = $state<RecencyKey>(initialRecency);
  let panelOpen = $state(false);
  let debounce: ReturnType<typeof setTimeout> | null = null;

  // Active-filter count shown on the collapsed trigger: recency counts when it is
  // narrower than "all", plus every selected chip.
  const activeCount = $derived(
    (recency !== "all" ? 1 : 0) + districts.length + sources.length + kinds.length + features.length,
  );
  const recencyLabel = $derived(RECENCY_PRESETS.find((p) => p.key === recency)?.label ?? "All time");

  function toggle(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }
  function emit() {
    const hours = presetToHours(recency);
    onChange({ q, districts, kinds, features, sources, sort, sinceHours: hours ?? undefined });
  }
  function onType() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(emit, 300);
  }
  function setRecency(key: RecencyKey) {
    recency = key;
    saveRecencyPreset(key);
    emit();
  }
  function reset() {
    districts = []; kinds = []; features = []; sources = [];
    setRecency("24h"); // setRecency() emits
  }
  onDestroy(() => { if (debounce) clearTimeout(debounce); });

  const chip = (on: boolean) =>
    `rounded-full border px-[12px] py-[5px] text-[0.8rem] font-semibold transition-colors ${on
      ? "border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] text-ink shadow-[var(--inset-sheen)]"
      : "border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-3 hover:text-ink"}`;
  const rowLabel = "shrink-0 w-[64px] pt-[6px] text-[0.72rem] font-bold uppercase tracking-[0.06em] text-ink-3";
</script>

<div class="mb-[18px] flex flex-col gap-3">
  <div class="flex flex-wrap items-center gap-3">
    <input
      bind:value={q} oninput={onType}
      placeholder="Find offers… &ldquo;quiet, near the sea&rdquo;"
      class="min-w-[220px] flex-1 rounded-full border border-[rgba(120,170,255,0.35)] bg-[var(--glass-fill)] px-5 py-[10px] text-[0.9rem] text-ink outline-none placeholder:text-ink-3"
    />
    <select bind:value={sort} onchange={emit}
      class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-[9px] text-[0.85rem] text-ink-2">
      <option value="score">Relevance</option>
      <option value="newest">Newest</option>
      <option value="price">Price</option>
      <option value="area">Area</option>
    </select>
    <button
      type="button"
      onclick={() => (panelOpen = !panelOpen)}
      aria-expanded={panelOpen}
      aria-controls="offers-filters-panel"
      class="inline-flex items-center gap-[7px] rounded-full border px-4 py-[9px] text-[0.85rem] font-semibold transition-colors {activeCount
        ? 'border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] text-ink shadow-[var(--inset-sheen)]'
        : 'border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 hover:text-ink'}"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>
      Filters
      <span class="text-ink-3">· {recencyLabel}</span>
      {#if activeCount}<span class="grid h-5 min-w-5 place-items-center rounded-full bg-[rgba(47,109,255,0.35)] px-[5px] text-[0.7rem] font-bold text-ink">{activeCount}</span>{/if}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform {panelOpen ? 'rotate-180' : ''}"><path d="m6 9 6 6 6-6"/></svg>
    </button>
  </div>

  {#if panelOpen}
    <div id="offers-filters-panel" class="glass flex flex-col gap-[14px] rounded-[var(--radius-glass)] p-4 animate-rise">
      <div class="flex items-start gap-3">
        <span class={rowLabel}>Posted</span>
        <div class="flex flex-wrap gap-2">
          {#each RECENCY_PRESETS as p (p.key)}
            <button class={chip(recency === p.key)} onclick={() => setRecency(p.key)}>{p.label}</button>
          {/each}
        </div>
      </div>
      {#if facets.districts.length}
        <div class="flex items-start gap-3">
          <span class={rowLabel}>District</span>
          <div class="flex flex-wrap gap-2">
            {#each facets.districts as d (d)}
              <button class={chip(districts.includes(d))} onclick={() => { districts = toggle(districts, d); emit(); }}>{d}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if facets.sources.length > 1}
        <div class="flex items-start gap-3">
          <span class={rowLabel}>Source</span>
          <div class="flex flex-wrap gap-2">
            {#each facets.sources as s (s)}
              <button class={chip(sources.includes(s))} onclick={() => { sources = toggle(sources, s); emit(); }}>{SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if facets.kinds.length}
        <div class="flex items-start gap-3">
          <span class={rowLabel}>Type</span>
          <div class="flex flex-wrap gap-2">
            {#each facets.kinds as k (k)}
              <button class={chip(kinds.includes(k))} onclick={() => { kinds = toggle(kinds, k); emit(); }}>{k}</button>
            {/each}
          </div>
        </div>
      {/if}
      <div class="flex items-start gap-3">
        <span class={rowLabel}>Features</span>
        <div class="flex-1">
          <FeatureFilter
            features={facets.features}
            selected={features}
            onChange={(next) => { features = next; emit(); }}
          />
        </div>
      </div>
      <div class="flex justify-end border-t border-[var(--glass-border)] pt-3">
        <button type="button" onclick={reset} class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-[7px] text-[0.8rem] font-semibold text-ink-2 transition-colors hover:text-ink">Reset filters</button>
      </div>
    </div>
  {/if}
</div>
