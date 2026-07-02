
## This project (renthunter)

Rental crawler: scrape listings → filter → AI-score (DeepSeek) → notify (Apprise). Postgres via Drizzle + `postgres-js` (NOT Bun.sql); Svelte 5 SPA in `web/`.

- **Tests run on in-memory PGlite, never the real DB.** `test/setup.ts` (bunfig `[test] preload`) injects it; `src/db/client.ts` THROWS under `NODE_ENV=test` without it. Never point `DATABASE_URL` at data you care about — DB-backed tests truncate tables in setup hooks.
- `make db-backup` before any risky DB work (no other backups exist). `make up-fresh` DESTROYS the DB volume — only `make up` is safe to rerun.
- `bun run db:generate` (drizzle-kit) needs an interactive TTY; in agent shells hand-author migrations: SQL in `drizzle/` + `drizzle/meta/NNNN_snapshot.json` + a `_journal.json` entry (see `0003_multisource`).
- Host DB for migrations/server: `DATABASE_URL=postgres://renthunter:renthunter@localhost:5432/renthunter` (dev Docker `db`, loopback-only). Apply with `bun run db:migrate`.
- Server does NOT auto-migrate — `bun run dev`/`start` skip migrations (only `start:prod` runs `drizzle-kit migrate`). On a **fresh** dev DB volume, run `bun run db:migrate` with the host `DATABASE_URL` before starting the server, or the schema is missing.
- `docker compose … down -v` is blocked by a guard hook (protects the DB volume) — use `docker compose -f docker-compose.dev.yml stop db` to stop without wiping data.
- Run locally (fresh dev DB): `docker compose -f docker-compose.dev.yml up -d db` → `DATABASE_URL=postgres://renthunter:renthunter@localhost:5432/renthunter bun run db:migrate` → `DATABASE_URL=… bun run dev`.
- Crawl scheduling is in-process (`src/pipeline/scheduler.ts`), driven by DB `config.pollIntervalMin` (0 = off). No trigger.dev.
- API routes use a `ServerOptions` DI pattern (`createServer(port, { runCrawler, getAiModels, … })`, defaulting to real impls) so tests inject stubs — follow it for new routes. Upstream/provider failures degrade as HTTP 200 + `{ error }` data (the UI treats it as degraded, not broken), never a 5xx.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- Postgres: this project uses **Drizzle + `postgres-js`** by design (see intro) — do NOT migrate to `Bun.sql`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

**Gotcha:** `bun test` exits with code **99** and prints stderr noise from `test/logger.test.ts` (intentional error-path tests) even when the whole suite passes — judge success by the `N pass / N fail` summary line, not the exit code.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Web UI is a **Svelte 5** SPA in `web/`, built by `bun run build` (`web/build.ts`). Gotchas: the bundler only compiles `.svelte` files that are actually **imported** by the entry — an unimported component is never type/compile-checked (verify a new component by wiring its import, not just building). Svelte 5 `$props.id()` must be its own statement, not inline in an expression (`const id = $props.id(); const listId = id + "-x"`, not `$props.id() + "-x"`).

`web/` is served as static files by `src/api/server.ts` (the SPA build in `web/dist`, path-traversal-safe with an `index.html` fallback). Dev: `bun run dev` (= `bun run build && bun --hot src/api/server.ts`). Don't use `vite` — Bun's bundler (`web/build.ts`) handles Svelte + Tailwind. The generic Bun **React** HTML-import pattern does NOT apply here.

For Bun API details, read the docs in `node_modules/bun-types/docs/**.mdx`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A **post-commit hook** auto-regenerates the tracked `graphify-out/` files, re-dirtying the tree after every commit — stage & commit them as `chore(graphify): …` (or `git restore graphify-out/`) to keep `git status` clean; don't chase the churn in a loop.
