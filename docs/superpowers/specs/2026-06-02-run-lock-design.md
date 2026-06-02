# Cross-Process Run Lock — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Cel

Zapobiec **nakładaniu się przebiegów crawlera** uruchamianych z dwóch różnych
procesów, które współdzielą wyłącznie Postgresa:
- ręczny przebieg in-process w Bun API (`POST /api/run`),
- zaplanowany przebieg w workerze trigger.dev (`*/5`).

Obecna flaga `runInFlight` żyje w pamięci pojedynczego procesu (domknięcie
`createServer`) i nie widzi przebiegu w drugim procesie. Bez współdzielonej
blokady ręczny i zaplanowany przebieg mogą działać równocześnie — oba piszą do
bazy, a dwa równoległe `markInactive` mogą się ścigać.

Decyzje z brainstormingu:
- **Mechanizm:** wiersz-dzierżawa (lease) w Postgresie ze **stale timeout** —
  bez heartbeatu; przebieg po awarii samoczynnie wygasa po przekroczeniu limitu.
- **Kolizja:** ręczny → `409`; zaplanowany → pomiń + zaloguj (`run.skipped`),
  bez błędu.

## Model danych — tabela `run_lock`

Pojedynczy wiersz (`id = 1`):

| kolumna | typ | uwagi |
|---|---|---|
| `id` | integer PK default 1 | zawsze 1 |
| `holder` | text, nullable | `runId` aktualnego posiadacza; `NULL` gdy wolna |
| `source` | text, nullable | `"manual"` / `"scheduled"` — obserwowalność |
| `acquired_at` | timestamptz, nullable | moment zajęcia |

Migracja Drizzle (`db:generate` + `db:push` — jak w poprzedniej iteracji, brak
łańcucha migracji w repo).

## Atomowe zajęcie / zwolnienie

**Zajęcie** — jedno zdanie SQL, samoinicjujące wiersz, odporne na wyścig (konflikt
zakłada blokadę wiersza, więc dwóch równoległych nie wygra naraz):

```sql
INSERT INTO run_lock (id, holder, source, acquired_at)
VALUES (1, $holder, $source, now())
ON CONFLICT (id) DO UPDATE
  SET holder = $holder, source = $source, acquired_at = now()
  WHERE run_lock.holder IS NULL
     OR run_lock.acquired_at < now() - make_interval(secs => $staleSeconds)
RETURNING holder;
```

- Wolna lub wygasła → `UPDATE`/`INSERT` wykonany → 1 wiersz w `RETURNING` →
  **zajęte**.
- Zajęta i świeża → `WHERE` fałszywe, `UPDATE` pominięty, konflikt `INSERT`
  niczego nie wstawia → 0 wierszy → **niezajęte**.
- Pierwsze wywołanie → `INSERT` bez konfliktu → zajęte.

`acquireRunLock` zwraca `boolean` = `rows.length === 1`.

**Zwolnienie** — tylko jeśli wciąż jesteśmy posiadaczem (gdyby dzierżawa wygasła
i ktoś ją przejął, nie zwalniamy cudzej):

```sql
UPDATE run_lock SET holder = NULL, source = NULL WHERE id = 1 AND holder = $holder;
```

**Stale timeout:** `RUN_LOCK_STALE_MS = 15 * 60 * 1000` (15 min). Musi przekraczać
najdłuższy możliwy przebieg (trigger.dev `maxDuration = 300 s`) z zapasem. Bez
heartbeatu — świadomy kompromis (YAGNI przy tak krótkim `maxDuration`).

## Komponenty

### `src/db/queries.ts`
- `acquireRunLock(holder: string, source: string, staleMs: number): Promise<boolean>`
- `releaseRunLock(holder: string): Promise<void>`

Implementacja przez `db.execute(sql\`…\`)` (drizzle raw `sql`), bo `ON CONFLICT …
WHERE` jest niewygodne w builderze. `staleMs` przekazywany do SQL jako sekundy
(`make_interval(secs => $1)`), `staleSeconds = staleMs / 1000`.

### `src/pipeline/run-lock.ts`
```ts
export const RUN_LOCK_STALE_MS = 15 * 60 * 1000;

export async function withRunLock<T>(
  holder: string, source: string, fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }>;
```
Zajmij; jeśli nie udało się → `{ ran: false }`. W przeciwnym razie `try { result =
await fn() } finally { releaseRunLock(holder) }` → `{ ran: true, result }`.

## Miejsca wywołania

### Zaplanowany (`trigger/check-offers.ts`)
Owinąć `runCheck` w `withRunLock(runId, "scheduled", () => runCheck(deps))`:
- `ran === false` → `logger.log({ level: "info", event: "run.skipped",
  message: "skipped: another run in progress" })`, `triggerLogger.info(...)`,
  zwróć `{ skipped: true }`.
- `ran === true` → zwróć `outcome.result` (dotychczasowe `summary`).
- `pruneLogs()` pozostaje w **zewnętrznym** `finally` (retencja działa też przy
  pominięciu — nieszkodliwe).

### Ręczny (`src/api/server.ts`)
- `defaultRunCrawler` staje się **async** i najpierw woła `acquireRunLock(runId,
  "manual", RUN_LOCK_STALE_MS)`:
  - nie zajęto → zwróć `{ busy: true }`.
  - zajęto → odpal `runCheck` w tle (fire-and-forget); `done` zwalnia blokadę:
    `runCheck(...).catch(log).finally(() => releaseRunLock(runId))`. Zwróć
    `{ runId, done }`.
- Typ opcji: `runCrawler?: () => Promise<{ runId: string; done: Promise<void> }
  | { busy: true }>`.
- Trasa `POST /api/run`:
  ```ts
  const r = await runCrawler();
  if ("busy" in r) return json({ error: "a run is already in progress" }, 409);
  return json({ runId: r.runId }, 202);
  ```
- **Usuwamy flagę `runInFlight`** z `createServer` — dzierżawa DB jest jedynym
  źródłem prawdy i obsługuje także ręczny-vs-ręczny (drugie kliknięcie nie zajmie
  zajętej blokady → 409).

## Świadomie bez zmian

- **`refreshOffer` bez blokady** — to operacja na pojedynczej ofercie, nie pełny
  crawl. Równoległy crawl dotykający tej samej oferty po prostu idempotentnie
  nadpisuje (`upsertOffer`). Blokowanie niepotrzebnie serializowałoby przycisk
  odświeżania względem przebiegów.

## Obsługa błędów / kompromisy

- Restart procesu Bun API w trakcie przebiegu → wiersz pozostaje zajęty do
  wygaśnięcia (15 min), potem samoczynnie wolny. Akceptowalne.
- Brak heartbeatu: przebieg dłuższy niż 15 min zostałby uznany za martwy i mógłby
  zostać przejęty równolegle. Niemożliwe przy `maxDuration = 300 s`; gdyby limit
  wzrósł, podnieść `RUN_LOCK_STALE_MS`.
- `release` warunkowy (`AND holder = $holder`) chroni przed zwolnieniem cudzej
  dzierżawy po wygaśnięciu.

## Testy

- `test/run-lock.test.ts` (DB):
  - zajęcie wolnej → `true`; drugie zajęcie → `false`; zwolnienie → ponowne
    zajęcie `true`.
  - wygasła dzierżawa (mały `staleMs`, odczekać) → ponownie zajmowalna.
  - `withRunLock`: woła `fn` gdy wolna i zwalnia po (kolejne `withRunLock` przejdzie);
    `{ ran: false }` gdy zajęta, bez wołania `fn`.
- `test/api.test.ts`: wstrzyknięty `runCrawler` zwracający `{ busy: true }` → `409`;
  normalny → `202` + `runId`. Aktualizacja istniejącego faka do nowego (async) typu.
- `test/queries.test.ts` może hostować testy zajęcia/zwolnienia zamiast osobnego
  pliku — dopuszczalne; preferowany osobny `run-lock.test.ts`.

## Poza zakresem (YAGNI)

- Heartbeat / odnawianie dzierżawy w trakcie przebiegu.
- Kolejkowanie/oczekiwanie na blokadę (wybrano pomiń/409).
- Blokada dla `refreshOffer`.
- Zaawansowane statusy przebiegu (poza logami `run.start`/`run.finish`/`run.skipped`).
