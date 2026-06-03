# Trójmiasto Wynajem — Design Spec

**Date:** 2026-06-01
**Status:** Approved

## Cel

Aplikacja zbiera oferty najmu nieruchomości z ogłoszenia.trojmiasto.pl, śledzi
istniejące i nowe oferty, ocenia nowe oferty pod kątem dopasowania (twarde filtry
+ AI scoring DeepSeek) i wysyła powiadomienie, gdy pojawi się interesująca oferta.
Panel UI pozwala łatwo rekonfigurować parametry.

Źródło danych (domyślny URL wyszukiwania z gotowymi filtrami):
`https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000,e1i,81_33_58_46_91_34_32_1_143_87_76_86_142_2_7_31_29_60_26_93,qi,40_.html`

Strona jest **server-rendered** (czysty HTML) — scrapowanie zwykłym `fetch` +
`HTMLRewriter`, bez przeglądarki.

## Stack i topologia

Jedno repo (Bun), współdzielone moduły TS, kilka kontenerów w `docker-compose`:

- **Svelte SPA** — panel UI (budowany bundlerem Bun przez `bun-plugin-svelte`, nie Vite/SvelteKit).
- **Bun API** (`Bun.serve`) — serwuje statyczny build SPA + endpointy odczytu ofert i CRUD configu.
- **PostgreSQL** — przechowuje oferty i konfigurację. Dostęp przez **Drizzle ORM**
  (sterownik `drizzle-orm/bun-sql`, pod spodem `Bun.sql` — zgodnie z CLAUDE.md).
- **trigger.dev** — zadania w tle (scheduled co 5 min): scrape → parse → dedupe → fetch detali → AI score → notify. Cloud (projekt `proj_fcfuguqmrtfsffzmefyl`) teraz, self-hosted w przyszłości.
- **Apprise** — usługa powiadomień (push), wołana HTTP POST.

### Dostęp do danych z trigger.dev

Zadania piszą **wprost do Postgresa** (`DATABASE_URL`), nie przez publiczne API.
- W dev: `trigger.dev dev` wykonuje taski lokalnie i sięga do bazy z compose.
- W prod po self-hoście: trigger.dev w tej samej sieci Dockera.

Postgres nie jest wystawiany publicznie. Bun API obsługuje wyłącznie potrzeby
frontendu (odczyt ofert, CRUD configu).

### Architektura (diagram)

```
┌─────────────┐     ┌──────────────────────────────┐
│ Svelte SPA  │────▶│ Bun API (Bun.serve)          │
│ (panel UI)  │ HTTP│  • GET /api/offers           │
└─────────────┘     │  • GET/PUT /api/config       │──┐
                    │  • serwuje statyczny build    │  │
                    └──────────────────────────────┘  │
                                                       ▼
   ┌──────────────────────────────┐            ┌──────────────┐
   │ trigger.dev (scheduled 5 min)│───────────▶│  PostgreSQL  │
   │  scrape → parse → dedupe →   │  Drizzle   │ offers/config│
   │  fetch detali → AI score →   │◀───────────└──────────────┘
   │  notify (Apprise)            │
   └───────────────┬──────────────┘
                   │ HTTP POST
                   ▼
            ┌────────────┐
            │  Apprise   │
            └────────────┘
```

## Współdzielone moduły

Importowane i przez Bun API, i przez zadania trigger.dev:

- `src/db` — **Drizzle**: schema (`drizzle-orm/pg-core`), instancja klienta
  (`drizzle-orm/bun-sql`), zapytania. Migracje generowane i aplikowane przez `drizzle-kit`.
- `src/scraper` — `fetch` + `HTMLRewriter`:
  - `parseListPage(html)` → lista `{ externalId, title, price, area, rooms, district, url }`
  - `parseDetailPage(html)` → `{ description, ...dodatkowe pola }`
  - `externalId` wyłuskiwany z linku (`...-ogl<NNN>.html`).
- `src/scorer` — klient DeepSeek (`deepseek-chat`). Wejście: opis oferty + kryteria
  użytkownika. Wyjście: `{ score: 0–100, reasons: string }` (JSON mode).
- `src/notify` — klient Apprise (HTTP POST do `apprise` z listą celów + treścią).

## Przepływ zadania trigger.dev (co 5 min)

1. Wczytaj `config` z bazy.
2. Scrapuj stronę(y) listy (domyślnie 1–2 pierwsze strony — nowe oferty są na górze).
3. **Dedupe**: porównaj `externalId` z bazą → wyodrębnij nowe.
4. Uaktualnij `last_seen` widzianych ofert; oferty zniknięte z listy oznacz `inactive`.
5. Twarde filtry (min/max cena, min metraż, min pokoje) odsiewają nieinteresujące nowe oferty.
6. Dla nowych po filtrach: pobierz stronę detalu (pełny opis) → DeepSeek scoring wg `ai_criteria`.
   - Detale pobierane **tylko dla nowych ofert** (koszt ograniczony).
   - Jeśli `deepseek_enabled = false` → pomiń scoring (score = null, powiadom po samych filtrach).
7. Zapisz oferty + score + reasons do bazy.
8. Jeśli `score ≥ score_threshold` (lub scoring wyłączony) → powiadomienie przez Apprise
   (tytuł, cena, dzielnica, link, uzasadnienie AI). Oznacz `notified = true`.

## Model danych (Postgres)

### `offers`
| kolumna | typ | uwagi |
|---|---|---|
| `external_id` | text | UNIQUE, z linku `ogl<NNN>` |
| `title` | text | |
| `price` | int | zł |
| `area` | numeric | m² |
| `rooms` | int | |
| `district` | text | |
| `url` | text | link do detalu |
| `description` | text | z detalu, dla scoringu |
| `score` | int | 0–100, nullable |
| `score_reasons` | text | uzasadnienie AI, nullable |
| `status` | text | `active` / `inactive` |
| `notified` | bool | domyślnie false |
| `first_seen` | timestamptz | |
| `last_seen` | timestamptz | |

### `config` (pojedynczy wiersz)
| kolumna | typ | domyślnie |
|---|---|---|
| `search_url` | text | URL z filtrami (powyżej) |
| `min_price` | int | null |
| `max_price` | int | 4000 |
| `min_area` | numeric | null |
| `min_rooms` | int | null |
| `ai_criteria` | text | opis „czego szukam" |
| `score_threshold` | int | np. 70 |
| `poll_interval_min` | int | 5 |
| `apprise_urls` | text[] | cele powiadomień |
| `deepseek_enabled` | bool | true |

Rekonfiguracja filtrów trojmiasto = wklejenie nowego `search_url` z wyszukiwarki
serwisu (kody `81_33_58…` to ID dzielnic; własny query-builder pominięty — YAGNI).
Filtry app-level (cena/metraż/pokoje) jako dopełnienie.

## Bun API

- `GET /api/offers` — lista ofert (filtrowanie/sortowanie po score, status).
- `GET /api/config` — odczyt configu.
- `PUT /api/config` — zapis configu.
- `/*` — statyczny build Svelte SPA.

Jedno origin (API serwuje SPA) → brak CORS.

## Panel UI (Svelte SPA)

- **Dashboard**: tabela ofert (score, cena, dzielnica, status, „nowa", link), filtrowanie i sortowanie po score.
- **Config**: edycja wszystkich pól `config` (search_url, filtry, `ai_criteria`, próg, cele Apprise, interwał, `deepseek_enabled`).

## Kontenery (`docker-compose`)

- `db` — Postgres (wolumen na dane).
- `app` — Bun API + serwowany build SPA.
- `apprise` — usługa Apprise (push).
- (trigger.dev cloud teraz; self-hosted dołączy do compose później.)

## Świadome decyzje / kompromisy

- Filtry trojmiasto rekonfigurowane przez wklejenie URL (nie własny query-builder).
- Svelte budowany bundlerem Bun (`bun-plugin-svelte`), nie Vite/SvelteKit.
- Bun API serwuje statyczny build SPA (jedno origin, brak CORS).
- Zapis bezpośrednio do bazy z trigger.dev (dev: taski lokalnie; prod: sieć compose).
- Detale ofert pobierane tylko dla nowych (ograniczenie kosztu i ruchu do serwisu).

## Poza zakresem (YAGNI na teraz)

- Query-builder filtrów trojmiasto.
- Self-hosting trigger.dev (planowany później; design tego nie blokuje).
- Uwierzytelnianie panelu UI (zakładamy prywatną sieć / dostęp lokalny — do rozważenia przy deployu).
