/** Columns that fit `width` px given a min card width and gap, matching the
 *  CSS grid `repeat(auto-fill, minmax(290px,1fr))` with an 18px gap and the
 *  `<560px → single column` rule used in Dashboard.svelte. */
export function columnsForWidth(width: number, minCardWidth = 290, gap = 18): number {
  if (width < 560) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

/** Group a flat list into rows of `cols` items (last row may be short). */
export function chunkRows<T>(items: T[], cols: number): T[][] {
  const n = Math.max(1, Math.floor(cols));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}

import {
  Virtualizer,
  observeWindowRect,
  observeWindowOffset,
  windowScroll,
  measureElement,
  type VirtualItem,
} from "@tanstack/virtual-core";

export interface WindowVirtualizerOptions {
  /** reactive row count (e.g. () => rows.length) */
  count: () => number;
  /** estimated row height in px */
  estimateSize: () => number;
  /** distance from top of document to the list container (scroll-margin) */
  scrollMargin: () => number;
  overscan?: number;
}

/** Window-scrolling virtualizer bound to Svelte 5 runes. Returns reactive
 *  `virtualItems` / `totalSize` and a `measureElement` action for dynamic row
 *  heights. Call this during component init (it uses $state/$effect). */
export function createWindowVirtualizer(opts: WindowVirtualizerOptions) {
  let virtualItems = $state<VirtualItem[]>([]);
  let totalSize = $state(0);

  const instance = new Virtualizer<Window, Element>({
    count: opts.count(),
    getScrollElement: () => (typeof window !== "undefined" ? window : null),
    estimateSize: opts.estimateSize,
    scrollMargin: opts.scrollMargin(),
    overscan: opts.overscan ?? 4,
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    measureElement,
    onChange: (inst, _sync) => {
      virtualItems = inst.getVirtualItems();
      totalSize = inst.getTotalSize();
    },
  });

  // Mount: wires up the window scroll/resize observers; cleans up on destroy.
  $effect(() => instance._didMount());

  // Re-sync options whenever reactive inputs change, then recompute the window.
  $effect(() => {
    instance.setOptions({
      ...instance.options,
      count: opts.count(),
      scrollMargin: opts.scrollMargin(),
      estimateSize: opts.estimateSize,
    });
    instance._willUpdate();
    virtualItems = instance.getVirtualItems();
    totalSize = instance.getTotalSize();
  });

  return {
    get virtualItems() { return virtualItems; },
    get totalSize() { return totalSize; },
    /** register a row node with the virtualizer for dynamic measurement */
    measureElement: (node: Element) => instance.measureElement(node),
  };
}
