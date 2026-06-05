import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { runLock } from "../src/db/schema";
import { acquireRunLock, releaseRunLock } from "../src/db/queries";

beforeEach(async () => {
  await db.delete(runLock);
});

const BIG = 15 * 60 * 1000;

test("acquire succeeds when free, fails when held", async () => {
  expect(await acquireRunLock("A", "manual", BIG)).toBe(true);
  expect(await acquireRunLock("B", "scheduled", BIG)).toBe(false);
});

test("release frees the lock for the next holder", async () => {
  expect(await acquireRunLock("A", "manual", BIG)).toBe(true);
  await releaseRunLock("A");
  expect(await acquireRunLock("B", "scheduled", BIG)).toBe(true);
});

test("release by a non-holder does not free the lock", async () => {
  expect(await acquireRunLock("A", "manual", BIG)).toBe(true);
  await releaseRunLock("B"); // B doesn't hold it
  expect(await acquireRunLock("C", "manual", BIG)).toBe(false);
});

test("a stale lease can be re-acquired", async () => {
  expect(await acquireRunLock("A", "manual", BIG)).toBe(true);
  // staleMs = 0 means "anything older than now" is stale → re-acquirable
  expect(await acquireRunLock("B", "scheduled", 0)).toBe(true);
});
