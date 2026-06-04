import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { markInactive } from "../src/db/queries";
import { eq } from "drizzle-orm";

async function seedActive(externalId: string) {
  await db.insert(offers).values({ externalId, url: `https://x/${externalId}`, source: "olx", status: "active" });
}
beforeEach(async () => { await db.delete(offers); });

test("empty active list does NOT deactivate existing offers", async () => {
  await seedActive("a1");
  await markInactive([]);
  const [row] = await db.select().from(offers).where(eq(offers.externalId, "a1"));
  expect(row.status).toBe("active");
});
test("offers not in the active list are deactivated", async () => {
  await seedActive("keep"); await seedActive("gone");
  await markInactive(["keep"]);
  const rows = await db.select().from(offers);
  expect(rows.find((r) => r.externalId === "keep")!.status).toBe("active");
  expect(rows.find((r) => r.externalId === "gone")!.status).toBe("inactive");
});
