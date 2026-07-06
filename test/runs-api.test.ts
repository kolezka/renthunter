import { test, expect } from "bun:test";
import { createServer } from "../src/api/server";
import type { RunSnapshot } from "../src/pipeline/runs";

const snap: RunSnapshot = {
  runId: "r-9", kind: "crawl", source: "manual",
  startedAt: "2026-07-06T00:00:00.000Z", cancelling: false,
  progress: { phase: "processing", processed: 3, total: 12 },
};

test("GET /api/runs/current returns the active run snapshot", async () => {
  const s = createServer(0, { getCurrentRun: () => snap });
  try {
    const res = await fetch(`http://localhost:${s.port}/api/runs/current`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: snap as any });
  } finally { s.stop(true); }
});

test("GET /api/runs/current returns null when idle", async () => {
  const s = createServer(0, { getCurrentRun: () => null });
  try {
    const res = await fetch(`http://localhost:${s.port}/api/runs/current`);
    expect(await res.json()).toEqual({ run: null });
  } finally { s.stop(true); }
});

test("POST cancel cancels the active run", async () => {
  let cancelled = 0;
  const s = createServer(0, { cancelRun: () => { cancelled++; return { runId: "r-9" }; } });
  try {
    const res = await fetch(`http://localhost:${s.port}/api/runs/current/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, runId: "r-9" });
    expect(cancelled).toBe(1);
  } finally { s.stop(true); }
});

test("POST cancel with no active run degrades to 200 + error", async () => {
  const s = createServer(0, { cancelRun: () => null });
  try {
    const res = await fetch(`http://localhost:${s.port}/api/runs/current/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: "no active run" });
  } finally { s.stop(true); }
});
