<script lang="ts">
  import SearchUrlList from "../SearchUrlList.svelte";
  import type { Config } from "../lib/api";
  import { labelSpan, control, grid } from "./styles";

  let { cfg = $bindable() }: { cfg: Config } = $props();

  // Computed once on mount, not reactively: active constraints must never be hidden
  // behind a collapsed header, but the group shouldn't snap shut while typing/clearing.
  const initiallyOpen = [cfg.minPrice, cfg.maxPrice, cfg.minArea, cfg.maxArea, cfg.minRooms, cfg.maxRooms]
    .some((v) => v != null);
</script>

<SearchUrlList bind:urls={cfg.searchUrls} />

<details open={initiallyOpen} class="mt-5 rounded-[14px] border border-[var(--glass-border)] bg-white/[0.03] p-4">
  <summary class="cursor-pointer select-none text-[0.92rem] font-semibold">
    Hard limits <span class="text-[0.8rem] font-medium text-ink-3">· optional</span>
  </summary>
  <p class="mb-[14px] mt-2 text-[0.8rem] leading-snug text-ink-3">
    Optional safety net applied on top of your search URLs — offers outside these bounds are rejected before scoring. Empty = no limit.
  </p>
  <div class={grid}>
    <label class="grid gap-[7px]"><span class={labelSpan}>Min price</span><input type="number" bind:value={cfg.minPrice} class={control} /></label>
    <label class="grid gap-[7px]"><span class={labelSpan}>Max price</span><input type="number" bind:value={cfg.maxPrice} class={control} /></label>
    <label class="grid gap-[7px]"><span class={labelSpan}>Min area</span><input type="number" bind:value={cfg.minArea} class={control} /></label>
    <label class="grid gap-[7px]"><span class={labelSpan}>Max area</span><input type="number" min="0" bind:value={cfg.maxArea} class={control} /></label>
    <label class="grid gap-[7px]"><span class={labelSpan}>Min rooms</span><input type="number" bind:value={cfg.minRooms} class={control} /></label>
    <label class="grid gap-[7px]"><span class={labelSpan}>Max rooms</span><input type="number" min="0" bind:value={cfg.maxRooms} class={control} /></label>
  </div>
</details>
