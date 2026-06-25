import { test, expect, describe, beforeEach } from "bun:test";
import { runRescore, type RescoreDeps } from "../src/pipeline/rescore";
import type { RescoreEvent } from "../src/pipeline/progress";
import { db } from "../src/db/client";
import { offers, config, runLock } from "../src/db/schema";
import { ensureConfig, updateConfig, acquireRunLock } from "../src/db/queries";
import { runRescoreGuarded } from "../src/pipeline/deps";

const env = {
  port: 0, appriseUrl: "http://apprise",
  deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
} as any;

const baseConfig = {
  id: 1, searchUrls: ["https://search"],
  minPrice: null, maxPrice: null, minArea: null, minRooms: null, maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: [], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 2,
};

function makeDeps(over: Partial<RescoreDeps> = {}): {
  deps: RescoreDeps;
  updates: Array<{ id: string; score: number | null; reasons: string | null }>;
  events: RescoreEvent[];
  notifications: Array<{ title: string; body: string; targets: string[] }>;
  notifiedIds: string[];
} {
  const updates: Array<{ id: string; score: number | null; reasons: string | null }> = [];
  const events: RescoreEvent[] = [];
  const notifications: Array<{ title: string; body: string; targets: string[] }> = [];
  const notifiedIds: string[] = [];
  const deps: RescoreDeps = {
    runId: "test-run",
    getConfig: async () => baseConfig as any,
    getActiveScorableOffers: async () => [
      { externalId: "100", description: "opis A", title: "A", price: 1000, area: 30, rooms: 1, district: "d", url: "u100", notified: false } as any,
      { externalId: "200", description: "opis B", title: "B", price: 2000, area: 40, rooms: 2, district: "d", url: "u200", notified: false } as any,
    ],
    scoreOffer: async (input) => ({ score: input.description === "opis A" ? 91 : 42, reasons: "bo " + input.description }),
    updateOfferScore: async (id, score, reasons) => { updates.push({ id, score, reasons }); },
    emitProgress: (e) => events.push(e),
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    sendNotification: async (i) => { notifications.push({ title: i.title, body: i.body, targets: i.targets }); },
    appriseUrl: "http://apprise",
    markNotified: async (id) => { notifiedIds.push(id); },
    notifyOnQualify: false,
    log: { log() {} },
    ...over,
  };
  return { deps, updates, events, notifications, notifiedIds };
}

test("runRescore scores every active offer and persists score columns", async () => {
  const { deps, updates } = makeDeps();
  const summary = await runRescore(deps);
  expect(summary).toEqual({ scored: 2, errors: 0 });
  expect(updates.find((u) => u.id === "100")).toEqual({ id: "100", score: 91, reasons: "bo opis A" });
  expect(updates.find((u) => u.id === "200")).toEqual({ id: "200", score: 42, reasons: "bo opis B" });
});

test("runRescore emits start, one scored per offer, and done", async () => {
  const { deps, events } = makeDeps();
  await runRescore(deps);
  expect(events[0]).toEqual({ type: "rescore:start", runId: "test-run", total: 2 });
  const scored = events.filter((e) => e.type === "rescore:scored");
  expect(scored.length).toBe(2);
  const done = events[events.length - 1]!;
  expect(done).toEqual({ type: "rescore:done", runId: "test-run", summary: { scored: 2, errors: 0 } });
});

test("runRescore is a no-op when deepseek disabled (writes nothing)", async () => {
  let scoreCalled = false;
  const { deps, updates, events } = makeDeps({
    getConfig: async () => ({ ...baseConfig, deepseekEnabled: false }) as any,
    scoreOffer: async () => { scoreCalled = true; return { score: 0, reasons: "" }; },
  });
  const summary = await runRescore(deps);
  expect(scoreCalled).toBe(false);
  expect(updates.length).toBe(0);
  expect(summary).toEqual({ scored: 0, errors: 0 });
  expect(events.length).toBe(0);
});

test("runRescore counts a failing offer as an error without aborting the batch", async () => {
  const { deps, updates } = makeDeps({
    scoreOffer: async (input) => {
      if (input.description === "opis A") throw new Error("deepseek 500");
      return { score: 42, reasons: "ok" };
    },
  });
  const summary = await runRescore(deps);
  expect(summary).toEqual({ scored: 1, errors: 1 });
  expect(updates).toEqual([{ id: "200", score: 42, reasons: "ok" }]);
});

test("runRescore never re-fetches detail pages", async () => {
  const seen: string[] = [];
  const { deps } = makeDeps({ scoreOffer: async (i) => { seen.push(i.description); return { score: 1, reasons: "" }; } });
  await runRescore(deps);
  expect(seen.sort()).toEqual(["opis A", "opis B"]);
});

test("notifyOnQualify notifies + marks offers crossing the threshold, skips the rest", async () => {
  const { deps, notifications, notifiedIds } = makeDeps({
    getConfig: async () => ({ ...baseConfig, scoreThreshold: 70, appriseUrls: ["ntfy://t"] }) as any,
    notifyOnQualify: true,
  });
  await runRescore(deps);
  expect(notifiedIds).toEqual(["100"]);
  expect(notifications.length).toBe(1);
  expect(notifications[0]!.title).toBe("New offer: A");
  expect(notifications[0]!.targets).toEqual(["ntfy://t"]);
});

test("notifyOnQualify does not re-notify an already-notified offer", async () => {
  const { deps, notifications, notifiedIds } = makeDeps({
    getConfig: async () => ({ ...baseConfig, scoreThreshold: 70, appriseUrls: ["ntfy://t"] }) as any,
    getActiveScorableOffers: async () => [
      { externalId: "100", description: "opis A", title: "A", price: 1, area: 1, rooms: 1, district: "d", url: "u", notified: true } as any,
    ],
    notifyOnQualify: true,
  });
  await runRescore(deps);
  expect(notifiedIds).toEqual([]);
  expect(notifications.length).toBe(0);
});

test("notifyOnQualify=false never notifies (default)", async () => {
  const { deps, notifications, notifiedIds } = makeDeps({
    getConfig: async () => ({ ...baseConfig, scoreThreshold: 70, appriseUrls: ["ntfy://t"] }) as any,
  });
  await runRescore(deps);
  expect(notifiedIds).toEqual([]);
  expect(notifications.length).toBe(0);
});

test("a failing notification is swallowed and does not abort scoring", async () => {
  const { deps, updates } = makeDeps({
    getConfig: async () => ({ ...baseConfig, scoreThreshold: 70, appriseUrls: ["ntfy://t"] }) as any,
    notifyOnQualify: true,
    sendNotification: async () => { throw new Error("apprise 424"); },
  });
  const summary = await runRescore(deps);
  expect(summary).toEqual({ scored: 2, errors: 0 });
  expect(updates.length).toBe(2);
});

test("runRescore uses DB scorerModel + aiBaseUrl when set", async () => {
  let sentModel: string | undefined;
  let sentBaseUrl: string | undefined;
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, scorerModel: "deepseek/deepseek-reasoner", aiBaseUrl: "https://proxy/" }) as any,
    scoreOffer: async (_i: any, o: any) => { sentModel = o.model; sentBaseUrl = o.baseUrl; return { score: 80, reasons: "ok" }; },
    deepseekModel: "deepseek/deepseek-chat",
  });
  await runRescore(deps);
  expect(sentModel).toBe("deepseek/deepseek-reasoner");
  expect(sentBaseUrl).toBe("https://proxy");
});

describe("runRescoreGuarded (DB)", () => {
  beforeEach(async () => {
    await db.delete(runLock); await db.delete(offers); await db.delete(config);
    await ensureConfig("https://search.example");
  });

  test("runRescoreGuarded returns { disabled } when deepseek is off", async () => {
    await updateConfig({ deepseekEnabled: false });
    const r = await runRescoreGuarded(env);
    expect(r).toEqual({ disabled: true });
  });

  test("runRescoreGuarded returns { busy } when the lock is held", async () => {
    expect(await acquireRunLock("someone-else", "manual", 15 * 60 * 1000)).toBe(true);
    const r = await runRescoreGuarded(env);
    expect(r).toEqual({ busy: true });
  });

  test("runRescoreGuarded acquires the lock and returns a runId", async () => {
    const r = await runRescoreGuarded(env);
    expect("runId" in r).toBe(true);
    if ("runId" in r) await r.done; // let it settle + release the lock
  });
});
