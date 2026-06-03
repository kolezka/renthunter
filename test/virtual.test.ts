import { test, expect } from "bun:test";
import { columnsForWidth, chunkRows } from "../web/lib/virtual.svelte";

test("columnsForWidth forces 1 column below 560px", () => {
  expect(columnsForWidth(320)).toBe(1);
  expect(columnsForWidth(559)).toBe(1);
});

test("columnsForWidth derives columns from min card width + gap", () => {
  // (width + gap) / (290 + 18) = floor
  expect(columnsForWidth(600)).toBe(2);   // 618/308 = 2.00
  expect(columnsForWidth(940)).toBe(3);   // 958/308 = 3.11
  expect(columnsForWidth(1280)).toBe(4);  // 1298/308 = 4.21
});

test("columnsForWidth never returns less than 1", () => {
  expect(columnsForWidth(0)).toBe(1);
});

test("chunkRows splits items into rows of `cols`", () => {
  expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(chunkRows([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  expect(chunkRows([], 3)).toEqual([]);
});

test("chunkRows treats cols < 1 as 1", () => {
  expect(chunkRows([1, 2], 0)).toEqual([[1], [2]]);
});
