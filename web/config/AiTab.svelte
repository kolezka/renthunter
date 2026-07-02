<script lang="ts">
  import { onMount } from "svelte";
  import { type Config } from "../lib/api";
  import { labelSpan, control, grid, hint, card } from "./styles";
  import StageCard from "./StageCard.svelte";
  import ModelSelect from "./ModelSelect.svelte";
  import { modelState, ensureModels, refreshModels } from "./aiModels.svelte";

  let { cfg = $bindable() }: { cfg: Config } = $props();

  // Model state is module-scoped (aiModels.svelte.ts) so it survives this tab's
  // remount-on-switch; ensureModels loads once per endpoint, the button forces it.
  onMount(() => { ensureModels(cfg.aiBaseUrl); });
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
        onclick={() => refreshModels(cfg.aiBaseUrl)}
        disabled={modelState.loading}
        class="cursor-pointer rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-[7px] text-[0.8rem] font-semibold text-ink-2 transition-colors duration-200 hover:bg-[var(--glass-fill-strong)] hover:text-ink disabled:cursor-default disabled:opacity-50"
      >{modelState.loading ? "Refreshing…" : "Refresh models"}</button>
      {#if modelState.models.length}
        <span class="font-semibold text-good">✓ {modelState.models.length} models available</span>
      {:else if modelState.error}
        <span class="font-semibold text-bad">{modelState.error}</span>
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
    <ModelSelect label="Model" bind:value={cfg.scorerModel} models={modelState.models} placeholder="deepseek/deepseek-chat" />
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
    <ModelSelect label="Embedding model" bind:value={cfg.embedModel} models={modelState.models} placeholder="bge-m3" />
  </StageCard>
</div>
