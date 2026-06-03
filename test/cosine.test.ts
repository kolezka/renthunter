import { test, expect } from "bun:test";
import { cosineSimilarity, rankByCosine } from "../src/embeddings/cosine";

test("identical vectors have similarity 1", () => {
  expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
});

test("orthogonal vectors have similarity 0", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
});

test("zero vector yields 0, never NaN", () => {
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
});

test("rankByCosine orders by descending similarity; null embeddings last", () => {
  const items = [
    { id: "a", embedding: [0, 1] },
    { id: "b", embedding: [1, 0] },
    { id: "c", embedding: null },
  ];
  const ranked = rankByCosine(items, [0.9, 0.1], (i) => i.embedding);
  expect(ranked.map((i) => i.id)).toEqual(["b", "a", "c"]);
});
