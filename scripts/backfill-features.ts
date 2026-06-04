/**
 * One-off backfill: re-map every offer's stored `features` through the canonical
 * feature taxonomy (config/features.ts), so existing rows converge on the same
 * canonical tags new extractions now produce. Pure remapping — no AI/network cost.
 *
 * Run against the target DB:
 *   DATABASE_URL=postgres://renthunter:renthunter@localhost:5432/renthunter \
 *     bun scripts/backfill-features.ts
 *
 * Idempotent: re-running it changes nothing once converged. Take a `make db-backup`
 * first, as with any direct DB write.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { canonicalizeFeatures } from "../src/keywords/features";

const rows = await db.select({ id: offers.id, features: offers.features }).from(offers);

let changed = 0;
for (const r of rows) {
  const prev = r.features ?? [];
  const next = canonicalizeFeatures(prev);
  const differs = next.length !== prev.length || next.some((v, i) => v !== prev[i]);
  if (differs) {
    await db.update(offers).set({ features: next }).where(eq(offers.id, r.id));
    changed++;
  }
}

console.log(`backfill-features: updated ${changed}/${rows.length} offers`);
process.exit(0);
