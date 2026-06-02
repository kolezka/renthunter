// Test DB isolation: every `bun test` run gets a fresh in-memory PGlite database
// (real Postgres compiled to WASM — full dialect parity, incl. text[] arrays).
// This is injected into src/db/client.ts via globalThis BEFORE any test imports it,
// so destructive setup hooks (db.delete(...)) can NEVER touch the dev/prod database.
//
// Wired through bunfig.toml: [test] preload = ["./test/setup.ts"].
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";

const client = new PGlite(); // no path => in-memory, discarded when the process exits
const db = drizzle(client, { schema });

// Build the schema from the committed migrations (also validates that the
// migration files apply cleanly on a fresh database).
await migrate(db, { migrationsFolder: "./drizzle" });

(globalThis as { __TEST_DB__?: unknown }).__TEST_DB__ = db;
