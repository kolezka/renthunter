# Crawler Scheduler (in-process) + Multi-source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move crawler scheduling into the Bun process (DB-driven `pollIntervalMin`, `0` = off), support multiple search sources, and remove trigger.dev entirely.

**Architecture:** A self-scheduling `setTimeout` loop in `src/pipeline/scheduler.ts` reads `pollIntervalMin` from DB and runs the existing `runCheck` through the existing `withRunLock`. The pipeline iterates over a `searchUrls` array (replacing the single `searchUrl`), merging/deduping offers across sources by `externalId`. trigger.dev and the prod curl sidecar are deleted — one mechanism for dev and prod.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (postgres), `bun:test`, Svelte 5 (runes), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-02-crawler-scheduler-design.md`

---

## File Structure

- `src/db/schema.ts` — `searchUrl` → `searchUrls text[]` (modify).
- `drizzle/0003_*.sql` — generated migration, hand-edited to backfill (create).
- `src/db/queries.ts` — `ensureConfig` seeds `searchUrls` (modify).
- `src/api/validate.ts` — `searchUrls` array validation (SSRF host kept); `pollIntervalMin` min → 0 (modify).
- `src/pipeline/check.ts` — `runCheck` iterates `config.searchUrls` (modify).
- `src/pipeline/deps.ts` — `runCrawlGuarded(env, source)` shared helper (modify).
- `src/pipeline/scheduler.ts` — `nextDelayMs` + `startScheduler` (create).
- `src/api/server.ts` — use `runCrawlGuarded` for `/api/run`; start scheduler in `import.meta.main` (modify).
- `web/lib/api.ts` — `Config.searchUrl` → `searchUrls: string[]` (modify).
- `web/Config.svelte` — sources textarea (one per line) (modify).
- `docker-compose.prod.yml` — remove `scheduler` sidecar + `CRAWL_INTERVAL_MIN` (modify).
- `trigger/`, `trigger.config.ts`, `package.json`, `Makefile` — remove trigger.dev (delete/modify).
- Tests: `test/validate.test.ts`, `test/check.test.ts`, `test/refresh.test.ts`, `test/scheduler.test.ts`.

---

## Task 1: Schema — searchUrls array + migration

**Files:**
- Modify: `src/db/schema.ts:26`
- Modify: `src/db/queries.ts:5-7`
- Create: `drizzle/0003_*.sql` (generated, then hand-edited)

- [ ] **Step 1: Replace the column in the schema**

In `src/db/schema.ts`, replace line 26:

```ts
  searchUrl: text("search_url").notNull(),
```

with:

```ts
  searchUrls: text("search_urls").array().notNull().default([]),
```

- [ ] **Step 2: Update ensureConfig to seed the array**

In `src/db/queries.ts`, replace the body of `ensureConfig` (lines 5-7):

```ts
export async function ensureConfig(defaultSearchUrl: string): Promise<void> {
  await db.insert(config).values({ id: 1, searchUrls: [defaultSearchUrl] }).onConflictDoNothing();
}
```

- [ ] **Step 3: Generate the migration**

Run: `bun run db:generate`
Expected: a new `drizzle/0003_*.sql` appears; command exits 0. It will likely
`DROP COLUMN search_url` and `ADD COLUMN search_urls`.

- [ ] **Step 4: Hand-edit the migration to backfill before dropping**

Open the new `drizzle/0003_*.sql`. Ensure the order is: add the new column, backfill
from the old one, then drop the old one. Edit it to read (adjust the auto-generated
statements to this effect):

```sql
ALTER TABLE "config" ADD COLUMN "search_urls" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
UPDATE "config" SET "search_urls" = ARRAY["search_url"] WHERE "search_url" IS NOT NULL AND "search_url" <> '';
--> statement-breakpoint
ALTER TABLE "config" DROP COLUMN "search_url";
```

- [ ] **Step 5: Apply the migration**

Run: `bun run db:migrate`
Expected: migration applies with no error; existing config row's `search_url` value
is now in `search_urls`.

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: errors ONLY in files still referencing `searchUrl` (validate.ts, check.ts,
test configs, web) — those are fixed in later tasks. Note them; do not fix here.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/queries.ts drizzle/
git commit -m "feat(db): config.searchUrls array (multi-source) with backfill migration"
```

---

## Task 2: Validate searchUrls + relax pollIntervalMin

**Files:**
- Modify: `src/api/validate.ts:4-9,33-44,71-76`
- Test: `test/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/validate.test.ts`:

```ts
test("accepts an array of trojmiasto search urls", () => {
  const r = validateConfigPatch({
    searchUrls: [
      "https://ogloszenia.trojmiasto.pl/a.html",
      "https://ogloszenia.trojmiasto.pl/b.html",
    ],
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.patch.searchUrls?.length).toBe(2);
});

test("accepts an empty searchUrls array", () => {
  expect(validateConfigPatch({ searchUrls: [] }).ok).toBe(true);
});

test("rejects a searchUrls entry on a foreign host (SSRF)", () => {
  expect(validateConfigPatch({ searchUrls: ["https://evil.example.com/x"] }).ok).toBe(false);
});

test("rejects a non-url searchUrls entry", () => {
  expect(validateConfigPatch({ searchUrls: ["not a url"] }).ok).toBe(false);
});

test("rejects searchUrls that is not an array of strings", () => {
  expect(validateConfigPatch({ searchUrls: "https://ogloszenia.trojmiasto.pl/a.html" }).ok).toBe(false);
});

test("pollIntervalMin 0 is accepted (disabled)", () => {
  expect(validateConfigPatch({ pollIntervalMin: 0 }).ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/validate.test.ts`
Expected: FAIL — `searchUrls` is dropped by the whitelist, `pollIntervalMin: 0` rejected.

- [ ] **Step 3: Edit the EDITABLE list**

In `src/api/validate.ts`, replace the `EDITABLE` array (lines 4-9):

```ts
const EDITABLE: (keyof Config)[] = [
  "searchUrls", "minPrice", "maxPrice", "minArea", "minRooms",
  "maxArea", "maxRooms",
  "aiCriteria", "scoreThreshold", "pollIntervalMin", "appriseUrls", "deepseekEnabled",
  "listPages", "maxDetailFetchesPerRun", "requestDelayMs", "concurrencyLimit",
];
```

- [ ] **Step 4: Replace the searchUrl validation block with searchUrls**

Replace the `if ("searchUrl" in patch) { … }` block (lines 33-44) with:

```ts
  if ("searchUrls" in patch) {
    const v = patch.searchUrls;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      return { ok: false, error: "searchUrls must be an array of strings" };
    }
    for (const s of v as string[]) {
      let u: URL;
      try { u = new URL(s); } catch { return { ok: false, error: `searchUrls entry is not a valid URL: ${s.slice(0, 40)}` }; }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        return { ok: false, error: "searchUrls entries must be http(s)" };
      }
      if (u.hostname !== ALLOWED_SEARCH_HOST) {
        return { ok: false, error: `searchUrls host must be ${ALLOWED_SEARCH_HOST}` };
      }
    }
  }
```

- [ ] **Step 5: Relax the pollIntervalMin lower bound to 0**

Replace the `pollIntervalMin` block (lines 71-76) with:

```ts
  if ("pollIntervalMin" in patch) {
    const v = patch.pollIntervalMin;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1440) {
      return { ok: false, error: "pollIntervalMin must be an integer 0-1440 (0 = disabled)" };
    }
  }
```

- [ ] **Step 6: Run to verify it passes**

Run: `bun test test/validate.test.ts`
Expected: PASS (new + existing). If an old test asserted `searchUrl` validation,
update it to `searchUrls`.

- [ ] **Step 7: Commit**

```bash
git add src/api/validate.ts test/validate.test.ts
git commit -m "feat(api): validate searchUrls array (SSRF-safe); allow pollIntervalMin 0"
```

---

## Task 3: Pipeline — iterate over all sources

**Files:**
- Modify: `src/pipeline/check.ts:115-127`
- Modify: `test/check.test.ts` (baseConfig + multi-page test + new multi-source test)

- [ ] **Step 1: Update baseConfig and the multi-page test, add a multi-source test**

In `test/check.test.ts`, change `baseConfig` so it uses `searchUrls` instead of
`searchUrl`:

```ts
  searchUrls: ["https://search"],
```

(remove the old `searchUrl: "https://search",` line).

In the existing "listPages > 1" test, the `pages` map key `"https://search"` and the
`"https://search/?strona=2"` stay valid (source iteration calls `listPageUrls` per
source). Leave it as is.

Append a multi-source test:

```ts
test("scrapes every source and dedups across sources by externalId", async () => {
  const bySource: Record<string, string> = {
    "https://search-a": "<list-a>",
    "https://search-b": "<list-b>",
  };
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, searchUrls: ["https://search-a", "https://search-b"] }) as any,
    fetchPage: async (url) => {
      if (url.includes("ogl")) return "<detail>";
      return bySource[url] ?? "<list>";
    },
    parseListUrls: (html) =>
      html === "<list-b>"
        ? [
            { externalId: "100", url: "https://x/a-ogl100.html" }, // dup across sources
            { externalId: "200", url: "https://x/b-ogl200.html" },
          ]
        : [{ externalId: "100", url: "https://x/a-ogl100.html" }],
  });
  const summary = await runCheck(deps);
  expect(summary.listedCount).toBe(2); // 100 deduped, 200 unique
  expect(summary.newCount).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/check.test.ts`
Expected: FAIL — `runCheck` reads `config.searchUrl` (now undefined) so it scrapes
nothing / type-errors.

- [ ] **Step 3: Rewrite the list-collection loop in runCheck**

In `src/pipeline/check.ts`, replace the single-source loop (the block that starts with
`const merged = new Map<string, ListItem>();` through the line building `items`):

```ts
    // Fetch + merge every page of every configured source. parseListUrls dedups
    // per page; the Map dedups across pages AND across sources by externalId.
    const merged = new Map<string, ListItem>();
    for (const source of config.searchUrls) {
      for (const pageUrl of listPageUrls(source, config.listPages)) {
        await sleep(config.requestDelayMs);
        const html = await deps.fetchPage(pageUrl);
        for (const it of deps.parseListUrls(html)) {
          if (!merged.has(it.externalId)) merged.set(it.externalId, it);
        }
      }
    }
    const items = [...merged.values()];
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/check.test.ts`
Expected: PASS (all existing + the new multi-source test).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/check.ts test/check.test.ts
git commit -m "feat(pipeline): scrape and dedup across multiple sources"
```

---

## Task 4: Fix refresh test config + web client + Config UI

**Files:**
- Modify: `test/refresh.test.ts` (baseConfig)
- Modify: `web/lib/api.ts:10`
- Modify: `web/Config.svelte`

- [ ] **Step 1: Update refresh.test.ts baseConfig**

In `test/refresh.test.ts`, change the `baseConfig` `searchUrl: "https://search",`
line to:

```ts
  searchUrls: ["https://search"],
```

- [ ] **Step 2: Run the full suite to confirm green on the server side**

Run: `bun test`
Expected: PASS — no test references `searchUrl` anymore.

- [ ] **Step 3: Update the web Config type**

In `web/lib/api.ts`, replace the `searchUrl: string;` field (line 10) so the `Config`
interface starts:

```ts
  searchUrls: string[]; minPrice: number | null; maxPrice: number | null;
```

- [ ] **Step 4: Replace the Search URL textarea with a sources textarea**

In `web/Config.svelte`, add a derived text state next to `appriseText` (after line 7):

```ts
  let searchUrlsText = $state("");
```

Where `appriseText` is initialised from `cfg` (around lines 11 and 24), add alongside:

```ts
    searchUrlsText = cfg.searchUrls.join("\n");
```

In the submit handler, where `appriseUrls` is built (around line 20), add:

```ts
      searchUrls: searchUrlsText.split("\n").map((s) => s.trim()).filter(Boolean),
```

Replace the "Wyszukiwanie" fieldset body (the single `<textarea bind:value={cfg.searchUrl} …>`):

```svelte
      <label class="mt-3 grid gap-[7px]">
        <span class={labelSpan}>Adresy wyszukiwania <em class="font-medium not-italic text-ink-3">· jeden na linię</em></span>
        <textarea bind:value={searchUrlsText} rows="3" placeholder="https://ogloszenia.trojmiasto.pl/…" class="{control} resize-y leading-normal"></textarea>
      </label>
```

- [ ] **Step 5: Relax the interval input to allow 0**

In `web/Config.svelte`, change the "Interwał (min)" input `min="1"` to `min="0"` and
update its label span to hint at disabling:

```svelte
        <label class="grid gap-[7px]"><span class={labelSpan}>Interwał (min) <em class="font-medium not-italic text-ink-3">· 0 = off</em></span><input type="number" min="0" bind:value={cfg.pollIntervalMin} class={control} /></label>
```

- [ ] **Step 6: Build the SPA**

Run: `bun run build`
Expected: build succeeds, no Svelte compile errors.

- [ ] **Step 7: Commit**

```bash
git add test/refresh.test.ts web/lib/api.ts web/Config.svelte
git commit -m "feat(web): multi-source textarea + interval 0=off; fix refresh test config"
```

---

## Task 5: Shared lock-guarded run helper

**Files:**
- Modify: `src/pipeline/deps.ts` (add `runCrawlGuarded`)
- Modify: `src/api/server.ts:1-29,46-58`

- [ ] **Step 1: Add runCrawlGuarded to deps.ts**

Append to `src/pipeline/deps.ts`:

```ts
import { acquireRunLock, releaseRunLock } from "../db/queries";
import { runCheck } from "./check";
import { dbLogger, createRunLogger } from "../log/logger";
import { RUN_LOCK_STALE_MS } from "./run-lock";

/**
 * Acquire the cross-process run lock and run the crawl in-process under the given
 * source ("manual" | "scheduled"). Fire-and-forget: returns the runId and a `done`
 * promise immediately; releases the lock when the run settles. `{ busy: true }`
 * when another run already holds the lock.
 */
export async function runCrawlGuarded(
  env: AppConfig,
  source: string,
): Promise<{ runId: string; done: Promise<void> } | { busy: true }> {
  const runId = crypto.randomUUID();
  const acquired = await acquireRunLock(runId, source, RUN_LOCK_STALE_MS);
  if (!acquired) return { busy: true };
  const logger = createRunLogger(dbLogger, runId);
  const done = runCheck(buildCheckDeps(env, logger))
    .then(() => {})
    .catch((err) => { console.error(`${source} runCheck failed:`, err); })
    .finally(() => releaseRunLock(runId));
  return { runId, done };
}
```

- [ ] **Step 2: Use it from server.ts; drop the duplicated defaultRunCrawler body**

In `src/api/server.ts`, remove the now-unused imports that only `defaultRunCrawler`
used if no longer referenced (`acquireRunLock`, `releaseRunLock`, `runCheck`,
`RUN_LOCK_STALE_MS`, `createRunLogger`/`dbLogger` if unused elsewhere — keep
`dbLogger`/`createRunLogger` if `defaultRefresh` still uses them). Add
`runCrawlGuarded` to the deps import:

```ts
import { buildRefreshDeps, runCrawlGuarded } from "../pipeline/deps";
```

Replace the whole `defaultRunCrawler` function (lines 17-29) with:

```ts
// Default in-process crawl, triggered by POST /api/run (source "manual").
function defaultRunCrawler(): Promise<{ runId: string; done: Promise<void> } | { busy: true }> {
  return runCrawlGuarded(loadConfig(), "manual");
}
```

- [ ] **Step 3: Typecheck + run the api tests**

Run: `bunx tsc --noEmit && bun test test/api.test.ts`
Expected: PASS — `/api/run` behaviour unchanged (still 202 / 409). Remove any import
left unused (tsc under `noUnusedLocals` if enabled, else verify manually).

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/deps.ts src/api/server.ts
git commit -m "refactor(pipeline): shared runCrawlGuarded for manual + scheduled runs"
```

---

## Task 6: Scheduler module

**Files:**
- Create: `src/pipeline/scheduler.ts`
- Test: `test/scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/scheduler.test.ts`:

```ts
import { test, expect } from "bun:test";
import { nextDelayMs, IDLE_RECHECK_MS, startScheduler, type SchedulerDeps } from "../src/pipeline/scheduler";

test("nextDelayMs: 0 means idle recheck, no run", () => {
  expect(nextDelayMs(0)).toEqual({ delayMs: IDLE_RECHECK_MS, willRun: false });
});

test("nextDelayMs: positive minutes convert to ms and will run", () => {
  expect(nextDelayMs(5)).toEqual({ delayMs: 5 * 60_000, willRun: true });
});

test("nextDelayMs: negative is treated as idle", () => {
  expect(nextDelayMs(-3)).toEqual({ delayMs: IDLE_RECHECK_MS, willRun: false });
});

function makeDeps(over: Partial<SchedulerDeps> = {}) {
  const calls = { runs: 0, timers: [] as Array<{ fn: () => void; ms: number }> };
  const deps: SchedulerDeps = {
    getConfig: async () => ({ pollIntervalMin: 5 }) as any,
    runGuarded: async () => { calls.runs++; return { ran: true }; },
    setTimer: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; },
    clearTimer: () => {},
    log: { log() {} },
    ...over,
  };
  return { deps, calls };
}

test("startScheduler schedules the first cycle using the configured interval", async () => {
  const { deps, calls } = makeDeps();
  startScheduler(deps);
  await Promise.resolve(); // let the async getConfig settle
  expect(calls.timers.length).toBe(1);
  expect(calls.timers[0]!.ms).toBe(5 * 60_000);
  expect(calls.runs).toBe(0); // nothing runs until the timer fires
});

test("firing the timer runs the crawl then schedules the next cycle", async () => {
  const { deps, calls } = makeDeps();
  startScheduler(deps);
  await Promise.resolve();
  await calls.timers[0]!.fn();        // simulate the timer firing
  await Promise.resolve();
  expect(calls.runs).toBe(1);
  expect(calls.timers.length).toBe(2); // next cycle scheduled
});

test("idle interval (0) schedules a recheck and does not run", async () => {
  const { deps, calls } = makeDeps({ getConfig: async () => ({ pollIntervalMin: 0 }) as any });
  startScheduler(deps);
  await Promise.resolve();
  expect(calls.timers[0]!.ms).toBe(IDLE_RECHECK_MS);
  await calls.timers[0]!.fn();
  await Promise.resolve();
  expect(calls.runs).toBe(0);
});

test("stop() prevents further scheduling after the current cycle", async () => {
  const { deps, calls } = makeDeps();
  const stop = startScheduler(deps);
  await Promise.resolve();
  stop();
  await calls.timers[0]!.fn();
  await Promise.resolve();
  expect(calls.timers.length).toBe(1); // no new timer after stop
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/scheduler.test.ts`
Expected: FAIL — module `../src/pipeline/scheduler` not found.

- [ ] **Step 3: Implement the scheduler**

Create `src/pipeline/scheduler.ts`:

```ts
import type { Logger } from "../log/logger";
import type { AppConfig } from "../config";
import { getConfig } from "../db/queries";
import { runCrawlGuarded } from "./deps";

/** How often to re-read config while auto-crawl is disabled (pollIntervalMin <= 0). */
export const IDLE_RECHECK_MS = 60_000;

export interface SchedulerDeps {
  getConfig: () => Promise<{ pollIntervalMin: number }>;
  runGuarded: () => Promise<{ ran: boolean }>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  log: Logger;
}

/** Pure decision: how long to wait next, and whether that wake-up runs a crawl. */
export function nextDelayMs(pollIntervalMin: number): { delayMs: number; willRun: boolean } {
  if (!Number.isFinite(pollIntervalMin) || pollIntervalMin <= 0) {
    return { delayMs: IDLE_RECHECK_MS, willRun: false };
  }
  return { delayMs: pollIntervalMin * 60_000, willRun: true };
}

/**
 * Start the self-scheduling crawl loop. Reads pollIntervalMin from DB each cycle
 * (so UI changes take effect on the next cycle), runs the crawl through the shared
 * run lock, and reschedules. Returns a stop() that cancels the pending timer.
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  let stopped = false;
  let handle: unknown = null;

  async function schedule(): Promise<void> {
    if (stopped) return;
    let minutes = 0;
    try {
      minutes = (await deps.getConfig()).pollIntervalMin;
    } catch (err) {
      await deps.log.log({ level: "error", event: "scheduler.config_error", message: `scheduler getConfig failed: ${String(err)}` });
    }
    if (stopped) return;
    const { delayMs, willRun } = nextDelayMs(minutes);
    handle = deps.setTimer(() => { void tick(willRun); }, delayMs);
  }

  async function tick(willRun: boolean): Promise<void> {
    if (stopped) return;
    if (willRun) {
      try {
        const r = await deps.runGuarded();
        if (!r.ran) {
          await deps.log.log({ level: "info", event: "scheduler.skipped", message: "scheduled run skipped: another run in progress" });
        }
      } catch (err) {
        await deps.log.log({ level: "error", event: "scheduler.error", message: `scheduled run failed: ${String(err)}` });
      }
    }
    await schedule();
  }

  void schedule();
  return () => { stopped = true; if (handle !== null) deps.clearTimer(handle); };
}

/** Compose the real scheduler deps (DB config + lock-guarded run, source "scheduled"). */
export function buildSchedulerDeps(env: AppConfig, logger: Logger): SchedulerDeps {
  return {
    getConfig,
    runGuarded: async () => {
      const r = await runCrawlGuarded(env, "scheduled");
      return { ran: !("busy" in r) };
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    log: logger,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/scheduler.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/scheduler.ts test/scheduler.test.ts
git commit -m "feat(pipeline): in-process self-scheduling crawl loop"
```

---

## Task 7: Wire the scheduler into the server entry

**Files:**
- Modify: `src/api/server.ts` (the `if (import.meta.main)` block)

- [ ] **Step 1: Start the scheduler on boot with a hot-reload guard**

In `src/api/server.ts`, in the `if (import.meta.main)` block, after
`const server = createServer(env.port);` add:

```ts
  const { startScheduler, buildSchedulerDeps } = await import("../pipeline/scheduler");
  const { dbLogger, createRunLogger } = await import("../log/logger");
  // Guard against bun --hot re-evaluating this module and stacking timers.
  const g = globalThis as { __crawlScheduler?: () => void };
  g.__crawlScheduler?.();
  g.__crawlScheduler = startScheduler(buildSchedulerDeps(env, createRunLogger(dbLogger, "scheduler")));
  console.log(`API listening on http://localhost:${server.port}`);
```

Remove the now-duplicate `console.log("API listening …")` line that was already there.

- [ ] **Step 2: Typecheck + full suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS — `createServer` (used in tests) still does NOT start a scheduler;
only the `import.meta.main` entry does.

- [ ] **Step 3: Smoke-test against the running dev DB**

With the dev DB reachable, run the server briefly and set a short interval:

```bash
DATABASE_URL=postgres://wynajem:wynajem@localhost:5432/wynajem bun run src/api/server.ts &
sleep 2
curl -s -X PATCH localhost:3000/api/config -H 'content-type: application/json' -d '{"pollIntervalMin":1}' >/dev/null
echo "scheduler set to 1 min; check logs after ~1 min, then kill"
```
Expected: after ~1 min a `run.start` log appears (via `GET /api/logs` or DB). Kill the
background server (`kill %1`).

- [ ] **Step 4: Commit**

```bash
git add src/api/server.ts
git commit -m "feat(api): start in-process crawl scheduler on server boot"
```

---

## Task 8: Remove trigger.dev

**Files:**
- Delete: `trigger/check-offers.ts`, `trigger.config.ts`
- Modify: `package.json`, `Makefile`

- [ ] **Step 1: Delete the trigger files**

```bash
git rm trigger/check-offers.ts trigger.config.ts
rmdir trigger 2>/dev/null || true
```

- [ ] **Step 2: Remove the dependency and scripts from package.json**

In `package.json`, delete the `"trigger:dev"` and `"trigger:deploy"` script lines and
the `"@trigger.dev/sdk": "^4.4.6",` dependency line.

- [ ] **Step 3: Remove the Makefile target**

In `Makefile`, delete the `trigger-dev` target (lines around 70-71) and remove
`trigger-dev` from the `.PHONY` list (line 6).

- [ ] **Step 4: Refresh the lockfile and confirm nothing imports trigger.dev**

Run:
```bash
bun install
grep -rn "@trigger.dev" src/ web/ test/ || echo "no trigger.dev imports left"
```
Expected: lockfile updates; grep prints the "no … left" message.

- [ ] **Step 5: Typecheck + full suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove trigger.dev (scheduling now in-process)"
```

---

## Task 9: Remove the prod curl sidecar

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Delete the scheduler service**

In `docker-compose.prod.yml`, remove the entire `scheduler:` service block (from
`  scheduler:` through the end of its `entrypoint:` heredoc) and any
`CRAWL_INTERVAL_MIN` reference. Update the header comment to note scheduling is now in
the app process.

- [ ] **Step 2: Validate the compose file parses**

Run: `docker compose -f docker-compose.prod.yml config -q && echo "prod compose OK"`
Expected: prints "prod compose OK" (no YAML/schema error).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "chore(docker): drop prod curl sidecar; app schedules crawls in-process"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Whole suite + typecheck + build**

Run: `bunx tsc --noEmit && bun test && bun run build`
Expected: no type errors; all suites green; SPA build succeeds.

- [ ] **Step 2: End-to-end in Docker**

```bash
make up-fresh   # resets DB volume; only if you accept losing dev data — otherwise `make up`
```
Then in the panel: add two trojmiasto source URLs, set interval to 1 min, save. After
~1 min confirm a run appears in Logs. Set interval to 0, save; confirm no further
auto-runs. The manual "Uruchom crawler" button still triggers a run.

- [ ] **Step 3: Final commit (stray changes)**

```bash
git add -A && git commit -m "chore: scheduler + multi-source final verification" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** in-process scheduler → Task 6+7; `pollIntervalMin` 0=off → Task 2 (validate), 4 (UI), 6 (`nextDelayMs`); shared guarded run → Task 5; multi-source schema/migration → Task 1; multi-source validate → Task 2; multi-source pipeline → Task 3; multi-source UI/client/seed → Task 1 (seed) + 4; trigger.dev removal → Task 8; prod sidecar removal → Task 9.
- **Type consistency:** `searchUrls: string[]` used in schema (Task 1), validate (Task 2), check.ts (Task 3), web (Task 4); `runCrawlGuarded(env, source)` defined in Task 5 and consumed by server.ts (Task 5) and `buildSchedulerDeps` (Task 6); `SchedulerDeps`/`nextDelayMs`/`startScheduler`/`IDLE_RECHECK_MS` defined in Task 6 and wired in Task 7.
- **Migration safety:** Task 1 Step 4 backfills `search_urls` from `search_url` before dropping it, so the configured search survives.
