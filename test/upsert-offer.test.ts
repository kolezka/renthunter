import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers, offerSnapshots } from "../src/db/schema";
import { upsertOffer } from "../src/db/queries";
import { eq } from "drizzle-orm";
beforeEach(async () => { await db.delete(offerSnapshots); await db.delete(offers); });

// Snapshot semantics (see src/db/snapshot.ts hasTrackedChange): a snapshot is
// recorded on the first insert (no prior snapshot) AND on any tracked-field
// change, but NOT on a no-op re-upsert. This refactor must preserve that.
test("first upsert inserts the offer and records the initial snapshot", async () => {
  await upsertOffer({ externalId: "e1", url: "https://x/e1", source: "olx", price: 1000 });
  const [o] = await db.select().from(offers).where(eq(offers.externalId, "e1"));
  expect(o.price).toBe(1000);
  expect((await db.select().from(offerSnapshots).where(eq(offerSnapshots.offerId, o.id))).length).toBe(1);
});
test("no-op re-upsert does not add a snapshot", async () => {
  await upsertOffer({ externalId: "e1", url: "https://x/e1", source: "olx", price: 1000 });
  await upsertOffer({ externalId: "e1", url: "https://x/e1", source: "olx", price: 1000 });
  const [o] = await db.select().from(offers).where(eq(offers.externalId, "e1"));
  expect((await db.select().from(offerSnapshots).where(eq(offerSnapshots.offerId, o.id))).length).toBe(1);
});
test("price change records another snapshot", async () => {
  await upsertOffer({ externalId: "e1", url: "https://x/e1", source: "olx", price: 1000 });
  await upsertOffer({ externalId: "e1", url: "https://x/e1", source: "olx", price: 1200 });
  const [o] = await db.select().from(offers).where(eq(offers.externalId, "e1"));
  expect(o.price).toBe(1200);
  expect((await db.select().from(offerSnapshots).where(eq(offerSnapshots.offerId, o.id))).length).toBe(2);
});
