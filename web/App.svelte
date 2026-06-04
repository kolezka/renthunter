<script lang="ts">
  import Dashboard from "./Dashboard.svelte";
  import Config from "./Config.svelte";
  import Logs from "./Logs.svelte";

  let configOpen = $state(false);
  let view: "dashboard" | "logs" = $state("dashboard");
  const close = () => (configOpen = false);

  // Lock background scroll + freeze the aurora animation while the modal is
  // open (the `modal-open` class pauses the backdrop so its blur is cheap).
  $effect(() => {
    const open = configOpen;
    document.body.style.overflow = open ? "hidden" : "";
    document.documentElement.classList.toggle("modal-open", open);
    return () => {
      document.body.style.overflow = "";
      document.documentElement.classList.remove("modal-open");
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="mx-auto max-w-[1140px] px-4 pt-6 pb-18 sm:px-8 sm:pt-11">
  <header class="mb-8 flex items-center justify-between gap-4 animate-rise sm:mb-10">
    <div class="flex items-center gap-[14px]">
      <span
        class="grid h-[46px] w-[46px] place-items-center rounded-[14px] text-white shadow-[0_10px_28px_-8px_rgba(47,109,255,0.7),var(--inset-sheen)] bg-[linear-gradient(140deg,var(--color-aurora-indigo),var(--color-aurora-violet)_55%,var(--color-aurora-magenta))]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v9h14v-9" />
          <path d="M10 19v-5h4v5" />
        </svg>
      </span>
      <div class="flex flex-col leading-[1.15]">
        <span class="font-display text-[clamp(1.05rem,2.4vw,1.4rem)] font-extrabold tracking-[-0.02em]">RentHunter</span>
        <span class="text-[0.78rem] lowercase tracking-[0.04em] text-ink-3">rental listings monitor</span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <div class="flex gap-1 rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] p-1" role="group" aria-label="View">
        <button
          class="cursor-pointer rounded-full px-4 py-[6px] text-[0.85rem] transition-colors {view === 'dashboard' ? 'bg-[var(--glass-fill-strong)] text-ink' : 'text-ink-3 hover:text-ink'}"
          onclick={() => (view = "dashboard")}>Offers</button>
        <button
          class="cursor-pointer rounded-full px-4 py-[6px] text-[0.85rem] transition-colors {view === 'logs' ? 'bg-[var(--glass-fill-strong)] text-ink' : 'text-ink-3 hover:text-ink'}"
          onclick={() => (view = "logs")}>Logs</button>
      </div>

      <button
        class="group glass grid h-11 w-11 cursor-pointer place-items-center rounded-full text-ink-2 transition-colors duration-300 hover:text-ink"
        onclick={() => (configOpen = true)}
        aria-label="Settings"
        title="Settings"
      >
        <svg class="transition-transform duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] group-hover:rotate-90" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  </header>

  <main class="animate-rise">
    {#if view === "dashboard"}
      <Dashboard />
    {:else}
      <Logs />
    {/if}
  </main>
</div>

{#if configOpen}
  <!-- The container itself is the single dim+blur layer: fixed (covers the
       viewport even when content scrolls) and the only backdrop-filter while
       open. Clicking the container (outside the panel) closes. -->
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-md sm:p-8"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    onclick={(e) => e.target === e.currentTarget && close()}
  >
    <Config onClose={close} />
  </div>
{/if}
