---
name: create-migration
description: Hand-author a new Drizzle migration (SQL + snapshot + journal entry) for trojmiasto-wynajem, because drizzle-kit generate needs an interactive TTY that agent shells don't have. Use when src/db/schema.ts changed and a migration must be created without `bun run db:generate`.
disable-model-invocation: true
---

# Create a Drizzle migration by hand

`bun run db:generate` (drizzle-kit) needs an interactive TTY, so in an agent
shell you cannot generate migrations the normal way. Author the three artifacts
by hand. Use `drizzle/0003_multisource` and `drizzle/0004_multiportal` as
worked examples — both were hand-authored.

## Layout (what a migration is)

A migration is **three** coordinated changes:

1. `drizzle/NNNN_<name>.sql` — the forward SQL, with `--> statement-breakpoint`
   between statements (matches the existing files).
2. `drizzle/meta/NNNN_snapshot.json` — the FULL schema snapshot **after** this
   migration. Start from the previous snapshot (`NNNN-1`) and apply only your
   change. `prevId` must equal the previous snapshot's `id`; `id` is a new UUID.
3. A new entry appended to `drizzle/meta/_journal.json`.

`NNNN` is the next zero-padded index (current highest is `0004`, so the next is
`0005`).

## Steps

1. **Diff the schema.** Read `src/db/schema.ts` and the latest snapshot
   (`drizzle/meta/0004_snapshot.json`) to determine exactly which columns /
   tables / constraints changed.

2. **Write `drizzle/NNNN_<name>.sql`.** One DDL statement per block, separated by:
   ```sql
   --> statement-breakpoint
   ```
   Keep it reversible-minded and additive where possible (this project favors
   safe, non-destructive migrations — adding columns/tables over dropping).

3. **Write `drizzle/meta/NNNN_snapshot.json`.** Copy the previous snapshot, then
   edit it to reflect the new schema. Critical fields:
   - `id`: a fresh UUID (any valid v4).
   - `prevId`: the previous snapshot's `id` (copy it verbatim).
   - `version`: `"7"`, `dialect`: `"postgresql"` (match the others).
   - Update `tables` / `columns` / `indexes` / `foreignKeys` to match
     `schema.ts` exactly after the change.

4. **Append to `drizzle/meta/_journal.json`.** Add an entry to `entries`:
   ```json
   {
     "idx": 5,
     "version": "7",
     "when": <timestamp-ms>,
     "tag": "0005_<name>",
     "breakpoints": true
   }
   ```
   - `idx` = previous idx + 1.
   - `tag` = the SQL filename without `.sql`.
   - `when` = any integer strictly greater than the previous entry's `when`
     (hand-authored entries here use round ms values, e.g. `0004` used
     `1780531200000` — pick something larger).

5. **Verify against PGlite (safe).** The test suite applies migrations to an
   in-memory PGlite DB, so this validates the migration without touching any
   real database:
   ```sh
   make check        # tsc --noEmit + bun test (the CI gate)
   ```

6. **Apply to the dev DB (host, loopback-only).** Only when you intend to mutate
   the dev database:
   ```sh
   DATABASE_URL=postgres://wynajem:wynajem@localhost:5432/wynajem bun run db:migrate
   ```

## Guardrails

- **Run `make db-backup` first** if applying against any DB you care about — no
  other backups exist.
- **Never** use `bun run db:push` / `drizzle-kit push` (it can drop columns) — the
  PreToolUse guard blocks it.
- After writing the three files, consider asking the **migration-reviewer**
  subagent to verify SQL ↔ snapshot ↔ journal ↔ `schema.ts` consistency before
  applying.
