import { test, expect } from "bun:test";
import { refreshOffer, type RefreshDeps } from "../src/pipeline/refresh";

const baseConfig = {
  id: 1, searchUrls: ["https://search"],
  minPrice: null, maxPrice: null, minArea: null, minRooms: null,
  maxArea: null, maxRooms: null,
  aiCriteria: "blisko SKM", scoreThreshold: 70, pollIntervalMin: 5,
  appriseUrls: [], deepseekEnabled: true,
  listPages: 1, maxDetailFetchesPerRun: 30, requestDelayMs: 0, concurrencyLimit: 1,
};

function makeDeps(over: Partial<RefreshDeps> = {}): { deps: RefreshDeps; upserts: any[] } {
  const upserts: any[] = [];
  const deps: RefreshDeps = {
    getConfig: async () => baseConfig as any,
    getOffer: async () => ({ externalId: "100", url: "https://x/a-ogl100.html", source: "trojmiasto" } as any),
    fetchPage: async () => "<detail>",
    resolveSource: () => ({
      id: "trojmiasto", hosts: ["x"],
      listPageUrls: (u: string) => [u],
      parseList: () => [],
      parseDetail: () => ({ title: "Re 2pok", price: 3400, area: 48, rooms: 2, district: "Oliwa", description: "blisko SKM", images: ["https://img/a.jpg"] }),
    }),
    scoreOffer: async () => ({ score: 91, reasons: "świetna" }),
    upsertOffer: async (o) => { upserts.push(o); },
    deepseekApiKey: "k", deepseekBaseUrl: "https://api.deepseek.com",
    log: { log() {} },
    ...over,
  };
  return { deps, upserts };
}

test("refreshOffer re-scrapes, re-scores and upserts", async () => {
  const { deps, upserts } = makeDeps();
  const updated = await refreshOffer("100", deps);
  expect(upserts[0].score).toBe(91);
  expect(upserts[0].source).toBe("trojmiasto");
  expect(updated.title).toBe("Re 2pok");
  expect(updated.score).toBe(91);
});

test("refreshOffer skips scoring when deepseek disabled", async () => {
  let scored = false;
  const { deps } = makeDeps({
    getConfig: async () => ({ ...baseConfig, deepseekEnabled: false }) as any,
    scoreOffer: async () => { scored = true; return { score: 0, reasons: "" }; },
  });
  const updated = await refreshOffer("100", deps);
  expect(scored).toBe(false);
  expect(updated.score).toBeNull();
});

test("refreshOffer throws OfferNotFound for an unknown id", async () => {
  const { deps } = makeDeps({ getOffer: async () => null });
  await expect(refreshOffer("404", deps)).rejects.toThrow("offer not found");
});

test("refreshOffer persists images", async () => {
  const { deps, upserts } = makeDeps();
  await refreshOffer("100", deps);
  expect(upserts[0].images).toEqual(["https://img/a.jpg"]);
});
