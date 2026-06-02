<script lang="ts">
  import { onMount } from "svelte";
  import { getConfig, saveConfig, type Config } from "./lib/api";
  let cfg: Config | null = $state(null);
  let saved = $state(false);
  let error = $state("");
  let appriseText = $state("");

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
      appriseUrls: appriseText.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      cfg = await saveConfig(patch);
      appriseText = cfg.appriseUrls.join("\n");
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (err) {
      // Validation rejection (e.g. cleared próg/interwał, bad searchUrl) — keep
      // the form state intact and tell the user what was wrong.
      error = err instanceof Error ? err.message : "Nie udało się zapisać";
    }
  }

  // No backdrop-filter here: these sit inside the modal (already over a blurred
  // dim), so a plain translucent fill avoids stacking expensive blur layers.
  const panel = "rounded-[18px] border border-[var(--glass-border)] bg-white/[0.04] p-[22px]";
  const legend = "px-1 font-display text-[0.95rem] font-bold tracking-[-0.01em] text-ink";
  const labelSpan = "text-[0.78rem] font-semibold tracking-[0.03em] text-ink-2";
  const control = "w-full rounded-[12px] border border-[var(--glass-border)] bg-black/25 px-[13px] py-[11px] text-ink transition-[border-color,box-shadow,background] duration-200 placeholder:text-ink-3 focus:border-[rgba(47,109,255,0.7)] focus:bg-black/35 focus:shadow-[0_0_0_3px_rgba(47,109,255,0.18)] focus:outline-none";
</script>

{#if cfg}
  <form onsubmit={submit} class="grid gap-[18px]">
    <fieldset class={panel}>
      <legend class={legend}>Wyszukiwanie</legend>
      <label class="mt-3 grid gap-[7px]">
        <span class={labelSpan}>Search URL</span>
        <textarea bind:value={cfg.searchUrl} rows="2" placeholder="https://…" class="{control} resize-y leading-normal"></textarea>
      </label>
    </fieldset>

    <fieldset class={panel}>
      <legend class={legend}>Filtry</legend>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px]">
        <label class="grid gap-[7px]"><span class={labelSpan}>Min cena</span><input type="number" bind:value={cfg.minPrice} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Max cena</span><input type="number" bind:value={cfg.maxPrice} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Min metraż</span><input type="number" bind:value={cfg.minArea} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Min pokoje</span><input type="number" bind:value={cfg.minRooms} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Max metraż</span><input type="number" min="0" bind:value={cfg.maxArea} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Max pokoje</span><input type="number" min="0" bind:value={cfg.maxRooms} class={control} /></label>
      </div>
    </fieldset>

    <fieldset class={panel}>
      <legend class={legend}>Ocena AI</legend>
      <label class="mt-3 grid gap-[7px]">
        <span class={labelSpan}>Kryteria AI</span>
        <textarea bind:value={cfg.aiCriteria} rows="4" placeholder="Opisz idealne mieszkanie…" class="{control} resize-y leading-normal"></textarea>
      </label>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px]">
        <label class="grid gap-[7px]"><span class={labelSpan}>Próg score (0–100)</span><input type="number" min="0" max="100" bind:value={cfg.scoreThreshold} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Interwał (min)</span><input type="number" min="1" bind:value={cfg.pollIntervalMin} class={control} /></label>
      </div>
      <label class="mt-[18px] flex cursor-pointer select-none items-center gap-3">
        <input type="checkbox" bind:checked={cfg.deepseekEnabled} class="peer pointer-events-none absolute opacity-0" />
        <span class="relative h-[27px] w-[46px] flex-shrink-0 rounded-full border border-[var(--glass-border)] bg-white/10 transition-[background,border-color] duration-300 peer-checked:border-transparent peer-checked:bg-[linear-gradient(120deg,var(--color-aurora-indigo),var(--color-aurora-violet))] peer-checked:[&>span]:translate-x-[19px] peer-focus-visible:shadow-[0_0_0_3px_rgba(47,109,255,0.3)]" aria-hidden="true">
          <span class="absolute left-[2px] top-[2px] h-[21px] w-[21px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1.18,0.36,1)]"></span>
        </span>
        <span class="text-[0.92rem] font-semibold">DeepSeek scoring</span>
      </label>
    </fieldset>

    <fieldset class={panel}>
      <legend class={legend}>Wydajność</legend>
      <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px]">
        <label class="grid gap-[7px]"><span class={labelSpan}>Workers (równolegle)</span><input type="number" min="1" max="16" bind:value={cfg.concurrencyLimit} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Strony listy</span><input type="number" min="1" max="10" bind:value={cfg.listPages} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Max pobrań / przebieg</span><input type="number" min="1" max="500" bind:value={cfg.maxDetailFetchesPerRun} class={control} /></label>
        <label class="grid gap-[7px]"><span class={labelSpan}>Opóźnienie (ms)</span><input type="number" min="0" max="10000" bind:value={cfg.requestDelayMs} class={control} /></label>
      </div>
    </fieldset>

    <fieldset class={panel}>
      <legend class={legend}>Powiadomienia</legend>
      <label class="mt-3 grid gap-[7px]">
        <span class={labelSpan}>Apprise URLs <em class="font-medium not-italic text-ink-3">· jeden na linię</em></span>
        <textarea bind:value={appriseText} rows="3" placeholder={"discord://…\ntgram://…"} class="{control} resize-y leading-normal"></textarea>
      </label>
    </fieldset>

    <div class="flex items-center gap-[14px]">
      <button
        type="submit"
        class="cursor-pointer rounded-full border-0 px-7 py-[13px] text-[0.95rem] font-bold text-white shadow-[0_12px_28px_-10px_rgba(47,109,255,0.8),var(--inset-sheen)] transition-[transform,box-shadow,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] bg-[linear-gradient(120deg,var(--color-aurora-indigo),var(--color-aurora-violet)_70%,var(--color-aurora-magenta))] hover:-translate-y-[2px] hover:brightness-110 active:translate-y-0"
      >Zapisz zmiany</button>
      {#if saved}<span class="animate-rise text-[0.9rem] font-semibold text-good">Zapisano ✓</span>{/if}
      {#if error}<span class="animate-rise text-[0.9rem] font-semibold text-bad">{error}</span>{/if}
    </div>
  </form>
{:else}
  <div class="glass rounded-[var(--radius-glass)] p-10 text-center text-ink-3">Ładowanie konfiguracji…</div>
{/if}
