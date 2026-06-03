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
