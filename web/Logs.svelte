<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getLogs, logStreamUrl, type LogEntry } from "./lib/api";
  import { mergeEntries, filterEntries, summarizeContext, distinctEvents, distinctRuns } from "./lib/logs";

  let entries: LogEntry[] = $state([]);
  let loading = $state(true);
  let connected = $state(false);
  let level = $state("all");
  let eventFilter = $state("all");
  let runFilter = $state("all");
  let search = $state("");
  let follow = $state(true);
  let expanded = $state<Record<number, boolean>>({});
  let copiedId = $state<number | null>(null);
  let viewport: HTMLDivElement | null = $state(null);
  let es: EventSource | undefined;

  const shown = $derived(filterEntries(entries, { level, event: eventFilter, runId: runFilter, search }));
  const events = $derived(distinctEvents(entries));
  const runs = $derived(distinctRuns(entries));
  const hasFilter = $derived(level !== "all" || eventFilter !== "all" || runFilter !== "all" || search.trim() !== "");

  onMount(() => {
    // Stream first, backlog second: the stream only carries rows newer than
    // connect time, so this order leaves no gap (mergeEntries dedups overlap).
    es = new EventSource(logStreamUrl);
    es.addEventListener("ready", () => (connected = true));
    es.addEventListener("logs", (e) => {
      try {
        entries = mergeEntries(entries, JSON.parse((e as MessageEvent).data) as LogEntry[]);
      } catch {
        // ignore malformed payloads
      }
    });
    es.onerror = () => (connected = false); // EventSource auto-reconnects
    getLogs(300)
      .then((backlog) => (entries = mergeEntries(entries, backlog)))
      .catch(() => {})
      .finally(() => (loading = false));
  });
  onDestroy(() => es?.close());

  // Pin the viewport to the bottom while following.
  $effect(() => {
    void shown.length;
    if (follow && viewport) viewport.scrollTop = viewport.scrollHeight;
  });

  const levelDot: Record<string, string> = {
    info: "bg-[var(--color-aurora-indigo)]",
    warn: "bg-mid",
    error: "bg-bad",
  };

  const time = (ts: string) =>
    new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const day = (ts: string) =>
    new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const localDay = (ts: string) => new Date(ts).toDateString();

  // Divider predicates over the *filtered* list (oldest-at-top).
  function isDayBoundary(i: number): boolean {
    if (i === 0) return true;
    return localDay(shown[i]!.ts) !== localDay(shown[i - 1]!.ts);
  }
  function isRunBoundary(i: number): boolean {
    if (i === 0) return false;
    return shown[i]!.runId !== shown[i - 1]!.runId;
  }

  function toggle(e: LogEntry) {
    if (e.context == null) return;
    expanded[e.id] = !expanded[e.id];
  }

  async function copyContext(ev: MouseEvent, e: LogEntry) {
    ev.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(e.context, null, 2));
      copiedId = e.id;
      setTimeout(() => (copiedId = null), 1200);
    } catch {
      // clipboard unavailable (permissions/non-secure context) — ignore
    }
  }

  function clearFilters() {
    level = "all";
    eventFilter = "all";
    runFilter = "all";
    search = "";
  }
</script>

<section class="animate-rise">
  <header class="mb-5 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h2 class="m-0 font-display text-[1.5rem] font-extrabold tracking-[-0.02em]">Logs</h2>
      <p class="m-0 text-[0.9rem] text-ink-3">
        Monitor event stream ·
        <span class={connected ? "text-good" : "text-mid"}>{connected ? "● live" : "○ reconnecting"}</span>
      </p>
    </div>
  </header>

  <div
    class="glass mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-glass)] px-4 py-3 text-[0.85rem]"
    role="group"
    aria-label="Log filters"
  >
    <label class="flex items-center gap-2 text-ink-3">
      Level
      <select
        bind:value={level}
        class="cursor-pointer rounded-lg border border-[var(--glass-border)] bg-[var(--glass-fill)] px-2 py-1 text-ink [&>option]:bg-[#12141d]"
      >
        <option value="all">all</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
    </label>
    <label class="flex items-center gap-2 text-ink-3">
      Event
      <select
        bind:value={eventFilter}
        class="max-w-[180px] cursor-pointer rounded-lg border border-[var(--glass-border)] bg-[var(--glass-fill)] px-2 py-1 text-ink [&>option]:bg-[#12141d]"
      >
        <option value="all">all</option>
        {#each events as ev (ev)}
          <option value={ev}>{ev}</option>
        {/each}
      </select>
    </label>
    <label class="flex items-center gap-2 text-ink-3">
      Run
      <select
        bind:value={runFilter}
        class="max-w-[180px] cursor-pointer rounded-lg border border-[var(--glass-border)] bg-[var(--glass-fill)] px-2 py-1 text-ink [&>option]:bg-[#12141d]"
      >
        <option value="all">all</option>
        {#each runs as r (r.id)}
          <option value={r.id}>{r.label}</option>
        {/each}
      </select>
    </label>
    <input
      type="search"
      placeholder="Filter text…"
      bind:value={search}
      class="min-w-[160px] flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-fill)] px-3 py-1 text-ink placeholder:text-ink-3"
    />
    <label class="flex cursor-pointer items-center gap-2 text-ink-3">
      <input type="checkbox" bind:checked={follow} class="accent-[var(--color-aurora-indigo)]" /> Follow
    </label>
    <span class="tabular-nums text-ink-3">{shown.length} / {entries.length}</span>
  </div>

  {#if loading && entries.length === 0}
    <p class="text-ink-3">Loading…</p>
  {:else}
    <div class="glass overflow-hidden rounded-[var(--radius-glass)] p-2">
      <div
        bind:this={viewport}
        class="h-[68vh] overflow-y-auto rounded-[18px] border border-[var(--glass-border)] bg-[#07080f] px-3 py-2 font-mono text-[0.8rem] leading-[1.55]"
      >
        {#each shown as e, i (e.id)}
          {#if isDayBoundary(i)}
            <div class="my-1 flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.1em] text-ink-3">
              <span class="h-px flex-1 bg-[var(--glass-border)]"></span>
              {day(e.ts)}
              <span class="h-px flex-1 bg-[var(--glass-border)]"></span>
            </div>
          {/if}
          {#if isRunBoundary(i)}
            <div class="my-1 text-[0.68rem] uppercase tracking-[0.1em] text-ink-3">
              — run {e.runId ? e.runId.slice(0, 8) : "n/a"} —
            </div>
          {/if}
          <div
            class="flex items-start gap-3 rounded px-1 py-[2px] hover:bg-[rgba(255,255,255,0.04)] {e.context != null ? 'cursor-pointer' : ''}"
            onclick={() => toggle(e)}
            role={e.context != null ? "button" : undefined}
          >
            <span class="w-[64px] flex-shrink-0 tabular-nums text-ink-3">{time(e.ts)}</span>
            <span class="mt-[7px] h-2 w-2 flex-shrink-0 rounded-full {levelDot[e.level] ?? 'bg-ink-3'}" aria-hidden="true"></span>
            <span class="w-[150px] flex-shrink-0 truncate text-ink-2" title={e.event}>{e.event}</span>
            <div class="min-w-0 flex-1">
              <span class="break-words {e.level === 'error' ? 'text-bad' : e.level === 'warn' ? 'text-mid' : 'text-ink'}">{e.message}</span>
              {#if e.level === "error" && e.context != null && !expanded[e.id]}
                <div class="truncate text-[0.72rem] text-ink-3" title={summarizeContext(e.context)}>
                  {summarizeContext(e.context)}
                </div>
              {/if}
            </div>
            {#if e.context != null}
              <span class="flex-shrink-0 text-ink-3" aria-hidden="true">{expanded[e.id] ? "▾" : "▸"}</span>
            {/if}
          </div>
          {#if expanded[e.id] && e.context != null}
            <div class="relative mb-1 ml-[84px] mr-1 rounded-lg border border-[var(--glass-border)] bg-[rgba(255,255,255,0.03)] p-2">
              <button
                class="absolute right-2 top-2 cursor-pointer rounded border border-[var(--glass-border)] bg-[var(--glass-fill)] px-2 py-[2px] text-[0.7rem] text-ink-2 hover:text-ink"
                onclick={(ev) => copyContext(ev, e)}
              >
                {copiedId === e.id ? "Copied" : "Copy"}
              </button>
              <pre class="m-0 overflow-x-auto whitespace-pre-wrap break-words text-[0.75rem] text-ink-2">{JSON.stringify(e.context, null, 2)}</pre>
            </div>
          {/if}
        {:else}
          <div class="p-4 text-ink-3">
            {#if entries.length === 0}
              No entries yet.
            {:else}
              No entries match the filters.
              <button class="ml-1 cursor-pointer text-[var(--color-aurora-violet)] underline" onclick={clearFilters}>Clear filters</button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>
