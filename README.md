# trojmiasto-wynajem

Monitors rental listings on ogłoszenia.trojmiasto.pl: scrapes new offers, applies
hard filters + optional DeepSeek AI scoring, and pushes a notification (via Apprise)
when an interesting offer appears. A Svelte SPA lets you reconfigure everything.

Built with [Bun](https://bun.com). Postgres via Drizzle ORM. The crawl runs
in-process behind a lock-guarded `POST /api/run`; in production a tiny scheduler
sidecar triggers it on an interval, so the whole stack is self-contained (no cloud
dependency, Postgres never exposed off-host).

## Run it with Docker

The stack is the same on a laptop and on a dedicated server — only the compose file
differs. Both keep Postgres and Apprise off the public network.

### Development (hot reload)

Full stack with the app hot-reloading from bind-mounted source:

```bash
bun run compose:dev          # docker compose -f docker-compose.dev.yml up
```

- App: http://localhost:3000 · Postgres: `127.0.0.1:5432` · Apprise: `127.0.0.1:8000`
  (loopback-only, so host `bun test` and `bun run trigger:dev` can reach them).
- Trigger a crawl with the **"Uruchom crawler"** button in the UI, or run
  `bun run trigger:dev` on the host.
- Frontend (`web/`) edits need a rebuild; the server hot-reloads on its own.
- Stop: `bun run compose:dev:down`.

### Production (dedicated server)

Self-contained: `db` + `apprise` + `app` + a `scheduler` sidecar that POSTs
`/api/run` every `CRAWL_INTERVAL_MIN` minutes. Postgres and Apprise are internal-only.

```bash
cp .env.production.example .env.production   # then fill in POSTGRES_PASSWORD etc.
bun run compose:prod                         # up -d --build, reads .env.production
```

- The app is published on `${APP_PORT:-3000}` — put a reverse proxy (Caddy/Traefik/
  nginx) in front of it for TLS.
- The app auto-applies the schema (`drizzle-kit push`) on start.
- Logs: `bun run compose:prod:logs` · Stop: `bun run compose:prod:down`.

## Run on the host (without Docker)

```bash
bun install
cp .env.example .env          # point DATABASE_URL at a reachable Postgres
bun run db:push               # apply schema
bun run dev                   # build SPA + hot-reload API on PORT (default 3000)
bun test                      # run the test suite
```

## Configuration

All runtime behavior (search URL, filters, AI criteria, score threshold, Apprise
targets, concurrency, list pages, request delay, …) is edited live in the UI
**Konfiguracja** panel and stored in Postgres. Container env only carries
connection/secret values — see `.env.example` (host) and `.env.production.example`
(prod compose).
