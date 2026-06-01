<script lang="ts">
  import { onMount } from "svelte";
  import { getOffers, type Offer } from "./lib/api";
  let offers: Offer[] = $state([]);
  let loading = $state(true);
  onMount(async () => { offers = await getOffers(); loading = false; });
</script>

{#if loading}
  <p>Ładowanie…</p>
{:else}
  <table>
    <thead>
      <tr><th>Score</th><th>Tytuł</th><th>Cena</th><th>m²</th><th>Pok</th><th>Dzielnica</th><th>Status</th><th></th></tr>
    </thead>
    <tbody>
      {#each offers as o (o.id)}
        <tr class:notified={o.notified}>
          <td>{o.score ?? "–"}</td>
          <td>{o.title}</td>
          <td>{o.price ?? "–"} zł</td>
          <td>{o.area ?? "–"}</td>
          <td>{o.rooms ?? "–"}</td>
          <td>{o.district ?? "–"}</td>
          <td>{o.status}</td>
          <td><a href={o.url} target="_blank" rel="noreferrer">otwórz</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 14px; }
  tr.notified { background: #f0fff4; }
</style>
