import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers, config } from "../src/db/schema";
import {
  ensureConfig, getConfig, updateConfig,
  getKnownExternalIds, upsertOffer, markNotified, markInactive, listOffers,
} from "../src/db/queries";

beforeEach(async () => {
  await db.delete(offers);
  await db.delete(config);
});

test("ensureConfig seeds a single default row", async () => {
  await ensureConfig("https://example.com/search");
  const c = await getConfig();
  expect(c.id).toBe(1);
  expect(c.searchUrl).toBe("https://example.com/search");
  expect(c.scoreThreshold).toBe(70);
  await ensureConfig("https://other");
  const c2 = await getConfig();
  expect(c2.searchUrl).toBe("https://example.com/search");
});

test("updateConfig changes editable fields", async () => {
  await ensureConfig("https://example.com/search");
  await updateConfig({ maxPrice: 3500, aiCriteria: "blisko SKM", appriseUrls: ["json://x"] });
  const c = await getConfig();
  expect(c.maxPrice).toBe(3500);
  expect(c.aiCriteria).toBe("blisko SKM");
  expect(c.appriseUrls).toEqual(["json://x"]);
});

test("upsertOffer inserts then updates lastSeen without duplicating", async () => {
  await upsertOffer({ externalId: "111", url: "u", title: "t" });
  await upsertOffer({ externalId: "111", url: "u", title: "t2" });
  const all = await listOffers();
  expect(all.length).toBe(1);
  expect(all[0]!.title).toBe("t2");
});

test("getKnownExternalIds returns existing ids", async () => {
  await upsertOffer({ externalId: "111", url: "u", title: "t" });
  await upsertOffer({ externalId: "222", url: "u", title: "t" });
  const known = await getKnownExternalIds();
  expect(known.has("111")).toBe(true);
  expect(known.has("222")).toBe(true);
  expect(known.has("333")).toBe(false);
});

test("markNotified and markInactive", async () => {
  await upsertOffer({ externalId: "111", url: "u", title: "t" });
  await upsertOffer({ externalId: "222", url: "u", title: "t" });
  await markNotified("111");
  await markInactive(["111"]);
  const all = await listOffers();
  const o222 = all.find((o) => o.externalId === "222")!;
  const o111 = all.find((o) => o.externalId === "111")!;
  expect(o111.notified).toBe(true);
  expect(o111.status).toBe("active");
  expect(o222.status).toBe("inactive");
});

test("listOffers sorts scored offers above unscored (NULLS LAST)", async () => {
  await upsertOffer({ externalId: "low", url: "u", title: "t", score: 30 });
  await upsertOffer({ externalId: "none", url: "u", title: "t" }); // score null
  await upsertOffer({ externalId: "high", url: "u", title: "t", score: 90 });
  const ids = (await listOffers()).map((o) => o.externalId);
  expect(ids).toEqual(["high", "low", "none"]);
});
