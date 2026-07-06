import { test, expect } from "bun:test";
import { runCheck, maybeScore, type CheckDeps } from "../src/pipeline/check";
import type { Source } from "../src/scraper/sources/types";
import type { LogInput } from "../src/log/logger";

const baseConfig = {
  id: 1, searchUrls: ["https://search"],
  minPrice: null, maxPrice: 4000, minArea: 30, minRooms: 2,
  maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: ["json://x"], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 1,
};

/** Build a fake Source. Returns ids VERBATIM (no namespacing) so tests can
 *  assert bare ids like "100"/"good". Mimics trojmiasto pagination. */
function makeSource(over: Partial<Source> = {}): Source {
  return {
    id: "trojmiasto",
    hosts: ["x"],
    listPageUrls: (url: string, pages: number) =>
      Array.from({ length: pages }, (_, i) =>
        i === 0 ? url : `${url}/?strona=${i + 1}`,
      ),
    parseList: () => [
      { externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" },
    ],
    parseDetail: () => ({
      title: "Ładne 2pok", price: 3500, area: 50, rooms: 2,
      district: "Wrzeszcz", description: "blisko SKM",
      images: ["https://img/1.jpg", "https://img/2.jpg"],
    }),
    ...over,
  };
}

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
    resolveSource: () => makeSource(),
    scoreOffer: async () => ({ score: 88, reasons: "blisko SKM" }),
    sendNotification: async () => {},
    appriseUrl: "http://apprise:8000",
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    log: { log: (e) => { logs.push(e); } },
    extractFeatures: async () => [],
    embed: async () => [0, 0],
    embedBaseUrl: "https://e",
    embedApiKey: "",
    embedModel: "m",
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
  expect(upserts[0].source).toBe("trojmiasto");
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
    resolveSource: () => makeSource({
      parseDetail: () => ({ title: "1pok", price: 3500, area: 50, rooms: 1, district: "X", description: "", images: [] }),
    }),
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
    resolveSource: () => makeSource({
      parseList: () => [
        { externalId: "bad", url: "https://x/bad-ogl1.html", source: "trojmiasto" },
        { externalId: "good", url: "https://x/good-ogl2.html", source: "trojmiasto" },
      ],
      parseDetail: (html) => {
        if (html === "boom") throw new Error("malformed detail page");
        return { title: "OK 2pok", price: 3500, area: 50, rooms: 2, district: "W", description: "blisko SKM", images: [] };
      },
    }),
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

// List fetches degrade per-source (see the source-failure tests below); the
// run.error + rethrow contract is for genuinely unexpected failures.
test("runCheck emits run.error and rethrows on unexpected failures", async () => {
  const { deps, logs } = makeDeps({
    getKnownExternalIds: async () => { throw new Error("db down"); },
  });
  await expect(runCheck(deps)).rejects.toThrow("db down");
  expect(logs.find((l) => l.event === "run.error")).toBeDefined();
});

test("all sources failing completes the run without deactivating anything", async () => {
  const inactiveCalls: Array<{ ids: string[] }> = [];
  const { deps, logs } = makeDeps({
    fetchPage: async () => { throw new Error("everything down"); },
    markInactive: async (ids: string[]) => { inactiveCalls.push({ ids }); },
  });
  const summary = await runCheck(deps);
  expect(summary.listedCount).toBe(0);
  expect(logs.some((l) => l.event === "run.finish")).toBe(true);
  // Empty active list = "no signal": the markInactive impl deactivates nothing.
  expect(inactiveCalls[0]!.ids).toEqual([]);
});

test("maxDetailFetchesPerRun caps how many fresh offers are processed", async () => {
  const cfg = { ...baseConfig, maxDetailFetchesPerRun: 1 };
  const { deps, upserts } = makeDeps({
    getConfig: async () => cfg as any,
    resolveSource: () => makeSource({
      parseList: () => [
        { externalId: "1", url: "https://x/a-ogl1.html", source: "trojmiasto" },
        { externalId: "2", url: "https://x/b-ogl2.html", source: "trojmiasto" },
      ],
    }),
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
    resolveSource: () => makeSource({
      parseList: () => ids.map((i) => ({ externalId: i, url: `https://x/o-ogl${i}.html`, source: "trojmiasto" as const })),
    }),
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
    resolveSource: () => makeSource({
      parseList: (html) =>
        html === "<list2>"
          ? [{ externalId: "200", url: "https://x/b-ogl200.html", source: "trojmiasto" }]
          : [{ externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" }],
    }),
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

test("scrapes every source and dedups across sources by externalId", async () => {
  const bySource: Record<string, string> = {
    "https://search-a": "<list-a>",
    "https://search-b": "<list-b>",
  };
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, searchUrls: ["https://search-a", "https://search-b"] }) as any,
    fetchPage: async (url) => {
      if (url.includes("ogl")) return "<detail>";
      return bySource[url] ?? "<list>";
    },
    resolveSource: () => makeSource({
      parseList: (html) =>
        html === "<list-b>"
          ? [
              { externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" }, // dup across sources
              { externalId: "200", url: "https://x/b-ogl200.html", source: "trojmiasto" },
            ]
          : [{ externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" }],
    }),
  });
  const summary = await runCheck(deps);
  expect(summary.listedCount).toBe(2); // 100 deduped, 200 unique
  expect(summary.newCount).toBe(2);
});

test("a list page whose parseList throws is logged as list.error and skipped, run continues", async () => {
  const { deps, logs } = makeDeps({
    resolveSource: () => makeSource({
      parseList: (html: string) => {
        if (html === "<bad>") throw new Error("bot challenge");
        return [{ externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" }];
      },
      listPageUrls: (u: string) => [`${u}/bad`, u],
    }),
    fetchPage: async (url: string) => url.endsWith("/bad") ? "<bad>" : url.includes("ogl") ? "<detail>" : "<list>",
    getConfig: async () => ({ ...baseConfig, listPages: 2 }) as any,
  });
  const summary = await runCheck(deps);
  const warn = logs.find((l) => l.event === "list.error");
  expect(warn).toBeDefined();
  expect(warn!.level).toBe("warn");
  expect(summary.listedCount).toBe(1); // the good page still parsed
});

test("runCheck warns and skips a searchUrl with no registered source", async () => {
  const { deps, logs } = makeDeps({
    getConfig: async () => ({ ...baseConfig, searchUrls: ["https://unknown.example/x", "https://search"] }) as any,
    resolveSource: (url: string) => (url.includes("unknown.example") ? null : makeSource()),
  });
  const summary = await runCheck(deps);
  const warn = logs.find((l) => l.event === "source.unknown");
  expect(warn).toBeDefined();
  expect(warn!.level).toBe("warn");
  expect((warn!.context as any).searchUrl).toContain("unknown.example");
  expect(summary.listedCount).toBeGreaterThan(0);
});

test("fresh selection interleaves sources so a later source is not starved by the per-run cap", async () => {
  // Two sources, 10 fresh items each, cap of 4. Without interleaving, the merge
  // order (source A first) means fresh = first 4 = all A, starving source B.
  const srcA = makeSource({
    id: "trojmiasto", hosts: ["a"],
    parseList: () => Array.from({ length: 10 }, (_, i) => ({
      externalId: `a${i}`, url: `https://a/a${i}-ogl.html`, source: "trojmiasto" as const,
    })),
  });
  const srcB = makeSource({
    id: "otodom", hosts: ["b"],
    parseList: () => Array.from({ length: 10 }, (_, i) => ({
      externalId: `b${i}`, url: `https://b/b${i}-ogl.html`, source: "otodom" as const,
    })),
  });
  const { deps, upserts } = makeDeps({
    getConfig: async () => ({ ...baseConfig, searchUrls: ["https://a", "https://b"], maxDetailFetchesPerRun: 4 }) as any,
    resolveSource: (url: string) => {
      try { return new URL(url).hostname === "a" ? srcA : srcB; } catch { return null; }
    },
  });
  await runCheck(deps);
  const sources = new Set(upserts.map((u) => u.source));
  expect(upserts.length).toBe(4);                 // cap respected
  expect(sources.has("trojmiasto")).toBe(true);
  expect(sources.has("otodom")).toBe(true);       // the later source is NOT starved
});

test("maybeScore passes the configured model to scoreOffer", async () => {
  let sentModel: string | undefined;
  const deps = {
    scoreOffer: async (_i: any, o: any) => { sentModel = o.model; return { score: 1, reasons: "x" }; },
    deepseekApiKey: "k", deepseekBaseUrl: "https://d", deepseekModel: "deepseek/deepseek-chat",
  };
  await maybeScore(
    { description: "d" } as any,
    { deepseekEnabled: true, aiCriteria: "c", outputLanguage: "Polish" } as any,
    deps,
  );
  expect(sentModel).toBe("deepseek/deepseek-chat");
});

test("maybeScore prefers DB scorerModel + aiBaseUrl over env deps", async () => {
  let sentModel: string | undefined;
  let sentBaseUrl: string | undefined;
  const deps = {
    scoreOffer: async (_i: any, o: any) => { sentModel = o.model; sentBaseUrl = o.baseUrl; return { score: 1, reasons: "x" }; },
    deepseekApiKey: "k", deepseekBaseUrl: "https://env", deepseekModel: "deepseek/deepseek-chat",
  } as any;
  await maybeScore(
    { title: "t", description: "d", price: 1, area: 1, rooms: 1, district: "x", images: [] } as any,
    { deepseekEnabled: true, aiCriteria: "c", outputLanguage: "Polish", scorerModel: "deepseek/deepseek-reasoner", aiBaseUrl: "https://proxy" } as any,
    deps,
  );
  expect(sentModel).toBe("deepseek/deepseek-reasoner");
  expect(sentBaseUrl).toBe("https://proxy");
});

// --- Source-failure isolation: one dead source must not kill the run ---------
// Regression for the 2026-07-06 incident: an OLX list fetch failing via
// browserless (HTTP 500) aborted the whole check — remaining sources were never
// crawled and nothing already collected was processed.

test("a failing source list fetch skips that source but the run completes", async () => {
  const srcB = makeSource({
    id: "olx",
    parseList: () => [{ externalId: "olx:1", url: "https://y/o-ogl1.html", source: "olx" }],
  });
  const { deps, upserts, logs } = makeDeps({
    getConfig: async () => ({ ...baseConfig, searchUrls: ["https://a", "https://b"] }) as any,
    resolveSource: (url) => (url.startsWith("https://b") || url.startsWith("https://y") ? srcB : makeSource()),
    fetchPage: async (url) => {
      if (url.startsWith("https://b")) throw new Error("fetchPage via browserless -> HTTP 500");
      return url.includes("ogl") ? "<detail>" : "<list>";
    },
  });
  const summary = await runCheck(deps); // must NOT throw
  expect(upserts.some((o) => o.externalId === "100")).toBe(true); // healthy source fully processed
  expect(logs.some((l) => l.event === "run.finish")).toBe(true);
  expect(logs.some((l) => l.event === "run.error")).toBe(false);
  expect(logs.some((l) => l.event === "list.error" && l.context && (l.context as any).source === "olx")).toBe(true);
  expect(summary.listedCount).toBe(1);
});

test("a source whose list fetch failed is excluded from markInactive", async () => {
  const inactiveCalls: Array<{ ids: string[]; opts?: { excludeSources?: string[] } }> = [];
  const srcB = makeSource({
    id: "olx",
    parseList: () => [{ externalId: "olx:1", url: "https://y/o-ogl1.html", source: "olx" }],
  });
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, searchUrls: ["https://a", "https://b"] }) as any,
    resolveSource: (url) => (url.startsWith("https://b") || url.startsWith("https://y") ? srcB : makeSource()),
    fetchPage: async (url) => {
      if (url.startsWith("https://b")) throw new Error("HTTP 500");
      return url.includes("ogl") ? "<detail>" : "<list>";
    },
    markInactive: async (ids: string[], opts?: { excludeSources?: string[] }) => {
      inactiveCalls.push({ ids, opts });
    },
  });
  await runCheck(deps);
  expect(inactiveCalls.length).toBe(1);
  expect(inactiveCalls[0]!.ids).toEqual(["100"]);
  expect(inactiveCalls[0]!.opts?.excludeSources).toEqual(["olx"]);
});

test("list fetch failure skips the source's remaining pages", async () => {
  const fetched: string[] = [];
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, listPages: 3 }) as any,
    fetchPage: async (url) => {
      fetched.push(url);
      if (url.includes("strona=2")) throw new Error("HTTP 500");
      return url.includes("ogl") ? "<detail>" : "<list>";
    },
  });
  await runCheck(deps); // must NOT throw
  expect(fetched.some((u) => u.includes("strona=2"))).toBe(true);
  expect(fetched.some((u) => u.includes("strona=3"))).toBe(false); // pointless retries skipped
});

// --- Cancellation + crawl progress events ------------------------------------

test("aborting the signal cancels the crawl: no markInactive, run.cancelled logged", async () => {
  const controller = new AbortController();
  const inactiveCalls: string[][] = [];
  const { deps, logs, upserts } = makeDeps({
    getConfig: async () => ({ ...baseConfig, listPages: 3 }) as any,
    fetchPage: async (url) => {
      if (url.includes("strona=2")) controller.abort(); // cancel lands mid-listing
      return url.includes("ogl") ? "<detail>" : "<list>";
    },
    markInactive: async (ids: string[]) => { inactiveCalls.push(ids); },
  });
  (deps as any).signal = controller.signal;
  (deps as any).runId = "run-cancel";
  const summary = await runCheck(deps); // must NOT throw
  expect(logs.some((l) => l.event === "run.cancelled" && l.level === "info")).toBe(true);
  expect(logs.some((l) => l.event === "run.finish")).toBe(false);
  expect(inactiveCalls.length).toBe(0); // partial list must never deactivate
  expect(upserts.length).toBe(0);       // pool never started
  expect(summary.newCount).toBe(0);
});

test("abort during offer processing stops remaining offers", async () => {
  const controller = new AbortController();
  const { deps, upserts, logs } = makeDeps({
    getConfig: async () => ({ ...baseConfig, concurrencyLimit: 1 }) as any,
    resolveSource: () => makeSource({
      parseList: () => [
        { externalId: "1", url: "https://x/a-ogl1.html", source: "trojmiasto" },
        { externalId: "2", url: "https://x/b-ogl2.html", source: "trojmiasto" },
      ],
    }),
    fetchPage: async (url) => {
      if (url.includes("ogl1")) controller.abort(); // abort while offer 1 is in flight
      return url.includes("ogl") ? "<detail>" : "<list>";
    },
  });
  (deps as any).signal = controller.signal;
  await runCheck(deps);
  // offer 1 completes (abort landed after its fetch); offer 2 is never started
  expect(upserts.length).toBe(1);
  expect(logs.some((l) => l.event === "run.cancelled")).toBe(true);
});

test("runCheck emits crawl progress events in order with correct counts", async () => {
  const events: any[] = [];
  const { deps } = makeDeps({
    resolveSource: () => makeSource({
      parseList: () => [
        { externalId: "1", url: "https://x/a-ogl1.html", source: "trojmiasto" },
        { externalId: "2", url: "https://x/b-ogl2.html", source: "trojmiasto" },
      ],
    }),
  });
  (deps as any).runId = "run-prog";
  (deps as any).emitProgress = (e: any) => events.push(e);
  await runCheck(deps);
  expect(events[0]).toEqual({ type: "crawl:start", runId: "run-prog" });
  expect(events[1]).toEqual({ type: "crawl:listed", runId: "run-prog", listed: 2, toProcess: 2 });
  const offerEvents = events.filter((e) => e.type === "crawl:offer");
  expect(offerEvents.length).toBe(2);
  expect(offerEvents.map((e) => e.processed).sort()).toEqual([1, 2]);
  expect(offerEvents[0]!.total).toBe(2);
  const done = events[events.length - 1];
  expect(done.type).toBe("crawl:done");
  expect(done.summary.newCount).toBe(2);
});
