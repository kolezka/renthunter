# Re-score offers on demand — design

## Problem

When the AI scoring criteria (`config.aiCriteria`) change, existing offers keep
their old `score` / `scoreReasons`. There is no way to re-evaluate the already
crawled offers against the new criteria short of waiting for them to be
re-crawled (which never happens for offers that stay in the same listing). We
need a manual "re-score everything against the current criteria" action.

## Decisions

- **Trigger:** manual button ("Przelicz oceny") on the Dashboard header, beside
  "Uruchom crawler".
- **Scope:** active offers only (`status = 'active'`) that have a non-null
  `description`.
- **Data source:** reuse the stored `description`. No re-fetch / no scraping —
  only the AI score is recomputed. This is fast and never touches the portals.
- **Notifications:** none. Re-scoring is silent; results are reviewed in the
  dashboard.
- **Execution:** background job; the dashboard updates live as each offer is
  scored, over a persistent WebSocket.

Only `aiCriteria` actually feeds the AI score. `scoreThreshold` gates
notifications (irrelevant here, since we don't notify) and `deepseekEnabled`
toggles scoring on/off.

## Backend

### Queries (`src/db/queries.ts`)

- `getActiveScorableOffers(): Promise<Offer[]>` — offers with `status = 'active'`
  AND `description IS NOT NULL`.
- `updateOfferScore(externalId, score, reasons): Promise<void>` — narrow `UPDATE`
  of `score` + `scoreReasons` ONLY. Unlike `upsertOffer`, it does **not** touch
  `status`, `lastSeen`, or any other column.

### Pipeline module (`src/pipeline/rescore.ts`)

Mirrors the shape of `runCheck`.

```
runRescore(deps): Promise<RescoreSummary>
  config = getConfig()
  if (!config.deepseekEnabled) → log + return { skipped: "disabled", scored:0, ... }
  offers = getActiveScorableOffers()
  emitProgress?({ type:"rescore:start", runId, total: offers.length })
  runPool(offers, config.concurrencyLimit, async (o) => {
    try {
      { score, reasons } = scoreOffer({ description: o.description, criteria: config.aiCriteria }, …)
      updateOfferScore(o.externalId, score, reasons)
      emitProgress?({ type:"rescore:scored", externalId: o.externalId, score, reasons })
      scored++
    } catch { log offer.error; errors++ }
  })
  emitProgress?({ type:"rescore:done", runId, summary })
  log rescore.finish
  return { scored, skipped, errors }
```

- **Guard:** `deepseekEnabled === false` → no-op. Re-scoring with DeepSeek off
  would write `null` over every existing score; we refuse instead.
- Reuses the existing `runPool` and `config.concurrencyLimit`.
- Logs `rescore.start` / `rescore.finish` (with the summary) through the same
  `Logger`, so the run shows up in the Logi view.
- `RescoreDeps` includes an optional `emitProgress?(e: RescoreEvent): void` so the
  module stays transport-agnostic (tests pass a spy or omit it).

### Concurrency guard (`src/pipeline/deps.ts`)

- `buildRescoreDeps(env, logger, emitProgress)` — composes `RescoreDeps` from the
  real queries + `scoreOffer`, wiring `emitProgress` to `progressBus.emit`.
- `runRescoreGuarded(env, emitProgress)` — sibling of `runCrawlGuarded`. Acquires
  the existing single-row **run lock** with `source: "rescore"` so a re-score and
  a crawl can never run concurrently (they'd contend over rows / DeepSeek quota).
  Fire-and-forget: returns `{ runId, done }` or `{ busy: true }`; releases the
  lock when the run settles.

### Progress bus (`src/pipeline/progress.ts`)

Minimal typed in-process pub/sub, decoupling the pipeline from `Bun.serve`:

```ts
type RescoreEvent =
  | { type: "rescore:start"; runId: string; total: number }
  | { type: "rescore:scored"; externalId: string; score: number | null; reasons: string | null }
  | { type: "rescore:done"; runId: string; summary: RescoreSummary };

export const progressBus = {
  emit(e: RescoreEvent): void,
  subscribe(fn: (e: RescoreEvent) => void): () => void, // returns unsubscribe
};
```

### API route (`src/api/server.ts`)

- `POST /api/rescore` — fire-and-forget, like `/api/run`:
  - `202 { runId }` on start.
  - `409 { error }` if a run already holds the lock.
  - `400 { error }` if `deepseekEnabled` is false (so the UI can message it).
- `GET /ws` — WebSocket upgrade. On `open`, subscribe the socket to
  `progressBus`; forward each event as JSON; on `close`, unsubscribe.
- `ServerOptions` gains an optional injectable `runRescore` (parallel to the
  existing `runCrawler` / `refreshOfferById`) for testability.

## Frontend

### API client (`web/lib/api.ts`)

- `rescoreAll(): Promise<{ runId: string }>` → `POST /api/rescore`, with the same
  `!res.ok` → `throw new Error(error)` handling as `runCrawler` (surfaces the
  `409` busy and `400` disabled messages).
- `RescoreEvent` type mirrored from the backend.

### Dashboard (`web/Dashboard.svelte`)

- **Persistent WebSocket**, opened on mount and held for the session:
  - Connect to `/ws` (derive `ws(s)://` from `location`).
  - Simple auto-reconnect with backoff on unexpected close.
  - Message handler dispatches on `type`:
    - `rescore:start` → set `rescoring = true` (covers re-scores triggered
      elsewhere too).
    - `rescore:scored` → merge `score` / `scoreReasons` into the matching offer
      in `offers` (in place; live, no reload). Update `selected` if it matches.
    - `rescore:done` → flash summary toast ("Przeliczono N ofert"), set
      `rescoring = false`, and run one final `getOffers()` to reconcile anything
      missed (e.g. if the socket dropped mid-run).
  - Closed on component teardown.
- **Button** "Przelicz oceny" beside "Uruchom crawler" (mirrors the `onRun`
  pattern): disabled while `rescoring`, spinner icon. On click → `rescoreAll()`;
  on error flash the message and clear local state. The live state is driven by
  WS events, not the POST response.

## Edge cases

- DeepSeek disabled → `400`; toast tells the user to enable scoring first.
- No active scorable offers → run completes immediately, `done` summary shows 0.
- Offer with `null` description → excluded by the query (cannot score).
- Concurrent crawl in progress → `409` busy toast.
- WS not connected when `done` would fire → the final `getOffers()` on `done`
  reconciles; if the socket itself is down, auto-reconnect restores live updates
  and a manual page refresh always shows persisted scores.

## Testing

- `runRescore`: skips when disabled (no score writes); scores active offers via a
  fake `scoreOffer`; emits `start`/`scored`/`done`; counts errors without
  aborting the batch; never calls `fetchPage`.
- `updateOfferScore`: updates only score columns, leaves `status`/`lastSeen`.
- `getActiveScorableOffers`: excludes inactive and null-description rows.
- API: `POST /api/rescore` returns 202 / 409 (busy) / 400 (disabled) per the
  injected `runRescore`.
- `progressBus`: subscribe receives emitted events; unsubscribe stops delivery.

## Out of scope

- Auto-triggering re-score on config save.
- Re-fetching listing detail pages during re-score.
- Notifications on newly-qualifying offers.
- Driving live crawler progress over the WS (the bus is built to allow it later).
