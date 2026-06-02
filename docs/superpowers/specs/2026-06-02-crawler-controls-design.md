# Crawler Controls — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Cel

Rozszerzyć panel i pipeline o ręczną kontrolę crawlera oraz więcej parametrów
konfiguracji:

1. **Workers / współbieżność** — konfigurowalna liczba ofert przetwarzanych
   równolegle w jednym przebiegu (zamiast sekwencyjnej pętli).
2. **Więcej opcji konfiguracji** — górne granice filtrów, liczba stron listy,
   limit pobrań detali na przebieg, opóźnienie między żądaniami.
3. **Akcja „Uruchom crawler"** — przycisk w UI uruchamiający przebieg na żądanie.
4. **Akcja „Odśwież ofertę"** — przycisk per-oferta, który ponownie pobiera
   detal, parsuje i ocenia pojedynczą ofertę.

Decyzje podjęte w brainstormingu:
- Ustawienia współbieżności/wydajności żyją w **DB config** (edytowalne w UI).
- Akcje ręczne wykonują się **in-process w Bun API** (bez zależności od
  dostępności trigger.dev).
- Model współbieżności: **in-process bounded pool** (Option A) — jeden wspólny
  `runCheck` używany zarówno przez zadanie trigger.dev (scheduled), jak i przez
  ręczne uruchomienie w Bun API.

## Model współbieżności (Option A)

Sekwencyjna pętla `for` w `src/pipeline/check.ts` zostaje zastąpiona **ograniczoną
pulą roboczą** o rozmiarze `concurrencyLimit` (knob „workers" z DB config). Ten
sam `runCheck` działa identycznie:
- w workerze trigger.dev (scheduled co `*/5`),
- w procesie Bun API (ręczne uruchomienie).

Maszyna trigger.dev (`machine`) to właściwość infrastrukturalna — nie da się jej
sterować z DB, więc preset ustawiamy statycznie w `trigger.config.ts` z
komentarzem (zapas CPU na pracę równoległą). Odrzucony wariant B (fan-out do
zadań potomnych `process-offer`) wymagałby drugiego modelu wykonania, którego nie
da się użyć w ręcznym przebiegu in-process — sprzeczne z decyzją „in-process".

### Pula robocza

Mały helper (~15 linii), bez zależności zewnętrznych: przetwarza listę zadań
z maksymalnie N równoległymi „workerami", zachowując odporność na błędy
pojedynczego elementu (jak obecna pętla — błąd jednej oferty nie przerywa
przebiegu). Podpis koncepcyjny:

```
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void>
```

## Model danych — nowe pola `config`

Migracja Drizzle (`drizzle-kit generate` + `migrate`) dodaje do tabeli `config`:

| kolumna | typ | domyślnie | zakres walidacji |
|---|---|---|---|
| `max_area` | doublePrecision | null | 0–1e7 lub null |
| `max_rooms` | int | null | 0–1e7 lub null |
| `list_pages` | int | 1 | 1–10 |
| `max_detail_fetches_per_run` | int | 30 | 1–500 |
| `request_delay_ms` | int | 0 | 0–10000 |
| `concurrency_limit` | int | 1 | 1–16 |

Wszystkie dodane do listy `EDITABLE` i do walidacji w `src/api/validate.ts`
(całkowite, zakresowe; `max_area` jako nieujemna liczba lub null).

## Pipeline (`src/pipeline/`)

### `filter.ts`
`FilterBounds` zyskuje `maxArea`, `maxRooms`. `passesFilters` dokłada górne
granice:
- `maxArea != null && o.area != null && o.area > maxArea` → odrzuć,
- `maxRooms != null && o.rooms != null && o.rooms > maxRooms` → odrzuć.

### `check.ts`
- Wydzielić ciało pętli per-oferta do `processOffer(item, config, deps)` —
  zwraca wynik (`notified` / `filtered` / `error`), zachowując obecną izolację
  błędów (log + licznik, bez przerywania przebiegu).
- `runCheck`:
  1. Scrapuje `listPages` stron listy, scala i deduplikuje po `externalId`
     (`parseListUrls` już deduplikuje — scalanie jest bezpieczne).
  2. Dedupe względem znanych `externalId`.
  3. Ogranicza świeże oferty do `maxDetailFetchesPerRun`.
  4. Przetwarza świeże oferty przez **pulę** (`concurrencyLimit`), z
     `requestDelayMs` zastosowanym przed każdym pobraniem.
  5. `markInactive(activeIds)` jak dotychczas.
- Liczniki `notifiedCount` / `errorCount` agregowane z wyników puli (bezpieczne
  dla współbieżności — agregacja po zakończeniu, nie współdzielone mutowalne
  liczniki w trakcie).

### `requestDelayMs`
Opóźnienie stosowane przed każdym pobraniem strony w obrębie workera puli
(grzeczność wobec serwisu). Stron listy też dotyczy.

### `buildDeps(env, logger)`
Fabryka `deps` (obecnie inline w `trigger/check-offers.ts`) zostaje wydzielona do
współdzielonego modułu (np. `src/pipeline/deps.ts`) i używana przez:
- zadanie trigger.dev,
- Bun API (ręczne uruchomienie + odświeżenie oferty).

## Akcje ręczne (in-process, `src/api/server.ts`)

### `POST /api/run`
- Uruchamia `runCheck` in-process w trybie fire-and-forget.
- **Single-flight**: flaga w pamięci procesu; równoległe kliknięcie w trakcie
  trwającego przebiegu zwraca `409`.
- Zwraca `202` + `runId`; postęp widoczny na istniejącej stronie Logs (polling).

### `POST /api/offers/:externalId/refresh`
- Pobiera ponownie stronę detalu tej oferty, parsuje, ocenia (jeśli
  `deepseekEnabled`), `upsertOffer`, zwraca zaktualizowaną ofertę (synchronicznie).
- Walidacja `externalId` (tylko cyfry, zgodnie z `-ogl(\d+)\.html`).

## Panel UI (`web/`)

### `lib/api.ts`
- Rozszerzyć typ `Config` o nowe pola.
- `runCrawler(): Promise<{ runId: string }>` → `POST /api/run` (obsługa `409`).
- `refreshOffer(externalId): Promise<Offer>` → `POST /api/offers/:id/refresh`.

### `Dashboard.svelte`
- Przycisk **„Uruchom crawler"** w nagłówku: stan „uruchamianie…", toast wyniku,
  obsługa `409` („przebieg już trwa").
- Przycisk **odświeżania** per-oferta (karta i wiersz tabeli): re-score w miejscu,
  aktualizacja pojedynczej oferty w liście bez przeładowania całości.

### `Config.svelte`
- `maxArea`, `maxRooms` dołączone do fieldsetu **Filtry**.
- Nowy fieldset **„Wydajność"**: `concurrencyLimit`, `listPages`,
  `maxDetailFetchesPerRun`, `requestDelayMs` — w istniejącym stylu glass.

## Świadome decyzje / kompromisy

- **Współbieżność = pula in-process** (Option A), wspólna dla scheduled i ręcznego
  przebiegu; `machine` preset statycznie w `trigger.config.ts`.
- **Nakładanie przebiegów**: ręczny przebieg in-process i scheduled trigger.dev
  mogą się nałożyć (oba piszą do DB). Upserty są idempotentne; single-flight
  chroni tylko ręczny-vs-ręczny. Nakładanie ręczny-vs-scheduled akceptowane na
  teraz (bez blokady rozproszonej).
- `maxDetailFetchesPerRun` ogranicza koszt (pobrania detali + AI) per przebieg.
- Akcje ręczne in-process → brak zależności od `TRIGGER_SECRET_KEY` i dostępności
  trigger.dev.

## Otwarta niewiadoma

- **Format URL paginacji listy** trojmiasto (query param vs segment ścieżki) nie
  jest znany z kodu — wymaga sprawdzenia strony nr 2 przy implementacji. Logika
  scalania/dedupe jest niezależna od formatu; zależna jest tylko konstrukcja URL
  kolejnych stron. Jedyne ryzyko badawcze.

## Poza zakresem (YAGNI)

- Fan-out do zadań potomnych trigger.dev (Option B).
- Blokada rozproszona przeciw nakładaniu przebiegów ręczny-vs-scheduled.
- Kolejka/historia uruchomień ręcznych (poza istniejącymi logami).
- Query-builder filtrów trojmiasto (jak w pierwotnym spec).
