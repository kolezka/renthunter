import { test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/api/server";
import { db } from "../src/db/client";
import { offers, config, logs } from "../src/db/schema";
import { ensureConfig, appendLog } from "../src/db/queries";

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  await db.delete(offers);
  await db.delete(config);
  await db.delete(logs);
  await ensureConfig("https://search.example");
  await appendLog({ level: "info", event: "run.start", message: "seeded" });
  server = createServer(0, {
    runCrawler: async () => ({ runId: "run-test-id", done: Promise.resolve() }),
    refreshOfferById: async (externalId) =>
      externalId === "100"
        ? ({ id: 1, externalId, title: "Refreshed", price: 3000, area: 40, rooms: 2,
             district: "X", url: "https://x/a-ogl100.html", score: 80, scoreReasons: "ok",
             status: "active", notified: false, firstSeen: "", lastSeen: "" } as any)
        : null,
    runRescore: async () => ({ runId: "rescore-test-id", done: Promise.resolve() }),
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

test("GET /api/config returns seeded config", async () => {
  const res = await fetch(`${base}/api/config`);
  expect(res.status).toBe(200);
  const c = (await res.json()) as Record<string, unknown>;
  expect(c.searchUrls).toEqual(["https://search.example"]);
});

test("PUT /api/config updates fields", async () => {
  const res = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPrice: 3800, aiCriteria: "balkon", appriseUrls: ["json://x"] }),
  });
  expect(res.status).toBe(200);
  const c = (await res.json()) as Record<string, unknown>;
  expect(c.maxPrice).toBe(3800);
  expect(c.appriseUrls).toEqual(["json://x"]);
});

test("GET /api/offers returns array", async () => {
  const res = await fetch(`${base}/api/offers`);
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test("GET /api/logs returns entries newest-first", async () => {
  const res = await fetch(`${base}/api/logs`);
  expect(res.status).toBe(200);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows[0]!.event).toBe("run.start");
});

test("POST /api/run starts a run and reports 202", async () => {
  const res = await fetch(`${base}/api/run`, { method: "POST" });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { runId: string };
  expect(body.runId).toBe("run-test-id");
});

test("POST /api/run returns 409 when the runner reports busy", async () => {
  const s = createServer(0, { runCrawler: async () => ({ busy: true as const }) });
  const b = `http://localhost:${s.port}`;
  try {
    const res = await fetch(`${b}/api/run`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("in progress");
  } finally {
    s.stop(true);
  }
});

test("POST /api/offers/:id/refresh returns the updated offer", async () => {
  const res = await fetch(`${base}/api/offers/100/refresh`, { method: "POST" });
  expect(res.status).toBe(200);
  const o = (await res.json()) as Record<string, unknown>;
  expect(o.title).toBe("Refreshed");
});

test("POST refresh returns 404 for unknown offer", async () => {
  const res = await fetch(`${base}/api/offers/999/refresh`, { method: "POST" });
  expect(res.status).toBe(404);
});

test("POST refresh returns 400 for non-numeric id", async () => {
  const res = await fetch(`${base}/api/offers/abc/refresh`, { method: "POST" });
  expect(res.status).toBe(400);
});

test("POST /api/rescore returns 202 with a runId", async () => {
  const res = await fetch(`${base}/api/rescore`, { method: "POST" });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { runId: string };
  expect(body.runId).toBe("rescore-test-id");
});

test("POST /api/rescore returns 409 when busy", async () => {
  const s = createServer(0, { runRescore: async () => ({ busy: true as const }) });
  const b = `http://localhost:${s.port}`;
  try {
    const res = await fetch(`${b}/api/rescore`, { method: "POST" });
    expect(res.status).toBe(409);
  } finally { s.stop(true); }
});

test("POST /api/rescore returns 400 when deepseek disabled", async () => {
  const s = createServer(0, { runRescore: async () => ({ disabled: true as const }) });
  const b = `http://localhost:${s.port}`;
  try {
    const res = await fetch(`${b}/api/rescore`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("deepseek");
  } finally { s.stop(true); }
});

test("GET /ws relays progressBus events to the client", async () => {
  const { progressBus } = await import("../src/pipeline/progress");
  const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
  const message = await new Promise<string>((resolve, reject) => {
    ws.onopen = () => progressBus.emit({ type: "rescore:start", runId: "ws-test", total: 5 });
    ws.onmessage = (ev) => resolve(String(ev.data));
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(() => reject(new Error("timeout")), 2000);
  });
  ws.close();
  expect(JSON.parse(message)).toEqual({ type: "rescore:start", runId: "ws-test", total: 5 });
});

