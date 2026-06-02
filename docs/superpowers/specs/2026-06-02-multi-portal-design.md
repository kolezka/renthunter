# Multi-portal support (OLX + Otodom + trojmiasto) — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Branch:** `feat/multi-portal` (off `main`)

## Problem

Crawler obsługuje dziś **tylko trojmiasto**. Mechanizm `config.searchUrls text[]`
(z etapu scheduler/multi-source) przyjmuje wiele URL-i, ale parsery są
trojmiasto-specyficzne i zahardkodowane w pipeline:

- `src/scraper/parse.ts` — `parseListUrls`, `parseDetail`, `listPageUrls` operują
  wyłącznie na HTML trojmiasto (regex `-ogl(\d+).html`, paginacja `strona`).
- `CheckDeps` (`src/pipeline/check.ts`) wstrzykuje **jedną** parę
  `parseListUrls`/`parseDetail`, więc `runCheck`/`processOffer` nie potrafią
  rozróżnić portali.
- `offers.external_id` to bare-numeryczne ID (unikalne globalnie) — ID z różnych
  portali mogą kolidować.
- `validate.ts` dopuszcza dokładnie jeden host (`ogloszenia.trojmiasto.pl`) jako
  cel scrapowania (guard SSRF).

Docelowe portale:

- **OLX:** `https://www.olx.pl/nieruchomosci/mieszkania/wynajem/gdansk/?search[filter_float_price:to]=4100&search[filter_float_m:from]=40`
- **trojmiasto:** `https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4100,e1i,81_33_58_46_91_34_32_1_143_87_76_86_142_2_7_31_29_60_26_93,qi,40_.html`
- **otodom:** `https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/pomorskie/gdansk/gdansk/gdansk?limit=36&priceMax=4100&by=DEFAULT&direction=DESC`

## Cel

Pipeline portal-agnostyczny: każde źródło ma własny parser list+detail i własną
paginację, dyspozytor wybiera parser po hoście URL-a. Jeden etap obejmuje
rusztowanie (rejestr) + namespacing ID + kolumnę `source` + allow-listę SSRF +
parsery wszystkich trzech portali. Implementacja TDD, commity portal po portalu.

### Decyzje z brainstormingu

- **Rejestr źródeł per-host**, czyste funkcje parsujące (`(html) → dane`),
  testowalne na zapisanych fixtures (Approach A). Fetch zostaje wspólny,
  host-agnostyczny.
- **Namespacing externalId**: `trojmiasto:NNN`, `olx:<token>`, `otodom:<id>`.
  Istniejące wiersze migrowane (`NNN` → `trojmiasto:NNN`).
- **Kolumna `offers.source`** (`text NOT NULL DEFAULT 'trojmiasto'`).
- **UI**: badge źródła + filtr po portalu na dashboardzie. `Config.svelte` bez
  zmian funkcjonalnych (host-dispatch po wklejonym URL-u).
- **Anti-bot**: bez zmian — wszystkie trzy portale zwróciły HTTP 200 na istniejący
  browser-UA + `Accept-Language: pl`. `requestDelayMs` zostaje knobem politeness.

## Potwierdzony kształt danych (live fetch 2026-06-02)

Fetch na żywo (curl, browser-UA) — wszystkie HTTP 200, bez Cloudflare:

- **OLX** (lista, 3.6 MB HTML): natywne oferty to karty HTML z linkiem
  `href="/d/oferta/<slug>-ID<token>.html"` (relatywny) → externalId = `<token>`
  (np. `1aQOwN`). Pełny stan strony w `window.__PRERENDERED_STATE__`; jest też
  JSON-LD (`@type:Offer`). **Wynik wyszukiwania OLX zawiera też karty hostowane na
  otodom.pl** (`href="https://www.otodom.pl/..."`) — parser OLX MUSI je pomijać
  (bierzemy tylko natywne `/d/oferta/`), inaczej podwójny crawl. Paginacja `&page=N`.
- **Otodom** (lista, 1 MB HTML): Next.js — dane w `__NEXT_DATA__` JSON. Wpisy
  `AdvertListItem` mają `id` (numeryczne), `totalPrice.value`, `areaInSquareMeters`,
  `slug`, lokalizację. Brak scrapowania HTML; detail też przez `__NEXT_DATA__`.
  URL z slug → `https://www.otodom.pl/pl/oferta/<slug>`. Paginacja `&page=N`.
- **trojmiasto**: istniejący parser HTML, externalId z `-ogl(\d+).html`,
  paginacja `strona`.

Fixtures zapisane: `test/fixtures/{olx,otodom}-list.html` (surowe snapshoty;
zostaną przycięte do kilku kart w trakcie TDD; detail-fixtures dod. per portal).

## Architektura (Approach A — rejestr źródeł)

### Nowy moduł `src/scraper/sources/`

```
sources/
  types.ts        # Source, ListItem (z polem `source`), SourceId
  registry.ts     # SOURCES[], resolveSource(url), allowedHosts()
  trojmiasto.ts   # przeniesiona logika z parse.ts, owinięta jako Source
  olx.ts          # parseList z kart HTML + parseDetail z __PRERENDERED_STATE__/JSON-LD
  otodom.ts       # parseList + parseDetail z __NEXT_DATA__ JSON
```

### Interfejs `Source` (`types.ts`)

```ts
export type SourceId = "trojmiasto" | "olx" | "otodom";

export interface ListItem {
  externalId: string;   // już namespaced, np. "olx:1aQOwN"
  url: string;          // absolutny
  source: SourceId;
}

export interface OfferDetail { /* bez zmian: title, price, area, rooms, district, description, images */ }

export interface Source {
  id: SourceId;
  hosts: string[];                                   // do dispatch + allow-listy SSRF
  listPageUrls(searchUrl: string, pages: number): string[];
  parseList(html: string): ListItem[];               // externalId namespaced; url absolutny
  parseDetail(html: string): OfferDetail;
}
```

### `registry.ts`

- `SOURCES: Source[]` — trzy obiekty źródeł.
- `resolveSource(url): Source | null` — dopasowuje `new URL(url).hostname` do
  `source.hosts` (tolerancja bare/`www.`). `null` dla nieznanego hosta.
- `allowedHosts(): Set<string>` — płaski zbiór wszystkich hostów; **jedyne źródło
  prawdy** dla allow-listy SSRF w `validate.ts`.

### Zmiany w pipeline

`src/pipeline/check.ts` + `deps.ts`:

- `CheckDeps` traci `parseListUrls` i `parseDetail`; zyskuje
  `resolveSource: (url: string) => Source | null`. `fetchPage` zostaje.
- `runCheck`: dla każdego `searchUrl` → `const src = resolveSource(searchUrl)`
  (jeśli `null`: log `source.unknown` + skip), potem `src.listPageUrls(...)` i
  `src.parseList(html)`. Dedup-`Map` kluczuje po **namespaced** externalId →
  kolizje między portalami niemożliwe.
- `processOffer(item, ...)`: `resolveSource(item.url)` (lub po `item.source`) →
  `src.parseDetail`. Budowany `NewOffer` ustawia `externalId` (namespaced) i
  nowe pole `source: item.source`.

Każdy quirk portalu (filtr kart otodom w OLX, JSON Otodom, `strona` trojmiasto)
żyje w pliku źródła, za tymi samymi trzema czystymi metodami.

## Model danych + migracja

### Schema (`src/db/schema.ts`)

Dodanie kolumny do `offers`:

```ts
source: text("source").notNull().default("trojmiasto"),
```

`external_id` zachowuje `UNIQUE`; wartości stają się namespaced, więc kolizje
cross-portal nie występują. `NewOffer` zyskuje `source`.

### Migracja `drizzle/0004_multiportal.sql` (hand-authored)

drizzle-kit `generate` wymaga TTY — autorujemy ręcznie wg wzoru `0003`: SQL +
`drizzle/meta/0004_snapshot.json` + wpis w `drizzle/meta/_journal.json`.

```sql
ALTER TABLE "offers" ADD COLUMN "source" text NOT NULL DEFAULT 'trojmiasto';
UPDATE "offers" SET "external_id" = 'trojmiasto:' || "external_id"
  WHERE "external_id" NOT LIKE '%:%';
```

Guard `NOT LIKE '%:%'` czyni UPDATE re-run-safe (pomija już-namespaced ID).
**`make db-backup` przed zastosowaniem** (potwierdzić istnienie backupu — wcześniej
doszło do utraty danych testowych; patrz [[test-db-isolation]]).

### Kod operujący na ID (bez zmian funkcjonalnych)

- `getKnownExternalIds`, `markInactive`, `markNotified`, `upsertOffer`
  (onConflict `external_id`) — działają na namespaced stringu transparentnie.
- **Refresh**: `/api/offers/:id/refresh` + `buildRefreshDeps` używają pojedynczego
  `parseDetail`. Po zmianie muszą `resolveSource(offer.url)` (lub użyć `offer.source`)
  by wybrać właściwy parser detalu — wirowane w tym etapie, by refresh działał dla
  OLX/Otodom.

### Absolutyzacja URL

`parseList` zwraca URL absolutny: OLX `new URL(href, "https://www.olx.pl")`,
Otodom `https://www.otodom.pl/pl/oferta/<slug>`. trojmiasto już absolutny.

## Walidacja / SSRF (`src/api/validate.ts`)

- `ALLOWED_SEARCH_HOST` (pojedynczy const) → `allowedHosts()` z rejestru.
- Per-element: `if (!allowedHosts().has(u.hostname)) reject`. Dodanie portalu
  automatycznie rozszerza allow-listę.

## Fetch (`src/scraper/fetch.ts`)

Bez zmian. Wszystkie trzy portale: HTTP 200 na istniejący UA + `Accept-Language`.
`requestDelayMs` (już aplikowany per-fetch) zostaje knobem politeness/anti-bot.
Ewentualny 403/Cloudflare w przyszłości to izolowana zmiana `fetch.ts` — poza
zakresem (YAGNI).

## Web UI (`web/`)

- `web/lib/api.ts`: typ `Offer` zyskuje `source: string`.
- `web/Dashboard.svelte`: badge źródła na karcie (OLX / Otodom / trójmiasto,
  odrębne kolory wg dark glass [[web-ui-stack]]) + filtr (All / per-source),
  client-side nad już załadowanymi ofertami. Bez nowego parametru API (`source`
  jest w payloadzie oferty).
- `web/Config.svelte`: bez zmian funkcjonalnych; aktualizacja hintu
  („wklej linki wyszukiwań OLX / Otodom / trojmiasto"). Uwaga na perf glass
  [[glass-perf-gotcha]] przy badge/filtrze.

## Testy (TDD, PGlite)

- Każdy parser to czysta `(html) → dane`, testowana na fixture:
  `test/sources/<portal>.test.ts`.
- Fixtures: przyciąć `test/fixtures/{olx,otodom}-list.html` do kilku kart
  (zachować realną strukturę: OLX `__PRERENDERED_STATE__`/karty z **jedną**
  kartą otodom-cross-post do asercji że jest pomijana; Otodom `__NEXT_DATA__` z
  kilkoma `AdvertListItem`). Detail-fixture per portal z live fetch w kroku TDD
  danego portalu (`olx-detail.html`, `otodom-detail.html`; trojmiasto ma `detail.html`).
- Asercje per portal: `parseList` (liczba, namespaced ID, absolutne URL, OLX
  pomija otodom-cross-posty), `parseDetail` (title/price/area/rooms/district/images),
  `listPageUrls` (param paginacji `strona` vs `page`), `resolveSource` (dispatch po
  hoście), migracja (namespacing + idempotencja).
- Wszystko na PGlite. Guard `test/setup.ts` nietknięty. Zero sieci w testach
  [[test-db-isolation]].

## Kolejność budowy (commity na `feat/multi-portal`)

1. Rusztowanie rejestru: `types.ts` + `resolveSource`/`allowedHosts` + przeniesienie
   trojmiasto do `sources/trojmiasto.ts` (behavior-preserving; istniejące testy
   zielone; ID nadal bare na tym etapie).
2. Schema `source` + migracja `0004` (namespacing) + wpięcie
   `processOffer`/refresh w namespaced ID i `source`; pipeline na `resolveSource`.
   `make db-backup` przed migracją.
3. `validate.ts` → allow-lista z rejestru.
4. Źródło OLX + testy.
5. Źródło Otodom + testy.
6. Web UI: badge + filtr.
7. Pełna weryfikacja: `tsc --noEmit && bun test && bun run build`; smoke e2e w Dockerze.

## Poza zakresem (YAGNI)

- Cloudflare/anti-bot bypass, proxy, rotacja UA.
- Headless browser / render JS (wszystkie dane dostępne w surowym HTML/JSON).
- Filtr źródła po stronie API (filtr client-side wystarcza).
- Portale inne niż OLX/Otodom/trojmiasto (rejestr czyni to trywialnym później).
