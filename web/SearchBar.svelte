<script lang="ts">
  import { SOURCE_LABEL, type Facets, type SearchQuery } from "./lib/api";
  let { facets, onChange }: { facets: Facets; onChange: (q: SearchQuery) => void } = $props();

  let q = $state("");
  let districts = $state<string[]>([]);
  let kinds = $state<string[]>([]);
  let features = $state<string[]>([]);
  let sources = $state<string[]>([]);
  let sort = $state<SearchQuery["sort"]>("score");
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function toggle(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }
  function emit() { onChange({ q, districts, kinds, features, sources, sort }); }
  function onType() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(emit, 300);
  }
  const chip = (on: boolean) =>
    `rounded-full border px-[12px] py-[5px] text-[0.8rem] font-semibold transition-colors ${on
      ? "border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] text-ink shadow-[var(--inset-sheen)]"
      : "border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-3 hover:text-ink"}`;
</script>

<div class="mb-[18px] flex flex-col gap-3">
  <div class="flex flex-wrap items-center gap-3">
    <input
      bind:value={q} oninput={onType}
      placeholder="Znajdź oferty… &bdquo;spokojnie blisko morza&ldquo;"
      class="min-w-[220px] flex-1 rounded-full border border-[rgba(120,170,255,0.35)] bg-[var(--glass-fill)] px-5 py-[10px] text-[0.9rem] text-ink outline-none placeholder:text-ink-3"
    />
    <select bind:value={sort} onchange={emit}
      class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-[9px] text-[0.85rem] text-ink-2">
      <option value="score">Trafność</option>
      <option value="newest">Najnowsze</option>
      <option value="price">Cena</option>
      <option value="area">Powierzchnia</option>
    </select>
  </div>
  {#if facets.districts.length}
    <div class="flex flex-wrap gap-2">
      {#each facets.districts as d (d)}
        <button class={chip(districts.includes(d))} onclick={() => { districts = toggle(districts, d); emit(); }}>{d}</button>
      {/each}
    </div>
  {/if}
  {#if facets.sources.length > 1}
    <div class="flex flex-wrap gap-2">
      {#each facets.sources as s (s)}
        <button class={chip(sources.includes(s))} onclick={() => { sources = toggle(sources, s); emit(); }}>{SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s}</button>
      {/each}
    </div>
  {/if}
  {#if facets.kinds.length || facets.features.length}
    <div class="flex flex-wrap gap-2">
      {#each facets.kinds as k (k)}
        <button class={chip(kinds.includes(k))} onclick={() => { kinds = toggle(kinds, k); emit(); }}>{k}</button>
      {/each}
      {#each facets.features as f (f)}
        <button class={chip(features.includes(f))} onclick={() => { features = toggle(features, f); emit(); }}>{f}</button>
      {/each}
    </div>
  {/if}
</div>
