# Re-score Offers On Demand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual "Re-score all active offers against the current AI criteria" action that runs in the background and streams per-offer score updates to the dashboard live.

**Architecture:** A new in-process pipeline (`runRescore`) re-runs DeepSeek on each active offer's already-stored `description` and updates only the score columns. It is guarded by the existing single-row run lock (`source: "rescore"`) so it can't run alongside a crawl. Progress is published to a tiny in-process pub/sub bus; the server relays bus events to clients over a persistent WebSocket (`/ws`). The Svelte dashboard holds the socket open for the session and merges `scored` events into its offer list in place.

**Tech Stack:** Bun (`Bun.serve` WebSockets), Drizzle ORM + `postgres-js` (PGlite in tests), Svelte 5 runes, `bun test`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-rescore-offers-design.md`

---

## File Structure

- Create `src/pipeline/progress.ts` — typed in-process pub/sub bus + `RescoreEvent`/`RescoreSummary` types.
- Create `src/pipeline/rescore.ts` — `runRescore(deps)` and `RescoreDeps`.
- Modify `src/db/queries.ts` — add `getActiveScorableOffers`, `updateOfferScore`.
- Modify `src/pipeline/deps.ts` — add `buildRescoreDeps`, `runRescoreGuarded`.
- Modify `src/api/server.ts` — add `POST /api/rescore`, `GET /ws` upgrade + `websocket` handler, `ServerOptions.runRescore`.
- Modify `web/lib/api.ts` — add `rescoreAll()` + `RescoreEvent` type.
- Modify `web/Dashboard.svelte` — persistent WS, "Przelicz oceny" button.
- Tests: `test/progress.test.ts`, `test/rescore.test.ts`, additions to `test/queries.test.ts`, `test/api.test.ts`.

Type contract used across tasks (defined in Task 1, consumed everywhere):

```ts
export interface RescoreSummary { scored: number; errors: number }
export type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };
```

---

## Task 1: Progress bus + shared types

**Files:**
- Create: `src/pipeline/progress.ts`
- Test: `test/progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/progress.test.ts
import { test, expect } from "bun:test";
import { progressBus, type RescoreEvent } from "../src/pipeline/progress";

test("subscribe receives emitted events; unsubscribe stops delivery", () => {
  const seen: RescoreEvent[] = [];
  const unsub = progressBus.subscribe((e) => seen.push(e));

  progressBus.emit({ type: "rescore:start", runId: "r1", total: 3 });
  progressBus.emit({ type: "rescore:scored", externalId: "100", score: 80, reasons: "ok" });
  expect(seen.length).toBe(2);
  expect(seen[0]).toEqual({ type: "rescore:start", runId: "r1", total: 3 });

  unsub();
  progressBus.emit({ type: "rescore:done", runId: "r1", summary: { scored: 1, errors: 0 } });
  expect(seen.length).toBe(2); // no delivery after unsubscribe
});

test("multiple subscribers each receive the event", () => {
  const a: RescoreEvent[] = [];
  const b: RescoreEvent[] = [];
  const ua = progressBus.subscribe((e) => a.push(e));
  const ub = progressBus.subscribe((e) => b.push(e));
  progressBus.emit({ type: "rescore:start", runId: "r2", total: 0 });
  expect(a.length).toBe(1);
  expect(b.length).toBe(1);
  ua(); ub();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/progress.test.ts`
Expected: FAIL — `Cannot find module '../src/pipeline/progress'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pipeline/progress.ts

/** Summary returned by a re-score run and carried in the `rescore:done` event. */
export interface RescoreSummary {
  scored: number;
  errors: number;
}

/** Progress events emitted during a re-score run. */
export type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };

type Listener = (e: RescoreEvent) => void;

/** Minimal in-process pub/sub. Decouples the pipeline from the transport
 *  (Bun.serve WebSockets) so `rescore.ts` stays transport-agnostic and testable. */
function createBus() {
  const listeners = new Set<Listener>();
  return {
    emit(e: RescoreEvent): void {
      for (const fn of listeners) fn(e);
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const progressBus = createBus();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/progress.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/progress.ts test/progress.test.ts
git commit -m "feat(rescore): in-process progress bus + event types"
```

---

## Task 2: Queries — fetch scorable offers, update score columns

**Files:**
- Modify: `src/db/queries.ts`
- Test: `test/queries.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/queries.test.ts`. Also add the two new names to the existing import block at the top of that file: `getActiveScorableOffers, updateOfferScore`.

```ts
test("getActiveScorableOffers excludes inactive and null-description rows", async () => {
  await upsertOffer({ externalId: "a", url: "u", title: "t", description: "ma opis" });
  await upsertOffer({ externalId: "b", url: "u", title: "t" }); // description null
  await upsertOffer({ externalId: "c", url: "u", title: "t", description: "też opis" });
  await markInactive(["a", "b"]); // c stays active; a/b -> inactive
  const rows = await getActiveScorableOffers();
  expect(rows.map((r) => r.externalId)).toEqual(["c"]);
});

test("updateOfferScore changes only score columns, leaves status/title", async () => {
  await upsertOffer({ externalId: "x", url: "u", title: "Tytuł", description: "d", score: 10, scoreReasons: "old" });
  await updateOfferScore("x", 88, "świetna");
  const o = await getOfferByExternalId("x");
  expect(o?.score).toBe(88);
  expect(o?.scoreReasons).toBe("świetna");
  expect(o?.title).toBe("Tytuł");   // untouched
  expect(o?.status).toBe("active"); // untouched
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/queries.test.ts`
Expected: FAIL — `getActiveScorableOffers`/`updateOfferScore` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/db/queries.ts`, extend the top import from `drizzle-orm` to include `and` and `isNotNull`:

```ts
import { eq, notInArray, sql, desc, lt, and, isNotNull } from "drizzle-orm";
```

Add these functions (place them just after `getOfferByExternalId`):

```ts
/** Active offers that have a description to score. Re-score reuses the stored
 *  description (no re-fetch); offers without one can't be scored. */
export async function getActiveScorableOffers(): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(and(eq(offers.status, "active"), isNotNull(offers.description)));
}

/** Narrow update of just the AI score columns. Unlike upsertOffer this does NOT
 *  touch status, lastSeen, or any scraped field. */
export async function updateOfferScore(
  externalId: string,
  score: number | null,
  reasons: string | null,
): Promise<void> {
  await db
    .update(offers)
    .set({ score, scoreReasons: reasons })
    .where(eq(offers.externalId, externalId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/queries.test.ts`
Expected: PASS (all existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts test/queries.test.ts
git commit -m "feat(rescore): queries for scorable offers and score-only update"
```

---

## Task 3: `runRescore` pipeline

**Files:**
- Create: `src/pipeline/rescore.ts`
- Test: `test/rescore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/rescore.test.ts
import { test, expect } from "bun:test";
import { runRescore, type RescoreDeps } from "../src/pipeline/rescore";
import type { RescoreEvent } from "../src/pipeline/progress";

const baseConfig = {
  id: 1, searchUrls: ["https://search"],
  minPrice: null, maxPrice: null, minArea: null, minRooms: null, maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: [], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 2,
};

function makeDeps(over: Partial<RescoreDeps> = {}): {
  deps: RescoreDeps; updates: Array<{ id: string; score: number | null; reasons: string | null }>; events: RescoreEvent[];
} {
  const updates: Array<{ id: string; score: number | null; reasons: string | null }> = [];
  const events: RescoreEvent[] = [];
  const deps: RescoreDeps = {
    runId: "test-run",
    getConfig: async () => baseConfig as any,
    getActiveScorableOffers: async () => [
      { externalId: "100", description: "opis A" } as any,
      { externalId: "200", description: "opis B" } as any,
    ],
    scoreOffer: async (input) => ({ score: input.description === "opis A" ? 91 : 42, reasons: "bo " + input.description }),
    updateOfferScore: async (id, score, reasons) => { updates.push({ id, score, reasons }); },
    emitProgress: (e) => events.push(e),
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    log: { log() {} },
    ...over,
  };
  return { deps, updates, events };
}

test("runRescore scores every active offer and persists score columns", async () => {
  const { deps, updates } = makeDeps();
  const summary = await runRescore(deps);
  expect(summary).toEqual({ scored: 2, errors: 0 });
  expect(updates.find((u) => u.id === "100")).toEqual({ id: "100", score: 91, reasons: "bo opis A" });
  expect(updates.find((u) => u.id === "200")).toEqual({ id: "200", score: 42, reasons: "bo opis B" });
});

test("runRescore emits start, one scored per offer, and done", async () => {
  const { deps, events } = makeDeps();
  await runRescore(deps);
  expect(events[0]).toEqual({ type: "rescore:start", runId: "test-run", total: 2 });
  const scored = events.filter((e) => e.type === "rescore:scored");
  expect(scored.length).toBe(2);
  const done = events[events.length - 1]!;
  expect(done).toEqual({ type: "rescore:done", runId: "test-run", summary: { scored: 2, errors: 0 } });
});

test("runRescore is a no-op when deepseek disabled (writes nothing)", async () => {
  let scoreCalled = false;
  const { deps, updates, events } = makeDeps({
    getConfig: async () => ({ ...baseConfig, deepseekEnabled: false }) as any,
    scoreOffer: async () => { scoreCalled = true; return { score: 0, reasons: "" }; },
  });
  const summary = await runRescore(deps);
  expect(scoreCalled).toBe(false);
  expect(updates.length).toBe(0);
  expect(summary).toEqual({ scored: 0, errors: 0 });
  expect(events.length).toBe(0);
});

test("runRescore counts a failing offer as an error without aborting the batch", async () => {
  const { deps, updates } = makeDeps({
    scoreOffer: async (input) => {
      if (input.description === "opis A") throw new Error("deepseek 500");
      return { score: 42, reasons: "ok" };
    },
  });
  const summary = await runRescore(deps);
  expect(summary).toEqual({ scored: 1, errors: 1 });
  expect(updates).toEqual([{ id: "200", score: 42, reasons: "ok" }]);
});

test("runRescore never re-fetches detail pages", async () => {
  // RescoreDeps has no fetchPage at all — this is a type-level guarantee.
  // Assert the stored description is what gets scored.
  const seen: string[] = [];
  const { deps } = makeDeps({ scoreOffer: async (i) => { seen.push(i.description); return { score: 1, reasons: "" }; } });
  await runRescore(deps);
  expect(seen.sort()).toEqual(["opis A", "opis B"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/rescore.test.ts`
Expected: FAIL — `Cannot find module '../src/pipeline/rescore'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pipeline/rescore.ts
import type { Config, Offer } from "../db/schema";
import type { Logger } from "../log/logger";
import type { RescoreEvent, RescoreSummary } from "./progress";
import { runPool } from "./pool";

export interface RescoreDeps {
  runId: string;
  getConfig: () => Promise<Config>;
  getActiveScorableOffers: () => Promise<Offer[]>;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  updateOfferScore: (externalId: string, score: number | null, reasons: string | null) => Promise<void>;
  emitProgress?: (e: RescoreEvent) => void;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  log: Logger;
}

/** Re-score every active offer against the current AI criteria, reusing each
 *  offer's stored description (no scraping, no notifications). No-op when
 *  DeepSeek is disabled — re-scoring then would null out every score. */
export async function runRescore(deps: RescoreDeps): Promise<RescoreSummary> {
  const config = await deps.getConfig();
  if (!config.deepseekEnabled) {
    await deps.log.log({ level: "warn", event: "rescore.skip", message: "rescore skipped: deepseek disabled" });
    return { scored: 0, errors: 0 };
  }

  const offers = await deps.getActiveScorableOffers();
  await deps.log.log({ level: "info", event: "rescore.start", message: `rescore started: ${offers.length} offers` });
  deps.emitProgress?.({ type: "rescore:start", runId: deps.runId, total: offers.length });

  let scored = 0;
  let errors = 0;
  await runPool(offers, config.concurrencyLimit, async (offer) => {
    try {
      const { score, reasons } = await deps.scoreOffer(
        { description: offer.description ?? "", criteria: config.aiCriteria },
        { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
      );
      await deps.updateOfferScore(offer.externalId, score, reasons);
      deps.emitProgress?.({ type: "rescore:scored", externalId: offer.externalId, score, reasons });
      scored++;
    } catch (err) {
      errors++;
      await deps.log.log({
        level: "error",
        event: "offer.error",
        message: `failed rescoring offer ${offer.externalId}`,
        context: { externalId: offer.externalId, error: String(err) },
      });
    }
  });

  const summary: RescoreSummary = { scored, errors };
  await deps.log.log({
    level: "info",
    event: "rescore.finish",
    message: `rescore finished: ${scored} scored, ${errors} errors`,
    context: summary,
  });
  deps.emitProgress?.({ type: "rescore:done", runId: deps.runId, summary });
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/rescore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/rescore.ts test/rescore.test.ts
git commit -m "feat(rescore): runRescore pipeline over active offers"
```

---

## Task 4: Compose deps + guarded runner

**Files:**
- Modify: `src/pipeline/deps.ts`
- Test: `test/rescore.test.ts` (append a guarded-runner section)

- [ ] **Step 1: Write the failing tests**

Append to `test/rescore.test.ts`. These exercise the lock guard and the disabled short-circuit against the real (PGlite) DB, mirroring `test/run-lock.test.ts`.

```ts
import { db } from "../src/db/client";
import { offers, config, runLock } from "../src/db/schema";
import { ensureConfig, updateConfig, acquireRunLock } from "../src/db/queries";
import { runRescoreGuarded } from "../src/pipeline/deps";

const env = {
  port: 0, appriseUrl: "http://apprise",
  deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
} as any;

test("runRescoreGuarded returns { disabled } when deepseek is off", async () => {
  await db.delete(runLock); await db.delete(offers); await db.delete(config);
  await ensureConfig("https://search.example");
  await updateConfig({ deepseekEnabled: false });
  const r = await runRescoreGuarded(env);
  expect(r).toEqual({ disabled: true });
});

test("runRescoreGuarded returns { busy } when the lock is held", async () => {
  await db.delete(runLock); await db.delete(offers); await db.delete(config);
  await ensureConfig("https://search.example"); // deepseekEnabled defaults true
  expect(await acquireRunLock("someone-else", "manual", 15 * 60 * 1000)).toBe(true);
  const r = await runRescoreGuarded(env);
  expect(r).toEqual({ busy: true });
});

test("runRescoreGuarded acquires the lock and returns a runId", async () => {
  await db.delete(runLock); await db.delete(offers); await db.delete(config);
  await ensureConfig("https://search.example");
  const r = await runRescoreGuarded(env);
  expect("runId" in r).toBe(true);
  if ("runId" in r) await r.done; // let it settle + release the lock
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/rescore.test.ts`
Expected: FAIL — `runRescoreGuarded` is not exported from `deps.ts`.

- [ ] **Step 3: Write minimal implementation**

In `src/pipeline/deps.ts`, extend the existing query import to add the two new functions, and add `RescoreDeps`/`runRescore`/progress imports:

```ts
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
  getOfferByExternalId, acquireRunLock, releaseRunLock,
  getActiveScorableOffers, updateOfferScore,
} from "../db/queries";
import { runRescore, type RescoreDeps } from "./rescore";
import { progressBus } from "./progress";
```

Add at the end of the file:

```ts
/** Compose deps for the re-score path. emitProgress goes to the in-process bus
 *  (relayed to WebSocket clients by the server). */
export function buildRescoreDeps(env: AppConfig, logger: Logger, runId: string): RescoreDeps {
  return {
    runId,
    getConfig,
    getActiveScorableOffers,
    scoreOffer,
    updateOfferScore,
    emitProgress: (e) => progressBus.emit(e),
    deepseekApiKey: env.deepseekApiKey,
    deepseekBaseUrl: env.deepseekBaseUrl,
    log: logger,
  };
}

/**
 * Acquire the cross-process run lock (source "rescore") and run a re-score in
 * the background. Returns { disabled } without touching the lock when DeepSeek
 * is off, { busy } when another run holds the lock, else { runId, done }.
 */
export async function runRescoreGuarded(
  env: AppConfig,
): Promise<{ runId: string; done: Promise<void> } | { busy: true } | { disabled: true }> {
  const cfg = await getConfig();
  if (!cfg.deepseekEnabled) return { disabled: true };

  const runId = crypto.randomUUID();
  const acquired = await acquireRunLock(runId, "rescore", RUN_LOCK_STALE_MS);
  if (!acquired) return { busy: true };
  const logger = createRunLogger(dbLogger, runId);
  const done = runRescore(buildRescoreDeps(env, logger, runId))
    .then(() => {})
    .catch((err) => { console.error("rescore failed:", err); })
    .finally(() => releaseRunLock(runId));
  return { runId, done };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/rescore.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/deps.ts test/rescore.test.ts
git commit -m "feat(rescore): guarded background runner + deps wiring"
```

---

## Task 5: API route + WebSocket relay

**Files:**
- Modify: `src/api/server.ts`
- Test: `test/api.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/api.test.ts`. The `beforeAll` server already exists; add a `runRescore` injection to it (Step 3 shows the full updated `createServer(...)` call — apply that change first, then these tests pass against it).

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/api.test.ts`
Expected: FAIL — `/api/rescore` returns 404 (route absent) and `/ws` doesn't upgrade.

- [ ] **Step 3: Write minimal implementation**

In `src/api/server.ts`:

(a) Extend imports:

```ts
import { buildRefreshDeps, runCrawlGuarded, runRescoreGuarded } from "../pipeline/deps";
import { progressBus } from "../pipeline/progress";
```

(b) Extend `ServerOptions` and add a default:

```ts
export interface ServerOptions {
  runCrawler?: () => Promise<{ runId: string; done: Promise<void> } | { busy: true }>;
  refreshOfferById?: (externalId: string) => Promise<Offer | null>;
  runRescore?: () => Promise<{ runId: string; done: Promise<void> } | { busy: true } | { disabled: true }>;
}

function defaultRunRescore() {
  return runRescoreGuarded(loadConfig());
}
```

(c) In `createServer`, resolve the new option (next to the other two):

```ts
  const runRescore = opts.runRescore ?? defaultRunRescore;
```

(d) Change the fetch signature to receive `server`, add the `/ws` upgrade and the `/api/rescore` route, and add the `websocket` handler. The `Bun.serve(...)` call becomes:

```ts
  return Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/ws") {
        if (server.upgrade(req, { data: {} as { unsub?: () => void } })) return undefined;
        return new Response("expected a websocket upgrade", { status: 426 });
      }

      if (path === "/api/rescore" && req.method === "POST") {
        const r = await runRescore();
        if ("disabled" in r) return json({ error: "DeepSeek scoring is disabled" }, 400);
        if ("busy" in r) return json({ error: "a run is already in progress" }, 409);
        return json({ runId: r.runId }, 202);
      }

      if (path === "/api/run" && req.method === "POST") {
        const r = await runCrawler();
        if ("busy" in r) return json({ error: "a run is already in progress" }, 409);
        return json({ runId: r.runId }, 202);
      }

      // ... (leave the existing refresh / offers / logs / config / static routes unchanged) ...
    },
    websocket: {
      open(ws: import("bun").ServerWebSocket<{ unsub?: () => void }>) {
        ws.data.unsub = progressBus.subscribe((e) => ws.send(JSON.stringify(e)));
      },
      message() {},
      close(ws: import("bun").ServerWebSocket<{ unsub?: () => void }>) {
        ws.data.unsub?.();
      },
    },
  });
```

Note: keep every existing route from the current `fetch` body (refresh, `GET /api/offers`, `/api/logs`, `/api/config` GET+PUT, static SPA fallback) exactly as-is — only the signature (`req, server`), the two new top blocks, and the `websocket` handler are added.

(e) Update the `beforeAll` server in `test/api.test.ts` to inject `runRescore` so the 202 test has a deterministic id:

```ts
  server = createServer(0, {
    runCrawler: async () => ({ runId: "run-test-id", done: Promise.resolve() }),
    runRescore: async () => ({ runId: "rescore-test-id", done: Promise.resolve() }),
    refreshOfferById: async (externalId) =>
      externalId === "100"
        ? ({ id: 1, externalId, title: "Refreshed", price: 3000, area: 40, rooms: 2,
             district: "X", url: "https://x/a-ogl100.html", score: 80, scoreReasons: "ok",
             status: "active", notified: false, firstSeen: "", lastSeen: "" } as any)
        : null,
  });
```

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: PASS — all suites including the 4 new api tests. (Run the whole suite here because the fetch-signature change touches every route.)

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat(rescore): POST /api/rescore + /ws progress relay"
```

---

## Task 6: Web API client

**Files:**
- Modify: `web/lib/api.ts`

(No automated test — `web/` has no test harness; verified by typecheck in Task 7.)

- [ ] **Step 1: Add the event type and client function**

Append to `web/lib/api.ts`:

```ts
export interface RescoreSummary { scored: number; errors: number }
export type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };

export async function rescoreAll(): Promise<{ runId: string }> {
  const res = await fetch("/api/rescore", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Rescore failed (HTTP ${res.status})`);
  return data as { runId: string };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(rescore): web api client rescoreAll + event type"
```

---

## Task 7: Dashboard — persistent WebSocket + button

**Files:**
- Modify: `web/Dashboard.svelte`

- [ ] **Step 1: Extend the script block**

In `web/Dashboard.svelte`, update the imports at the top of `<script>`:

```ts
  import { onMount, onDestroy } from "svelte";
  import { getOffers, runCrawler, refreshOffer, rescoreAll, SOURCE_LABEL, type Offer, type RescoreEvent } from "./lib/api";
```

Add state near the other `$state` declarations:

```ts
  let rescoring = $state(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsRetry = 0;
```

Add the WebSocket lifecycle + event handler + trigger (place after `onRefresh`):

```ts
  function handleEvent(e: RescoreEvent) {
    if (e.type === "rescore:start") {
      rescoring = true;
    } else if (e.type === "rescore:scored") {
      offers = offers.map((o) =>
        o.externalId === e.externalId ? { ...o, score: e.score, scoreReasons: e.reasons } : o,
      );
      if (selected && selected.externalId === e.externalId) {
        selected = { ...selected, score: e.score, scoreReasons: e.reasons };
      }
    } else if (e.type === "rescore:done") {
      rescoring = false;
      flash(`Przeliczono ${e.summary.scored} ofert`);
      getOffers().then((o) => (offers = o)); // reconcile anything missed
    }
  }

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => { wsRetry = 0; };
    ws.onmessage = (ev) => handleEvent(JSON.parse(ev.data) as RescoreEvent);
    ws.onclose = () => {
      ws = null;
      wsRetry = Math.min(wsRetry + 1, 6);
      reconnectTimer = setTimeout(connectWs, 1000 * wsRetry); // backoff, capped ~6s
    };
  }

  async function onRescore() {
    if (rescoring) return;
    rescoring = true; // optimistic; the start event will confirm
    try {
      await rescoreAll();
      flash("Przeliczanie ocen uruchomione…");
    } catch (e) {
      rescoring = false;
      flash(e instanceof Error ? e.message : "Nie udało się przeliczyć ocen");
    }
  }
```

Extend the existing `onMount` to open the socket, and add `onDestroy` to tear it down:

```ts
  onMount(async () => {
    offers = await getOffers();
    loading = false;
    connectWs();
  });

  onDestroy(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); } // null onclose so teardown doesn't reconnect
  });
```

- [ ] **Step 2: Add the button**

In the header actions `<div class="flex items-center gap-3">`, immediately **before** the existing "Uruchom crawler" `<button onclick={onRun} ...>`, add:

```svelte
    <button
      onclick={onRescore}
      disabled={rescoring}
      title="Przelicz oceny AI dla aktywnych ofert wg bieżących kryteriów"
      class="inline-flex items-center gap-[7px] rounded-full border border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] px-[16px] py-[8px] text-[0.85rem] font-semibold text-ink shadow-[var(--inset-sheen)] transition-[transform,background,filter] duration-300 ease-[cubic-bezier(0.22,1.18,0.36,1)] hover:bg-[rgba(47,109,255,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={rescoring ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
      {rescoring ? "Przeliczanie…" : "Przelicz oceny"}
    </button>
```

- [ ] **Step 3: Build the web bundle (typecheck + bundle)**

Run: `bun run build`
Expected: build completes with no Svelte/TypeScript errors and writes `web/dist`.

- [ ] **Step 4: Manual smoke test**

```bash
DATABASE_URL=postgres://wynajem:wynajem@localhost:5432/wynajem bun run start
```
Then in a browser at `http://localhost:<port>`:
- Open DevTools → Network → WS: confirm a `/ws` connection is established and stays open.
- Click "Przelicz oceny". Expected: button shows "Przeliczanie…", offer score badges update live as events arrive, a "Przeliczono N ofert" toast appears, button re-enables.
- In Config, turn DeepSeek off and save; click "Przelicz oceny" → expect a toast containing "DeepSeek".

Expected: all behaviors as described. (If no DeepSeek key / offers, the run completes immediately with "Przeliczono 0 ofert".)

- [ ] **Step 5: Commit**

```bash
git add web/Dashboard.svelte
git commit -m "feat(rescore): persistent WS + Przelicz oceny button on dashboard"
```

---

## Final verification

- [ ] **Run the whole suite**

Run: `bun test`
Expected: all suites PASS (new: `progress.test.ts`, `rescore.test.ts`; extended: `queries.test.ts`, `api.test.ts`).

- [ ] **Build the web bundle**

Run: `bun run build`
Expected: clean build.

---

## Notes for the implementer

- **PGlite, never the real DB.** Tests run on in-memory PGlite via `test/setup.ts`. Never point `DATABASE_URL` at data you care about.
- **Run lock is shared.** `source: "rescore"` reuses the same single-row lock as crawls, so a re-score and a crawl are mutually exclusive by design. Don't add a second lock.
- **`updateOfferScore` is deliberately narrow** — it must not touch `status`/`lastSeen`, or a re-score would resurrect inactive offers / skew freshness. The query test asserts this.
- **`runRescore` swallows per-offer errors** (logs + counts) so one bad DeepSeek call can't abort the batch — same contract as `processOffer` in the crawl path.
- **WS teardown nulls `onclose`** before closing so the reconnect backoff doesn't fire during component teardown.
```
