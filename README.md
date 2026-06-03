# renthunter

A self-hosted rental-listing monitor for the Trójmiasto area. It crawls apartment
offers from multiple portals, applies hard filters and optional AI scoring, and
pushes a notification the moment an interesting offer appears. A Svelte SPA lets you
search semantically, browse with sortable infinite scroll, inspect each offer's
change history, and reconfigure everything live — all stored in Postgres.

Everything runs in-process and off-host: no cloud queue, no external scheduler, and
Postgres/Apprise are never exposed to the public network.

## How it works

The pipeline is a single in-process flow, lock-guarded so only one crawl runs at a
time (`src/pipeline/`):

1. **Scrape** — fetch list pages from the configured search URLs across every enabled
   source (`src/scraper/sources/`: `trojmiasto`, `olx`, `otodom`). Each source is a
   small adapter behind a shared registry.
2. **Filter** — drop offers failing the hard criteria (price / area / rooms range)
   before any expensive work (`pipeline/filter.ts`).
3. **Enrich** — for new offers, fetch the detail page (bounded concurrency via
   `pipeline/pool.ts`) and extract structured data (`pipeline/enrich.ts`):
   canonical district (`keywords/gazetteer.ts`), kind, and features
   (`keywords/features.ts`), plus an **embedding** of the listing text for semantic
   search (`embeddings/`).
4. **Score** — optionally rate each offer 0–100 against your free-text criteria with
   **DeepSeek** (`scorer/deepseek.ts`), storing the score and its reasoning.
5. **Notify** — when an offer's score clears the threshold, send it through
   **Apprise** (`notify/apprise.ts`) to whatever targets you configured.
6. **Track changes** — every crawl snapshots tracked fields, so price/description/
   parameter changes are recorded and viewable as per-offer history
   (`db/snapshot.ts`, `offer_snapshots`).
7. **Reconcile** — offers no longer present on the source are marked inactive.

The crawl is triggered two ways: the **in-process scheduler** (`pipeline/scheduler.ts`)
re-runs it every `config.pollIntervalMin` minutes (`0` = off), and the
**"Uruchom crawler"** button in the UI fires `POST /api/run` on demand. Live progress
streams to the browser over a WebSocket (`pipeline/progress.ts`).

### Search & browsing

- **Facets** (district / kind / features / source) are hard filters.
- **Keyword search** turns your text into an embedding and ranks offers by cosine
  similarity (`embeddings/cosine.ts`). "Trafność" (relevance) returns the most
  relevant offers in similarity order; picking **Cena / Najnowsze / Powierzchnia**
  orders that relevant subset by price / date / area instead.
- The list is **server-paginated and DOM-virtualized** (`@tanstack/virtual-core`),
  so it stays fast with thousands of offers — infinite scroll fetches the next page
  and only the visible rows are rendered, in both the card and table views.

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime / bundler / test runner | **Bun** (server, `bun build`, `bun test` — no Node, webpack, vite, or jest) |
| Web UI | **Svelte 5** (runes) SPA, **Tailwind v4**, `@tanstack/virtual-core` for virtualization; built to static assets and served by `Bun.serve()` with a WebSocket for live crawl progress |
| Database | **Postgres** via **Drizzle ORM** + `postgres-js`; tests run against in-memory **PGlite** |
| AI scoring | **DeepSeek** chat completions |
| Semantic search | Text **embeddings** via any OpenAI-compatible endpoint (e.g. self-hosted **Ollama**, or OpenAI) + in-process cosine ranking |
| Notifications | **Apprise** |
| Packaging | **Docker Compose** (dev + prod), in-process lock-guarded crawl scheduler |

## Run it with Docker

The stack is the same on a laptop and on a dedicated server — only the compose file
differs. Both keep Postgres and Apprise off the public network.

### Development (hot reload)

Full stack with the app hot-reloading from bind-mounted source:

```bash
bun run compose:dev          # docker compose -f docker-compose.dev.yml up
```

- App: http://localhost:3000 · Postgres: `127.0.0.1:5432` · Apprise: `127.0.0.1:8000`
  (loopback-only, so host `bun test` can reach them).
- Trigger a crawl with the **"Uruchom crawler"** button in the UI.
- Frontend (`web/`) edits need a rebuild; the server hot-reloads on its own.
- Stop: `bun run compose:dev:down`.

### Production (dedicated server)

Self-contained: `db` + `apprise` + `app`. The scheduled crawl runs **in-process**
inside the app (`src/pipeline/scheduler.ts`, driven by the DB `pollIntervalMin`
setting) — there is no separate scheduler service. Postgres and Apprise are
internal-only.

```bash
cp .env.production.example .env.production   # then fill in POSTGRES_PASSWORD etc.
bun run compose:prod                         # up -d --build, reads .env.production
```

- The app is published on `${APP_PORT:-3000}` — put a reverse proxy (Caddy/Traefik/
  nginx) in front of it for TLS.
- The app auto-applies migrations (`drizzle-kit migrate`) on start.
- Logs: `bun run compose:prod:logs` · Stop: `bun run compose:prod:down`.

## Run on the host (without Docker)

```bash
bun install
cp .env.example .env          # point DATABASE_URL at a reachable Postgres
bun run db:push               # apply schema
bun run dev                   # build SPA + hot-reload API on PORT (default 3000)
bun test                      # run the test suite (PGlite, never touches your DB)
```

## Configuration

Two kinds of configuration:

- **Live settings** — search URLs, hard filters, AI criteria, score threshold,
  Apprise targets, poll interval, concurrency, list pages, request delay, and the
  extraction/embedding toggles — are edited in the UI **Konfiguracja** panel and
  stored in Postgres.
- **Environment** — connection strings and secrets only (`src/config.ts`):

  | Var | Purpose | Default |
  |-----|---------|---------|
  | `DATABASE_URL` | Postgres connection (required) | — |
  | `PORT` | App HTTP port | `3000` |
  | `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` | AI scoring | `https://api.deepseek.com` |
  | `EMBED_BASE_URL` / `EMBED_API_KEY` / `EMBED_MODEL` | Embeddings for semantic search | `https://api.openai.com/v1`, `text-embedding-3-small` |
  | `APPRISE_URL` | Apprise API endpoint | `http://localhost:8000` |

  See `.env.example` (host) and `.env.production.example` (prod compose).

## Project layout

```
src/
  api/         Bun.serve HTTP + WebSocket server, routes
  scraper/     source adapters (trojmiasto, olx, otodom) + HTML parsing
  pipeline/    crawl orchestration: filter, enrich, score, notify, scheduler, run-lock
  scorer/      DeepSeek AI scoring
  embeddings/  embedding client + cosine ranking
  keywords/    district gazetteer + feature extraction
  notify/      Apprise integration
  db/          Drizzle schema, queries, change-snapshot tracking
  log/         DB-backed logger
web/           Svelte 5 SPA (cards/table, search, config, logs, history)
test/          bun test suite (runs on PGlite)
```

## Notes

- **Tests run on in-memory PGlite**, never your real database; `src/db/client.ts`
  refuses to start under `NODE_ENV=test` without it.
- `make db-backup` before any risky DB work. `make up-fresh` destroys the DB volume —
  only `make up` is safe to rerun.
