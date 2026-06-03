<script module lang="ts">
  // Svelte action: registers a row node with the virtualizer for dynamic height measurement.
  function measure(node: HTMLElement, fn: (n: Element) => void) {
    fn(node);
    return { update: (f: (n: Element) => void) => f(node) };
  }
</script>

<script lang="ts">
  import { createWindowVirtualizer, columnsForWidth, chunkRows } from "./lib/virtual.svelte";
  import type { Offer } from "./lib/api";
  import type { Snippet } from "svelte";

  let {
    items,
    mode,
    row,
    onLoadMore,
    hasMore = false,
    estimateSize = mode === "table" ? 64 : 360,
  }: {
    items: Offer[];
    mode: "cards" | "table";
    row: Snippet<[Offer[]]>;
    onLoadMore: () => void;
    hasMore?: boolean;
    estimateSize?: number;
  } = $props();

  let container = $state<HTMLElement | null>(null);
  let cols = $state(1);
  // Container's distance from the top of the document, kept reactive so the
  // virtualizer re-syncs whenever content above the list (e.g. the SearchBar
  // facet chips loading in) shifts the list down — otherwise a stale margin
  // would position rows up into the header.
  let marginTop = $state(0);

  function remeasure() {
    const el = container;
    if (!el) return;
    cols = mode === "table" ? 1 : columnsForWidth(el.clientWidth);
    marginTop = el.getBoundingClientRect().top + window.scrollY;
  }

  $effect(() => {
    const el = container;
    if (!el) return;
    // Observe the list itself (width -> column count) and the page body, so a
    // layout shift above the list (async facets, toasts) updates marginTop too.
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    ro.observe(document.body);
    remeasure();
    return () => ro.disconnect();
  });

  const rows = $derived(chunkRows(items, cols));

  // scroll-margin = container's distance from top of document, so window coords map correctly.
  function scrollMargin() {
    return marginTop;
  }

  const v = createWindowVirtualizer({
    count: () => rows.length,
    estimateSize: () => estimateSize,
    scrollMargin,
    overscan: 4,
  });

  // Infinite scroll: when the last rendered virtual row reaches the end of loaded rows.
  $effect(() => {
    const vis = v.virtualItems;
    const last = vis[vis.length - 1];
    if (!last) return;
    if (hasMore && last.index >= rows.length - 1) onLoadMore();
  });
</script>

<div bind:this={container} style="position:relative; width:100%; height:{v.totalSize}px;">
  {#each v.virtualItems as vi (vi.key)}
    <div
      data-index={vi.index}
      use:measure={v.measureElement}
      style="position:absolute; top:0; left:0; width:100%; transform:translateY({vi.start - scrollMargin()}px);"
    >
      {@render row(rows[vi.index] ?? [])}
    </div>
  {/each}
</div>
