import { test, expect } from "bun:test";
import { passesFilters } from "../src/pipeline/filter";

const cfg = { minPrice: 1000, maxPrice: 4000, minArea: 35, minRooms: 2, maxArea: null, maxRooms: null };

test("passes when within all bounds", () => {
  expect(passesFilters({ price: 3000, area: 50, rooms: 2 }, cfg)).toBe(true);
});

test("rejects above maxPrice", () => {
  expect(passesFilters({ price: 5000, area: 50, rooms: 2 }, cfg)).toBe(false);
});

test("rejects below minArea", () => {
  expect(passesFilters({ price: 3000, area: 20, rooms: 2 }, cfg)).toBe(false);
});

test("rejects below minRooms", () => {
  expect(passesFilters({ price: 3000, area: 50, rooms: 1 }, cfg)).toBe(false);
});

test("null bounds are ignored; null offer fields pass", () => {
  expect(passesFilters({ price: null, area: null, rooms: null },
    { minPrice: null, maxPrice: null, minArea: null, minRooms: null, maxArea: null, maxRooms: null })).toBe(true);
});

const cfgMax = { minPrice: null, maxPrice: null, minArea: null, minRooms: null, maxArea: 60, maxRooms: 3 };

test("rejects above maxArea", () => {
  expect(passesFilters({ price: 3000, area: 75, rooms: 2 }, cfgMax)).toBe(false);
});

test("rejects above maxRooms", () => {
  expect(passesFilters({ price: 3000, area: 50, rooms: 5 }, cfgMax)).toBe(false);
});

test("passes within max bounds", () => {
  expect(passesFilters({ price: 3000, area: 55, rooms: 3 }, cfgMax)).toBe(true);
});
