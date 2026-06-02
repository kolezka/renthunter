<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getLogs, type LogEntry } from "./lib/api";

  let entries: LogEntry[] = $state([]);
  let loading = $state(true);
  let filter: "all" | "error" = $state("all");
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    try {
      entries = await getLogs(300);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    refresh();
    // Auto-poll while the view is mounted (every 5s).
    timer = setInterval(refresh, 5000);
  });
  onDestroy(() => clearInterval(timer));

  const shown = $derived(
    filter === "error" ? entries.filter((e) => e.level === "error") : entries,
  );

  const levelDot: Record<string, string> = {
    info: "bg-[var(--color-aurora-indigo)]",
    warn: "bg-mid",
    error: "bg-bad",
  };

  const time = (ts: string) =>
    new Date(ts).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // True when this row begins a different run than the row above it (newest-first
  // list, so compare with the previous index).
  function isRunBoundary(i: number): boolean {
    if (i === 0) return false;
    return shown[i]!.runId !== shown[i - 1]!.runId;
  }
</script>

<section class="animate-rise">
  <header class="mb-5 flex items-center justify-between gap-4">
    <div>
      <h2 class="m-0 font-display text-[1.5rem] font-extrabold tracking-[-0.02em]">Logi</h2>
      <p class="m-0 text-[0.9rem] text-ink-3">Strumień zdarzeń monitora · auto-odświeżanie co 5 s</p>
    </div>
    <div class="flex gap-1 rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] p-1">
      <button
        class="cursor-pointer rounded-full px-3 py-1 text-[0.8rem] transition-colors {filter === 'all' ? 'bg-[var(--glass-fill-strong)] text-ink' : 'text-ink-3 hover:text-ink'}"
        onclick={() => (filter = "all")}>Wszystkie</button>
      <button
        class="cursor-pointer rounded-full px-3 py-1 text-[0.8rem] transition-colors {filter === 'error' ? 'bg-[var(--glass-fill-strong)] text-ink' : 'text-ink-3 hover:text-ink'}"
        onclick={() => (filter = "error")}>Błędy</button>
    </div>
  </header>

  {#if loading}
    <p class="text-ink-3">Ładowanie…</p>
  {:else if shown.length === 0}
    <div class="glass rounded-[var(--radius-glass)] p-8 text-center text-ink-3">
      Brak wpisów do wyświetlenia.
    </div>
  {:else}
    <div class="glass overflow-hidden rounded-[var(--radius-glass)]">
      <ul class="divide-y divide-[var(--glass-border)] font-mono text-[0.82rem]">
        {#each shown as e, i (e.id)}
          {#if isRunBoundary(i)}
            <li class="bg-[var(--glass-fill)] px-4 py-1 text-[0.7rem] uppercase tracking-[0.08em] text-ink-3">
              — nowy przebieg —
            </li>
          {/if}
          <li class="flex items-start gap-3 px-4 py-2">
            <span class="mt-[6px] h-2 w-2 flex-shrink-0 rounded-full {levelDot[e.level] ?? 'bg-ink-3'}" aria-hidden="true"></span>
            <span class="w-[68px] flex-shrink-0 tabular-nums text-ink-3">{time(e.ts)}</span>
            <span class="w-[88px] flex-shrink-0 truncate text-ink-2" title={e.event}>{e.event}</span>
            <span class="min-w-0 flex-1 break-words {e.level === 'error' ? 'text-bad' : 'text-ink'}">{e.message}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
