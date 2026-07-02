<script lang="ts">
  import type { Snippet } from "svelte";
  import { toggleTrack, toggleKnob } from "./styles";

  let {
    title,
    description,
    enabled = $bindable(),
    children,
  }: { title: string; description: string; enabled: boolean; children?: Snippet } = $props();
</script>

<section class="rounded-[14px] border border-[var(--glass-border)] bg-white/[0.03] p-4">
  <label class="flex cursor-pointer select-none items-start justify-between gap-4">
    <span class="grid gap-[3px]">
      <span class="text-[0.95rem] font-bold">{title}</span>
      <span class="text-[0.8rem] leading-snug text-ink-3">{description}</span>
    </span>
    <input type="checkbox" bind:checked={enabled} class="peer pointer-events-none absolute opacity-0" />
    <span class="{toggleTrack} mt-[2px]" aria-hidden="true"><span class={toggleKnob}></span></span>
  </label>
  {#if children}
    <!-- fieldset[disabled] natively disables every input inside; opacity conveys it. -->
    <fieldset
      disabled={!enabled}
      class="m-0 mt-4 grid min-w-0 gap-[14px] border-0 p-0 transition-opacity duration-200 {enabled ? '' : 'opacity-40'}"
    >
      {@render children()}
    </fieldset>
  {/if}
</section>
