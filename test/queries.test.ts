import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { offers, config, logs } from "../src/db/schema";
import {
  ensureConfig, getConfig, updateConfig,
  getKnownExternalIds, upsertOffer, markNotified, markInactive, listOffers,
  appendLog, listLogs, pruneLogs, getOfferByExternalId,
  getActiveScorableOffers, updateOfferScore, getOfferHistory,
  searchOffers, getFacets,
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
  const all = (await listOffers()).items;
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
  const all = (await listOffers()).items;
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
  const ids = (await listOffers()).items.map((o) => o.externalId);
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

async function seedSearch() {
  await upsertOffer({ externalId: "s:1", url: "u1", source: "trojmiasto", title: "A", price: 3000, districtCanonical: "Gdańsk Wrzeszcz", kind: "mieszkanie", features: ["balkon"], embedding: [1, 0] });
  await upsertOffer({ externalId: "s:2", url: "u2", source: "olx", title: "B", price: 2000, districtCanonical: "Gdynia Orłowo", kind: "kawalerka", features: ["garaż"], embedding: [0, 1] });
}

test("searchOffers filters by district", async () => {
  await seedSearch();
  const r = (await searchOffers({ districts: ["Gdańsk Wrzeszcz"], sort: "newest" })).items;
  expect(r.map((o) => o.externalId)).toEqual(["s:1"]);
});

test("searchOffers ranks by query embedding under relevance (Trafność) sort", async () => {
  await seedSearch();
  const r = (await searchOffers({ queryEmbedding: [0.9, 0.1], sort: "score" })).items;
  expect(r[0]!.externalId).toBe("s:1"); // closest to [1,0]
});

test("explicit sort overrides relevance for keyword (embedding) searches", async () => {
  await seedSearch(); // s:1 price 3000 (closest to query), s:2 price 2000
  const r = (await searchOffers({ queryEmbedding: [0.9, 0.1], sort: "price" })).items;
  // price asc wins over cosine relevance, so the cheaper s:2 comes first
  expect(r.map((o) => o.externalId)).toEqual(["s:2", "s:1"]);
});

test("keyword searches only return embeddable offers (relevance filter)", async () => {
  await seedSearch(); // s:1, s:2 both have embeddings
  await upsertOffer({ externalId: "s:3", url: "u3", source: "olx", title: "C", price: 100 }); // no embedding
  const page = await searchOffers({ queryEmbedding: [0.9, 0.1], sort: "price" });
  expect(page.items.find((o) => o.externalId === "s:3")).toBeUndefined();
  expect(page.total).toBe(2); // total reflects the relevant subset, not all active
});

test("searchOffers sort=price ascending", async () => {
  await seedSearch();
  const r = (await searchOffers({ sort: "price" })).items;
  expect(r.map((o) => o.price)).toEqual([2000, 3000]);
});

test("searchOffers filters by features (array contains)", async () => {
  await seedSearch();
  const r = (await searchOffers({ features: ["garaż"] })).items;
  expect(r.map((o) => o.externalId)).toEqual(["s:2"]);
});

test("getFacets returns distinct districts/kinds/features", async () => {
  await seedSearch();
  const f = await getFacets();
  expect(f.districts).toContain("Gdańsk Wrzeszcz");
  expect(f.kinds.sort()).toEqual(["kawalerka", "mieszkanie"]);
  expect(f.features.sort()).toEqual(["balkon", "garaż"]);
});

test("listOffers paginates with stable order and reports total", async () => {
  for (let i = 1; i <= 5; i++) {
    await upsertOffer({ externalId: String(i), url: "u", title: `t${i}`, score: i });
  }
  const page = await listOffers({ limit: 2, offset: 0 });
  expect(page.total).toBe(5);
  expect(page.items.length).toBe(2);
  // highest score first (5 then 4)
  expect(page.items.map((o) => o.externalId)).toEqual(["5", "4"]);

  const page2 = await listOffers({ limit: 2, offset: 2 });
  expect(page2.items.map((o) => o.externalId)).toEqual(["3", "2"]);

  // no overlap across pages
  const ids = new Set([...page.items, ...page2.items].map((o) => o.externalId));
  expect(ids.size).toBe(4);
});

test("listOffers without params returns all items with total", async () => {
  await upsertOffer({ externalId: "1", url: "u", title: "t1" });
  await upsertOffer({ externalId: "2", url: "u", title: "t2" });
  const page = await listOffers();
  expect(page.total).toBe(2);
  expect(page.items.length).toBe(2);
});

test("searchOffers paginates after ranking and reports total", async () => {
  for (let i = 1; i <= 4; i++) {
    await upsertOffer({ externalId: String(i), url: "u", title: `t${i}`, price: i * 1000 });
  }
  const page = await searchOffers({ sort: "price" }, { limit: 2, offset: 0 });
  expect(page.total).toBe(4);
  expect(page.items.map((o) => o.price)).toEqual([1000, 2000]);
  const page2 = await searchOffers({ sort: "price" }, { limit: 2, offset: 2 });
  expect(page2.items.map((o) => o.price)).toEqual([3000, 4000]);
});

test("searchOffers slices after cosine ranking", async () => {
  await upsertOffer({ externalId: "near", url: "u", title: "near", embedding: [1, 0] });
  await upsertOffer({ externalId: "far", url: "u", title: "far", embedding: [0, 1] });
  const page = await searchOffers({ queryEmbedding: [0.9, 0.1] }, { limit: 1, offset: 0 });
  expect(page.total).toBe(2);
  expect(page.items.map((o) => o.externalId)).toEqual(["near"]);
});
