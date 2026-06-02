# Logs Page — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Cel

Dodać stronę **Logs** — surowy, dopisywany (append-only) strumień zdarzeń z
pipeline'u sprawdzania ofert. Obecnie `runCheck` zwraca `CheckSummary`, a
trigger.dev jedynie loguje go do swojej konsoli — nic nie trafia do bazy i nie
da się tego podejrzeć w UI. Strona Logs ma dać wgląd „czy monitor żyje", co woła
na zewnątrz i co się wywala.

Decyzje podjęte podczas brainstormingu:

- **Typ logu:** surowy, append-only strumień zdarzeń (DB-backed), nie historia
  przebiegów ani widok pochodny z tabeli `offers`.
- **Granularność zdarzeń:** start/koniec przebiegu, błędy/awarie, wywołania
  zewnętrzne (fetch, DeepSeek scoring, Apprise). **Bez** logowania sukcesów
  per-oferta.
- **Nawigacja:** przełącznik w nagłówku (Dashboard ↔ Logs). Bez routera.
- **Retencja:** okno czasowe — trzymamy ostatnie **7 dni**, starsze przycinamy.
- **Odświeżanie:** auto-poll co ~5 s, gdy widok Logs jest otwarty.

## Model danych — nowa tabela `logs`

```
id        serial PK
ts        timestamptz   default now()
run_id    text          -- grupuje wpisy z jednego przebiegu (subtelny dzielnik w UI)
level     text          -- 'info' | 'warn' | 'error'
event     text          -- kod maszynowy: run.start, run.finish, fetch, score, notify, offer.error, run.error
message   text          -- linia czytelna dla człowieka
context   jsonb         -- opcjonalnie: { externalId, url, durationMs, counts, error }
```

- Indeks na `ts` (sortowanie + przycinanie).
- `context` jako `jsonb` — strumień jest ustrukturyzowany bez sztywnych kolumn.
- Drizzle: `jsonb("context")`, `text("level")` itd. — zgodnie z istniejącym
  `schema.ts`.

## Warstwa logowania (główna decyzja architektoniczna)

Rozważone warianty:

1. **Przechwytywanie `console.*`** — odrzucone: kruche, gubi strukturę, łapie
   niepowiązany szum.
2. **Ręczne wołania `log()` w całym `runCheck`** — jawne, ale zaśmieca pipeline
   i wiąże go z każdym wywołaniem zewnętrznym.
3. **✅ Wybrane — wstrzykiwany `Logger` + dekorowane zależności.** Mały interfejs
   `Logger` dodany do `CheckDeps`. `runCheck` emituje tylko `run.start` /
   `run.finish` / `offer.error` / `run.error` (zastępując istniejące
   `console.error`). Zdarzenia **wywołań zewnętrznych** (`fetch`, `score`,
   `notify`) pochodzą z dekoratora `withLogging(deps, logger)` nałożonego w
   miejscu kompozycji (zadanie trigger.dev), opakowującego
   `fetchPage` / `scoreOffer` / `sendNotification` tak, by logowały przy
   wywołaniu i przy błędzie, z czasem trwania.

To utrzymuje logikę `runCheck` niemal nietkniętą, automatycznie łapie wywołania
zewnętrzne i pozostaje w pełni testowalne przez wstrzyknięty fałszywy logger.

### `run_id` i bezpieczeństwo logowania

- Logger jest **run-scoped**: w miejscu kompozycji powstaje logger, który stempluje
  wspólny `run_id` (`crypto.randomUUID()`) na każdym wpisie, dzięki czemu wszystkie
  wpisy z jednego przebiegu grupują się razem. Ten sam logger trafia do `runCheck`
  (jako dep `log`) i do dekorowanych zależności.
- **Zapis logu nigdy nie rzuca.** `dbLogger` łapie własne błędy DB
  (`console.error` + dalej), żeby logowanie nie mogło wywrócić przebiegu.

## Persystencja i retencja

Nowe zapytania w `src/db/queries.ts`:

- `appendLog(entry)` — wstawia jeden wiersz.
- `pruneLogs()` — usuwa `ts < now() - interval '7 days'`; wołane **raz na
  przebieg** przy `run.finish` (nie przy każdym insercie).
- `listLogs({ limit })` — zwraca najnowsze najpierw, limit ~300.

## API

`GET /api/logs?limit=300` → tablica wpisów (najnowsze najpierw). Klient co 5 s
pobiera najnowszą paczkę i podmienia listę (prosto, bez logiki scalania; lista
jest ograniczona). Endpoint dopisany w `src/api/server.ts` obok istniejących
`/api/offers` i `/api/config`.

## Web UI — `web/Logs.svelte` + nawigacja w `App.svelte`

- **`App.svelte`**: dodać stan `view: 'dashboard' | 'logs'` i przełącznik w
  nagłówku (dwa pill-buttony w istniejącym stylu glass). Config zostaje modalem.
- **`Logs.svelte`**: lista odwrotnie-chronologiczna w dark liquid-glass.
  Wiersz: znacznik czasu · kropka poziomu (kolor info/warn/error) · chip zdarzenia
  · message. Cienki dzielnik tam, gdzie zmienia się `run_id`. Filtr poziomu
  (All / Errors) jako rząd chipów — tani, wysokowartościowy dla podglądu logów —
  oraz stan pusty. Auto-poll co 5 s, gdy zamontowany; czyści interwał przy
  unmount. Korzysta z tokenów `text-good` / `text-bad` z istniejącego design
  systemu.
- **`web/lib/api.ts`**: dodać interfejs `LogEntry` + `getLogs()`.

## Testy

- `test/queries.test.ts`: `appendLog` / `listLogs` (kolejność + limit) /
  `pruneLogs` (okno czasowe).
- Nowy `test/logger.test.ts`: `withLogging` emituje poprawne wpisy przy sukcesie
  i przy rzuconym błędzie; błędy loggera są połykane.
- `test/check.test.ts`: wstrzyknąć fałszywy logger, sprawdzić emisję
  `run.start` / `run.finish` / `offer.error` (domyślny no-op logger w `makeDeps`).
- `test/api.test.ts`: `GET /api/logs` zwraca wstawione wpisy najnowsze-najpierw.

## Zakres (YAGNI)

Wyłączone: logowanie sukcesów per-oferta, live streaming po WebSocket,
filtrowanie poziomu po stronie serwera, wyszukiwanie w logach, ręczne wyzwalanie
przebiegu. Do dodania później.
