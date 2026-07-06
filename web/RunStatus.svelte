<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { runStatus } from "./lib/runStatus.svelte";
  import { formatElapsed } from "./lib/format";

  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    runStatus.start();
    tick = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    runStatus.stop();
    clearInterval(tick);
  });

  const run = $derived(runStatus.current);
  const elapsed = $derived(run ? formatElapsed(now - Date.parse(run.startedAt)) : "");
  const progressText = $derived.by(() => {
    if (!run) return "";
    const p = run.progress;
    if (p.phase === "listing") return "listing…";
    return p.total != null ? `${p.processed}/${p.total}` : `${p.processed}`;
  });
</script>

{#if run}
  <div class="glass flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-[0.8rem]" role="status">
    <span class="h-2 w-2 animate-pulse rounded-full bg-[var(--color-aurora-indigo)]" aria-hidden="true"></span>
    <span class="font-semibold text-ink">{run.kind}</span>
    <span class="text-ink-3">· {run.source} · {elapsed} · {progressText}</span>
    <button
      class="cursor-pointer rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-3 py-[3px] text-[0.75rem] text-ink-2 transition-colors hover:bg-[rgba(251,113,133,0.18)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      onclick={() => runStatus.cancel()}
      disabled={run.cancelling}
    >
      {run.cancelling ? "Cancelling…" : "Cancel"}
    </button>
  </div>
{/if}
