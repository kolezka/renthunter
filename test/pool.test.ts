import { test, expect } from "bun:test";
import { runPool } from "../src/pipeline/pool";

test("processes every item exactly once", async () => {
  const seen: number[] = [];
  await runPool([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
  expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
});

test("never exceeds the concurrency limit", async () => {
  let active = 0, peak = 0;
  await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  expect(peak).toBeLessThanOrEqual(3);
});

test("limit < 1 is treated as 1", async () => {
  const seen: number[] = [];
  await runPool([1, 2], 0, async (n) => { seen.push(n); });
  expect(seen.sort()).toEqual([1, 2]);
});

test("empty input resolves without error", async () => {
  await runPool([], 4, async () => { throw new Error("should not run"); });
  expect(true).toBe(true);
});
