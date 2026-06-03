# Keyword extraction + vector search + change history — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Summary

Three user-facing capabilities for the rental crawler, sharing one schema migration:

1. **Smart search bar** — semantic vector search ("find offers like: spokojnie blisko
   morza") combined with exact filter chips (district / kind / features).
2. **Sort by creation date** — plus other sort modes (score, price, area).
3. **Change history** — track price, description, and other parameter changes over time
   per offer, with a price sparkline and a change timeline.

Built from two underlying mechanisms:

- **Keyword extraction** — hybrid: a deterministic Trójmiasto gazetteer for
  district/kind, DeepSeek for an open-ended features list.
- **Embeddings** — a configurable, OpenAI-compatible embedding provider feeding a
  `pgvector` column for cosine-ranked semantic search.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Search engine | True embeddings (pgvector) + exact filter chips (hybrid) | User wants both keyword extraction and semantic "find offers like…" |
| Embedding provider | Configurable, OpenAI-compatible (`EMBED_BASE_URL`/`EMBED_API_KEY`/`EMBED_MODEL`) | Swap between OpenAI, Ollama, LM Studio, vLLM via env |
| Keyword extraction | Hybrid: gazetteer for district/kind, DeepSeek for features | Exact where the taxonomy is finite; AI for open-ended features |
| History storage | Full snapshots (`jsonb`), diff adjacent in UI | Simple writes; flexible read-time diffing |
| Search bar layout | A — unified top bar + chip row + sort | Extends the existing source-filter row pattern |
| History display | A — price sparkline + change timeline | Price is the headline metric |

### Defaults adopted (user-approved)

- **Dimension-agnostic `vector` column** (declared `vector`, no fixed N), exact KNN via
  `<=>` with no index. Dataset is hundreds–low-thousands of offers, so an unindexed exact
  scan is acceptable. An HNSW index can be added later once a model/dimension is locked.
- **One combined search endpoint** replaces the standalone source-filter row; source
  becomes another chip group.
- **Postgres image** swapped to `pgvector/pgvector:pg16` in dev and prod.
- **Extraction + embedding gated behind config flags**, defaulting on.

## Architecture

Five components in dependency order.

### 1. Schema / migration `0005` (hand-authored)

Per CLAUDE.md, `drizzle-kit generate` needs an interactive TTY; hand-author the SQL in
`drizzle/0005_*.sql` + `drizzle/meta/0005_snapshot.json` + a `_journal.json` entry, and
mirror the columns in `src/db/schema.ts`.

`offers` gains:

- `kind text` — kawalerka / mieszkanie / dom / pokój (gazetteer-derived)
- `district_canonical text` — normalized gazetteer hit (keep raw `district` too)
- `features text[] not null default '{}'` — DeepSeek-extracted features
- `embedding vector` — dimension-agnostic; nullable until embedded
- `embed_text_hash text` — hash of the text last embedded; skip re-embedding when unchanged

New table:

```
offer_snapshots(
  id          serial primary key,
  offer_id    integer not null references offers(id),
  captured_at timestamptz not null default now(),
  data        jsonb not null            -- snapshot of tracked fields
)
```

Migration also runs `CREATE EXTENSION IF NOT EXISTS vector;`.

Tracked fields for snapshots: `price, area, rooms, district, district_canonical, kind,
title, description, features`.

### 2. Keyword extraction

- `src/keywords/gazetteer.ts` (pure, unit-tested): a Trójmiasto taxonomy — cities
  (Gdańsk, Gdynia, Sopot) and their dzielnice (Wrzeszcz, Śródmieście, Oliwa, Przymorze,
  Zaspa, Morena, …). A diacritic-insensitive normalizer maps the messy parsed `district`
  and the title into `district_canonical` and `kind`. Deterministic, free, offline.
- `src/keywords/features.ts`: a DeepSeek call **separate from scoring** (extraction is
  criteria-independent, so it re-runs only when text changes), returning `string[]` of
  features (balkon, garaż, umeblowane, blisko morza, …). Mockable via injected `fetchImpl`,
  matching the `scoreOffer` pattern. Gated by a config flag.

### 3. Embeddings

- `src/embeddings/client.ts`: OpenAI-compatible `POST {EMBED_BASE_URL}/embeddings` with
  `EMBED_MODEL` and `EMBED_API_KEY`; injectable `fetchImpl`. Returns `number[]`.
- Embed-on-change, wired into `processOffer` and `refreshOffer` after extraction:
  - Build embed text: `title · district_canonical · kind · features.join(' ') · description(truncated)`.
  - If `hash(embedText) !== embed_text_hash`, call the provider, store `embedding` + the
    new hash. Otherwise skip.
  - Gated by an enable flag. Failures log and leave the row unembedded — never block the
    pipeline (mirrors how scoring nulls out today).

### 4. Search API

`GET /api/offers/search?q=&districts=&kind=&features=&sort=`:

- Structured params → SQL `WHERE` on `district_canonical`, `kind`, `features @> …`,
  plus the existing source filter.
- `q` present → embed the query, `ORDER BY embedding <=> $q` (cosine distance), with
  rows lacking an embedding ranked last.
- `q` empty → order by `sort`.
- `sort` ∈ `score | newest | price | area` (newest = `first_seen desc`; score keeps the
  current `score desc nulls last, last_seen desc`).
- No params → equivalent to today's `listOffers`. The frontend calls this endpoint
  instead of `/api/offers`.

`GET /api/offers/:externalId/history` → `offer_snapshots` ascending by `captured_at`.

`GET /api/offers/facets` → distinct `district_canonical`, `kind`, and `features` values
(with counts) across active offers, so the chip groups show only filters that exist.

### 5. Change history (write path)

`upsertOffer` becomes diff-aware:

1. Read the existing row's tracked fields.
2. Compare to the incoming values.
3. If any differ (or there is no prior snapshot), insert an `offer_snapshots` row capturing
   the **new** state.
4. Apply the update as today.

No snapshot is written when an unchanged refresh re-runs.

### 6. Frontend

- `web/SearchBar.svelte` (layout A): a semantic text box, district/kind/feature chip
  groups, and a sort dropdown; debounced calls to `/api/offers/search`. Replaces the
  standalone source-filter row (source becomes another chip group). Available filter
  values come from `GET /api/offers/facets`.
- Feature chips render near the existing m²/pok./district tags on cards and in the detail
  modal.
- `web/OfferHistory.svelte` inside `OfferDetail.svelte`: a price sparkline built from
  `data.price` over `captured_at`, plus a change timeline diffing adjacent snapshots
  (field badge, old → new, relative time). Loaded lazily when the modal opens.

## Infrastructure changes

- **Postgres image**: `postgres:16-alpine` → `pgvector/pgvector:pg16` in
  `docker-compose.dev.yml` and the prod compose. Same `PGDATA` volume, no data loss; the
  migration adds the extension.
- **PGlite tests**: `test/setup.ts` loads the `@electric-sql/pglite/vector` extension
  (`new PGlite({ extensions: { vector } })`) so migrations declaring a `vector` column and
  `CREATE EXTENSION vector` apply on a fresh in-memory DB.
- **Env / config**: add `EMBED_BASE_URL`, `EMBED_API_KEY`, `EMBED_MODEL` to `config.ts`
  and both compose files. Add enable flags for extraction and embedding to the `config`
  table (defaulting on), surfaced in the Config UI.

## Error handling

- Extraction and embedding failures are non-fatal: logged via the existing `Logger`, the
  pipeline continues, and the offer simply lacks features/vector until the next refresh.
- Search with `q` set but embeddings disabled/unavailable falls back to structured filter
  + sort (no vector ordering), so the bar always returns results.
- The history endpoint returns `[]` for offers with no snapshots yet (e.g. pre-existing
  rows) — the UI shows an empty-state.

## Testing

All DB-backed tests run on the injected in-memory PGlite (never the real DB).

- **Pure units**: gazetteer mapping (diacritics, multi-token addresses, unknown →
  null), snapshot-diff detection, embed-text hashing/skip logic.
- **Injected `fetchImpl`**: DeepSeek feature extraction and the embedding provider client
  (success, HTTP error, malformed JSON).
- **Integration on PGlite**: migration `0005` applies cleanly; `upsertOffer` writes a
  snapshot only on change; the search endpoint filters and orders correctly.
- **Early spike (highest-risk unknown)**: confirm `pgvector` works end-to-end in PGlite +
  drizzle `migrate` — extension load, `vector` column round-trip, `<=>` ordering — before
  building dependent components.

## Build sequence

Single worktree for the branch. Order:

1. Spike: pgvector in PGlite + drizzle `migrate`.
2. Migration `0005` + `schema.ts` + `test/setup.ts` vector extension.
3. Gazetteer (district/kind).
4. DeepSeek feature extraction.
5. Embeddings client + embed-on-change wiring.
6. Search API endpoint.
7. Change-history write path + history endpoint.
8. Frontend: search bar (A), feature chips, history view (A), sort.

Each step is TDD'd and independently testable.

## Out of scope (YAGNI)

- HNSW / ivfflat vector indexing (revisit if the dataset grows past exact-scan comfort).
- Re-embedding the entire backlog automatically on provider/model change (a manual
  re-embed action can be added later, reusing the rescore plumbing).
- Per-field specialized history tables.
