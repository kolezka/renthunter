export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Stable-sort a copy of `items` by descending cosine vs `query`. Items whose
 *  embedding is null/empty sort last (similarity treated as -Infinity). */
export function rankByCosine<T>(
  items: T[],
  query: number[],
  getEmbedding: (item: T) => number[] | null,
): T[] {
  return items
    .map((item, i) => {
      const e = getEmbedding(item);
      const score = e && e.length ? cosineSimilarity(query, e) : -Infinity;
      return { item, i, score };
    })
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((x) => x.item);
}
