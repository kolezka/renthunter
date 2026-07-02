<script lang="ts">
  import { onMount } from "svelte";
  import { getAiModels, type Config } from "../lib/api";
  import { labelSpan, control, grid, hint, card } from "./styles";
  import StageCard from "./StageCard.svelte";
  import ModelSelect from "./ModelSelect.svelte";

  let { cfg = $bindable() }: { cfg: Config } = $props();

  let models = $state<string[]>([]);
  let modelsError = $state("");
  let loadingModels = $state(false);

  /** fresh=false on mount rides the server's 60s cache; the button forces a re-fetch.
   *  The endpoint typed into the form (even unsaved) is what gets tested. */
  async function loadModels(fresh: boolean) {
    loadingModels = true;
    try {
      const r = await getAiModels(fresh, cfg.aiBaseUrl);
      models = r.models;
      modelsError = r.error ?? "";
    } catch (err) {
      models = [];
      modelsError = err instanceof Error ? err.message : "Failed to load models";
    } finally {
      loadingModels = false;
    }
  }
  onMount(() => { loadModels(false); });
</script>

<div class="mb-[18px] {card}">
  <label class="grid gap-[7px]">
    <span class={labelSpan}>LiteLLM endpoint <em class={hint}>· blank = use server env</em></span>
    <input type="text" bind:value={cfg.aiBaseUrl} placeholder={cfg.aiBaseUrlEffective ?? "https://api.deepseek.com"} class={control} />
  </label>
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem]">
    <span class="flex items-center gap-2">
      <span class={labelSpan}>API key</span>
      {#if cfg.aiKeyConfigured}
        <span class="font-semibold text-good">configured ✓ <em class={hint}>· set via server env</em></span>
      {:else}
        <span class="font-semibold text-bad">not set ✗ <em class={hint}>· set LITELLM_API_KEY in env</em></span>
      {/if}
    </span>
    <span class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => loadModels(true)}
        disabled={loadingModels}
        class="cursor-pointer rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-[7px] text-[0.8rem] font-semibold text-ink-2 transition-colors duration-200 hover:bg-[var(--glass-fill-strong)] hover:text-ink disabled:cursor-default disabled:opacity-50"
      >{loadingModels ? "Refreshing…" : "Refresh models"}</button>
      {#if models.length}
        <span class="font-semibold text-good">✓ {models.length} models available</span>
      {:else if modelsError}
        <span class="font-semibold text-bad">{modelsError}</span>
      {/if}
    </span>
  </div>
</div>

<div class="grid gap-[14px]">
  <StageCard
    title="AI scoring"
    description="Scores each new offer 0–100 against your criteria. Offers at or above the threshold trigger notifications."
    bind:enabled={cfg.deepseekEnabled}
  >
    <ModelSelect label="Model" bind:value={cfg.scorerModel} {models} placeholder="deepseek/deepseek-chat" />
    <label class="grid gap-[7px]">
      <span class={labelSpan}>AI criteria</span>
      <textarea bind:value={cfg.aiCriteria} rows="5" placeholder="Describe the ideal apartment…" class="{control} resize-y leading-normal"></textarea>
    </label>
    <div class={grid}>
      <label class="grid gap-[7px]"><span class={labelSpan}>Score threshold (0–100)</span><input type="number" min="0" max="100" bind:value={cfg.scoreThreshold} class={control} /></label>
      <label class="grid gap-[7px]"><span class={labelSpan}>Output language <em class={hint}>· reasons &amp; features</em></span><input type="text" maxlength="40" bind:value={cfg.outputLanguage} placeholder="Polish" class={control} /></label>
    </div>
  </StageCard>

  <StageCard
    title="Feature extraction"
    description="Pulls amenities (balkon, parking, umeblowane…) out of descriptions. Powers the feature filter chips on the Offers page. Uses the scoring model."
    bind:enabled={cfg.extractEnabled}
  />

  <StageCard
    title="Semantic search"
    description="Creates embeddings so natural-language search (“quiet, near the sea”) finds matching offers."
    bind:enabled={cfg.embedEnabled}
  >
    <ModelSelect label="Embedding model" bind:value={cfg.embedModel} {models} placeholder="bge-m3" />
  </StageCard>
</div>
