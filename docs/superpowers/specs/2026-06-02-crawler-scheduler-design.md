# Crawler Scheduler (in-process) — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Problem

Automatyczne uruchamianie crawlera nie działa w stacku Docker. Harmonogram żyje
**wyłącznie** w trigger.dev (`trigger/check-offers.ts`, cron `*/5 * * * *`), który
odpala się tylko gdy na hoście ręcznie działa `bunx trigger.dev dev`. Stack dev
(`docker-compose.dev.yml`) nie ma workera trigger.dev, więc w Dockerze nic nie
wyzwala crawla — działa tylko ręczny przycisk („Uruchom crawler" → `POST /api/run`).

Pole `pollIntervalMin` istnieje w DB, jest walidowane i ma input w panelu
(„Interwał (min)"), ale **nie jest nigdzie używane** — nie steruje harmonogramem.

Produkcja (`docker-compose.prod.yml`) już zrezygnowała z trigger.dev na rzecz
self-contained sidecara `scheduler` (kontener `curl` → `POST /api/run` co
`CRAWL_INTERVAL_MIN` minut), zabezpieczonego międzyprocesową blokadą w DB
(`acquireRunLock` / `withRunLock`). Interwał bierze się tam z env-vara, nie z UI.

## Cel

Jeden spójny, self-contained mechanizm harmonogramu **w procesie Bun**, sterowany
polem `pollIntervalMin` z DB (edytowalnym w UI), działający identycznie w dev i
prod, bez zależności od trigger.dev ani sidecara. `pollIntervalMin = 0` wyłącza
automatyczne przebiegi (przycisk ręczny działa nadal).

Decyzje z brainstormingu:
- Harmonogram **w procesie Bun** (nie trigger.dev, nie sidecar curl).
- Interwał z **DB/UI** (`pollIntervalMin`), zmiana działa na żywo (następny cykl).
- **trigger.dev usuwany całkowicie** (martwy kod po tej zmianie).
- **`pollIntervalMin = 0` = wyłączony** auto-crawl.

## Architektura

### Nowy moduł `src/pipeline/scheduler.ts`

Pętla **samoplanująca** (łańcuch `setTimeout`, nie `setInterval`):

1. Odczytaj `pollIntervalMin` z DB (`getConfig`).
2. Jeśli `<= 0` → zaplanuj samo ponowne sprawdzenie configu za stały `IDLE_RECHECK_MS`
   (np. 60 s), bez uruchamiania crawla. Dzięki temu włączenie z UI (zmiana 0 → N)
   zostaje podchwycone bez restartu apki.
3. W przeciwnym razie ustaw `setTimeout` na `pollIntervalMin × 60_000 ms`.
4. Po wybudzeniu: odpal lock-guarded run (source `"scheduled"`). Jeśli lock zajęty
   (trwa ręczny lub inny przebieg) → pomiń ten cykl (log `run.skipped`), bez błędu.
5. Po zakończeniu (lub pominięciu) zaplanuj kolejny cykl — **ponownie czytając
   config**, więc zmiana interwału / wyłączenie w UI działa od następnego cyklu.

Samoplanowanie zamiast stałego `setInterval` gwarantuje brak nakładania przebiegów
i podchwytuje zmianę interwału na żywo. **Pierwszy przebieg po jednym interwale**
(nie na starcie procesu) — inaczej `bun --hot` w dev odpalałby crawl przy każdej
edycji kodu, a każdy restart kontenera od razu hamerowałby serwis.

#### Granica i testowalność

`startScheduler(deps)` zwraca funkcję `stop()` (czyści bieżący timer, ustawia flagę
zatrzymania). Zależności wstrzykiwane dla testów:

```
interface SchedulerDeps {
  getConfig: () => Promise<Config>;          // czyta pollIntervalMin
  runGuarded: () => Promise<{ ran: boolean }>; // withRunLock(runCheck), source "scheduled"
  setTimer: (fn: () => void, ms: number) => Timer; // domyślnie setTimeout
  clearTimer: (t: Timer) => void;                  // domyślnie clearTimeout
  log: Logger;
}
```

Logika decyzyjna wydzielona jako czysta funkcja:
`nextDelayMs(pollIntervalMin): { delayMs: number; willRun: boolean }`
— `pollIntervalMin <= 0 → { IDLE_RECHECK_MS, false }`, w innym razie
`{ pollIntervalMin*60000, true }`. Testowana wprost, bez timerów.

### Współdzielony helper „lock-guarded run"

Dziś `defaultRunCrawler` w `src/api/server.ts` robi: `acquireRunLock(runId,
"manual", …)` → `runCheck(buildCheckDeps(...))` → `releaseRunLock`. Wydzielam tę
logikę do współdzielonej funkcji `runCrawlGuarded(env, source)` w
`src/pipeline/deps.ts` (tam już żyje kompozycja deps), parametryzowanej przez
`source`. Używają jej:
- `/api/run` (source `"manual"`) — zachowuje obecne `202` / `409 busy`,
- scheduler (source `"scheduled"`).

Zero duplikacji logiki budowania deps i blokady.

### Integracja w `src/api/server.ts`

W bloku `if (import.meta.main)` (jedyny prawdziwy start serwera; testy używają
`createServer` i **nie** odpalają schedulera) po `ensureConfig` i `createServer`:

```
const stop = startScheduler(buildSchedulerDeps(env));
```

Zabezpieczenie przed podwójnym startem przy `bun --hot`: poprzedni `stop`
przechowywany na `globalThis` i wywołany przed startem nowego (hot-reload
re-ewaluuje moduł, proces żyje dalej — bez tego mnożylibyśmy timery).

## Konfiguracja / walidacja

- `src/api/validate.ts`: zakres `pollIntervalMin` zmieniany z `1–1440` na
  **`0–1440`** (0 = wyłączony). Komunikat błędu zaktualizowany.
- `web/Config.svelte`: input „Interwał (min)" — `min="1"` → `min="0"`, dopisek/hint
  „0 = wyłączony" (krótki tekst pomocniczy w istniejącym stylu).
- Schema DB: bez zmian — `pollIntervalMin` już istnieje (default 5).

## Usunięcie trigger.dev

- Skasować `trigger/check-offers.ts` i `trigger.config.ts` (oraz katalog `trigger/`).
- `package.json`: usunąć zależność `@trigger.dev/sdk` oraz skrypty `trigger:dev`,
  `trigger:deploy`. Uruchomić `bun install`, by zaktualizować lockfile.
- `Makefile`: usunąć target `trigger-dev` (i wpis z listy `.PHONY`).
- Sprawdzić brak innych importów `@trigger.dev/*` po usunięciu (grep).

## Docker

- **dev** (`docker-compose.dev.yml`): **bez zmian**. Scheduler żyje w procesie
  aplikacji uruchamianej przez `bun run dev`, więc samo `up` daje automatyczny
  crawl. To rozwiązuje zgłoszony problem.
- **prod** (`docker-compose.prod.yml`): usunąć serwis `scheduler` (curl) i env
  `CRAWL_INTERVAL_MIN`. Harmonogram zapewnia teraz proces aplikacji; interwał
  z DB/UI. Zaktualizować komentarz nagłówkowy (nadal „self-contained, no cloud").

## Testy

`test/scheduler.test.ts`:
- `nextDelayMs(0)` → `willRun: false`, `delayMs == IDLE_RECHECK_MS`.
- `nextDelayMs(5)` → `willRun: true`, `delayMs == 300000`.
- tick z wstrzykniętym `runGuarded`: gdy interwał > 0 i timer wybudzony → woła
  `runGuarded` raz, potem planuje kolejny (sprawdzić przez fake `setTimer`).
- tick gdy `runGuarded` zwraca `{ ran: false }` (lock zajęty) → brak błędu, kolejny
  cykl zaplanowany.
- `stop()` → kolejny cykl nie jest planowany (fake `setTimer` nie wywoływany ponownie).

Istniejące testy (`test/api.test.ts`) nie ruszane — `createServer` nadal nie odpala
schedulera; wstrzyknięte fejki `runCrawler` działają jak dziś.

## Świadome decyzje / kompromisy

- **Zmiana interwału działa od następnego cyklu**, nie natychmiast (re-read configu
  na końcu cyklu). Dla idle (0) re-check co `IDLE_RECHECK_MS` ogranicza opóźnienie
  włączenia. Prostsze niż natychmiastowy reset timera przy zapisie configu —
  bez sprzęgania `/api/config` ze schedulerem.
- **Nakładanie ręczny-vs-scheduled** chronione istniejącą blokadą w DB
  (`withRunLock`); upserty i tak idempotentne. Bez zmian względem dziś.
- **Pierwszy przebieg po interwale** (nie na starcie) — bezpieczne dla `bun --hot`
  i restartów kontenera.

## Poza zakresem (YAGNI)

- Pełny cron / okna godzinowe w UI (wybrano model „co N minut").
- Natychmiastowy reset timera przy zapisie configu (wystarczy następny cykl).
- Osobna kolumna `schedulerEnabled` (wykorzystujemy `pollIntervalMin = 0`).
- Powrót do trigger.dev / dynamiczne harmonogramy SDK.
