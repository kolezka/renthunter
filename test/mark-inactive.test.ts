import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { markInactive } from "../src/db/queries";
import { eq } from "drizzle-orm";

async function seedActive(externalId: string, source = "olx") {
  await db.insert(offers).values({ externalId, url: `https://x/${externalId}`, source, status: "active" });
}
beforeEach(async () => { await db.delete(offers); });

test("empty active list does NOT deactivate existing offers", async () => {
  await seedActive("a1");
  await markInactive([]);
  const [row] = await db.select().from(offers).where(eq(offers.externalId, "a1"));
  expect(row!.status).toBe("active");
});
test("offers not in the active list are deactivated", async () => {
  await seedActive("keep"); await seedActive("gone");
  await markInactive(["keep"]);
  const rows = await db.select().from(offers);
  expect(rows.find((r) => r.externalId === "keep")!.status).toBe("active");
  expect(rows.find((r) => r.externalId === "gone")!.status).toBe("inactive");
});

test("offers from excluded sources are NOT deactivated even when unlisted", async () => {
  // A source whose list scrape failed this run gives no signal about its offers —
  // they must survive reconcile while other sources reconcile normally.
  await seedActive("olx:down", "olx");
  await seedActive("tm:keep", "trojmiasto");
  await seedActive("tm:gone", "trojmiasto");
  await markInactive(["tm:keep"], { excludeSources: ["olx"] });
  const rows = await db.select().from(offers);
  expect(rows.find((r) => r.externalId === "olx:down")!.status).toBe("active");
  expect(rows.find((r) => r.externalId === "tm:keep")!.status).toBe("active");
  expect(rows.find((r) => r.externalId === "tm:gone")!.status).toBe("inactive");
});
