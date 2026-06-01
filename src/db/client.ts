import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "../config";
import * as schema from "./schema";

// postgres-js (not Bun.sql): the same client must run under both the Bun API
// AND trigger.dev's Node worker. Bun.sql (`drizzle-orm/bun-sql`) imports the
// `bun` builtin, which trigger.dev's esbuild bundle can't resolve. postgres-js
// runs in both runtimes.
function createDb() {
  const client = postgres(loadConfig().databaseUrl);
  return drizzle(client, { schema });
}
type DB = ReturnType<typeof createDb>;

let instance: DB | null = null;
function getDb(): DB {
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
