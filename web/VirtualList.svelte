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

  // Track container width -> column count (cards only; table is always 1 column).
  $effect(() => {
    const el = container;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      cols = mode === "table" ? 1 : columnsForWidth(el.clientWidth);
    });
    ro.observe(el);
    cols = mode === "table" ? 1 : columnsForWidth(el.clientWidth);
    return () => ro.disconnect();
  });

  const rows = $derived(chunkRows(items, cols));

  // scroll-margin = container's distance from top of document, so window coords map correctly.
  function scrollMargin() {
    return container ? container.getBoundingClientRect().top + window.scrollY : 0;
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
