<script lang="ts">
  import Dashboard from "./Dashboard.svelte";
  import Config from "./Config.svelte";
  let tab: "offers" | "config" = $state("offers");
</script>

<nav>
  <button class:active={tab === "offers"} onclick={() => (tab = "offers")}>Oferty</button>
  <button class:active={tab === "config"} onclick={() => (tab = "config")}>Konfiguracja</button>
</nav>

<main>
  {#if tab === "offers"}<Dashboard />{:else}<Config />{/if}
</main>

<style>
  nav { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid #eee; }
  nav button.active { font-weight: 700; }
  main { padding: 16px; font-family: system-ui, sans-serif; }
</style>
