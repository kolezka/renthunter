<script lang="ts">
  import { onMount } from "svelte";
  import { getConfig, saveConfig, type Config } from "./lib/api";
  let cfg: Config | null = $state(null);
  let saved = $state(false);
  let error = $state("");
  let appriseText = $state("");

  onMount(async () => {
    cfg = await getConfig();
    appriseText = cfg.appriseUrls.join("\n");
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!cfg) return;
    error = "";
    const patch: Partial<Config> = {
      ...cfg,
      appriseUrls: appriseText.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      cfg = await saveConfig(patch);
      appriseText = cfg.appriseUrls.join("\n");
      saved = true;
      setTimeout(() => (saved = false), 1500);
    } catch (err) {
      // Validation rejection (e.g. cleared próg/interwał, bad searchUrl) — keep
      // the form state intact and tell the user what was wrong.
      error = err instanceof Error ? err.message : "Nie udało się zapisać";
    }
  }
</script>

{#if cfg}
  <form onsubmit={submit}>
    <label>Search URL<textarea bind:value={cfg.searchUrl} rows="2"></textarea></label>
    <label>Min cena<input type="number" bind:value={cfg.minPrice} /></label>
    <label>Max cena<input type="number" bind:value={cfg.maxPrice} /></label>
    <label>Min metraż<input type="number" bind:value={cfg.minArea} /></label>
    <label>Min pokoje<input type="number" bind:value={cfg.minRooms} /></label>
    <label>Kryteria AI<textarea bind:value={cfg.aiCriteria} rows="4"></textarea></label>
    <label>Próg score (0–100)<input type="number" min="0" max="100" bind:value={cfg.scoreThreshold} /></label>
    <label>Interwał (min, informacyjnie)<input type="number" min="1" bind:value={cfg.pollIntervalMin} /></label>
    <label><input type="checkbox" bind:checked={cfg.deepseekEnabled} /> DeepSeek scoring</label>
    <label>Apprise URLs (jeden na linię)<textarea bind:value={appriseText} rows="3"></textarea></label>
    <button type="submit">Zapisz</button>
    {#if saved}<span class="ok">Zapisano ✓</span>{/if}
    {#if error}<span class="err">{error}</span>{/if}
  </form>
{/if}

<style>
  form { display: grid; gap: 10px; max-width: 520px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  .ok { color: green; }
  .err { color: #c0392b; }
</style>
