import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "../config";
import * as schema from "./schema";

// postgres-js (not Bun.sql `drizzle-orm/bun-sql`): the runtime db client. Tests
// don't reach this path — they run on an injected in-memory PGlite (see getDb()
// and test/setup.ts), which is why drizzle-orm/pglite is also a dependency.
function createDb() {
  const client = postgres(loadConfig().databaseUrl);
  return drizzle(client, { schema });
}
type DB = ReturnType<typeof createDb>;

let instance: DB | null = null;
function getDb(): DB {
  // Tests MUST run against an isolated PGlite db injected by test/setup.ts
  // (bunfig.toml [test] preload). If that injection is missing we refuse to fall
  // through to the real postgres-js client — running the destructive test setup
  // (db.delete(...)) against the dev/prod database would wipe live data.
  const injected = (globalThis as { __TEST_DB__?: DB }).__TEST_DB__;
  if (injected) return injected;
  if (process.env.NODE_ENV === "test") {
    throw new Error(
      "Refusing to use the real database under NODE_ENV=test. " +
        "test/setup.ts (bunfig.toml [test] preload) must inject a PGlite db before any query.",
    );
  }
  return (instance ??= createDb());
}

// Lazy proxy: constructing the real client calls loadConfig() (throws without
// DATABASE_URL) and opens a connection. Deferring to first use means merely
// IMPORTING this module — e.g. trigger.dev indexing every task file — needs no env.
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
