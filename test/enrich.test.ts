import { test, expect } from "bun:test";
import { enrichOffer } from "../src/pipeline/enrich";

const deps = {
  extractFeatures: async () => ["balkon"],
  embed: async () => [0.1, 0.2],
  deepseekApiKey: "k", deepseekBaseUrl: "https://d",
  embedBaseUrl: "https://e", embedApiKey: "k", embedModel: "m",
  log: { log: async () => {} } as any,
};

test("enrichOffer adds gazetteer + features + embedding", async () => {
  const r = await enrichOffer(
    { title: "Kawalerka Wrzeszcz", price: 2000, area: 30, rooms: 1, district: "Gdańsk", description: "blisko morza", images: [] },
    { extractEnabled: true, embedEnabled: true } as any, deps,
  );
  expect(r.districtCanonical).toBe("Gdańsk Wrzeszcz");
  expect(r.kind).toBe("kawalerka");
  expect(r.features).toEqual(["balkon"]);
  expect(r.embedding).toEqual([0.1, 0.2]);
  expect(typeof r.embedTextHash).toBe("string");
});

test("enrichOffer skips extraction when disabled and never throws on provider error", async () => {
  const r = await enrichOffer(
    { title: "Dom", price: 1, area: 1, rooms: 1, district: null, description: "", images: [] },
    { extractEnabled: false, embedEnabled: true } as any,
    { ...deps, embed: async () => { throw new Error("boom"); } },
  );
  expect(r.features).toEqual([]);
  expect(r.embedding).toBeNull();
});

test("enrichOffer skips embedding entirely when embedEnabled is false", async () => {
  let embedCalls = 0;
  const r = await enrichOffer(
    { title: "Kawalerka Wrzeszcz", price: 2000, area: 30, rooms: 1, district: "Gdańsk", description: "blisko morza", images: [] },
    { extractEnabled: true, embedEnabled: false } as any,
    { ...deps, embed: async () => { embedCalls++; return [0.1, 0.2]; } },
  );
  expect(embedCalls).toBe(0);          // never touches the embed provider (no Ollama needed)
  expect(r.embedding).toBeNull();
  expect(r.embedTextHash).toBeNull();
  // gazetteer + feature extraction still run — only embedding is gated
  expect(r.districtCanonical).toBe("Gdańsk Wrzeszcz");
  expect(r.features).toEqual(["balkon"]);
});

test("enrichOffer skips embedding when the embed-text hash is unchanged", async () => {
  let embedCalls = 0;
  const d = { title: "Kawalerka Wrzeszcz", price: 2000, area: 30, rooms: 1, district: "Gdańsk", description: "blisko morza", images: [] };
  const local = { ...deps, embed: async () => { embedCalls++; return [0.1, 0.2]; } };
  const cfg = { extractEnabled: true, embedEnabled: true } as any;

  const first = await enrichOffer(d, cfg, local);
  expect(embedCalls).toBe(1);
  expect(first.embedding).toEqual([0.1, 0.2]);

  // Re-enrich with the prior hash → text unchanged → must NOT call embed again.
  const second = await enrichOffer(d, cfg, local, first.embedTextHash);
  expect(embedCalls).toBe(1);
  expect(second.embedding).toBeNull();         // null => upsert preserves existing embedding
  expect(second.embedTextHash).toBe(first.embedTextHash);
});

test("enrichOffer re-embeds when prior hash differs", async () => {
  let embedCalls = 0;
  const d = { title: "Kawalerka Wrzeszcz", price: 2000, area: 30, rooms: 1, district: "Gdańsk", description: "blisko morza", images: [] };
  const local = { ...deps, embed: async () => { embedCalls++; return [0.1, 0.2]; } };
  const cfg = { extractEnabled: true, embedEnabled: true } as any;
  const r = await enrichOffer(d, cfg, local, "some-old-stale-hash");
  expect(embedCalls).toBe(1);
  expect(r.embedding).toEqual([0.1, 0.2]);
});
