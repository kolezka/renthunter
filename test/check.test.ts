import { test, expect } from "bun:test";
import { runCheck, type CheckDeps } from "../src/pipeline/check";

const baseConfig = {
  id: 1, searchUrl: "https://search",
  minPrice: null, maxPrice: 4000, minArea: 30, minRooms: 2,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: ["json://x"], deepseekEnabled: true,
};

function makeDeps(over: Partial<CheckDeps> = {}): { deps: CheckDeps; notified: string[]; upserts: any[] } {
  const notified: string[] = [];
  const upserts: any[] = [];
  const deps: CheckDeps = {
    getConfig: async () => baseConfig as any,
    getKnownExternalIds: async () => new Set<string>(),
    upsertOffer: async (o) => { upserts.push(o); },
    markNotified: async (id) => { notified.push(id); },
    markInactive: async () => {},
    fetchPage: async (url) => url.includes("ogl") ? "<detail>" : "<list>",
    parseListUrls: () => [{ externalId: "100", url: "https://x/a-ogl100.html" }],
    parseDetail: () => ({ title: "Ładne 2pok", price: 3500, area: 50, rooms: 2, district: "Wrzeszcz", description: "blisko SKM" }),
    scoreOffer: async () => ({ score: 88, reasons: "blisko SKM" }),
    sendNotification: async () => {},
    appriseUrl: "http://apprise:8000",
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    ...over,
  };
  return { deps, notified, upserts };
}

test("new offer passing filters + score>=threshold gets notified", async () => {
  const { deps, notified, upserts } = makeDeps();
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(1);
  expect(summary.notifiedCount).toBe(1);
  expect(notified).toEqual(["100"]);
  expect(upserts[0].score).toBe(88);
});

test("known offer is not re-processed as new", async () => {
  const { deps, notified } = makeDeps({ getKnownExternalIds: async () => new Set(["100"]) });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(0);
  expect(notified.length).toBe(0);
});

test("offer below score threshold is saved but not notified", async () => {
  const { deps, notified } = makeDeps({ scoreOffer: async () => ({ score: 40, reasons: "daleko" }) });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(1);
  expect(notified.length).toBe(0);
});

test("offer failing hard filters is skipped (no detail score, no notify)", async () => {
  const { deps, notified } = makeDeps({
    parseDetail: () => ({ title: "1pok", price: 3500, area: 50, rooms: 1, district: "X", description: "" }),
  });
  const summary = await runCheck(deps);
  expect(summary.notifiedCount).toBe(0);
  expect(notified.length).toBe(0);
});

test("deepseekEnabled=false notifies on filters alone", async () => {
  const cfg = { ...baseConfig, deepseekEnabled: false };
  let scoreCalled = false;
  const { deps, notified } = makeDeps({
    getConfig: async () => cfg as any,
    scoreOffer: async () => { scoreCalled = true; return { score: 0, reasons: "" }; },
  });
  const summary = await runCheck(deps);
  expect(scoreCalled).toBe(false);
  expect(notified).toEqual(["100"]);
});

test("a failing offer is isolated: others still process and markInactive runs", async () => {
  let markInactiveCalled = false;
  const { deps, notified } = makeDeps({
    parseListUrls: () => [
      { externalId: "bad", url: "https://x/bad-ogl1.html" },
      { externalId: "good", url: "https://x/good-ogl2.html" },
    ],
    parseDetail: (html) => {
      if (html === "boom") throw new Error("malformed detail page");
      return { title: "OK 2pok", price: 3500, area: 50, rooms: 2, district: "W", description: "blisko SKM" };
    },
    fetchPage: async (url) =>
      url.includes("bad") ? "boom" : url.includes("ogl") ? "<detail>" : "<list>",
    markInactive: async () => { markInactiveCalled = true; },
  });
  const summary = await runCheck(deps);
  expect(summary.errorCount).toBe(1);
  expect(summary.notifiedCount).toBe(1);
  expect(notified).toEqual(["good"]);
  expect(markInactiveCalled).toBe(true);
});
