# Trójmiasto Wynajem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbierać oferty najmu z ogłoszenia.trojmiasto.pl, śledzić nowe, oceniać je (twarde filtry + AI scoring DeepSeek) i powiadamiać przez Apprise; konfiguracja przez panel Svelte.

**Architecture:** Jedno repo Bun. Współdzielone moduły TS (`src/db`, `src/scraper`, `src/scorer`, `src/notify`, `src/pipeline`) używane przez Bun API (`src/api`) oraz zadanie trigger.dev (`trigger/`). Postgres przez Drizzle ORM (`drizzle-orm/bun-sql`). Frontend Svelte SPA budowany bundlerem Bun (`bun-plugin-svelte`), serwowany przez Bun.serve. Apprise i Postgres w `docker-compose`.

**Tech Stack:** Bun, TypeScript, Drizzle ORM + drizzle-kit, PostgreSQL, HTMLRewriter (scraping), DeepSeek API (`deepseek-chat`), trigger.dev v3, Apprise (kontener `caronc/apprise`), Svelte 5 + `bun-plugin-svelte`.

**Spec:** `docs/superpowers/specs/2026-06-01-trojmiasto-wynajem-design.md`

---

## File Structure

```
bunfig.toml                     # rejestracja bun-plugin-svelte dla dev servera
drizzle.config.ts               # konfiguracja drizzle-kit
docker-compose.yml              # db (postgres), apprise
Dockerfile                      # obraz aplikacji (Bun API + statyczny build SPA)
trigger.config.ts               # konfiguracja trigger.dev
.env.example                    # szablon zmiennych środowiskowych
src/
  config.ts                     # odczyt zmiennych środowiskowych (DATABASE_URL, DEEPSEEK_API_KEY, APPRISE_URL...)
  db/
    schema.ts                   # Drizzle: tabele offers, config
    client.ts                   # instancja drizzle (bun-sql)
    queries.ts                  # ensureConfig, getConfig, updateConfig, listOffers, getKnownExternalIds, upsertOffer, markNotified, markInactive
  scraper/
    parse.ts                    # extractExternalId, parseListUrls, parseDetail
    fetch.ts                    # fetchPage (HTTP GET z nagłówkami przeglądarki)
  scorer/
    deepseek.ts                 # scoreOffer(description, criteria) -> { score, reasons }
  notify/
    apprise.ts                  # sendNotification(appriseUrl, targets, title, body)
  pipeline/
    check.ts                    # runCheck(deps) -> orkiestracja: scrape -> dedupe -> detail -> filter -> score -> notify
    filter.ts                   # passesFilters(offer, config)
  api/
    server.ts                   # Bun.serve: /api/offers, /api/config, statyczny build SPA
trigger/
  check-offers.ts               # schedules.task owijający runCheck
web/
  index.html                    # entry SPA
  main.ts                       # montaż Svelte
  App.svelte                    # router (Dashboard / Config)
  lib/api.ts                    # klient fetch do /api/*
  Dashboard.svelte              # tabela ofert
  Config.svelte                 # formularz konfiguracji
  build.ts                      # Bun.build SPA -> web/dist
test/
  fixtures/list.html            # zrzut realnej strony listy
  fixtures/detail.html          # zrzut realnej strony oferty
  *.test.ts
```

---

## Task 1: Zależności, env, bunfig

**Files:**
- Modify: `package.json`
- Create: `bunfig.toml`
- Create: `.env.example`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Zainstaluj zależności**

```bash
bun add drizzle-orm
bun add -d drizzle-kit
bun add @trigger.dev/sdk
bun add svelte bun-plugin-svelte
```

Expected: wszystkie pakiety instalują się bez błędu. Jeśli `bun-plugin-svelte` się nie zainstaluje, zatrzymaj się i zgłoś — reszta planu (UI) zależy od niego.

- [ ] **Step 2: Utwórz `bunfig.toml`**

```toml
[serve.static]
plugins = ["bun-plugin-svelte"]
```

- [ ] **Step 3: Utwórz `.env.example`**

```bash
DATABASE_URL=postgres://wynajem:wynajem@localhost:5432/wynajem
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
APPRISE_URL=http://localhost:8000
PORT=3000
```

Skopiuj do realnego `.env`: `cp .env.example .env` i uzupełnij `DEEPSEEK_API_KEY`. (`.env` jest w `.gitignore`.)

- [ ] **Step 4: Napisz test dla `src/config.ts`**

```ts
// test/config.test.ts
import { test, expect } from "bun:test";
import { loadConfig } from "../src/config";

test("loadConfig reads required env vars", () => {
  const cfg = loadConfig({
    DATABASE_URL: "postgres://x",
    DEEPSEEK_API_KEY: "k",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    APPRISE_URL: "http://apprise:8000",
    PORT: "3000",
  });
  expect(cfg.databaseUrl).toBe("postgres://x");
  expect(cfg.port).toBe(3000);
  expect(cfg.deepseekBaseUrl).toBe("https://api.deepseek.com");
});

test("loadConfig throws on missing DATABASE_URL", () => {
  expect(() => loadConfig({})).toThrow("DATABASE_URL");
});
```

- [ ] **Step 5: Uruchom test (ma się nie powieść)**

Run: `bun test test/config.test.ts`
Expected: FAIL — `Cannot find module "../src/config"`.

- [ ] **Step 6: Zaimplementuj `src/config.ts`**

```ts
// src/config.ts
export interface AppConfig {
  databaseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  appriseUrl: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = Bun.env): AppConfig {
  const require = (key: string): string => {
    const v = env[key];
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  };
  return {
    databaseUrl: require("DATABASE_URL"),
    deepseekApiKey: env.DEEPSEEK_API_KEY ?? "",
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    appriseUrl: env.APPRISE_URL ?? "http://localhost:8000",
    port: Number(env.PORT ?? "3000"),
  };
}
```

- [ ] **Step 7: Uruchom test (ma przejść)**

Run: `bun test test/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock bunfig.toml .env.example src/config.ts test/config.test.ts
git commit -m "chore: deps, env config loader, bunfig for svelte plugin"
```

---

## Task 2: docker-compose (Postgres + Apprise)

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Utwórz `docker-compose.yml`** (na razie usługi infrastrukturalne; `app` dojdzie w Task 15)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: wynajem
      POSTGRES_PASSWORD: wynajem
      POSTGRES_DB: wynajem
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wynajem"]
      interval: 5s
      timeout: 3s
      retries: 5

  apprise:
    image: caronc/apprise:latest
    ports:
      - "8000:8000"

volumes:
  pgdata:
```

- [ ] **Step 2: Wystartuj i zweryfikuj Postgresa**

Run: `docker compose up -d db apprise`
Then: `docker compose ps`
Expected: `db` ma status `healthy`, `apprise` `running`.

- [ ] **Step 3: Zweryfikuj połączenie z bazą**

Run: `docker compose exec db psql -U wynajem -d wynajem -c "select 1;"`
Expected: zwraca `1`.

- [ ] **Step 4: Zweryfikuj Apprise API**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000`
Expected: `200`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: docker-compose with postgres and apprise"
```

---

## Task 3: Schemat Drizzle + klient + migracja

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Utwórz `src/db/schema.ts`**

```ts
// src/db/schema.ts
import {
  pgTable, serial, integer, text, doublePrecision, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  title: text("title").notNull().default(""),
  price: integer("price"),
  area: doublePrecision("area"),
  rooms: integer("rooms"),
  district: text("district"),
  url: text("url").notNull(),
  description: text("description"),
  score: integer("score"),
  scoreReasons: text("score_reasons"),
  status: text("status").notNull().default("active"),
  notified: boolean("notified").notNull().default(false),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

export const config = pgTable("config", {
  id: integer("id").primaryKey().default(1),
  searchUrl: text("search_url").notNull(),
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  minArea: doublePrecision("min_area"),
  minRooms: integer("min_rooms"),
  aiCriteria: text("ai_criteria").notNull().default(""),
  scoreThreshold: integer("score_threshold").notNull().default(70),
  pollIntervalMin: integer("poll_interval_min").notNull().default(5),
  appriseUrls: text("apprise_urls").array().notNull().default([]),
  deepseekEnabled: boolean("deepseek_enabled").notNull().default(true),
});

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
export type Config = typeof config.$inferSelect;
```

- [ ] **Step 2: Utwórz `src/db/client.ts`**

```ts
// src/db/client.ts
import { drizzle } from "drizzle-orm/bun-sql";
import { loadConfig } from "../config";
import * as schema from "./schema";

export const db = drizzle(loadConfig().databaseUrl, { schema });
export { schema };
```

- [ ] **Step 3: Utwórz `drizzle.config.ts`**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Wypchnij schemat do bazy**

Run: `bunx drizzle-kit push`
Expected: tworzy tabele `offers` i `config` bez błędu (`Changes applied`).

- [ ] **Step 5: Zweryfikuj tabele**

Run: `docker compose exec db psql -U wynajem -d wynajem -c "\dt"`
Expected: na liście `offers` i `config`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/client.ts drizzle.config.ts
git commit -m "feat: drizzle schema (offers, config) and client"
```

---

## Task 4: Zapytania DB

**Files:**
- Create: `src/db/queries.ts`
- Test: `test/queries.test.ts`

**Uwaga:** to testy integracyjne — wymagają działającej bazy (`docker compose up -d db` + `bunx drizzle-kit push`). Test używa realnego `DATABASE_URL` z `.env`.

- [ ] **Step 1: Napisz test**

```ts
// test/queries.test.ts
import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers, config } from "../src/db/schema";
import {
  ensureConfig, getConfig, updateConfig,
  getKnownExternalIds, upsertOffer, markNotified, markInactive, listOffers,
} from "../src/db/queries";

beforeEach(async () => {
  await db.delete(offers);
  await db.delete(config);
});

test("ensureConfig seeds a single default row", async () => {
  await ensureConfig("https://example.com/search");
  const c = await getConfig();
  expect(c.id).toBe(1);
  expect(c.searchUrl).toBe("https://example.com/search");
  expect(c.scoreThreshold).toBe(70);
  // drugie wywołanie nie duplikuje
  await ensureConfig("https://other");
  const c2 = await getConfig();
  expect(c2.searchUrl).toBe("https://example.com/search");
});

test("updateConfig changes editable fields", async () => {
  await ensureConfig("https://example.com/search");
  await updateConfig({ maxPrice: 3500, aiCriteria: "blisko SKM", appriseUrls: ["json://x"] });
  const c = await getConfig();
  expect(c.maxPrice).toBe(3500);
  expect(c.aiCriteria).toBe("blisko SKM");
  expect(c.appriseUrls).toEqual(["json://x"]);
});

test("upsertOffer inserts then updates lastSeen without duplicating", async () => {
  await upsertOffer({ externalId: "111", url: "u", title: "t" });
  await upsertOffer({ externalId: "111", url: "u", title: "t2" });
  const all = await listOffers();
  expect(all.length).toBe(1);
  expect(all[0].title).toBe("t2");
});

test("getKnownExternalIds returns existing ids", async () => {
  await upsertOffer({ externalId: "111", url: "u", title: "t" });
  await upsertOffer({ externalId: "222", url: "u", title: "t" });
  const known = await getKnownExternalIds();
  expect(known.has("111")).toBe(true);
  expect(known.has("222")).toBe(true);
  expect(known.has("333")).toBe(false);
});

test("markNotified and markInactive", async () => {
  await upsertOffer({ externalId: "111", url: "u", title: "t" });
  await upsertOffer({ externalId: "222", url: "u", title: "t" });
  await markNotified("111");
  await markInactive(["111"]); // 222 zniknęło z listy -> inactive
  const all = await listOffers();
  const o222 = all.find((o) => o.externalId === "222")!;
  const o111 = all.find((o) => o.externalId === "111")!;
  expect(o111.notified).toBe(true);
  expect(o111.status).toBe("active");
  expect(o222.status).toBe("inactive");
});
```

- [ ] **Step 2: Uruchom test (ma się nie powieść)**

Run: `bun test test/queries.test.ts`
Expected: FAIL — `Cannot find module "../src/db/queries"`.

- [ ] **Step 3: Zaimplementuj `src/db/queries.ts`**

```ts
// src/db/queries.ts
import { eq, notInArray, sql, desc } from "drizzle-orm";
import { db } from "./client";
import { offers, config, type Config, type NewOffer, type Offer } from "./schema";

export async function ensureConfig(defaultSearchUrl: string): Promise<void> {
  await db.insert(config).values({ id: 1, searchUrl: defaultSearchUrl }).onConflictDoNothing();
}

export async function getConfig(): Promise<Config> {
  const rows = await db.select().from(config).where(eq(config.id, 1)).limit(1);
  if (rows.length === 0) throw new Error("Config not seeded; call ensureConfig first");
  return rows[0];
}

export async function updateConfig(patch: Partial<Omit<Config, "id">>): Promise<Config> {
  await db.update(config).set(patch).where(eq(config.id, 1));
  return getConfig();
}

export async function getKnownExternalIds(): Promise<Set<string>> {
  const rows = await db.select({ externalId: offers.externalId }).from(offers);
  return new Set(rows.map((r) => r.externalId));
}

export async function upsertOffer(o: NewOffer): Promise<void> {
  await db
    .insert(offers)
    .values({ ...o, lastSeen: sql`now()` })
    .onConflictDoUpdate({
      target: offers.externalId,
      set: {
        title: o.title ?? sql`${offers.title}`,
        price: o.price ?? sql`${offers.price}`,
        area: o.area ?? sql`${offers.area}`,
        rooms: o.rooms ?? sql`${offers.rooms}`,
        district: o.district ?? sql`${offers.district}`,
        description: o.description ?? sql`${offers.description}`,
        score: o.score ?? sql`${offers.score}`,
        scoreReasons: o.scoreReasons ?? sql`${offers.scoreReasons}`,
        status: "active",
        lastSeen: sql`now()`,
      },
    });
}

export async function markNotified(externalId: string): Promise<void> {
  await db.update(offers).set({ notified: true }).where(eq(offers.externalId, externalId));
}

/** Oferty, których NIE ma na bieżącej liście aktywnych external_id, oznacz jako inactive. */
export async function markInactive(activeExternalIds: string[]): Promise<void> {
  if (activeExternalIds.length === 0) {
    await db.update(offers).set({ status: "inactive" }).where(eq(offers.status, "active"));
    return;
  }
  await db
    .update(offers)
    .set({ status: "inactive" })
    .where(notInArray(offers.externalId, activeExternalIds));
}

export async function listOffers(): Promise<Offer[]> {
  return db.select().from(offers).orderBy(desc(offers.score), desc(offers.lastSeen));
}
```

- [ ] **Step 4: Uruchom test (ma przejść)**

Run: `bun test test/queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts test/queries.test.ts
git commit -m "feat: db queries with integration tests"
```

---

## Task 5: Scraper — parsowanie listy (external_id + url)

**Decyzja:** ze strony listy wyłuskujemy tylko `{ externalId, url }` (odporny regex na linki `-ogl<NNN>.html`). Bogate pola (cena, metraż, pokoje, dzielnica, opis) pobieramy ze strony detalu — tylko dla NOWYCH ofert (Task 6). Dzięki temu nie parsujemy kruchego DOM kart listy.

**Files:**
- Create: `src/scraper/parse.ts`
- Test: `test/parse-list.test.ts`
- Create: `test/fixtures/list.html`

- [ ] **Step 1: Zrzuć realny fixture listy**

```bash
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000,e1i,81_33_58_46_91_34_32_1_143_87_76_86_142_2_7_31_29_60_26_93,qi,40_.html" \
  -o test/fixtures/list.html
```
Expected: plik > 50 KB. Sprawdź, że zawiera linki `-ogl`: `grep -c "ogl[0-9]" test/fixtures/list.html` → liczba > 0.

- [ ] **Step 2: Napisz test**

```ts
// test/parse-list.test.ts
import { test, expect } from "bun:test";
import { extractExternalId, parseListUrls } from "../src/scraper/parse";

test("extractExternalId pulls digits from ogl link", () => {
  expect(extractExternalId("https://ogloszenia.trojmiasto.pl/x/foo-ogl66438940.html")).toBe("66438940");
  expect(extractExternalId("https://example.com/no-id.html")).toBeNull();
});

test("parseListUrls returns unique offer links from fixture", async () => {
  const html = await Bun.file("test/fixtures/list.html").text();
  const items = parseListUrls(html);
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.externalId).toMatch(/^\d+$/);
    expect(it.url).toContain("trojmiasto.pl");
    expect(it.url).toContain("-ogl");
  }
  // brak duplikatów external_id
  const ids = items.map((i) => i.externalId);
  expect(new Set(ids).size).toBe(ids.length);
});
```

- [ ] **Step 3: Uruchom test (ma się nie powieść)**

Run: `bun test test/parse-list.test.ts`
Expected: FAIL — `Cannot find module "../src/scraper/parse"`.

- [ ] **Step 4: Zaimplementuj `src/scraper/parse.ts` (część listy)**

```ts
// src/scraper/parse.ts
export interface ListItem {
  externalId: string;
  url: string;
}

export function extractExternalId(url: string): string | null {
  const m = url.match(/-ogl(\d+)\.html/);
  return m ? m[1] : null;
}

export function parseListUrls(html: string): ListItem[] {
  const re = /https?:\/\/ogloszenia\.trojmiasto\.pl\/nieruchomosci-mam-do-wynajecia\/[^"'\s]*-ogl(\d+)\.html/g;
  const seen = new Map<string, ListItem>();
  for (const match of html.matchAll(re)) {
    const url = match[0];
    const externalId = match[1];
    if (!seen.has(externalId)) seen.set(externalId, { externalId, url });
  }
  return [...seen.values()];
}
```

- [ ] **Step 5: Uruchom test (ma przejść)**

Run: `bun test test/parse-list.test.ts`
Expected: PASS (2 tests). Jeśli `parseListUrls` zwraca 0 — linki w fixture mogą być względne; rozszerz regex o wariant zaczynający się od `/nieruchomosci-mam-do-wynajecia/` i doklej domenę. Popraw, aż test przejdzie.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/parse.ts test/parse-list.test.ts test/fixtures/list.html
git commit -m "feat: parse offer urls + external ids from list page"
```

---

## Task 6: Scraper — pobieranie i parsowanie strony detalu

**Files:**
- Modify: `src/scraper/parse.ts`
- Create: `src/scraper/fetch.ts`
- Test: `test/parse-detail.test.ts`
- Create: `test/fixtures/detail.html`

- [ ] **Step 1: Zrzuć realny fixture detalu** (weź dowolny link z `parseListUrls`)

```bash
URL=$(bun -e 'const {parseListUrls}=await import("./src/scraper/parse.ts");const h=await Bun.file("test/fixtures/list.html").text();console.log(parseListUrls(h)[0].url)')
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$URL" -o test/fixtures/detail.html
echo "saved $URL"
```
Expected: `detail.html` > 30 KB. Obejrzyj, gdzie są cena/metraż: `grep -oE "[0-9][0-9 ]*zł" test/fixtures/detail.html | head` oraz `grep -oE "[0-9]+([.,][0-9]+)? m" test/fixtures/detail.html | head`. Zanotuj realne wartości tej oferty — użyjesz ich w asercjach.

- [ ] **Step 2: Napisz test** (zastąp wartości `EXPECTED_*` realnymi z fixture, jeśli znane; w razie wątpliwości zostaw asercje strukturalne)

```ts
// test/parse-detail.test.ts
import { test, expect } from "bun:test";
import { parseDetail } from "../src/scraper/parse";

test("parseDetail extracts structured fields from fixture", async () => {
  const html = await Bun.file("test/fixtures/detail.html").text();
  const d = parseDetail(html);
  expect(d.title.length).toBeGreaterThan(0);
  expect(d.price === null || d.price > 0).toBe(true);
  expect(d.area === null || d.area > 0).toBe(true);
  expect(d.rooms === null || d.rooms! >= 1).toBe(true);
  expect(typeof d.description).toBe("string");
});
```

- [ ] **Step 3: Uruchom test (ma się nie powieść)**

Run: `bun test test/parse-detail.test.ts`
Expected: FAIL — `parseDetail is not a function`.

- [ ] **Step 4: Dopisz `parseDetail` do `src/scraper/parse.ts`**

```ts
// dopisz do src/scraper/parse.ts
export interface OfferDetail {
  title: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  district: string | null;
  description: string;
}

function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(re)?.[1] ?? null;
}

function firstJsonLd(html: string): any | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const json = JSON.parse(m[1].trim());
      return json;
    } catch { /* spróbuj następny blok */ }
  }
  return null;
}

export function parseDetail(html: string): OfferDetail {
  const ld = firstJsonLd(html);

  const title =
    metaContent(html, "og:title") ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
    "";

  const description =
    metaContent(html, "og:description") ??
    (typeof ld?.description === "string" ? ld.description : "") ??
    "";

  // Cena: preferuj JSON-LD offers.price; fallback do "NNNN zł" w treści.
  let price: number | null = null;
  const ldPrice = ld?.offers?.price ?? ld?.price;
  if (ldPrice) price = parseInt(String(ldPrice).replace(/\D/g, ""), 10) || null;
  if (price === null) {
    const m = html.match(/([0-9][0-9\s ]{2,})\s*z[łl]/i);
    if (m) price = parseInt(m[1].replace(/[\s ]/g, ""), 10) || null;
  }

  // Metraż: "NN m²" / "NN m2".
  let area: number | null = null;
  const am = html.match(/([0-9]+(?:[.,][0-9]+)?)\s*m(?:²|2|<sup>2)/i);
  if (am) area = parseFloat(am[1].replace(",", ".")) || null;

  // Liczba pokoi: "Liczba pokoi: N" lub "N pok" w tytule.
  let rooms: number | null = null;
  const rm =
    html.match(/Liczba pokoi[^0-9]{0,12}([0-9]+)/i) ??
    title.match(/([0-9]+)\s*pok/i);
  if (rm) rooms = parseInt(rm[1], 10) || null;

  // Dzielnica: z params "Dzielnica" lub z og:locality.
  const district =
    html.match(/Dzielnica[^>]*>[\s\S]*?<[^>]*>([^<]{2,40})</i)?.[1]?.trim() ??
    metaContent(html, "og:locality") ??
    null;

  return { title, price, area, rooms, district, description };
}
```

- [ ] **Step 5: Uruchom test (ma przejść)**

Run: `bun test test/parse-detail.test.ts`
Expected: PASS. Jeśli `price`/`area` wychodzą `null` mimo że są w treści, dostrój regexy do realnego HTML z fixture (obejrzyj kontekst wokół wartości), aż asercje przejdą i wyciągają sensowne liczby.

- [ ] **Step 6: Zaimplementuj `src/scraper/fetch.ts`**

```ts
// src/scraper/fetch.ts
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9" },
  });
  if (!res.ok) throw new Error(`fetchPage ${url} -> HTTP ${res.status}`);
  return res.text();
}
```

- [ ] **Step 7: Commit**

```bash
git add src/scraper/parse.ts src/scraper/fetch.ts test/parse-detail.test.ts test/fixtures/detail.html
git commit -m "feat: fetch + parse offer detail page"
```

---

## Task 7: Filtry twarde

**Files:**
- Create: `src/pipeline/filter.ts`
- Test: `test/filter.test.ts`

- [ ] **Step 1: Napisz test**

```ts
// test/filter.test.ts
import { test, expect } from "bun:test";
import { passesFilters } from "../src/pipeline/filter";

const cfg = { minPrice: 1000, maxPrice: 4000, minArea: 35, minRooms: 2 };

test("passes when within all bounds", () => {
  expect(passesFilters({ price: 3000, area: 50, rooms: 2 }, cfg)).toBe(true);
});

test("rejects above maxPrice", () => {
  expect(passesFilters({ price: 5000, area: 50, rooms: 2 }, cfg)).toBe(false);
});

test("rejects below minArea", () => {
  expect(passesFilters({ price: 3000, area: 20, rooms: 2 }, cfg)).toBe(false);
});

test("rejects below minRooms", () => {
  expect(passesFilters({ price: 3000, area: 50, rooms: 1 }, cfg)).toBe(false);
});

test("null bounds are ignored; null offer fields pass", () => {
  expect(passesFilters({ price: null, area: null, rooms: null },
    { minPrice: null, maxPrice: null, minArea: null, minRooms: null })).toBe(true);
});
```

- [ ] **Step 2: Uruchom test (ma się nie powieść)**

Run: `bun test test/filter.test.ts`
Expected: FAIL — `Cannot find module "../src/pipeline/filter"`.

- [ ] **Step 3: Zaimplementuj `src/pipeline/filter.ts`**

```ts
// src/pipeline/filter.ts
export interface FilterBounds {
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  minRooms: number | null;
}
export interface FilterableOffer {
  price: number | null;
  area: number | null;
  rooms: number | null;
}

export function passesFilters(o: FilterableOffer, b: FilterBounds): boolean {
  if (b.minPrice != null && o.price != null && o.price < b.minPrice) return false;
  if (b.maxPrice != null && o.price != null && o.price > b.maxPrice) return false;
  if (b.minArea != null && o.area != null && o.area < b.minArea) return false;
  if (b.minRooms != null && o.rooms != null && o.rooms < b.minRooms) return false;
  return true;
}
```

- [ ] **Step 4: Uruchom test (ma przejść)**

Run: `bun test test/filter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/filter.ts test/filter.test.ts
git commit -m "feat: hard filter logic"
```

---

## Task 8: Scoring DeepSeek

**Files:**
- Create: `src/scorer/deepseek.ts`
- Test: `test/deepseek.test.ts`

- [ ] **Step 1: Napisz test** (wstrzykujemy `fetchImpl`, by nie wołać realnego API)

```ts
// test/deepseek.test.ts
import { test, expect } from "bun:test";
import { scoreOffer } from "../src/scorer/deepseek";

function fakeFetch(content: string) {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      headers: { "content-type": "application/json" },
    });
}

const opts = { apiKey: "k", baseUrl: "https://api.deepseek.com" };

test("scoreOffer parses score and reasons from JSON content", async () => {
  const result = await scoreOffer(
    { description: "ładne mieszkanie blisko SKM", criteria: "blisko SKM" },
    { ...opts, fetchImpl: fakeFetch('{"score": 85, "reasons": "blisko SKM, balkon"}') },
  );
  expect(result.score).toBe(85);
  expect(result.reasons).toContain("SKM");
});

test("scoreOffer clamps score to 0-100", async () => {
  const r = await scoreOffer(
    { description: "x", criteria: "y" },
    { ...opts, fetchImpl: fakeFetch('{"score": 250, "reasons": "z"}') },
  );
  expect(r.score).toBe(100);
});

test("scoreOffer handles non-JSON content gracefully", async () => {
  const r = await scoreOffer(
    { description: "x", criteria: "y" },
    { ...opts, fetchImpl: fakeFetch("nonsense") },
  );
  expect(r.score).toBe(0);
  expect(r.reasons).toContain("parse");
});
```

- [ ] **Step 2: Uruchom test (ma się nie powieść)**

Run: `bun test test/deepseek.test.ts`
Expected: FAIL — `Cannot find module "../src/scorer/deepseek"`.

- [ ] **Step 3: Zaimplementuj `src/scorer/deepseek.ts`**

```ts
// src/scorer/deepseek.ts
export interface ScoreInput { description: string; criteria: string; }
export interface ScoreResult { score: number; reasons: string; }
export interface ScoreOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export async function scoreOffer(input: ScoreInput, opts: ScoreOptions): Promise<ScoreResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const system =
    "Oceniasz oferty najmu mieszkań pod kątem kryteriów użytkownika. " +
    "Zwróć WYŁĄCZNIE JSON: {\"score\": <0-100>, \"reasons\": \"<krótkie uzasadnienie po polsku>\"}. " +
    "score = jak dobrze oferta pasuje do kryteriów (100 = idealnie).";
  const user =
    `Kryteria użytkownika:\n${input.criteria}\n\n` +
    `Opis oferty:\n${input.description}`;

  const res = await doFetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(content);
    const raw = Number(parsed.score);
    const score = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
    return { score, reasons: String(parsed.reasons ?? "") };
  } catch {
    return { score: 0, reasons: "Nie udało się sparsować odpowiedzi AI (parse error)" };
  }
}
```

- [ ] **Step 4: Uruchom test (ma przejść)**

Run: `bun test test/deepseek.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scorer/deepseek.ts test/deepseek.test.ts
git commit -m "feat: deepseek scoring with injectable fetch"
```

---

## Task 9: Powiadomienia Apprise

**Files:**
- Create: `src/notify/apprise.ts`
- Test: `test/apprise.test.ts`

- [ ] **Step 1: Napisz test**

```ts
// test/apprise.test.ts
import { test, expect } from "bun:test";
import { sendNotification } from "../src/notify/apprise";

test("sendNotification posts urls/title/body to apprise /notify", async () => {
  let captured: any = null;
  const fakeFetch = (async (url: string, init: any) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  await sendNotification({
    appriseUrl: "http://apprise:8000",
    targets: ["json://host", "tgram://token/chat"],
    title: "Nowa oferta",
    body: "3 pokoje, 3500 zł",
    fetchImpl: fakeFetch,
  });

  expect(captured.url).toBe("http://apprise:8000/notify");
  expect(captured.body.urls).toBe("json://host,tgram://token/chat");
  expect(captured.body.title).toBe("Nowa oferta");
  expect(captured.body.body).toBe("3 pokoje, 3500 zł");
});

test("sendNotification skips when no targets", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return new Response("ok"); }) as unknown as typeof fetch;
  await sendNotification({ appriseUrl: "http://x", targets: [], title: "t", body: "b", fetchImpl: fakeFetch });
  expect(called).toBe(false);
});
```

- [ ] **Step 2: Uruchom test (ma się nie powieść)**

Run: `bun test test/apprise.test.ts`
Expected: FAIL — `Cannot find module "../src/notify/apprise"`.

- [ ] **Step 3: Zaimplementuj `src/notify/apprise.ts`**

```ts
// src/notify/apprise.ts
export interface NotifyInput {
  appriseUrl: string;
  targets: string[];
  title: string;
  body: string;
  fetchImpl?: typeof fetch;
}

export async function sendNotification(input: NotifyInput): Promise<void> {
  if (input.targets.length === 0) return;
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(`${input.appriseUrl}/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: input.targets.join(","),
      title: input.title,
      body: input.body,
    }),
  });
  if (!res.ok) throw new Error(`Apprise HTTP ${res.status}`);
}
```

- [ ] **Step 4: Uruchom test (ma przejść)**

Run: `bun test test/apprise.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notify/apprise.ts test/apprise.test.ts
git commit -m "feat: apprise notification client"
```

---

## Task 10: Pipeline `runCheck` (orkiestracja, z wstrzykiwanymi zależnościami)

**Files:**
- Create: `src/pipeline/check.ts`
- Test: `test/check.test.ts`

Pipeline jest czysty względem I/O: dostaje funkcje (`fetchPage`, `scorer`, `notifier`) i obiekt zapytań DB jako zależności, więc da się go przetestować bez sieci i bazy (przekazujemy atrapy).

- [ ] **Step 1: Napisz test**

```ts
// test/check.test.ts
import { test, expect } from "bun:test";
import { runCheck, type CheckDeps } from "../src/pipeline/check";

const baseConfig = {
  id: 1, searchUrl: "https://search",
  minPrice: null, maxPrice: 4000, minArea: 30, minRooms: 2,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: ["json://x"], deepseekEnabled: true,
};

function makeDeps(over: Partial<CheckDeps> = {}): { deps: CheckDeps; notified: string[]; upserts: any[] } {
  const notified: string[] = [];
  const upserts: any[] = [];
  const deps: CheckDeps = {
    getConfig: async () => baseConfig as any,
    getKnownExternalIds: async () => new Set<string>(),
    upsertOffer: async (o) => { upserts.push(o); },
    markNotified: async (id) => { notified.push(id); },
    markInactive: async () => {},
    fetchPage: async (url) => url.includes("ogl") ? "<detail>" : "<list>",
    parseListUrls: () => [{ externalId: "100", url: "https://x/a-ogl100.html" }],
    parseDetail: () => ({ title: "Ładne 2pok", price: 3500, area: 50, rooms: 2, district: "Wrzeszcz", description: "blisko SKM" }),
    scoreOffer: async () => ({ score: 88, reasons: "blisko SKM" }),
    sendNotification: async () => {},
    appriseUrl: "http://apprise:8000",
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    ...over,
  };
  return { deps, notified, upserts };
}

test("new offer passing filters + score>=threshold gets notified", async () => {
  const { deps, notified, upserts } = makeDeps();
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(1);
  expect(summary.notifiedCount).toBe(1);
  expect(notified).toEqual(["100"]);
  expect(upserts[0].score).toBe(88);
});

test("known offer is not re-processed as new", async () => {
  const { deps, notified } = makeDeps({ getKnownExternalIds: async () => new Set(["100"]) });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(0);
  expect(notified.length).toBe(0);
});

test("offer below score threshold is saved but not notified", async () => {
  const { deps, notified } = makeDeps({ scoreOffer: async () => ({ score: 40, reasons: "daleko" }) });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(1);
  expect(notified.length).toBe(0);
});

test("offer failing hard filters is skipped (no detail score, no notify)", async () => {
  const { deps, notified } = makeDeps({
    parseDetail: () => ({ title: "1pok", price: 3500, area: 50, rooms: 1, district: "X", description: "" }),
  });
  const summary = await runCheck(deps);
  expect(summary.notifiedCount).toBe(0);
  expect(notified.length).toBe(0);
});

test("deepseekEnabled=false notifies on filters alone", async () => {
  const cfg = { ...baseConfig, deepseekEnabled: false };
  let scoreCalled = false;
  const { deps, notified } = makeDeps({
    getConfig: async () => cfg as any,
    scoreOffer: async () => { scoreCalled = true; return { score: 0, reasons: "" }; },
  });
  const summary = await runCheck(deps);
  expect(scoreCalled).toBe(false);
  expect(notified).toEqual(["100"]);
});
```

- [ ] **Step 2: Uruchom test (ma się nie powieść)**

Run: `bun test test/check.test.ts`
Expected: FAIL — `Cannot find module "../src/pipeline/check"`.

- [ ] **Step 3: Zaimplementuj `src/pipeline/check.ts`**

```ts
// src/pipeline/check.ts
import type { Config, NewOffer } from "../db/schema";
import { passesFilters } from "./filter";
import type { ListItem, OfferDetail } from "../scraper/parse";

export interface CheckDeps {
  getConfig: () => Promise<Config>;
  getKnownExternalIds: () => Promise<Set<string>>;
  upsertOffer: (o: NewOffer) => Promise<void>;
  markNotified: (externalId: string) => Promise<void>;
  markInactive: (activeExternalIds: string[]) => Promise<void>;
  fetchPage: (url: string) => Promise<string>;
  parseListUrls: (html: string) => ListItem[];
  parseDetail: (html: string) => OfferDetail;
  scoreOffer: (
    input: { description: string; criteria: string },
    opts: { apiKey: string; baseUrl: string },
  ) => Promise<{ score: number; reasons: string }>;
  sendNotification: (input: {
    appriseUrl: string; targets: string[]; title: string; body: string;
  }) => Promise<void>;
  appriseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
}

export interface CheckSummary {
  listedCount: number;
  newCount: number;
  notifiedCount: number;
}

export async function runCheck(deps: CheckDeps): Promise<CheckSummary> {
  const config = await deps.getConfig();

  const listHtml = await deps.fetchPage(config.searchUrl);
  const items = deps.parseListUrls(listHtml);
  const activeIds = items.map((i) => i.externalId);

  const known = await deps.getKnownExternalIds();
  const fresh = items.filter((i) => !known.has(i.externalId));

  let notifiedCount = 0;

  for (const item of fresh) {
    const detailHtml = await deps.fetchPage(item.url);
    const d = deps.parseDetail(detailHtml);

    const base: NewOffer = {
      externalId: item.externalId,
      url: item.url,
      title: d.title,
      price: d.price,
      area: d.area,
      rooms: d.rooms,
      district: d.district,
      description: d.description,
    };

    if (!passesFilters(d, config)) {
      await deps.upsertOffer(base);
      continue;
    }

    let score: number | null = null;
    let reasons: string | null = null;
    if (config.deepseekEnabled) {
      const r = await deps.scoreOffer(
        { description: d.description, criteria: config.aiCriteria },
        { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
      );
      score = r.score;
      reasons = r.reasons;
    }

    await deps.upsertOffer({ ...base, score, scoreReasons: reasons });

    const meetsThreshold = config.deepseekEnabled ? (score ?? 0) >= config.scoreThreshold : true;
    if (meetsThreshold) {
      const title = `Nowa oferta: ${d.title}`.slice(0, 120);
      const body =
        `${d.price ?? "?"} zł · ${d.area ?? "?"} m² · ${d.rooms ?? "?"} pok · ${d.district ?? ""}\n` +
        (reasons ? `AI: ${reasons}\n` : "") +
        item.url;
      await deps.sendNotification({
        appriseUrl: deps.appriseUrl,
        targets: config.appriseUrls,
        title,
        body,
      });
      await deps.markNotified(item.externalId);
      notifiedCount++;
    }
  }

  await deps.markInactive(activeIds);

  return { listedCount: items.length, newCount: fresh.length, notifiedCount };
}
```

- [ ] **Step 4: Uruchom test (ma przejść)**

Run: `bun test test/check.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/check.ts test/check.test.ts
git commit -m "feat: runCheck pipeline orchestration with injected deps"
```

---

## Task 11: Zadanie trigger.dev

**Files:**
- Create: `trigger.config.ts`
- Create: `trigger/check-offers.ts`

**Uwaga:** trigger.dev cron jest statyczny (`*/5 * * * *`). Pole `pollIntervalMin` w configu jest na teraz informacyjne / pod przyszłe dynamiczne harmonogramy — udokumentuj to w komentarzu, nie próbuj go tu honorować dynamicznie (YAGNI).

- [ ] **Step 1: Zainicjalizuj trigger.dev** (interaktywne; połączy projekt cloud)

```bash
bunx trigger.dev@latest init -p proj_fcfuguqmrtfsffzmefyl
```
Expected: tworzy/aktualizuje `trigger.config.ts` i katalog zadań. Jeśli init utworzy przykładowe zadanie — zostaw, usuniesz później.

- [ ] **Step 2: Upewnij się, że `trigger.config.ts` wskazuje katalog `./trigger`**

```ts
// trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_fcfuguqmrtfsffzmefyl",
  dirs: ["./trigger"],
  maxDuration: 300,
});
```

- [ ] **Step 3: Utwórz `trigger/check-offers.ts`**

```ts
// trigger/check-offers.ts
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { runCheck } from "../src/pipeline/check";
import { loadConfig } from "../src/config";
import {
  getConfig, getKnownExternalIds, upsertOffer, markNotified, markInactive,
} from "../src/db/queries";
import { fetchPage } from "../src/scraper/fetch";
import { parseListUrls, parseDetail } from "../src/scraper/parse";
import { scoreOffer } from "../src/scorer/deepseek";
import { sendNotification } from "../src/notify/apprise";

// Cron statyczny co 5 min. Pole config.pollIntervalMin jest informacyjne
// (dynamiczne harmonogramy = przyszłość, gdy trigger.dev będzie self-hosted).
export const checkOffers = schedules.task({
  id: "check-offers",
  cron: "*/5 * * * *",
  run: async () => {
    const env = loadConfig();
    const summary = await runCheck({
      getConfig,
      getKnownExternalIds,
      upsertOffer,
      markNotified,
      markInactive,
      fetchPage,
      parseListUrls,
      parseDetail,
      scoreOffer,
      sendNotification,
      appriseUrl: env.appriseUrl,
      deepseekApiKey: env.deepseekApiKey,
      deepseekBaseUrl: env.deepseekBaseUrl,
    });
    logger.info("check-offers done", summary);
    return summary;
  },
});
```

- [ ] **Step 4: Zweryfikuj kompilację typów**

Run: `bunx tsc --noEmit`
Expected: brak błędów w `trigger/check-offers.ts` i `src/**`.

- [ ] **Step 5: Smoke test lokalny** (wymaga `db` up, `bunx drizzle-kit push`, seeda configu — patrz Task 12 Step 6 jeśli config pusty; albo ręcznie `ensureConfig`)

Run: `bunx trigger.dev@latest dev`
W panelu trigger.dev wywołaj zadanie `check-offers` ręcznie (Test). Expected: log `check-offers done` z `{ listedCount, newCount, notifiedCount }`; brak wyjątków. Zatrzymaj `Ctrl+C`.

- [ ] **Step 6: Commit**

```bash
git add trigger.config.ts trigger/check-offers.ts
git commit -m "feat: trigger.dev scheduled check-offers task"
```

---

## Task 12: Bun API server

**Files:**
- Create: `src/api/server.ts`
- Test: `test/api.test.ts`

API serwuje też statyczny build SPA z `web/dist` (powstaje w Task 14). Do czasu builda katalog może nie istnieć — serwer obsługuje to, zwracając 404 dla nieznanych ścieżek (a `/` później pokryje build).

- [ ] **Step 1: Napisz test** (startujemy serwer na losowym porcie, wołamy endpointy; wymaga `db` up + `drizzle-kit push`)

```ts
// test/api.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/api/server";
import { db } from "../src/db/client";
import { offers, config } from "../src/db/schema";
import { ensureConfig } from "../src/db/queries";

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  await db.delete(offers);
  await db.delete(config);
  await ensureConfig("https://search.example");
  server = createServer(0);
  base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

test("GET /api/config returns seeded config", async () => {
  const res = await fetch(`${base}/api/config`);
  expect(res.status).toBe(200);
  const c = await res.json();
  expect(c.searchUrl).toBe("https://search.example");
});

test("PUT /api/config updates fields", async () => {
  const res = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPrice: 3800, aiCriteria: "balkon", appriseUrls: ["json://x"] }),
  });
  expect(res.status).toBe(200);
  const c = await res.json();
  expect(c.maxPrice).toBe(3800);
  expect(c.appriseUrls).toEqual(["json://x"]);
});

test("GET /api/offers returns array", async () => {
  const res = await fetch(`${base}/api/offers`);
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});
```

- [ ] **Step 2: Uruchom test (ma się nie powieść)**

Run: `bun test test/api.test.ts`
Expected: FAIL — `Cannot find module "../src/api/server"`.

- [ ] **Step 3: Zaimplementuj `src/api/server.ts`**

```ts
// src/api/server.ts
import { listOffers, getConfig, updateConfig } from "../db/queries";
import type { Config } from "../db/schema";

const DIST = `${import.meta.dir}/../../web/dist`;

const EDITABLE: (keyof Config)[] = [
  "searchUrl", "minPrice", "maxPrice", "minArea", "minRooms",
  "aiCriteria", "scoreThreshold", "pollIntervalMin", "appriseUrls", "deepseekEnabled",
];

function pickEditable(body: any): Partial<Config> {
  const patch: any = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  return patch;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function createServer(port: number) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/api/offers" && req.method === "GET") {
        return json(await listOffers());
      }
      if (path === "/api/config" && req.method === "GET") {
        return json(await getConfig());
      }
      if (path === "/api/config" && req.method === "PUT") {
        const body = await req.json();
        return json(await updateConfig(pickEditable(body)));
      }

      // statyczny build SPA
      const rel = path === "/" ? "/index.html" : path;
      const file = Bun.file(`${DIST}${rel}`);
      if (await file.exists()) return new Response(file);
      // fallback SPA -> index.html (dla routingu klienta)
      const index = Bun.file(`${DIST}/index.html`);
      if (await index.exists()) return new Response(index);

      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const { loadConfig } = await import("../config");
  const { ensureConfig } = await import("../db/queries");
  const env = loadConfig();
  const DEFAULT_SEARCH =
    "https://ogloszenia.trojmiasto.pl/nieruchomosci-mam-do-wynajecia/ai,_4000,e1i,81_33_58_46_91_34_32_1_143_87_76_86_142_2_7_31_29_60_26_93,qi,40_.html";
  await ensureConfig(DEFAULT_SEARCH);
  const server = createServer(env.port);
  console.log(`API listening on http://localhost:${server.port}`);
}
```

- [ ] **Step 4: Uruchom test (ma przejść)**

Run: `bun test test/api.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat: bun api server (offers, config, static spa)"
```

- [ ] **Step 6: Zasiej config i odpal serwer ręcznie (sanity)**

Run: `bun run src/api/server.ts`
Then (inne okno): `curl -s http://localhost:3000/api/config | head -c 200`
Expected: JSON z `searchUrl` ustawionym na domyślny link trojmiasto. Zatrzymaj serwer.

---

## Task 13: Build SPA — szkielet i smoke test

**Files:**
- Create: `web/index.html`
- Create: `web/main.ts`
- Create: `web/App.svelte`
- Create: `web/build.ts`

- [ ] **Step 1: Utwórz `web/App.svelte` (minimalny, do smoke testu builda)**

```svelte
<!-- web/App.svelte -->
<script lang="ts">
  let msg = "Trójmiasto Wynajem";
</script>

<h1>{msg}</h1>
```

- [ ] **Step 2: Utwórz `web/main.ts`**

```ts
// web/main.ts
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
```

- [ ] **Step 3: Utwórz `web/index.html`**

```html
<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Trójmiasto Wynajem</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Utwórz `web/build.ts`**

```ts
// web/build.ts
import { SveltePlugin } from "bun-plugin-svelte";

const result = await Bun.build({
  entrypoints: ["web/index.html"],
  outdir: "web/dist",
  target: "browser",
  minify: true,
  plugins: [SveltePlugin({ development: false })],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("SPA built ->", "web/dist");
```

- [ ] **Step 5: Zbuduj (smoke test pluginu Svelte)**

Run: `bun run web/build.ts`
Expected: `web/dist/index.html` + zbundlowany JS powstają, exit 0. Jeśli `SveltePlugin` nie importuje się z `bun-plugin-svelte`, sprawdź realny eksport pakietu (`bun -e "console.log(Object.keys(await import('bun-plugin-svelte')))"`) i dostosuj import — to twardy blocker dla UI.

- [ ] **Step 6: Zweryfikuj serwowanie przez API**

Run: `bun run src/api/server.ts` (inne okno: `curl -s http://localhost:3000/ | grep -c "<div id=\"app\">"`)
Expected: `1` (API serwuje zbudowany `index.html`). Zatrzymaj serwer.

- [ ] **Step 7: Dodaj `web/dist` do `.gitignore` i commit**

```bash
echo "web/dist" >> .gitignore
git add web/index.html web/main.ts web/App.svelte web/build.ts .gitignore
git commit -m "feat: svelte spa skeleton + bun build, served by api"
```

---

## Task 14: UI — klient API, Dashboard, Config

**Files:**
- Create: `web/lib/api.ts`
- Create: `web/Dashboard.svelte`
- Create: `web/Config.svelte`
- Modify: `web/App.svelte`

- [ ] **Step 1: Utwórz `web/lib/api.ts`**

```ts
// web/lib/api.ts
export interface Offer {
  id: number; externalId: string; title: string;
  price: number | null; area: number | null; rooms: number | null;
  district: string | null; url: string; score: number | null;
  scoreReasons: string | null; status: string; notified: boolean;
  firstSeen: string; lastSeen: string;
}
export interface Config {
  searchUrl: string; minPrice: number | null; maxPrice: number | null;
  minArea: number | null; minRooms: number | null; aiCriteria: string;
  scoreThreshold: number; pollIntervalMin: number;
  appriseUrls: string[]; deepseekEnabled: boolean;
}

export async function getOffers(): Promise<Offer[]> {
  return (await fetch("/api/offers")).json();
}
export async function getConfig(): Promise<Config> {
  return (await fetch("/api/config")).json();
}
export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.json();
}
```

- [ ] **Step 2: Utwórz `web/Dashboard.svelte`**

```svelte
<!-- web/Dashboard.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { getOffers, type Offer } from "./lib/api";
  let offers: Offer[] = $state([]);
  let loading = $state(true);
  onMount(async () => { offers = await getOffers(); loading = false; });
</script>

{#if loading}
  <p>Ładowanie…</p>
{:else}
  <table>
    <thead>
      <tr><th>Score</th><th>Tytuł</th><th>Cena</th><th>m²</th><th>Pok</th><th>Dzielnica</th><th>Status</th><th></th></tr>
    </thead>
    <tbody>
      {#each offers as o (o.id)}
        <tr class:notified={o.notified}>
          <td>{o.score ?? "–"}</td>
          <td>{o.title}</td>
          <td>{o.price ?? "–"} zł</td>
          <td>{o.area ?? "–"}</td>
          <td>{o.rooms ?? "–"}</td>
          <td>{o.district ?? "–"}</td>
          <td>{o.status}</td>
          <td><a href={o.url} target="_blank" rel="noreferrer">otwórz</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 14px; }
  tr.notified { background: #f0fff4; }
</style>
```

- [ ] **Step 3: Utwórz `web/Config.svelte`**

```svelte
<!-- web/Config.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { getConfig, saveConfig, type Config } from "./lib/api";
  let cfg: Config | null = $state(null);
  let saved = $state(false);
  let appriseText = $state("");

  onMount(async () => {
    cfg = await getConfig();
    appriseText = cfg.appriseUrls.join("\n");
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!cfg) return;
    const patch: Partial<Config> = {
      ...cfg,
      appriseUrls: appriseText.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    cfg = await saveConfig(patch);
    appriseText = cfg.appriseUrls.join("\n");
    saved = true;
    setTimeout(() => (saved = false), 1500);
  }
</script>

{#if cfg}
  <form onsubmit={submit}>
    <label>Search URL<textarea bind:value={cfg.searchUrl} rows="2"></textarea></label>
    <label>Min cena<input type="number" bind:value={cfg.minPrice} /></label>
    <label>Max cena<input type="number" bind:value={cfg.maxPrice} /></label>
    <label>Min metraż<input type="number" bind:value={cfg.minArea} /></label>
    <label>Min pokoje<input type="number" bind:value={cfg.minRooms} /></label>
    <label>Kryteria AI<textarea bind:value={cfg.aiCriteria} rows="4"></textarea></label>
    <label>Próg score<input type="number" bind:value={cfg.scoreThreshold} /></label>
    <label>Interwał (min, informacyjnie)<input type="number" bind:value={cfg.pollIntervalMin} /></label>
    <label><input type="checkbox" bind:checked={cfg.deepseekEnabled} /> DeepSeek scoring</label>
    <label>Apprise URLs (jeden na linię)<textarea bind:value={appriseText} rows="3"></textarea></label>
    <button type="submit">Zapisz</button>
    {#if saved}<span class="ok">Zapisano ✓</span>{/if}
  </form>
{/if}

<style>
  form { display: grid; gap: 10px; max-width: 520px; }
  label { display: grid; gap: 4px; font-size: 14px; }
  .ok { color: green; }
</style>
```

- [ ] **Step 4: Zaktualizuj `web/App.svelte` (prosty przełącznik zakładek)**

```svelte
<!-- web/App.svelte -->
<script lang="ts">
  import Dashboard from "./Dashboard.svelte";
  import Config from "./Config.svelte";
  let tab: "offers" | "config" = $state("offers");
</script>

<nav>
  <button class:active={tab === "offers"} onclick={() => (tab = "offers")}>Oferty</button>
  <button class:active={tab === "config"} onclick={() => (tab = "config")}>Konfiguracja</button>
</nav>

<main>
  {#if tab === "offers"}<Dashboard />{:else}<Config />{/if}
</main>

<style>
  nav { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid #eee; }
  nav button.active { font-weight: 700; }
  main { padding: 16px; font-family: system-ui, sans-serif; }
</style>
```

- [ ] **Step 5: Zbuduj i zweryfikuj w przeglądarce**

Run: `bun run web/build.ts && bun run src/api/server.ts`
Otwórz `http://localhost:3000`. Expected: widać zakładki „Oferty" i „Konfiguracja"; zakładka Konfiguracja ładuje wartości z `/api/config`, zapis działa (przycisk „Zapisano ✓"), po odświeżeniu zmiany trwałe. Zatrzymaj serwer.

- [ ] **Step 6: Commit**

```bash
git add web/lib/api.ts web/Dashboard.svelte web/Config.svelte web/App.svelte
git commit -m "feat: dashboard + config UI wired to api"
```

---

## Task 15: Dockerfile, usługa `app` w compose, weryfikacja E2E

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Utwórz `.dockerignore`**

```
node_modules
web/dist
.git
.env
test
docs
```

- [ ] **Step 2: Utwórz `Dockerfile`** (buduje SPA, uruchamia API)

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run web/build.ts

EXPOSE 3000
CMD ["bun", "run", "src/api/server.ts"]
```

- [ ] **Step 3: Dodaj usługę `app` do `docker-compose.yml`** (wstaw przed `volumes:`)

```yaml
  app:
    build: .
    environment:
      DATABASE_URL: postgres://wynajem:wynajem@db:5432/wynajem
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
      DEEPSEEK_BASE_URL: https://api.deepseek.com
      APPRISE_URL: http://apprise:8000
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
      apprise:
        condition: service_started
```

- [ ] **Step 4: Zbuduj i wystartuj cały stack**

Run: `docker compose up -d --build`
Then: `docker compose ps`
Expected: `db` healthy, `apprise` running, `app` running.

- [ ] **Step 5: Zastosuj schemat i zasiej config wewnątrz sieci** (jednorazowo)

Run: `docker compose exec app bunx drizzle-kit push`
Then: `curl -s http://localhost:3000/api/config | head -c 200`
Expected: JSON z domyślnym `searchUrl` (seed z `import.meta.main` w server.ts). Jeśli config pusty, zrestartuj `app` (`docker compose restart app`) — seed `ensureConfig` odpala się na starcie.

- [ ] **Step 6: Weryfikacja E2E zadania** (z lokalnego dev trigger.dev, pisze do bazy w compose)

Run: `bunx trigger.dev@latest dev`
W panelu trigger.dev odpal `check-offers` (Test). Expected: log `check-offers done` z `listedCount > 0`. Następnie `curl -s http://localhost:3000/api/offers | head -c 400` pokazuje zapisane oferty. Jeśli ustawiłeś realny `apprise_urls` (np. `ntfy://...`/`tgram://...`) w configu i pojawiła się nowa oferta ze score ≥ próg — przyszło powiadomienie. Zatrzymaj dev.

- [ ] **Step 7: Pełny zestaw testów**

Run: `bun test`
Expected: wszystkie testy PASS (config, queries, parse-list, parse-detail, filter, deepseek, apprise, check, api).

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "feat: dockerized app service + e2e wiring"
```

---

## Notatki końcowe / świadome ograniczenia

- **Interwał pollingu**: cron trigger.dev statyczny `*/5`. `pollIntervalMin` w UI jest informacyjny do czasu przejścia na self-hosted trigger.dev z dynamicznymi harmonogramami.
- **Filtry trojmiasto**: rekonfigurowane przez wklejenie nowego `searchUrl` (bez query-buildera ID dzielnic).
- **Auth panelu**: brak — zakładamy dostęp w prywatnej sieci / przez tunel. Przy publicznym deployu dodać basic-auth na poziomie reverse-proxy.
- **Pobieranie detali**: tylko dla nowych ofert (koszt ograniczony). Selektory parsera detalu mogą wymagać korekty po zmianach na stronie — testy na fixture wyłapią regresję po ponownym zrzucie.
```
