import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { runLock } from "../src/db/schema";
import { acquireRunLock, releaseRunLock } from "../src/db/queries";
import { withRunLock, RUN_LOCK_STALE_MS } from "../src/pipeline/run-lock";

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

test("withRunLock runs fn when free and releases after", async () => {
  let ran = 0;
  const r = await withRunLock("A", "manual", async () => { ran++; return "ok"; });
  expect(r).toEqual({ ran: true, result: "ok" });
  expect(ran).toBe(1);
  // lock released → a second withRunLock also runs
  const r2 = await withRunLock("B", "scheduled", async () => "again");
  expect(r2).toEqual({ ran: true, result: "again" });
});

test("withRunLock skips fn when the lock is held", async () => {
  await acquireRunLock("HOLDER", "manual", RUN_LOCK_STALE_MS);
  let ran = 0;
  const r = await withRunLock("B", "scheduled", async () => { ran++; return "x"; });
  expect(r).toEqual({ ran: false });
  expect(ran).toBe(0);
});

test("withRunLock releases even if fn throws", async () => {
  await expect(withRunLock("A", "manual", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await acquireRunLock("B", "scheduled", RUN_LOCK_STALE_MS)).toBe(true);
});
