<script lang="ts">
  import { onMount } from "svelte";
  import { getConfig, saveConfig, type Config } from "./lib/api";
  import SearchUrlList from "./SearchUrlList.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let cfg: Config | null = $state(null);
  let saved = $state(false);
  let error = $state("");
  let appriseText = $state("");

  type SectionId = "search" | "filters" | "ai" | "performance" | "notifications";
  const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
    { id: "search", label: "Search", blurb: "Where RentHunter looks for listings." },
    { id: "filters", label: "Filters", blurb: "Hard limits applied before scoring." },
    { id: "ai", label: "AI scoring", blurb: "How offers are scored and enriched." },
    { id: "performance", label: "Performance", blurb: "Crawl throughput and pacing." },
    { id: "notifications", label: "Notifications", blurb: "Where new matches are sent." },
  ];
  let active = $state<SectionId>("search");
  const current = $derived(SECTIONS.find((s) => s.id === active)!);

  onMount(async () => {
    cfg = await getConfig();
    appriseText = cfg.appriseUrls.join("\n");
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!cfg) return;
    error = "";
    const patch: Partial<Config> = {
      ...cfg,
      // SearchUrlList only admits trimmed, recognised URLs, so this is a defensive
      // pass in case the server ever echoes back a dirty/empty entry.
      searchUrls: cfg.searchUrls.map((s) => s.trim()).filter(Boolean),
      appriseUrls: appriseText.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      cfg = await saveConfig(patch);
      appriseText = cfg.appriseUrls.join("\n");
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (err) {
      // Validation rejection (e.g. cleared threshold/interval, bad searchUrl) — keep
      // the form state intact and tell the user what was wrong.
      error = err instanceof Error ? err.message : "Failed to save";
    }
  }

  // No backdrop-filter inside the modal: it already sits over the overlay's single
  // blur layer, so plain translucent fills avoid stacking expensive blur passes.
  const labelSpan = "text-[0.78rem] font-semibold tracking-[0.03em] text-ink-2";
  const control =
    "w-full rounded-[12px] border border-[var(--glass-border)] bg-black/25 px-[13px] py-[11px] text-ink transition-[border-color,box-shadow,background] duration-200 placeholder:text-ink-3 focus:border-[rgba(47,109,255,0.7)] focus:bg-black/35 focus:shadow-[0_0_0_3px_rgba(47,109,255,0.18)] focus:outline-none";
  const grid = "grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px]";
  const toggleTrack =
    "relative h-[27px] w-[46px] flex-shrink-0 rounded-full border border-[var(--glass-border)] bg-white/10 transition-[background,border-color] duration-300 peer-checked:border-transparent peer-checked:bg-[linear-gradient(120deg,var(--color-aurora-indigo),var(--color-aurora-violet))] peer-checked:[&>span]:translate-x-[19px] peer-focus-visible:shadow-[0_0_0_3px_rgba(47,109,255,0.3)]";
  const toggleKnob =
    "absolute left-[2px] top-[2px] h-[21px] w-[21px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1.18,0.36,1)]";
</script>

{#snippet ico(id: SectionId)}
  {#if id === "search"}<circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  {:else if id === "filters"}<path d="M4 6h16M4 12h10M4 18h6" /><circle cx="17" cy="12" r="2" /><circle cx="13" cy="18" r="2" />
  {:else if id === "ai"}<path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z" /><path d="M5 16l.8 2.2L8 19l-2.2.8L5 22" />
  {:else if id === "performance"}<path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  {:else if id === "notifications"}<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
  {/if}
{/snippet}

<div
  class="relative my-auto flex max-h-[min(86vh,760px)] w-full max-w-[880px] flex-col overflow-hidden rounded-[var(--radius-glass)] border border-[var(--glass-border)] bg-[rgba(14,19,34,0.92)] shadow-[var(--shadow-lift),var(--inset-sheen)] animate-pop"
>
  <!-- Header -->
  <header class="flex flex-shrink-0 items-center justify-between gap-4 border-b border-[var(--glass-border)] px-6 py-[18px] sm:px-7">
    <div class="flex items-center gap-[13px]">
      <span
        class="grid h-[42px] w-[42px] flex-shrink-0 place-items-center rounded-[13px] text-white shadow-[0_10px_24px_-10px_rgba(47,109,255,0.8),var(--inset-sheen)] bg-[linear-gradient(140deg,var(--color-aurora-indigo),var(--color-aurora-violet)_60%,var(--color-aurora-magenta))]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </span>
      <div class="leading-tight">
        <h2 class="m-0 font-display text-[1.4rem] font-extrabold tracking-[-0.02em]">Settings</h2>
        <p class="m-0 text-[0.85rem] text-ink-3">Monitor &amp; notification parameters</p>
      </div>
    </div>
    <button
      class="grid h-9 w-9 flex-shrink-0 cursor-pointer place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-2 transition-colors duration-200 hover:bg-[var(--glass-fill-strong)] hover:text-ink"
      onclick={onClose}
      aria-label="Close"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  </header>

  {#if cfg}
    <form onsubmit={submit} class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <!-- Section rail: vertical on desktop, horizontal scroll strip on mobile -->
        <nav
          class="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-[var(--glass-border)] p-3 sm:w-[212px] sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r"
          aria-label="Settings sections"
        >
          {#each SECTIONS as s (s.id)}
            <button
              type="button"
              onclick={() => (active = s.id)}
              aria-current={active === s.id ? "page" : undefined}
              class="flex flex-shrink-0 items-center gap-[10px] rounded-[12px] border px-[13px] py-[10px] text-left text-[0.86rem] font-semibold transition-[color,background,border-color] duration-200 {active === s.id
                ? 'border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] text-ink shadow-[var(--inset-sheen)]'
                : 'border-transparent text-ink-3 hover:bg-white/[0.04] hover:text-ink'}"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 {active === s.id ? 'text-[var(--color-aurora-violet)]' : ''}">
                {@render ico(s.id)}
              </svg>
              <span>{s.label}</span>
            </button>
          {/each}
        </nav>

        <!-- Content pane -->
        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
          {#key active}
            <div class="animate-rise">
              <div class="mb-[18px]">
                <h3 class="m-0 font-display text-[1.15rem] font-bold tracking-[-0.01em]">{current.label}</h3>
                <p class="m-0 mt-[2px] text-[0.82rem] text-ink-3">{current.blurb}</p>
              </div>

              {#if active === "search"}
                <SearchUrlList bind:urls={cfg.searchUrls} />

              {:else if active === "filters"}
                <div class={grid}>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Min price</span><input type="number" bind:value={cfg.minPrice} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Max price</span><input type="number" bind:value={cfg.maxPrice} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Min area</span><input type="number" bind:value={cfg.minArea} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Max area</span><input type="number" min="0" bind:value={cfg.maxArea} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Min rooms</span><input type="number" bind:value={cfg.minRooms} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Max rooms</span><input type="number" min="0" bind:value={cfg.maxRooms} class={control} /></label>
                </div>

              {:else if active === "ai"}
                <label class="grid gap-[7px]">
                  <span class={labelSpan}>AI criteria</span>
                  <textarea bind:value={cfg.aiCriteria} rows="5" placeholder="Describe the ideal apartment…" class="{control} resize-y leading-normal"></textarea>
                </label>
                <div class="mt-[14px] {grid}">
                  <label class="grid gap-[7px]"><span class={labelSpan}>Score threshold (0–100)</span><input type="number" min="0" max="100" bind:value={cfg.scoreThreshold} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Interval (min) <em class="font-medium not-italic text-ink-3">· 0 = off</em></span><input type="number" min="0" bind:value={cfg.pollIntervalMin} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Auto-rescore (min) <em class="font-medium not-italic text-ink-3">· 0 = off</em></span><input type="number" min="0" max="10080" bind:value={cfg.rescoreIntervalMin} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Output language <em class="font-medium not-italic text-ink-3">· AI reasons &amp; features</em></span><input type="text" maxlength="40" bind:value={cfg.outputLanguage} placeholder="Polish" class={control} /></label>
                </div>
                <div class="mt-5 grid gap-[14px] rounded-[14px] border border-[var(--glass-border)] bg-white/[0.03] p-4">
                  <label class="flex cursor-pointer select-none items-center gap-3">
                    <input type="checkbox" bind:checked={cfg.deepseekEnabled} class="peer pointer-events-none absolute opacity-0" />
                    <span class={toggleTrack} aria-hidden="true"><span class={toggleKnob}></span></span>
                    <span class="text-[0.92rem] font-semibold">DeepSeek scoring</span>
                  </label>
                  <label class="flex cursor-pointer select-none items-center gap-3">
                    <input type="checkbox" bind:checked={cfg.extractEnabled} class="peer pointer-events-none absolute opacity-0" />
                    <span class={toggleTrack} aria-hidden="true"><span class={toggleKnob}></span></span>
                    <span class="text-[0.92rem] font-semibold">Feature extraction (AI)</span>
                  </label>
                  <label class="flex cursor-pointer select-none items-center gap-3">
                    <input type="checkbox" bind:checked={cfg.embedEnabled} class="peer pointer-events-none absolute opacity-0" />
                    <span class={toggleTrack} aria-hidden="true"><span class={toggleKnob}></span></span>
                    <span class="text-[0.92rem] font-semibold">Embeddings (semantic search)</span>
                  </label>
                </div>

              {:else if active === "performance"}
                <div class={grid}>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Workers (parallel)</span><input type="number" min="1" max="16" bind:value={cfg.concurrencyLimit} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>List pages</span><input type="number" min="1" max="10" bind:value={cfg.listPages} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Max fetches / run</span><input type="number" min="1" max="500" bind:value={cfg.maxDetailFetchesPerRun} class={control} /></label>
                  <label class="grid gap-[7px]"><span class={labelSpan}>Delay (ms)</span><input type="number" min="0" max="10000" bind:value={cfg.requestDelayMs} class={control} /></label>
                </div>

              {:else if active === "notifications"}
                <label class="grid gap-[7px]">
                  <span class={labelSpan}>Apprise URLs <em class="font-medium not-italic text-ink-3">· one per line</em></span>
                  <textarea bind:value={appriseText} rows="5" placeholder={"discord://…\ntgram://…\nntfy://…"} class="{control} resize-y leading-normal"></textarea>
                </label>
              {/if}
            </div>
          {/key}
        </div>
      </div>

      <!-- Sticky save bar -->
      <footer class="flex flex-shrink-0 items-center justify-end gap-[14px] border-t border-[var(--glass-border)] bg-black/20 px-6 py-[14px] sm:px-7">
        {#if saved}<span class="animate-rise text-[0.9rem] font-semibold text-good">Saved ✓</span>{/if}
        {#if error}<span class="animate-rise text-[0.85rem] font-semibold text-bad">{error}</span>{/if}
        <button
          type="submit"
          class="cursor-pointer rounded-full border-0 px-7 py-[12px] text-[0.92rem] font-bold text-white shadow-[0_12px_28px_-10px_rgba(47,109,255,0.8),var(--inset-sheen)] transition-[transform,box-shadow,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] bg-[linear-gradient(120deg,var(--color-aurora-indigo),var(--color-aurora-violet)_70%,var(--color-aurora-magenta))] hover:-translate-y-[2px] hover:brightness-110 active:translate-y-0"
        >Save changes</button>
      </footer>
    </form>
  {:else}
    <div class="grid flex-1 place-items-center p-16 text-ink-3">Loading configuration…</div>
  {/if}
</div>
