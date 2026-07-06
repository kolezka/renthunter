import { test, expect, beforeAll } from "bun:test";
import { db } from "../src/db/client";
import { logs } from "../src/db/schema";
import { appendLog, listLogs } from "../src/db/queries";

beforeAll(async () => {
  await db.delete(logs);
  await appendLog({ level: "info", event: "a", message: "1" });
  await appendLog({ level: "info", event: "b", message: "2" });
  await appendLog({ level: "error", event: "c", message: "3" });
});

test("listLogs without sinceId stays newest-first", async () => {
  const rows = await listLogs();
  expect(rows.map((r) => r.event)).toEqual(["c", "b", "a"]);
});

test("listLogs sinceId returns only newer rows, ascending", async () => {
  const all = await listLogs();
  const oldestId = all[all.length - 1]!.id;
  const tail = await listLogs({ sinceId: oldestId });
  expect(tail.map((r) => r.event)).toEqual(["b", "c"]);
  expect(tail[0]!.id).toBeLessThan(tail[1]!.id);
});

test("listLogs sinceId respects limit from the oldest end of the tail", async () => {
  const capped = await listLogs({ sinceId: 0, limit: 2 });
  expect(capped.map((r) => r.event)).toEqual(["a", "b"]);
});
