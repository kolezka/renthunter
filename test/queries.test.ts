import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { offers, config, logs } from "../src/db/schema";
import {
  ensureConfig, getConfig, updateConfig,
  getKnownExternalIds, upsertOffer, markNotified, markInactive, listOffers,
  appendLog, listLogs, pruneLogs, getOfferByExternalId,
  getActiveScorableOffers, updateOfferScore, getOfferHistory,
} from "../src/db/queries";

beforeEach(async () => {
  await db.delete(offers);
  await db.delete(config);
  await db.delete(logs);
});

test("ensureConfig seeds a single default row", async () => {
  await ensureConfig("https://example.com/search");
  const c = await getConfig();
  expect(c.id).toBe(1);
  expect(c.searchUrls).toEqual(["https://example.com/search"]);
  expect(c.scoreThreshold).toBe(70);
  await ensureConfig("https://other");
  const c2 = await getConfig();
  expect(c2.searchUrls).toEqual(["https://example.com/search"]);
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

test("appendLog inserts a row; listLogs returns newest-first", async () => {
  await appendLog({ level: "info", event: "run.start", message: "started", runId: "r1" });
  await appendLog({ level: "error", event: "fetch", message: "boom", runId: "r1", context: { url: "u" } });
  const rows = await listLogs();
  expect(rows.length).toBe(2);
  expect(rows[0]!.event).toBe("fetch"); // newest first
  expect(rows[0]!.context).toEqual({ url: "u" });
  expect(rows[1]!.event).toBe("run.start");
  expect(rows[0]!.runId).toBe("r1");
});

test("listLogs honors limit", async () => {
  for (let i = 0; i < 5; i++) {
    await appendLog({ level: "info", event: "fetch", message: `m${i}` });
  }
  const rows = await listLogs({ limit: 3 });
  expect(rows.length).toBe(3);
});

test("pruneLogs deletes entries older than 7 days", async () => {
  await db.insert(logs).values({
    level: "info", event: "old", message: "stale",
    ts: sql`now() - interval '8 days'`,
  });
  await appendLog({ level: "info", event: "fresh", message: "keep" });
  await pruneLogs();
  const rows = await listLogs();
  expect(rows.length).toBe(1);
  expect(rows[0]!.event).toBe("fresh");
});

test("getOfferByExternalId returns the row or null", async () => {
  await upsertOffer({ externalId: "ext-1", url: "https://x/a-ogl1.html", title: "T" });
  const found = await getOfferByExternalId("ext-1");
  expect(found?.externalId).toBe("ext-1");
  expect(await getOfferByExternalId("nope")).toBeNull();
});

test("getActiveScorableOffers excludes inactive and null-description rows", async () => {
  await upsertOffer({ externalId: "a", url: "u", title: "t", description: "ma opis" });
  await upsertOffer({ externalId: "b", url: "u", title: "t" }); // active but null description
  await upsertOffer({ externalId: "c", url: "u", title: "t", description: "też opis" });
  await markInactive(["b", "c"]); // a -> inactive; b and c stay active
  const rows = await getActiveScorableOffers();
  // a excluded by status; b excluded by null description; only c qualifies
  expect(rows.map((r) => r.externalId)).toEqual(["c"]);
});

test("updateOfferScore changes only score columns, leaves status/title", async () => {
  await upsertOffer({ externalId: "x", url: "u", title: "Tytuł", description: "d", score: 10, scoreReasons: "old" });
  await updateOfferScore("x", 88, "świetna");
  const o = await getOfferByExternalId("x");
  expect(o?.score).toBe(88);
  expect(o?.scoreReasons).toBe("świetna");
  expect(o?.title).toBe("Tytuł");   // untouched
  expect(o?.status).toBe("active"); // untouched
});

test("updateOfferScore can clear a score back to null", async () => {
  await upsertOffer({ externalId: "y", url: "u", title: "t", description: "d", score: 55, scoreReasons: "stare" });
  await updateOfferScore("y", null, null);
  const o = await getOfferByExternalId("y");
  expect(o?.score).toBeNull();
  expect(o?.scoreReasons).toBeNull();
});

test("upsertOffer writes a snapshot on first insert and on change, not on no-op", async () => {
  const ext = "snaptest:1";
  await upsertOffer({ externalId: ext, url: "u", source: "trojmiasto", title: "T", price: 3000 });
  let hist = await getOfferHistory(ext);
  expect(hist.length).toBe(1); // first insert snapshot

  await upsertOffer({ externalId: ext, url: "u", source: "trojmiasto", title: "T", price: 3000 });
  hist = await getOfferHistory(ext);
  expect(hist.length).toBe(1); // no change -> no new snapshot

  await upsertOffer({ externalId: ext, url: "u", source: "trojmiasto", title: "T", price: 2900 });
  hist = await getOfferHistory(ext);
  expect(hist.length).toBe(2); // price changed -> new snapshot
  expect((hist[1]!.data as any).price).toBe(2900);
});
