import { test, expect } from "bun:test";
import { runCheck, type CheckDeps } from "../src/pipeline/check";
import type { LogInput } from "../src/log/logger";

const baseConfig = {
  id: 1, searchUrl: "https://search",
  minPrice: null, maxPrice: 4000, minArea: 30, minRooms: 2,
  maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: ["json://x"], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 1,
};

function makeDeps(over: Partial<CheckDeps> = {}): { deps: CheckDeps; notified: string[]; upserts: any[]; logs: LogInput[] } {
  const notified: string[] = [];
  const upserts: any[] = [];
  const logs: LogInput[] = [];
  const deps: CheckDeps = {
    getConfig: async () => baseConfig as any,
    getKnownExternalIds: async () => new Set<string>(),
    upsertOffer: async (o) => { upserts.push(o); },
    markNotified: async (id) => { notified.push(id); },
    markInactive: async () => {},
    fetchPage: async (url) => url.includes("ogl") ? "<detail>" : "<list>",
    parseListUrls: () => [{ externalId: "100", url: "https://x/a-ogl100.html" }],
    parseDetail: () => ({ title: "Ładne 2pok", price: 3500, area: 50, rooms: 2, district: "Wrzeszcz", description: "blisko SKM", images: ["https://img/1.jpg", "https://img/2.jpg"] }),
    scoreOffer: async () => ({ score: 88, reasons: "blisko SKM" }),
    sendNotification: async () => {},
    appriseUrl: "http://apprise:8000",
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    log: { log: (e) => { logs.push(e); } },
    ...over,
  };
  return { deps, notified, upserts, logs };
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
    parseDetail: () => ({ title: "1pok", price: 3500, area: 50, rooms: 1, district: "X", description: "", images: [] }),
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
      return { title: "OK 2pok", price: 3500, area: 50, rooms: 2, district: "W", description: "blisko SKM", images: [] };
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

test("runCheck emits run.start and run.finish log events", async () => {
  const { deps, logs } = makeDeps();
  await runCheck(deps);
  expect(logs.find((l) => l.event === "run.start")).toBeDefined();
  const finish = logs.find((l) => l.event === "run.finish");
  expect(finish).toBeDefined();
  expect((finish!.context as any).newCount).toBe(1);
});

test("runCheck emits offer.error when a detail fetch fails", async () => {
  const { deps, logs } = makeDeps({
    fetchPage: async (url) => {
      if (url.includes("ogl")) throw new Error("detail down");
      return "<list>";
    },
  });
  const summary = await runCheck(deps);
  expect(summary.errorCount).toBe(1);
  const err = logs.find((l) => l.event === "offer.error");
  expect(err).toBeDefined();
  expect(err!.level).toBe("error");
  expect((err!.context as any).externalId).toBe("100");
});

test("runCheck emits run.error and rethrows when the list fetch fails", async () => {
  const { deps, logs } = makeDeps({
    fetchPage: async () => { throw new Error("list down"); },
  });
  await expect(runCheck(deps)).rejects.toThrow("list down");
  expect(logs.find((l) => l.event === "run.error")).toBeDefined();
});

test("maxDetailFetchesPerRun caps how many fresh offers are processed", async () => {
  const cfg = { ...baseConfig, maxDetailFetchesPerRun: 1 };
  const { deps, upserts } = makeDeps({
    getConfig: async () => cfg as any,
    parseListUrls: () => [
      { externalId: "1", url: "https://x/a-ogl1.html" },
      { externalId: "2", url: "https://x/b-ogl2.html" },
    ],
  });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(1);
  expect(upserts.length).toBe(1);
});

test("concurrencyLimit > 1 still processes every fresh offer once", async () => {
  const cfg = { ...baseConfig, concurrencyLimit: 4, maxDetailFetchesPerRun: 30 };
  const ids = ["1", "2", "3", "4", "5"];
  const { deps, upserts } = makeDeps({
    getConfig: async () => cfg as any,
    parseListUrls: () => ids.map((i) => ({ externalId: i, url: `https://x/o-ogl${i}.html` })),
  });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(5);
  expect(upserts.length).toBe(5);
});

test("listPages > 1 fetches and merges multiple list pages (dedup by externalId)", async () => {
  const pages: Record<string, string> = {
    "https://search": "<list1>",
    "https://search/?strona=2": "<list2>",
  };
  const fetched: string[] = [];
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, listPages: 2 }) as any,
    fetchPage: async (url) => {
      fetched.push(url);
      if (url.includes("ogl")) return "<detail>";
      return pages[url] ?? "<list>";
    },
    parseListUrls: (html) =>
      html === "<list2>"
        ? [{ externalId: "200", url: "https://x/b-ogl200.html" }]
        : [{ externalId: "100", url: "https://x/a-ogl100.html" }],
  });
  const summary = await runCheck(deps);
  expect(summary.newCount).toBe(2);
  expect(fetched.some((u) => u.includes("strona=2"))).toBe(true);
});

test("images from parseDetail are persisted on the upserted offer", async () => {
  const { deps, upserts } = makeDeps();
  await runCheck(deps);
  expect(upserts[0].images).toEqual(["https://img/1.jpg", "https://img/2.jpg"]);
});
