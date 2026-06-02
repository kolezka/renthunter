# Offer Details, Photos & Scoring Summary — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Cel

Wzbogacić panel ofert o:
1. **Więcej szczegółów w tabeli** — kolumny: miniatura zdjęcia, skrót uzasadnienia
   AI, daty (`firstSeen` „X dni temu" + `lastSeen`), odznaka powiadomienia.
2. **Podgląd zdjęć** — miniatura na liście, pełna galeria w szczegółach.
3. **Widok szczegółów oferty** — modal z galerią, pełnymi danymi i
   **podsumowaniem scoringu** (score + tier + `scoreReasons`).

Decyzje z brainstormingu: modal (nie routing), galeria wielu zdjęć (z detalu),
kolumny: miniatura + AI(skrót) + daty + powiadomienie.

## Model danych — `offers.images`

Nowa kolumna `images` typu `text[] NOT NULL DEFAULT '{}'` (lista URLi zdjęć).
Migracja Drizzle (`db:generate` + `db:push`). Istniejące oferty: `[]` →
placeholder, dopóki nie zostaną odświeżone/przecrawlowane.

## Scraper (`src/scraper/parse.ts`)

`OfferDetail` zyskuje `images: string[]`. `parseDetail` wyciąga zdjęcia:
- **Źródło główne:** JSON-LD `image` (tablica URLi stringów — potwierdzone w
  fixture).
- **Fallback:** `og:image` (pojedyncze) gdy JSON-LD nie ma tablicy.
- Dedup (`Set`) + limit 12.

Lista (`parseListUrls`) bez zmian — galeria pochodzi z detalu.

## Zapis (`src/db/queries.ts`, pipeline)

- `upsertOffer`: w `onConflictDoUpdate` dochodzi `images: o.images ?? sql\`${offers.images}\``
  (zachowaj istniejące, jeśli brak nowych). Insert bierze `images` z `...o`.
- `NewOffer` (z `$inferInsert`) automatycznie zawiera `images`.
- `processOffer` (`check.ts`) i `refreshOffer` (`refresh.ts`): do budowanego
  `NewOffer` dochodzi `images: d.images`. Dzięki temu przycisk **Odśwież**
  backfilluje zdjęcia istniejących ofert.

## API

Bez nowego endpointu. `listOffers` (`select *`) zwróci `images`. Modal szczegółów
korzysta z obiektu oferty już załadowanego przez `/api/offers` (ma `description`,
`scoreReasons`, `images`). Świadomy kompromis: payload listy rośnie; przy obecnej
skali OK — osobny endpoint detalu = YAGNI.

## UI (`web/`)

### `lib/api.ts`
Typ `Offer` zyskuje `images: string[]` oraz `description: string | null`.

### `OfferDetail.svelte` (nowy)
Props: `offer: Offer`, `onClose: () => void`, `onRefresh: (o) => void`.
Zawartość:
- **Galeria:** główne zdjęcie + pasek miniatur, prev/next, kropki; placeholder gdy
  `images` puste lub błąd ładowania (`onerror`).
- Tytuł, cena, m²/pokoje/dzielnica (te same „tagi" co na kartach).
- **Podsumowanie scoringu:** duży `score` w kolorze tier (good/mid/bad/none),
  etykieta tier, pełny tekst `scoreReasons`. Gdy `score == null` → „brak oceny".
- Pełny `description`.
- Link „Otwórz w trojmiasto", przycisk **Odśwież** (re-score), data first/last seen.

### Szkielet modala (WAŻNE — perf glassu)
Modal szczegółów **reużywa wzorca modala Konfiguracji z `App.svelte`**: jedna
warstwa `backdrop-filter` na kontenerze + przełączenie klasy `modal-open` na
`documentElement` (zatrzymuje animację aurory) + blokada scrolla. To znany gotcha:
stackowanie blura nad animowaną aurorą powoduje lag — reuse wzorca go unika.
Selekcja oferty i render modala mogą żyć w `Dashboard.svelte` (stan
`selected: Offer | null`) lub być podniesione do `App.svelte`; wybór: trzymać w
`Dashboard.svelte` i tam montować `OfferDetail`, z tym samym mechanizmem
`modal-open`/scroll-lock co `App.svelte`.

### `Dashboard.svelte`
- **Stan:** `selected: Offer | null`; `openDetail(o)`, `closeDetail()`.
- **Tabela — nowe kolumny:** miniatura (pierwsze zdjęcie / placeholder), AI
  (skrót `scoreReasons`, np. `line-clamp`/truncate + `title`), daty (`firstSeen`
  jako „X dni temu", `lastSeen` mniejsze/szare), powiadomienie (odznaka
  „powiadomiono"/„—"). Klik w wiersz → `openDetail(o)` (link „otwórz ↗" zostaje,
  `stopPropagation`).
- **Karty:** miniatura u góry karty; klik w kartę → `openDetail(o)` (istniejące
  przyciski Odśwież/Otwórz: `stopPropagation`).
- Helper `relativeDate(iso)` → „dziś"/„X dni temu" (pl).
- Obrazy: `loading="lazy"`, `onerror` → placeholder.

## Testy

- `test/parse-detail.test.ts`: `parseDetail(detail.html).images` zawiera wiele
  URLi z JSON-LD; osobny przypadek — HTML tylko z `og:image` → 1 element.
- `test/check.test.ts` / `test/refresh.test.ts`: `images` z `parseDetail`
  trafiają do `upsertOffer` (asercja na przekazanym obiekcie).
- Web: `bunx tsc --noEmit` + `bun run build` kompilują; wizualny check.

## Świadome decyzje / kompromisy

- Galeria parsowana tylko z detalu (mniej zmian; lista i tak pobiera detal nowych).
- Modal zamiast routingu (spójne z Konfiguracją, bez routera).
- Backfill zdjęć przez Odśwież/kolejny crawl. Uwaga: live crawl jest obecnie
  blokowany 403 — zdjęcia pojawią się po rozwiązaniu tego (browserless, osobny
  temat) lub po Odśwież.
- Modal reużywa istniejącego scroll-lock + `modal-open` (perf aurory).

## Poza zakresem (YAGNI)

- Routing/deep-link do oferty.
- Osobny endpoint `/api/offers/:id` (detal).
- Pobieranie/cache'owanie zdjęć po stronie serwera (linkujemy do `s-trojmiasto.pl`).
- Strukturalny scoring (rozbicie na kryteria) — pokazujemy istniejący tekst.
- Lightbox/zoom zdjęć, lazy-loading galerii poza `loading="lazy"`.
