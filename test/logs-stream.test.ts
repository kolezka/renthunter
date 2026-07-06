import { test, expect, beforeAll } from "bun:test";
import { createServer } from "../src/api/server";
import { db } from "../src/db/client";
import { logs } from "../src/db/schema";
import { appendLog, listLogs } from "../src/db/queries";

beforeAll(async () => {
  await db.delete(logs);
});

/** Read the SSE body until `until(buffer)` is true (or timeout), then release the reader. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  until: (buf: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (!until(buf) && Date.now() < deadline) {
      const race = await Promise.race([
        reader.read(),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), deadline - Date.now())),
      ]);
      if (race === "timeout") break;
      if (race.done) break;
      buf += dec.decode(race.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return buf;
}

test("stream sends ready, then streams appended rows with an id: cursor", async () => {
  const server = createServer(0, { logStreamIntervalMs: 25 });
  const base = `http://localhost:${server.port}`;
  const ac = new AbortController();
  try {
    const res = await fetch(`${base}/api/logs/stream`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Interleave: wait for ready, append a row, then wait for the logs frame.
    const body = res.body!;
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readInto = async (until: (b: string) => boolean, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      while (!until(buf) && Date.now() < deadline) {
        const race = await Promise.race([
          reader.read(),
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), Math.max(deadline - Date.now(), 1))),
        ]);
        if (race === "timeout" || race.done) break;
        buf += dec.decode(race.value, { stream: true });
      }
    };

    await readInto((b) => b.includes("event: ready"));
    expect(buf).toContain("event: ready");

    await appendLog({ level: "error", event: "stream.test", message: "hello stream", context: { status: 500 } });
    await readInto((b) => b.includes("event: logs"));
    expect(buf).toContain("event: logs");
    expect(buf).toContain("hello stream");
    const rows = await listLogs({ limit: 1 });
    expect(buf).toContain(`id: ${rows[0]!.id}`);
    await reader.cancel().catch(() => {});
  } finally {
    ac.abort();
    server.stop(true);
  }
});

test("Last-Event-ID resumes the cursor and replays missed rows", async () => {
  await appendLog({ level: "info", event: "missed.one", message: "m1" });
  await appendLog({ level: "info", event: "missed.two", message: "m2" });
  const all = await listLogs();
  const beforeMissedId = all.find((r) => r.event === "stream.test")!.id;

  const server = createServer(0, { logStreamIntervalMs: 25 });
  const base = `http://localhost:${server.port}`;
  const ac = new AbortController();
  try {
    const res = await fetch(`${base}/api/logs/stream`, {
      signal: ac.signal,
      headers: { "last-event-id": String(beforeMissedId) },
    });
    const buf = await readUntil(res.body!, (b) => b.includes("missed.two"));
    expect(buf).toContain("missed.one");
    expect(buf).toContain("missed.two");
  } finally {
    ac.abort();
    server.stop(true);
  }
});

test("fresh connection does not replay old rows, only new ones", async () => {
  const server = createServer(0, { logStreamIntervalMs: 25 });
  const base = `http://localhost:${server.port}`;
  const ac = new AbortController();
  try {
    const res = await fetch(`${base}/api/logs/stream`, { signal: ac.signal });
    // Give the stream a few ticks; old rows (missed.one/two) must NOT appear.
    const buf = await readUntil(res.body!, (b) => b.includes("event: fresh.row"), 400);
    expect(buf).toContain("event: ready");
    expect(buf).not.toContain("missed.one");
  } finally {
    ac.abort();
    server.stop(true);
  }
});
