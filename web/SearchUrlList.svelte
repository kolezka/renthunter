<script lang="ts">
  import type { Source } from "./lib/api";
  import { resolveSource, splitPasted, addUrls } from "./lib/searchUrls";

  let { urls = $bindable([]) }: { urls: string[] } = $props();

  let draft = $state("");
  let skipNote = $state("");

  // Per-source visual tokens. Colours are domain data (which marketplace), not app
  // chrome, so they live here rather than in the global theme. Matte tints, no glow —
  // matches the "calmer 2026" direction.
  type Key = Source | "unknown";
  const TINT: Record<Key, { rgb: string; label: string }> = {
    trojmiasto: { rgb: "232,160,90", label: "Trójmiasto" },
    olx: { rgb: "124,196,98", label: "OLX" },
    otodom: { rgb: "120,150,245", label: "Otodom" },
    "nieruchomosci-online": { rgb: "224,122,160", label: "Nieruchomości-online" },
    unknown: { rgb: "150,158,176", label: "Unknown" },
  };

  function keyOf(url: string): Key {
    return resolveSource(url) ?? "unknown";
  }
  function parts(url: string): { host: string; path: string } {
    try {
      const u = new URL(url);
      return { host: u.hostname.replace(/^www\./i, ""), path: (u.pathname + u.search) || "/" };
    } catch {
      return { host: url, path: "" };
    }
  }
  // One display label per URL, derived from the same parser as the rows so a
  // malformed paste truncates identically in the skip-note and the row host.
  function hostLabel(url: string): string {
    return parts(url).host.slice(0, 24);
  }

  const detected = $derived(draft.trim() ? resolveSource(draft.trim()) : null);
  const draftInvalid = $derived(draft.trim().length > 0 && detected === null);

  function commitDraft() {
    const cands = splitPasted(draft);
    if (cands.length === 0) return;
    const res = addUrls(urls, cands);
    urls = res.urls;
    draft = "";
    skipNote = res.skipped.length
      ? `${res.added.length} added · ${res.skipped.length} skipped (${res.skipped.map((s) => hostLabel(s.url)).join(", ")})`
      : "";
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
  }
  function remove(url: string) {
    urls = urls.filter((u) => u !== url);
    skipNote = "";
  }
</script>

<!-- grid-cols-1 → minmax(0,1fr): pins rows to the container width so long URLs
     truncate instead of widening the row and pushing the source pill off-screen. -->
<div class="grid grid-cols-1 gap-[10px]">
  {#if urls.length === 0}
    <p class="rounded-[13px] border border-dashed border-[var(--glass-border)] px-4 py-5 text-center text-[0.82rem] text-ink-3">
      No search URLs yet — paste one below to start monitoring a marketplace.
    </p>
  {/if}

  {#each urls as url (url)}
    {@const k = keyOf(url)}
    {@const p = parts(url)}
    <div
      class="flex items-center gap-3 rounded-[14px] border px-3 py-[11px] transition-colors duration-150"
      style="background: linear-gradient(90deg, rgba({TINT[k].rgb},0.13), rgba({TINT[k].rgb},0.03)); border-color: rgba({TINT[k].rgb},0.22);"
    >
      <div class="min-w-0 flex-1">
        <div class="truncate text-[0.86rem] font-semibold text-ink">{p.host}</div>
        {#if p.path}<div class="truncate text-[0.72rem] text-ink-3">{p.path}</div>{/if}
      </div>
      <span
        class="flex-none rounded-full px-[9px] py-[4px] text-[0.62rem] font-extrabold uppercase tracking-[0.03em]"
        style="background: rgba({TINT[k].rgb},0.18); color: rgb({TINT[k].rgb});"
      >{TINT[k].label}</span>
      <button
        type="button"
        onclick={() => remove(url)}
        aria-label="Remove {p.host}"
        title="Remove"
        class="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] text-ink-3 transition-colors duration-150 hover:bg-[rgba(255,90,90,0.12)] hover:text-[var(--color-bad)]"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  {/each}

  <!-- Add field -->
  <div class="mt-1 flex gap-[9px]">
    <input
      bind:value={draft}
      onkeydown={onKey}
      placeholder="Paste an OLX / Otodom / Trójmiasto / Nieruchomości-online search URL…"
      class="min-w-0 flex-1 rounded-[13px] border border-[var(--glass-border)] bg-black/25 px-[13px] py-[11px] text-[0.84rem] text-ink transition-[border-color,box-shadow,background] duration-200 placeholder:text-ink-3 focus:border-[rgba(47,109,255,0.7)] focus:bg-black/35 focus:shadow-[0_0_0_3px_rgba(47,109,255,0.18)] focus:outline-none"
    />
    <button
      type="button"
      onclick={commitDraft}
      disabled={draftInvalid || draft.trim().length === 0}
      class="flex-none cursor-pointer rounded-[13px] border-0 px-5 text-[0.84rem] font-bold text-white transition-[filter,opacity] duration-200 bg-[linear-gradient(120deg,var(--color-aurora-indigo),var(--color-aurora-violet))] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >Add</button>
  </div>

  <!-- Live recognition / skip feedback (announced to screen readers as it changes) -->
  <div aria-live="polite" aria-atomic="true">
    {#if draftInvalid}
      <p class="flex items-center gap-2 px-1 text-[0.74rem] text-[var(--color-bad)]">
        <span class="h-[6px] w-[6px] flex-none rounded-full bg-current"></span>
        {hostLabel(draft.trim())} isn't a supported source — only OLX, Otodom, Trójmiasto &amp; Nieruchomości-online work.
      </p>
    {:else if detected}
      <p class="flex items-center gap-2 px-1 text-[0.74rem] text-[var(--color-good)]">
        <span class="h-[6px] w-[6px] flex-none rounded-full bg-current"></span>
        Recognised {TINT[detected].label} — press Enter or Add.
      </p>
    {:else if skipNote}
      <p class="flex items-center gap-2 px-1 text-[0.74rem] text-ink-2">
        <span class="h-[6px] w-[6px] flex-none rounded-full bg-current"></span>
        {skipNote}
      </p>
    {/if}
  </div>
</div>
