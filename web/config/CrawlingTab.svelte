<script lang="ts">
  import type { Config } from "../lib/api";
  import { labelSpan, control, grid, fieldDesc } from "./styles";

  let { cfg = $bindable() }: { cfg: Config } = $props();
</script>

<div class="grid gap-5">
  <section>
    <h4 class="m-0 mb-[10px] text-[0.95rem] font-bold">Schedule</h4>
    <div class={grid}>
      <label class="grid content-start gap-[7px]">
        <span class={labelSpan}>Crawl interval (min)</span>
        <input type="number" min="0" max="1440" bind:value={cfg.pollIntervalMin} class={control} />
        <p class={fieldDesc}>How often the crawler checks all search URLs for new offers. 0 disables automatic crawling; you can still run it manually.</p>
      </label>
      <label class="grid content-start gap-[7px]">
        <span class={labelSpan}>Auto-rescore (min)</span>
        <input type="number" min="0" max="10080" bind:value={cfg.rescoreIntervalMin} class={control} />
        <p class={fieldDesc}>How often existing offers are re-scored against your current criteria (useful after editing criteria). 0 = never; rescore manually from the Offers page.</p>
      </label>
    </div>
  </section>

  <section>
    <h4 class="m-0 mb-[10px] text-[0.95rem] font-bold">Throughput</h4>
    <div class={grid}>
      <label class="grid content-start gap-[7px]">
        <span class={labelSpan}>Parallel workers</span>
        <input type="number" min="1" max="16" bind:value={cfg.concurrencyLimit} class={control} />
        <p class={fieldDesc}>How many offer pages are fetched simultaneously. Higher = faster crawls but more load on the source sites (risk of rate-limiting/bans).</p>
      </label>
      <label class="grid content-start gap-[7px]">
        <span class={labelSpan}>List pages per source</span>
        <input type="number" min="1" max="10" bind:value={cfg.listPages} class={control} />
        <p class={fieldDesc}>How many pages of search results to walk per search URL each run. Deeper pages contain older offers.</p>
      </label>
      <label class="grid content-start gap-[7px]">
        <span class={labelSpan}>Max detail fetches per run</span>
        <input type="number" min="1" max="500" bind:value={cfg.maxDetailFetchesPerRun} class={control} />
        <p class={fieldDesc}>Cap on full offer pages fetched in one run. Protects against runaway runs when a source returns thousands of results.</p>
      </label>
      <label class="grid content-start gap-[7px]">
        <span class={labelSpan}>Request delay (ms)</span>
        <input type="number" min="0" max="10000" bind:value={cfg.requestDelayMs} class={control} />
        <p class={fieldDesc}>Pause between consecutive requests to the same source. Raise this if you see blocks or CAPTCHAs in the logs.</p>
      </label>
    </div>
  </section>
</div>
