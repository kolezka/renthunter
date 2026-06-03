# Keyword Extraction + Vector Search + Change History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hybrid keyword-extraction + embedding-powered search bar, sort-by-date, and per-offer change history to the rental crawler.

**Architecture:** Gazetteer extracts district/kind deterministically; DeepSeek extracts an open-ended features list; an OpenAI-compatible provider produces embeddings stored as `real[]` and ranked by cosine similarity in app code (no pgvector — unavailable in the PGlite 0.5.1 test harness). A combined `/api/offers/search` endpoint filters on structured columns and ranks by the query embedding. Change history is captured as full `jsonb` snapshots written only when a tracked field changes, diffed in the UI.

**Tech Stack:** Bun, TypeScript, Drizzle ORM + postgres-js (PGlite in tests), Svelte 5, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-06-03-keyword-extraction-vector-search-history-design.md`

## Conventions (verified in this repo — follow exactly)

- **Tests live in `test/`**, importing from `../src/...` (NOT colocated `*.test.ts`). Run a single file with `bun test test/<name>.test.ts`, or one case with `-t "<name>"`.
- DB tests run on injected PGlite; suites clean state in `beforeEach`/`beforeAll` with `db.delete(offers); db.delete(config); db.delete(logs);` and seed config via `ensureConfig(url)`.
- API is tested by `createServer(0, opts)` (returns a Bun server with `.port` / `.stop(true)`) and real `fetch(\`http://localhost:${server.port}/...\`)`. See `test/api.test.ts`.
- Migrations are hand-authored (no TTY): `.sql` + `_journal.json` entry + `meta/NNNN_snapshot.json` (snapshot consumed only by future `drizzle-kit generate`; the runtime migrator uses the `.sql` + journal).

---

## File Structure

**Create:**
- `drizzle/0005_search_and_history.sql`, `drizzle/meta/0005_snapshot.json`
- `src/keywords/gazetteer.ts`, `src/keywords/features.ts`
- `src/embeddings/cosine.ts`, `src/embeddings/client.ts`, `src/embeddings/embedText.ts`
- `src/db/snapshot.ts`
- `src/pipeline/enrich.ts`
- `web/SearchBar.svelte`, `web/OfferHistory.svelte`
- Tests: `test/gazetteer.test.ts`, `test/cosine.test.ts`, `test/embed-client.test.ts`, `test/features.test.ts`, `test/embed-text.test.ts`, `test/snapshot.test.ts`, `test/enrich.test.ts`

**Modify:**
- `src/db/schema.ts`, `src/db/queries.ts`, `drizzle/meta/_journal.json`
- `src/pipeline/check.ts`, `src/pipeline/refresh.ts`, `src/pipeline/deps.ts`
- `src/api/server.ts`, `src/api/validate.ts`, `src/config.ts`
- `web/lib/api.ts`, `web/Dashboard.svelte`, `web/OfferDetail.svelte`, `web/Config.svelte`
- `docker-compose.dev.yml`, `docker-compose.prod.yml`
- Existing tests touched by signature changes: `test/check.test.ts`, `test/refresh.test.ts`, `test/queries.test.ts`, `test/api.test.ts`, `test/config.test.ts`

---

## Task 1: Migration 0005 + schema

**Files:** Create `drizzle/0005_search_and_history.sql`, `drizzle/meta/0005_snapshot.json`; Modify `src/db/schema.ts`, `drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `drizzle/0005_search_and_history.sql`. The `offer_snapshots` FK uses **ON DELETE CASCADE** so existing test teardowns (`db.delete(offers)`) still work once snapshots reference offers:

```sql
ALTER TABLE "offers" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "district_canonical" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "features" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "embedding" real[];--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "embed_text_hash" text;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "extract_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "embed_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE "offer_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "offer_snapshots" ADD CONSTRAINT "offer_snapshots_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
```

- [ ] **Step 2: Add the journal entry**

In `drizzle/meta/_journal.json`, append to `entries` (after `0004_multiportal`):

```json
{
  "idx": 5,
  "version": "7",
  "when": 1780617600000,
  "tag": "0005_search_and_history",
  "breakpoints": true
}
```

- [ ] **Step 3: Create the kit snapshot**

Copy `drizzle/meta/0004_snapshot.json` to `drizzle/meta/0005_snapshot.json`. In the copy: set top-level `"id"` to a new random UUID and `"prevId"` to the old 0004 `"id"`; under `tables.offers.columns` add `kind` (`text`), `district_canonical` (`text`), `features` (`text[]`, notNull, default `'{}'`), `embedding` (`real[]`), `embed_text_hash` (`text`); under `tables.config.columns` add `extract_enabled`, `embed_enabled` (`boolean`, notNull, default `true`); add a `tables.offer_snapshots` object with columns `id`/`offer_id`/`captured_at`/`data`, the PK, and the FK (`onDelete: "cascade"`). Only future `drizzle-kit generate` reads this; runtime uses the `.sql` + journal.

- [ ] **Step 4: Update the Drizzle schema**

In `src/db/schema.ts`, add `real` to the import:

```ts
import {
  pgTable, serial, integer, text, doublePrecision, real, boolean, timestamp, jsonb,
} from "drizzle-orm/pg-core";
```

Add to `offers` (after `district`):

```ts
  kind: text("kind"),
  districtCanonical: text("district_canonical"),
  features: text("features").array().notNull().default([]),
  embedding: real("embedding").array(),
  embedTextHash: text("embed_text_hash"),
```

Add to `config` (after `concurrencyLimit`):

```ts
  extractEnabled: boolean("extract_enabled").notNull().default(true),
  embedEnabled: boolean("embed_enabled").notNull().default(true),
```

Add at end of file:

```ts
export const offerSnapshots = pgTable("offer_snapshots", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  data: jsonb("data").notNull(),
});

export type OfferSnapshot = typeof offerSnapshots.$inferSelect;
export type NewOfferSnapshot = typeof offerSnapshots.$inferInsert;
```

- [ ] **Step 5: Verify migration applies on PGlite**

Run: `bun test test/queries.test.ts`
Expected: existing tests PASS (the preload migrates a fresh PGlite from `./drizzle`; a bad migration throws here).

- [ ] **Step 6: Commit**

```bash
git add drizzle/0005_search_and_history.sql drizzle/meta/_journal.json drizzle/meta/0005_snapshot.json src/db/schema.ts
git commit -m "feat(db): migration 0005 — search columns, config flags, offer_snapshots"
```

---

## Task 2: Gazetteer (district + kind)

**Files:** Create `src/keywords/gazetteer.ts`; Test `test/gazetteer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/gazetteer.test.ts`:

```ts
import { test, expect } from "bun:test";
import { normalizeText, extractKeywords } from "../src/keywords/gazetteer";

test("normalizeText strips Polish diacritics and lowercases", () => {
  expect(normalizeText("Śródmieście")).toBe("srodmiescie");
  expect(normalizeText("Gdańsk Wrzeszcz")).toBe("gdansk wrzeszcz");
});

test("extractKeywords maps a messy district to a canonical dzielnica", () => {
  const r = extractKeywords({ district: "Gdańsk Wrzeszcz ul. Grunwaldzka", title: "Mieszkanie 2 pok" });
  expect(r.districtCanonical).toBe("Gdańsk Wrzeszcz");
  expect(r.kind).toBe("mieszkanie");
});

test("extractKeywords finds district from title when district field is null", () => {
  const r = extractKeywords({ district: null, title: "Kawalerka na Zaspie, Gdańsk" });
  expect(r.districtCanonical).toBe("Gdańsk Zaspa");
  expect(r.kind).toBe("kawalerka");
});

test("extractKeywords returns nulls when nothing matches", () => {
  const r = extractKeywords({ district: "Warszawa Mokotów", title: "Lokal" });
  expect(r.districtCanonical).toBeNull();
  expect(r.kind).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/gazetteer.test.ts`
Expected: FAIL — `Cannot find module '../src/keywords/gazetteer'`.

- [ ] **Step 3: Write the implementation**

Create `src/keywords/gazetteer.ts`:

```ts
/** Diacritic-insensitive, lowercased normalization (Śródmieście -> srodmiescie). */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export interface KeywordHit {
  districtCanonical: string | null;
  kind: string | null;
}

// Canonical "City Dzielnica" forms. Extend freely — this is a starter taxonomy.
const DISTRICTS: string[] = [
  "Gdańsk Wrzeszcz", "Gdańsk Oliwa", "Gdańsk Przymorze", "Gdańsk Zaspa",
  "Gdańsk Brzeźno", "Gdańsk Śródmieście", "Gdańsk Jelitkowo", "Gdańsk Stogi",
  "Gdańsk Orunia", "Gdańsk Chełm", "Gdańsk Osowa", "Gdańsk Żabianka",
  "Gdańsk Piecki-Migowo", "Gdańsk Ujeścisko", "Gdańsk Łostowice", "Gdańsk Morena",
  "Gdynia Śródmieście", "Gdynia Orłowo", "Gdynia Redłowo", "Gdynia Witomino",
  "Gdynia Chylonia", "Gdynia Oksywie", "Gdynia Działki Leśne", "Gdynia Wzgórze",
  "Sopot",
];

// One normalized alias per district (the dzielnica word, or the city for Sopot).
const DISTRICT_ALIASES: { canonical: string; alias: string }[] = DISTRICTS.map((c) => {
  const parts = c.split(" ");
  const word = parts.length > 1 ? parts.slice(1).join(" ") : parts[0]!;
  return { canonical: c, alias: normalizeText(word) };
});

// kind keyword -> canonical kind. Order matters: most specific first.
const KINDS: { needle: string; kind: string }[] = [
  { needle: "kawalerk", kind: "kawalerka" },
  { needle: "apartament", kind: "apartament" },
  { needle: "dom", kind: "dom" },
  { needle: "pokoj", kind: "pokój" },
  { needle: "studio", kind: "studio" },
  { needle: "mieszkan", kind: "mieszkanie" },
];

function matchDistrict(haystack: string): string | null {
  for (const { canonical, alias } of DISTRICT_ALIASES) {
    if (haystack.includes(alias)) return canonical;
  }
  return null;
}

function matchKind(haystack: string): string | null {
  for (const { needle, kind } of KINDS) {
    if (haystack.includes(needle)) return kind;
  }
  return null;
}

export function extractKeywords(input: { district: string | null; title: string }): KeywordHit {
  const districtHay = normalizeText(`${input.district ?? ""} ${input.title}`);
  const titleHay = normalizeText(input.title);
  return {
    districtCanonical: matchDistrict(districtHay),
    kind: matchKind(titleHay),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/gazetteer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/keywords/gazetteer.ts test/gazetteer.test.ts
git commit -m "feat(keywords): Trójmiasto gazetteer for district + kind extraction"
```

---

## Task 3: Cosine similarity

**Files:** Create `src/embeddings/cosine.ts`; Test `test/cosine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/cosine.test.ts`:

```ts
import { test, expect } from "bun:test";
import { cosineSimilarity, rankByCosine } from "../src/embeddings/cosine";

test("identical vectors have similarity 1", () => {
  expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
});

test("orthogonal vectors have similarity 0", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
});

test("zero vector yields 0, never NaN", () => {
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
});

test("rankByCosine orders by descending similarity; null embeddings last", () => {
  const items = [
    { id: "a", embedding: [0, 1] },
    { id: "b", embedding: [1, 0] },
    { id: "c", embedding: null },
  ];
  const ranked = rankByCosine(items, [0.9, 0.1], (i) => i.embedding);
  expect(ranked.map((i) => i.id)).toEqual(["b", "a", "c"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cosine.test.ts`
Expected: FAIL — `Cannot find module '../src/embeddings/cosine'`.

- [ ] **Step 3: Write the implementation**

Create `src/embeddings/cosine.ts`:

```ts
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Stable-sort a copy of `items` by descending cosine vs `query`. Items whose
 *  embedding is null/empty sort last (similarity treated as -Infinity). */
export function rankByCosine<T>(
  items: T[],
  query: number[],
  getEmbedding: (item: T) => number[] | null,
): T[] {
  return items
    .map((item, i) => {
      const e = getEmbedding(item);
      const score = e && e.length ? cosineSimilarity(query, e) : -Infinity;
      return { item, i, score };
    })
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((x) => x.item);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/cosine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/embeddings/cosine.ts test/cosine.test.ts
git commit -m "feat(embeddings): cosine similarity + ranking helper"
```

---

## Task 4: Embedding provider client

**Files:** Create `src/embeddings/client.ts`; Test `test/embed-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/embed-client.test.ts`:

```ts
import { test, expect } from "bun:test";
import { embed } from "../src/embeddings/client";

function mockFetch(body: unknown, ok = true, status = 200) {
  return async () => new Response(JSON.stringify(body), { status: ok ? 200 : status });
}
const opts = { baseUrl: "https://x", apiKey: "k", model: "m" };

test("embed returns the vector from an OpenAI-compatible response", async () => {
  const fetchImpl = mockFetch({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
  expect(await embed("hi", { ...opts, fetchImpl })).toEqual([0.1, 0.2, 0.3]);
});

test("embed throws on non-OK HTTP", async () => {
  const fetchImpl = mockFetch({}, false, 500);
  await expect(embed("hi", { ...opts, fetchImpl })).rejects.toThrow("Embeddings HTTP 500");
});

test("embed throws on malformed response", async () => {
  const fetchImpl = mockFetch({ data: [] });
  await expect(embed("hi", { ...opts, fetchImpl })).rejects.toThrow("malformed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/embed-client.test.ts`
Expected: FAIL — `Cannot find module '../src/embeddings/client'`.

- [ ] **Step 3: Write the implementation**

Create `src/embeddings/client.ts`:

```ts
export interface EmbedOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** Call an OpenAI-compatible POST {baseUrl}/embeddings and return the vector. */
export async function embed(text: string, opts: EmbedOptions): Promise<number[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ model: opts.model, input: text }),
  });
  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}`);
  const data: any = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) throw new Error("Embeddings: malformed response");
  return vec.map(Number);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/embed-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/embeddings/client.ts test/embed-client.test.ts
git commit -m "feat(embeddings): OpenAI-compatible embedding client"
```

---

## Task 5: DeepSeek feature extraction

**Files:** Create `src/keywords/features.ts`; Test `test/features.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/features.test.ts`:

```ts
import { test, expect } from "bun:test";
import { extractFeatures } from "../src/keywords/features";

function mockChat(content: string, ok = true, status = 200) {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: ok ? 200 : status });
}
const opts = { apiKey: "k", baseUrl: "https://x" };

test("extractFeatures parses a JSON features array", async () => {
  const fetchImpl = mockChat(JSON.stringify({ features: ["balkon", "umeblowane"] }));
  expect(await extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl }))
    .toEqual(["balkon", "umeblowane"]);
});

test("extractFeatures returns [] on malformed JSON", async () => {
  const fetchImpl = mockChat("not json");
  expect(await extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl })).toEqual([]);
});

test("extractFeatures throws on non-OK HTTP", async () => {
  const fetchImpl = mockChat("", false, 500);
  await expect(extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl }))
    .rejects.toThrow("DeepSeek HTTP 500");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/features.test.ts`
Expected: FAIL — `Cannot find module '../src/keywords/features'`.

- [ ] **Step 3: Write the implementation**

Create `src/keywords/features.ts` (mirrors `src/scorer/deepseek.ts`):

```ts
export interface ExtractFeaturesInput { title: string; description: string; }
export interface ExtractFeaturesOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function extractFeatures(
  input: ExtractFeaturesInput,
  opts: ExtractFeaturesOptions,
): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const system =
    "Wyodrębniasz cechy mieszkania z ogłoszenia najmu. " +
    'Zwróć WYŁĄCZNIE JSON: {"features": ["<cecha>", ...]}. ' +
    "Każda cecha to krótkie hasło po polsku, małymi literami (np. balkon, garaż, " +
    "umeblowane, blisko morza, winda, parking). Maksymalnie 12 cech.";
  const user = `Tytuł:\n${input.title}\n\nOpis:\n${input.description}`;

  const res = await doFetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed.features) ? parsed.features : [];
    return arr.map((f: unknown) => String(f).trim().toLowerCase()).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/features.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/keywords/features.ts test/features.test.ts
git commit -m "feat(keywords): DeepSeek feature extraction"
```

---

## Task 6: Embed-text composition + hash

**Files:** Create `src/embeddings/embedText.ts`; Test `test/embed-text.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/embed-text.test.ts`:

```ts
import { test, expect } from "bun:test";
import { buildEmbedText, embedTextHash } from "../src/embeddings/embedText";

const offer = {
  title: "Mieszkanie 2 pok",
  districtCanonical: "Gdańsk Wrzeszcz",
  kind: "mieszkanie",
  features: ["balkon", "umeblowane"],
  description: "Ładne mieszkanie blisko morza.",
};

test("buildEmbedText joins the salient fields", () => {
  const t = buildEmbedText(offer);
  expect(t).toContain("Gdańsk Wrzeszcz");
  expect(t).toContain("balkon umeblowane");
  expect(t).toContain("Ładne mieszkanie");
});

test("buildEmbedText truncates very long descriptions", () => {
  const t = buildEmbedText({ ...offer, description: "x".repeat(5000) });
  expect(t.length).toBeLessThanOrEqual(2200);
});

test("embedTextHash is stable and changes with content", () => {
  const a = embedTextHash(buildEmbedText(offer));
  const b = embedTextHash(buildEmbedText(offer));
  const c = embedTextHash(buildEmbedText({ ...offer, kind: "kawalerka" }));
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/embed-text.test.ts`
Expected: FAIL — `Cannot find module '../src/embeddings/embedText'`.

- [ ] **Step 3: Write the implementation**

Create `src/embeddings/embedText.ts`:

```ts
import { createHash } from "node:crypto";

export interface EmbedTextFields {
  title: string;
  districtCanonical: string | null;
  kind: string | null;
  features: string[];
  description: string | null;
}

const MAX_DESC = 2000;

export function buildEmbedText(o: EmbedTextFields): string {
  const desc = (o.description ?? "").slice(0, MAX_DESC);
  return [o.title, o.districtCanonical ?? "", o.kind ?? "", (o.features ?? []).join(" "), desc]
    .filter(Boolean)
    .join(" · ");
}

export function embedTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/embed-text.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/embeddings/embedText.ts test/embed-text.test.ts
git commit -m "feat(embeddings): embed-text composition + hash"
```

---

## Task 7: Diff helper + diff-aware upsert + snapshots

**Files:** Create `src/db/snapshot.ts`; Test `test/snapshot.test.ts`; Modify `src/db/queries.ts`; Test `test/queries.test.ts`

- [ ] **Step 1: Write the failing pure-diff test**

Create `test/snapshot.test.ts`:

```ts
import { test, expect } from "bun:test";
import { trackedFields, hasTrackedChange } from "../src/db/snapshot";

const base = {
  price: 3000, area: 40, rooms: 2, district: "Gdańsk", districtCanonical: "Gdańsk Wrzeszcz",
  kind: "mieszkanie", title: "T", description: "D", features: ["balkon"],
};

test("hasTrackedChange is true when no previous snapshot exists", () => {
  expect(hasTrackedChange(null, base)).toBe(true);
});

test("hasTrackedChange detects a price change", () => {
  expect(hasTrackedChange(base, { ...base, price: 2900 })).toBe(true);
});

test("hasTrackedChange treats equal feature sets as unchanged, different as changed", () => {
  expect(hasTrackedChange(base, { ...base, features: ["balkon"] })).toBe(false);
  expect(hasTrackedChange(base, { ...base, features: ["balkon", "garaż"] })).toBe(true);
});

test("trackedFields picks only the tracked keys", () => {
  const snap = trackedFields({ ...base, id: 1, url: "u", extra: "x" } as any);
  expect(Object.keys(snap).sort()).toEqual(
    ["area", "description", "district", "districtCanonical", "features", "kind", "price", "rooms", "title"].sort(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/snapshot.test.ts`
Expected: FAIL — `Cannot find module '../src/db/snapshot'`.

- [ ] **Step 3: Write the diff helper**

Create `src/db/snapshot.ts`:

```ts
export const TRACKED_KEYS = [
  "price", "area", "rooms", "district", "districtCanonical",
  "kind", "title", "description", "features",
] as const;

export type TrackedSnapshot = Record<(typeof TRACKED_KEYS)[number], unknown>;

export function trackedFields(o: Record<string, unknown>): TrackedSnapshot {
  const out = {} as TrackedSnapshot;
  for (const k of TRACKED_KEYS) out[k] = o[k] ?? null;
  return out;
}

function eq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return [...a].sort().join(" ") === [...b].sort().join(" ");
  }
  return a === b;
}

/** True if any tracked field differs, or there is no prior snapshot. */
export function hasTrackedChange(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): boolean {
  if (!prev) return true;
  const p = trackedFields(prev), n = trackedFields(next);
  return TRACKED_KEYS.some((k) => !eq(p[k], n[k]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/snapshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing integration test for upsert snapshots**

Add to `test/queries.test.ts` (the file already cleans `offers`/`config`/`logs` in `beforeEach`; cascade removes snapshots). Add `getOfferHistory` to its import list and append:

```ts
test("upsertOffer writes a snapshot on first insert and on change, not on no-op", async () => {
  const ext = "snaptest:1";
  await upsertOffer({ externalId: ext, url: "u", source: "trojmiasto", title: "T", price: 3000 });
  let hist = await getOfferHistory(ext);
  expect(hist.length).toBe(1); // first insert snapshot

  await upsertOffer({ externalId: ext, url: "u", source: "trojmiasto", title: "T", price: 3000 });
  hist = await getOfferHistory(ext);
  expect(hist.length).toBe(1); // no change -> no new snapshot

  await upsertOffer({ externalId: ext, url: "u", source: "trojmiasto", title: "T", price: 2900 });
  hist = await getOfferHistory(ext);
  expect(hist.length).toBe(2); // price changed -> new snapshot
  expect((hist[1]!.data as any).price).toBe(2900);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test test/queries.test.ts -t "writes a snapshot"`
Expected: FAIL — `getOfferHistory` not exported / snapshots not written.

- [ ] **Step 7: Make `upsertOffer` diff-aware + add `getOfferHistory`**

In `src/db/queries.ts`, extend imports:

```ts
import { eq, notInArray, sql, desc, asc, lt, and, inArray, isNotNull } from "drizzle-orm";
import { offers, config, logs, runLock, offerSnapshots, type Config, type NewOffer, type Offer, type LogRow, type OfferSnapshot } from "./schema";
import { hasTrackedChange, trackedFields } from "./snapshot";
```

Replace the existing `upsertOffer` with:

```ts
export async function upsertOffer(o: NewOffer): Promise<void> {
  const existing = (
    await db.select().from(offers).where(eq(offers.externalId, o.externalId)).limit(1)
  )[0] ?? null;

  // The would-be new tracked state (incoming non-null value, else keep existing).
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const k of Object.keys(o) as (keyof NewOffer)[]) {
    if (o[k] !== undefined && o[k] !== null) merged[k] = o[k];
  }

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
        url: o.url,
        district: o.district ?? sql`${offers.district}`,
        districtCanonical: o.districtCanonical ?? sql`${offers.districtCanonical}`,
        kind: o.kind ?? sql`${offers.kind}`,
        features: o.features ?? sql`${offers.features}`,
        embedding: o.embedding ?? sql`${offers.embedding}`,
        embedTextHash: o.embedTextHash ?? sql`${offers.embedTextHash}`,
        description: o.description ?? sql`${offers.description}`,
        images: o.images ?? sql`${offers.images}`,
        score: o.score ?? sql`${offers.score}`,
        scoreReasons: o.scoreReasons ?? sql`${offers.scoreReasons}`,
        status: "active",
        lastSeen: sql`now()`,
      },
    });

  if (hasTrackedChange(existing, merged)) {
    const row = (
      await db.select({ id: offers.id }).from(offers).where(eq(offers.externalId, o.externalId)).limit(1)
    )[0];
    if (row) await db.insert(offerSnapshots).values({ offerId: row.id, data: trackedFields(merged) });
  }
}

export async function getOfferHistory(externalId: string): Promise<OfferSnapshot[]> {
  const row = (
    await db.select({ id: offers.id }).from(offers).where(eq(offers.externalId, externalId)).limit(1)
  )[0];
  if (!row) return [];
  return db
    .select()
    .from(offerSnapshots)
    .where(eq(offerSnapshots.offerId, row.id))
    .orderBy(asc(offerSnapshots.capturedAt), asc(offerSnapshots.id));
}
```

- [ ] **Step 8: Run tests**

Run: `bun test test/queries.test.ts`
Expected: PASS (new + existing). Then `bun test test/check.test.ts test/refresh.test.ts` → still PASS (cascade handles snapshot cleanup).

- [ ] **Step 9: Commit**

```bash
git add src/db/snapshot.ts test/snapshot.test.ts src/db/queries.ts test/queries.test.ts
git commit -m "feat(db): diff-aware upsert writes offer_snapshots + getOfferHistory"
```

---

## Task 8: searchOffers + getFacets

**Files:** Modify `src/db/queries.ts`; Test `test/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/queries.test.ts` (add `searchOffers`, `getFacets` to imports):

```ts
async function seedSearch() {
  await upsertOffer({ externalId: "s:1", url: "u1", source: "trojmiasto", title: "A", price: 3000, districtCanonical: "Gdańsk Wrzeszcz", kind: "mieszkanie", features: ["balkon"], embedding: [1, 0] });
  await upsertOffer({ externalId: "s:2", url: "u2", source: "olx", title: "B", price: 2000, districtCanonical: "Gdynia Orłowo", kind: "kawalerka", features: ["garaż"], embedding: [0, 1] });
}

test("searchOffers filters by district", async () => {
  await seedSearch();
  const r = await searchOffers({ districts: ["Gdańsk Wrzeszcz"], sort: "newest" });
  expect(r.map((o) => o.externalId)).toEqual(["s:1"]);
});

test("searchOffers ranks by query embedding when provided", async () => {
  await seedSearch();
  const r = await searchOffers({ queryEmbedding: [0.9, 0.1], sort: "newest" });
  expect(r[0]!.externalId).toBe("s:1"); // closest to [1,0]
});

test("searchOffers sort=price ascending", async () => {
  await seedSearch();
  const r = await searchOffers({ sort: "price" });
  expect(r.map((o) => o.price)).toEqual([2000, 3000]);
});

test("getFacets returns distinct districts/kinds/features", async () => {
  await seedSearch();
  const f = await getFacets();
  expect(f.districts).toContain("Gdańsk Wrzeszcz");
  expect(f.kinds.sort()).toEqual(["kawalerka", "mieszkanie"]);
  expect(f.features.sort()).toEqual(["balkon", "garaż"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/queries.test.ts -t "searchOffers"`
Expected: FAIL — `searchOffers` not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/db/queries.ts` (`inArray`, `and`, `sql` already imported in Task 7):

```ts
export interface SearchParams {
  q?: string;
  queryEmbedding?: number[] | null;
  districts?: string[];
  kinds?: string[];
  features?: string[];
  sources?: string[];
  sort?: "score" | "newest" | "price" | "area";
}

export async function searchOffers(params: SearchParams): Promise<Offer[]> {
  const conds = [eq(offers.status, "active")];
  if (params.districts?.length) conds.push(inArray(offers.districtCanonical, params.districts));
  if (params.kinds?.length) conds.push(inArray(offers.kind, params.kinds));
  if (params.sources?.length) conds.push(inArray(offers.source, params.sources));
  if (params.features?.length) conds.push(sql`${offers.features} @> ${params.features}::text[]`);

  const rows = await db.select().from(offers).where(and(...conds));

  if (params.queryEmbedding && params.queryEmbedding.length) {
    const { rankByCosine } = await import("../embeddings/cosine");
    return rankByCosine(rows, params.queryEmbedding, (o) => o.embedding ?? null);
  }

  const sorted = [...rows];
  switch (params.sort) {
    case "newest": sorted.sort((a, b) => +new Date(b.firstSeen) - +new Date(a.firstSeen)); break;
    case "price": sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); break;
    case "area": sorted.sort((a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity)); break;
    default: sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || +new Date(b.lastSeen) - +new Date(a.lastSeen));
  }
  return sorted;
}

export async function getFacets(): Promise<{ districts: string[]; kinds: string[]; features: string[]; sources: string[] }> {
  const rows = await db
    .select({ districtCanonical: offers.districtCanonical, kind: offers.kind, features: offers.features, source: offers.source })
    .from(offers)
    .where(eq(offers.status, "active"));
  const districts = new Set<string>(), kinds = new Set<string>(), features = new Set<string>(), sources = new Set<string>();
  for (const r of rows) {
    if (r.districtCanonical) districts.add(r.districtCanonical);
    if (r.kind) kinds.add(r.kind);
    if (r.source) sources.add(r.source);
    for (const f of r.features ?? []) features.add(f);
  }
  return { districts: [...districts], kinds: [...kinds], features: [...features], sources: [...sources] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/queries.test.ts -t "searchOffers"` then `... -t "getFacets"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts test/queries.test.ts
git commit -m "feat(db): searchOffers (filters + cosine rank + sort) and getFacets"
```

---

## Task 9: Config env + enrich + pipeline wiring

**Files:** Modify `src/config.ts`; Test `test/config.test.ts`; Create `src/pipeline/enrich.ts`; Test `test/enrich.test.ts`; Modify `src/pipeline/check.ts`, `src/pipeline/refresh.ts`, `src/pipeline/deps.ts`

- [ ] **Step 1: Add embedding env to config (test first)**

Add to `test/config.test.ts`:

```ts
test("loadConfig reads embedding env with defaults", () => {
  const c = loadConfig({ DATABASE_URL: "x", EMBED_MODEL: "m", EMBED_API_KEY: "k", EMBED_BASE_URL: "https://e" });
  expect(c.embedBaseUrl).toBe("https://e");
  expect(c.embedApiKey).toBe("k");
  expect(c.embedModel).toBe("m");
});

test("loadConfig embedBaseUrl defaults to OpenAI", () => {
  const c = loadConfig({ DATABASE_URL: "x" });
  expect(c.embedBaseUrl).toBe("https://api.openai.com/v1");
});
```

(If `loadConfig` isn't already imported in `test/config.test.ts`, add `import { loadConfig } from "../src/config";`.)

Run: `bun test test/config.test.ts` → FAIL (no `embedBaseUrl`).

- [ ] **Step 2: Implement config fields**

In `src/config.ts`, add to `AppConfig`:

```ts
  embedBaseUrl: string;
  embedApiKey: string;
  embedModel: string;
```

and to the `loadConfig` return object:

```ts
    embedBaseUrl: env.EMBED_BASE_URL ?? "https://api.openai.com/v1",
    embedApiKey: env.EMBED_API_KEY ?? "",
    embedModel: env.EMBED_MODEL ?? "text-embedding-3-small",
```

Run: `bun test test/config.test.ts` → PASS.

- [ ] **Step 3: Write the enrich helper test**

Create `test/enrich.test.ts`:

```ts
import { test, expect } from "bun:test";
import { enrichOffer } from "../src/pipeline/enrich";

const deps = {
  extractFeatures: async () => ["balkon"],
  embed: async () => [0.1, 0.2],
  deepseekApiKey: "k", deepseekBaseUrl: "https://d",
  embedBaseUrl: "https://e", embedApiKey: "k", embedModel: "m",
  log: { log: async () => {} } as any,
};

test("enrichOffer adds gazetteer + features + embedding", async () => {
  const r = await enrichOffer(
    { title: "Kawalerka Wrzeszcz", price: 2000, area: 30, rooms: 1, district: "Gdańsk", description: "blisko morza", images: [] },
    { extractEnabled: true, embedEnabled: true } as any, deps,
  );
  expect(r.districtCanonical).toBe("Gdańsk Wrzeszcz");
  expect(r.kind).toBe("kawalerka");
  expect(r.features).toEqual(["balkon"]);
  expect(r.embedding).toEqual([0.1, 0.2]);
  expect(typeof r.embedTextHash).toBe("string");
});

test("enrichOffer skips extraction when disabled and never throws on provider error", async () => {
  const r = await enrichOffer(
    { title: "Dom", price: 1, area: 1, rooms: 1, district: null, description: "", images: [] },
    { extractEnabled: false, embedEnabled: true } as any,
    { ...deps, embed: async () => { throw new Error("boom"); } },
  );
  expect(r.features).toEqual([]);
  expect(r.embedding).toBeNull();
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test test/enrich.test.ts`
Expected: FAIL — `Cannot find module '../src/pipeline/enrich'`.

- [ ] **Step 5: Write the enrich helper**

Create `src/pipeline/enrich.ts`:

```ts
import type { Config, NewOffer } from "../db/schema";
import type { OfferDetail } from "../scraper/sources/types";
import type { Logger } from "../log/logger";
import { extractKeywords } from "../keywords/gazetteer";
import { buildEmbedText, embedTextHash } from "../embeddings/embedText";

export interface EnrichDeps {
  extractFeatures: (i: { title: string; description: string }, o: { apiKey: string; baseUrl: string }) => Promise<string[]>;
  embed: (text: string, o: { baseUrl: string; apiKey: string; model: string }) => Promise<number[]>;
  deepseekApiKey: string; deepseekBaseUrl: string;
  embedBaseUrl: string; embedApiKey: string; embedModel: string;
  log: Logger;
}

export type EnrichFields = Pick<NewOffer,
  "districtCanonical" | "kind" | "features" | "embedding" | "embedTextHash">;

/** Derive gazetteer keyword fields, AI features, and an embedding for a detail.
 *  Extraction/embedding failures are logged and degrade to null/[] — never throw. */
export async function enrichOffer(
  d: OfferDetail,
  config: Pick<Config, "extractEnabled" | "embedEnabled">,
  deps: EnrichDeps,
): Promise<EnrichFields> {
  const { districtCanonical, kind } = extractKeywords({ district: d.district, title: d.title });

  let features: string[] = [];
  if (config.extractEnabled && deps.deepseekApiKey) {
    try {
      features = await deps.extractFeatures(
        { title: d.title, description: d.description },
        { apiKey: deps.deepseekApiKey, baseUrl: deps.deepseekBaseUrl },
      );
    } catch (err) {
      await deps.log.log({ level: "warn", event: "enrich.features.error", message: String(err) });
    }
  }

  let embedding: number[] | null = null;
  let hash: string | null = null;
  if (config.embedEnabled && deps.embedApiKey) {
    const text = buildEmbedText({ title: d.title, districtCanonical, kind, features, description: d.description });
    hash = embedTextHash(text);
    try {
      embedding = await deps.embed(text, { baseUrl: deps.embedBaseUrl, apiKey: deps.embedApiKey, model: deps.embedModel });
    } catch (err) {
      embedding = null;
      await deps.log.log({ level: "warn", event: "enrich.embed.error", message: String(err) });
    }
  }

  return { districtCanonical, kind, features, embedding, embedTextHash: hash };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test test/enrich.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire enrich into check.ts**

In `src/pipeline/check.ts`:
- Add `import { enrichOffer, type EnrichDeps } from "./enrich";`
- Change `export interface CheckDeps {` to also extend the enrich members: `export interface CheckDeps extends EnrichDeps {` (and remove the now-duplicate `log: Logger;` line from `CheckDeps`, since `EnrichDeps` already declares it).
- In `processOffer`, after `const d = src.parseDetail(detailHtml);`, insert and spread:

```ts
    const enriched = await enrichOffer(d, config, deps);
    const base: NewOffer = {
      externalId: item.externalId,
      url: item.url,
      source: item.source,
      title: d.title,
      price: d.price,
      area: d.area,
      rooms: d.rooms,
      district: d.district,
      description: d.description,
      images: d.images,
      ...enriched,
    };
```

- [ ] **Step 8: Wire enrich into refresh.ts**

In `src/pipeline/refresh.ts`:
- Add `import { enrichOffer, type EnrichDeps } from "./enrich";`
- Change `export interface RefreshDeps {` to `export interface RefreshDeps extends EnrichDeps {` and remove its duplicate `log: Logger;` line.
- After `const d = src.parseDetail(html);` add `const enriched = await enrichOffer(d, config, deps);` and add `...enriched,` into the `row: NewOffer` object (before `score,`).

- [ ] **Step 9: Wire deps in deps.ts**

In `src/pipeline/deps.ts`:
- Add imports: `import { extractFeatures } from "../keywords/features";` and `import { embed } from "../embeddings/client";`
- In both `buildCheckDeps` (inside the `withLogging({...})` object) and `buildRefreshDeps`, add:

```ts
      extractFeatures, embed,
      embedBaseUrl: env.embedBaseUrl, embedApiKey: env.embedApiKey, embedModel: env.embedModel,
```

- [ ] **Step 10: Fix existing pipeline tests + run**

Run: `bun test test/check.test.ts test/refresh.test.ts`
Expected: FAIL where the test builds `CheckDeps`/`RefreshDeps` literals (missing new fields). Fix each by adding stub fields to the deps object:

```ts
    extractFeatures: async () => [],
    embed: async () => [0, 0],
    embedBaseUrl: "https://e", embedApiKey: "", embedModel: "m",
```

(With `embedApiKey: ""`, `enrichOffer` skips embedding, so existing assertions about scored/notified offers are unaffected.) Re-run until PASS.

- [ ] **Step 11: Commit**

```bash
git add src/config.ts test/config.test.ts src/pipeline/enrich.ts test/enrich.test.ts src/pipeline/check.ts src/pipeline/refresh.ts src/pipeline/deps.ts test/check.test.ts test/refresh.test.ts
git commit -m "feat(pipeline): enrich offers with keywords + features + embedding"
```

---

## Task 10: API endpoints

**Files:** Modify `src/api/server.ts`, `src/api/validate.ts`; Test `test/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/api.test.ts` (it already has `server`/`base` from `beforeAll`; add `upsertOffer` and `getOfferHistory` are not needed — seed via the imported `upsertOffer`). Add `import { upsertOffer } from "../src/db/queries";` and append:

```ts
test("GET /api/offers/facets returns facet sets", async () => {
  await upsertOffer({ externalId: "facet:1", url: "u", source: "trojmiasto", title: "T", kind: "mieszkanie", districtCanonical: "Gdańsk Oliwa", features: ["winda"] });
  const res = await fetch(`${base}/api/offers/facets`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { kinds: string[]; districts: string[] };
  expect(body.kinds).toContain("mieszkanie");
  expect(body.districts).toContain("Gdańsk Oliwa");
});

test("GET /api/offers/:id/history returns snapshots", async () => {
  await upsertOffer({ externalId: "hist:1", url: "u", source: "trojmiasto", title: "T", price: 100 });
  await upsertOffer({ externalId: "hist:1", url: "u", source: "trojmiasto", title: "T", price: 90 });
  const res = await fetch(`${base}/api/offers/hist%3A1/history`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as unknown[];
  expect(body.length).toBe(2);
});

test("GET /api/offers/search filters by district", async () => {
  await upsertOffer({ externalId: "search:1", url: "u", source: "trojmiasto", title: "T", districtCanonical: "Gdynia Orłowo" });
  const res = await fetch(`${base}/api/offers/search?districts=${encodeURIComponent("Gdynia Orłowo")}&sort=newest`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as Array<{ externalId: string }>;
  expect(body.some((o) => o.externalId === "search:1")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/api.test.ts -t "facets"`
Expected: FAIL (404 — route missing).

- [ ] **Step 3: Add the routes**

In `src/api/server.ts`, extend the queries import and add two more:

```ts
import { listOffers, getConfig, updateConfig, listLogs, searchOffers, getFacets, getOfferHistory } from "../db/queries";
import { embed } from "../embeddings/client";
```

Add these blocks before the existing `if (path === "/api/offers" && req.method === "GET")`:

```ts
      if (path === "/api/offers/facets" && req.method === "GET") {
        return json(await getFacets());
      }

      const historyMatch = path.match(/^\/api\/offers\/([^/]+)\/history$/);
      if (historyMatch && req.method === "GET") {
        const externalId = decodeURIComponent(historyMatch[1]!);
        return json(await getOfferHistory(externalId));
      }

      if (path === "/api/offers/search" && req.method === "GET") {
        const sp = url.searchParams;
        const list = (k: string) => sp.get(k)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
        const q = sp.get("q")?.trim() || "";
        const cfg = await getConfig();
        let queryEmbedding: number[] | null = null;
        if (q && cfg.embedEnabled) {
          const env = loadConfig();
          try {
            queryEmbedding = await embed(q, { baseUrl: env.embedBaseUrl, apiKey: env.embedApiKey, model: env.embedModel });
          } catch { queryEmbedding = null; }
        }
        const sortParam = sp.get("sort");
        const sort = (["score", "newest", "price", "area"] as const).find((s) => s === sortParam);
        const results = await searchOffers({
          q, queryEmbedding,
          districts: list("districts"), kinds: list("kinds"),
          features: list("features"), sources: list("sources"),
          sort,
        });
        return json(results);
      }
```

(`loadConfig` is already imported at the top of `server.ts`.)

- [ ] **Step 4: Allow the new config flags in validate.ts**

In `src/api/validate.ts`, add `extractEnabled` and `embedEnabled` to the boolean-validated keys, exactly mirroring how `deepseekEnabled` is handled.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/api.test.ts`
Expected: PASS. Then `bun test` (full suite) → all green.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts src/api/validate.ts test/api.test.ts
git commit -m "feat(api): /api/offers/search, /facets, /:id/history + config flags"
```

---

## Task 11: Frontend API client

**Files:** Modify `web/lib/api.ts`

- [ ] **Step 1: Extend types and add client functions**

In `web/lib/api.ts`, add to the `Offer` interface:

```ts
  kind: string | null;
  districtCanonical: string | null;
  features: string[];
```

Add to `Config`: `extractEnabled: boolean; embedEnabled: boolean;`.

Add these exports:

```ts
export interface Facets { districts: string[]; kinds: string[]; features: string[]; sources: string[] }
export interface SearchQuery {
  q?: string; districts?: string[]; kinds?: string[]; features?: string[]; sources?: string[];
  sort?: "score" | "newest" | "price" | "area";
}
export async function getFacets(): Promise<Facets> {
  return (await fetch("/api/offers/facets")).json();
}
export async function searchOffers(query: SearchQuery): Promise<Offer[]> {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  for (const k of ["districts", "kinds", "features", "sources"] as const) {
    const v = query[k]; if (v && v.length) p.set(k, v.join(","));
  }
  if (query.sort) p.set("sort", query.sort);
  return (await fetch(`/api/offers/search?${p.toString()}`)).json();
}

export interface OfferSnapshot { id: number; offerId: number; capturedAt: string; data: Record<string, unknown> }
export async function getOfferHistory(externalId: string): Promise<OfferSnapshot[]> {
  return (await fetch(`/api/offers/${encodeURIComponent(externalId)}/history`)).json();
}
```

- [ ] **Step 2: Build to type-check**

Run: `bun run build`
Expected: build succeeds (Bun transpiles + bundles the SPA; type errors surface here).

- [ ] **Step 3: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(web): search/facets/history API client + Offer keyword fields"
```

---

## Task 12: SearchBar component + Dashboard wiring

**Files:** Create `web/SearchBar.svelte`; Modify `web/Dashboard.svelte`

- [ ] **Step 1: Build the SearchBar component (layout A)**

Create `web/SearchBar.svelte`:

```svelte
<script lang="ts">
  import type { Facets, SearchQuery } from "./lib/api";
  let { facets, onChange }: { facets: Facets; onChange: (q: SearchQuery) => void } = $props();

  let q = $state("");
  let districts = $state<string[]>([]);
  let kinds = $state<string[]>([]);
  let features = $state<string[]>([]);
  let sort = $state<SearchQuery["sort"]>("score");
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function toggle(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }
  function emit() { onChange({ q, districts, kinds, features, sort }); }
  function onType() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(emit, 300);
  }
  const chip = (on: boolean) =>
    `rounded-full border px-[12px] py-[5px] text-[0.8rem] font-semibold transition-colors ${on
      ? "border-[var(--glass-border-strong)] bg-[var(--glass-fill-strong)] text-ink shadow-[var(--inset-sheen)]"
      : "border-[var(--glass-border)] bg-[var(--glass-fill)] text-ink-3 hover:text-ink"}`;
</script>

<div class="mb-[18px] flex flex-col gap-3">
  <div class="flex flex-wrap items-center gap-3">
    <input
      bind:value={q} oninput={onType}
      placeholder="Znajdź oferty… „spokojnie blisko morza”"
      class="min-w-[220px] flex-1 rounded-full border border-[rgba(120,170,255,0.35)] bg-[var(--glass-fill)] px-5 py-[10px] text-[0.9rem] text-ink outline-none placeholder:text-ink-3"
    />
    <select bind:value={sort} onchange={emit}
      class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-[9px] text-[0.85rem] text-ink-2">
      <option value="score">Trafność</option>
      <option value="newest">Najnowsze</option>
      <option value="price">Cena</option>
      <option value="area">Powierzchnia</option>
    </select>
  </div>
  {#if facets.districts.length}
    <div class="flex flex-wrap gap-2">
      {#each facets.districts as d (d)}
        <button class={chip(districts.includes(d))} onclick={() => { districts = toggle(districts, d); emit(); }}>{d}</button>
      {/each}
    </div>
  {/if}
  {#if facets.kinds.length || facets.features.length}
    <div class="flex flex-wrap gap-2">
      {#each facets.kinds as k (k)}
        <button class={chip(kinds.includes(k))} onclick={() => { kinds = toggle(kinds, k); emit(); }}>{k}</button>
      {/each}
      {#each facets.features as f (f)}
        <button class={chip(features.includes(f))} onclick={() => { features = toggle(features, f); emit(); }}>{f}</button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Wire SearchBar into Dashboard**

In `web/Dashboard.svelte`:
- Add to the imports: `SearchBar` (`import SearchBar from "./SearchBar.svelte";`), and from `./lib/api` add `searchOffers, getFacets, type Facets, type SearchQuery`.
- Add state: `let facets = $state<Facets>({ districts: [], kinds: [], features: [], sources: [] });`
- In `onMount`, after `offers = await getOffers();`, add `facets = await getFacets();`
- Add a handler:

```ts
  async function onSearch(query: SearchQuery) {
    loading = true;
    try { offers = await searchOffers(query); } finally { loading = false; }
  }
```

- Remove the source-filter state and derived list: delete the `sourceFilter` state, the `visible` derived, and the `SOURCE_FILTERS` block of markup (the `{#if !loading && offers.length > 0}` source-filter `<div>`). Replace that markup with `<SearchBar {facets} onChange={onSearch} />`.
- Replace every `visible` reference in the cards/table markup with `offers`, and the count badge `{visible.length}` with `{offers.length}`. Keep the `{:else if offers.length === 0}` empty state; remove the now-dead `{:else if visible.length === 0}` source-empty branch.

- [ ] **Step 3: Build + smoke-test**

Run: `bun run build`
Expected: build succeeds, no Svelte errors. Then run the app against the dev DB (CLAUDE.md host URL) and confirm: typing re-queries; district chip filters; sort reorders.

- [ ] **Step 4: Commit**

```bash
git add web/SearchBar.svelte web/Dashboard.svelte
git commit -m "feat(web): search bar with semantic query, filter chips, sort"
```

---

## Task 13: OfferHistory + feature chips in detail

**Files:** Create `web/OfferHistory.svelte`; Modify `web/OfferDetail.svelte`, `web/Dashboard.svelte`

- [ ] **Step 1: Build the history component (style A)**

Create `web/OfferHistory.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { getOfferHistory, type OfferSnapshot } from "./lib/api";
  import { relativeDate } from "./lib/format";
  let { externalId }: { externalId: string } = $props();

  let snaps = $state<OfferSnapshot[]>([]);
  let loaded = $state(false);
  onMount(async () => { snaps = await getOfferHistory(externalId); loaded = true; });

  const prices = $derived(
    snaps.map((s) => Number((s.data as any).price)).filter((n) => Number.isFinite(n)),
  );
  function points(vals: number[]): string {
    if (vals.length < 2) return "";
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    return vals.map((v, i) => `${(i / (vals.length - 1)) * 320},${60 - ((v - min) / span) * 50}`).join(" ");
  }
  const changes = $derived.by(() => {
    const out: { field: string; from: unknown; to: unknown; at: string }[] = [];
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1].data as any, b = snaps[i].data as any;
      for (const k of Object.keys(b)) {
        const same = Array.isArray(a[k])
          ? JSON.stringify([...a[k]].sort()) === JSON.stringify([...(b[k] ?? [])].sort())
          : a[k] === b[k];
        if (!same) out.push({ field: k, from: a[k], to: b[k], at: snaps[i].capturedAt });
      }
    }
    return out.reverse();
  });
</script>

{#if loaded && snaps.length > 1}
  <section class="mb-4 rounded-[16px] border border-[var(--glass-border)] bg-white/[0.04] p-4">
    <h3 class="m-0 mb-3 font-display text-[0.95rem] font-bold text-ink-2">Historia zmian</h3>
    {#if prices.length > 1}
      <svg viewBox="0 0 320 64" preserveAspectRatio="none" class="mb-3 h-[64px] w-full">
        <polyline points={points(prices)} fill="none" stroke="var(--color-aurora-indigo, #7dd3fc)" stroke-width="2" />
      </svg>
    {/if}
    <ul class="m-0 list-none p-0">
      {#each changes as c}
        <li class="flex items-start gap-[10px] border-t border-white/[0.07] py-[9px] text-[0.85rem]">
          <span class="rounded-[6px] border border-[var(--glass-border)] px-[7px] py-[1px] text-[0.66rem] uppercase tracking-[0.05em] text-ink-3">{c.field}</span>
          <span class="text-ink-2">
            {#if c.field === "description"}zmieniono opis{:else}<span class="text-[#f0a4a4] line-through">{String(c.from ?? "–")}</span> → <span class="font-semibold text-[#9be3b0]">{String(c.to ?? "–")}</span>{/if}
          </span>
          <span class="ml-auto whitespace-nowrap text-[0.72rem] text-ink-3">{relativeDate(c.at)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
```

- [ ] **Step 2: Wire into OfferDetail + feature chips**

In `web/OfferDetail.svelte`:
- Add `import OfferHistory from "./OfferHistory.svelte";`
- After the scoring `</section>` (before the `{#if offer.description}` block), add `<OfferHistory externalId={offer.externalId} />`.
- In the tags row (`mb-4 flex flex-wrap items-center gap-3`), after the district tag, add: `{#each offer.features ?? [] as f (f)}<span class={tagCls}>{f}</span>{/each}`

In `web/Dashboard.svelte`, in the card chip row (after the `{#if o.district}` tag), add: `{#each o.features ?? [] as f (f)}<span class="rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] px-[11px] py-1 text-[0.78rem] font-medium text-ink-2">{f}</span>{/each}`

- [ ] **Step 3: Build + smoke-test**

Run: `bun run build`
Expected: build succeeds. Open an offer that has had a price change → sparkline + timeline render; feature chips appear on cards and in the modal.

- [ ] **Step 4: Commit**

```bash
git add web/OfferHistory.svelte web/OfferDetail.svelte web/Dashboard.svelte
git commit -m "feat(web): offer change-history view + feature chips"
```

---

## Task 14: Compose env + Config UI toggles

**Files:** Modify `docker-compose.dev.yml`, `docker-compose.prod.yml`, `web/Config.svelte`

- [ ] **Step 1: Add embedding env to compose**

In both compose files, under the `app` service `environment:` block, add:

```yaml
      EMBED_BASE_URL: ${EMBED_BASE_URL:-https://api.openai.com/v1}
      EMBED_API_KEY: ${EMBED_API_KEY:-}
      EMBED_MODEL: ${EMBED_MODEL:-text-embedding-3-small}
```

- [ ] **Step 2: Surface the flags in Config UI**

In `web/Config.svelte`, add toggles for `embedEnabled` and `extractEnabled`, mirroring the existing `deepseekEnabled` toggle (same binding + save path).

- [ ] **Step 3: Build + full test**

Run: `bun run build && bun test`
Expected: build succeeds; entire suite PASS.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.dev.yml docker-compose.prod.yml web/Config.svelte
git commit -m "feat(config): embedding env vars + extraction/embedding UI toggles"
```

---

## Final verification

- [ ] `bun test` — entire suite green.
- [ ] `bun run build` — SPA builds clean.
- [ ] Manual (with `EMBED_API_KEY` set): run a crawl; confirm new offers get `district_canonical`, `kind`, `features`, and an `embedding`; the search bar returns sensible results for "blisko morza"; a refreshed offer with a changed price shows a 2-point sparkline.
- [ ] Manual (empty `EMBED_API_KEY`): app still works — search falls back to filters + sort; offers simply lack embeddings.
