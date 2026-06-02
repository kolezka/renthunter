# Docker Compose (dev + prod) — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Cel

Dwa samowystarczalne stosy Compose: jeden do wygodnego dev na laptopie, jeden do
produkcji na dedykowanym serwerze. Oba uruchamiają tę samą aplikację; różnią się
trybem (hot-reload vs zbudowany obraz) i hartowaniem.

Decyzje z brainstormingu:
- **Dwa osobne pliki** (`docker-compose.dev.yml`, `docker-compose.prod.yml`),
  każdy kompletny — bez nakładek/override.
- **Dev: aplikacja w kontenerze** z bind-mountem źródeł i `bun --hot`.
- **Brak zależności od trigger.dev cloud** w prod — rozwiązuje napięcie
  Postgres-wewnętrzny ↔ cloud (worker chmurowy nie ma dostępu do wewnętrznej bazy).

## Rozwiązanie napięcia Postgres ↔ trigger.dev

Zaplanowany crawl w prod uruchamia **sidecar `scheduler`**, który cyklicznie woła
**`POST /api/run`** (endpoint z blokadą `run_lock` dodaną wcześniej). Aplikacja
wykonuje crawl in-process, więc:
- Postgres nigdy nie musi być wystawiony poza hosta (worker chmurowy nie jest
  potrzebny),
- blokada przebiegu chroni przed nakładaniem/duplikatami,
- cały stos działa identycznie lokalnie i na serwerze.

trigger.dev pozostaje opcjonalne dla dev (`bun run trigger:dev` na hoście).

## `docker-compose.dev.yml` (projekt `trojmiasto-wynajem-dev`)

- **db** — `postgres:16-alpine`, hasło `${POSTGRES_PASSWORD:-wynajem}`, port
  **loopback** `127.0.0.1:5432` (host: testy, `trigger:dev`), healthcheck, wolumen
  `pgdata`.
- **apprise** — loopback `127.0.0.1:8000`.
- **app** — obraz `oven/bun:1` (bez budowania), `working_dir: /app`, komenda
  `bun install --frozen-lockfile && bunx drizzle-kit push && bun run dev`. Bind-mount
  `.:/app` + anonimowy wolumen `/app/node_modules` (linux vs darwin). Loopback `3000`.
  `depends_on` db healthy.
- **Precedencja env:** Compose `environment:` ma pierwszeństwo nad `.env`
  z bind-mounta — zweryfikowane: Bun daje pierwszeństwo realnym zmiennym środowiska
  nad plikiem `.env`. Dlatego `DATABASE_URL` wskazuje host `db`, nie `localhost`
  z hostowego `.env`.
- Ograniczenie: `bun run dev` buduje SPA raz; tylko serwer hot-reloaduje — edycje
  `web/` wymagają ponownego builda. Udokumentowane, poza zakresem zmiany.

## `docker-compose.prod.yml` (projekt `trojmiasto-wynajem-prod`)

- **db** — hasło **wymagane** (`${POSTGRES_PASSWORD:?…}`), `restart: unless-stopped`,
  healthcheck, wolumen `pgdata`, **bez portu hosta** (tylko sieć wewnętrzna).
- **apprise** — `restart: unless-stopped`, **wewnętrzny** (bez portu hosta).
- **app** — `build: .` (Dockerfile: build SPA + `drizzle-kit push` + serwer),
  `restart: unless-stopped`, sekrety przez podstawienie, publikacja na
  `${APP_PORT:-3000}` (z założeniem reverse-proxy/TLS przed nią). Healthcheck
  **przez `bun`** (`fetch('http://localhost:3000/api/config')`), bo slim-obraz nie ma
  curl/wget. `start_period: 40s`.
- **scheduler** — `curlimages/curl:latest`, `restart: unless-stopped`,
  `depends_on: app healthy`. Pętla `sh`: `sleep CRAWL_INTERVAL_MIN*60` →
  `curl -X POST http://app:3000/api/run`. `$$` w YAML, by to powłoka kontenera (nie
  Compose) liczyła arytmetykę/rozwijała zmienną. Domyślny interwał `${CRAWL_INTERVAL_MIN:-5}`.

## Pliki pomocnicze

- Usunięto stary `docker-compose.yml` (zastąpiony dwoma jawnymi plikami).
- `.gitignore` += `.env.production`.
- Nowy `.env.production.example` (POSTGRES_PASSWORD wymagany; DEEPSEEK_API_KEY,
  APP_PORT, CRAWL_INTERVAL_MIN opcjonalne).
- `package.json`: skróty `compose:dev[:down]`, `compose:prod[:down|:logs]`.
- README: instrukcje dev/prod/host.

## Walidacja

- `docker compose -f docker-compose.dev.yml config` → VALID.
- `POSTGRES_PASSWORD=… docker compose -f docker-compose.prod.yml config` → VALID.
- Eskejping `$$` zweryfikowany uruchomieniowo: kontener liczy `sleep_seconds=300`
  dla `CRAWL_INTERVAL_MIN=5`.

## Świadome decyzje / kompromisy

- Scheduler tylko w prod; w dev crawl ręczny (przycisk UI) lub `trigger:dev`.
- Postgres/apprise w prod bez portów hosta — dostęp wyłącznie wewnątrz sieci Compose.
- Reverse-proxy/TLS przed aplikacją pozostaje po stronie wdrożenia (poza compose).
- `CRAWL_INTERVAL_MIN` steruje sidecarem; pole `config.pollIntervalMin` w bazie
  pozostaje informacyjne (jak dotąd).

## Poza zakresem (YAGNI)

- Reverse-proxy/TLS jako usługa w compose.
- Self-hosting trigger.dev.
- Watch-build dla frontendu w kontenerze dev.
- Limity zasobów (`deploy.resources`).
