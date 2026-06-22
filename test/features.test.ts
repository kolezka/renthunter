import { test, expect } from "bun:test";
import { extractFeatures, canonicalizeFeatures } from "../src/keywords/features";

function mockChat(content: string, ok = true, status = 200) {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: ok ? 200 : status });
}
const opts = { apiKey: "k", baseUrl: "https://x" };

test("extractFeatures parses a JSON features array", async () => {
  const fetchImpl = mockChat(JSON.stringify({ features: ["balkon", "umeblowane"] }));
  expect(await extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl }))
    .toEqual(["balkon", "umeblowane"]);
});

test("extractFeatures returns [] on malformed JSON", async () => {
  const fetchImpl = mockChat("not json");
  expect(await extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl })).toEqual([]);
});

test("extractFeatures throws on non-OK HTTP", async () => {
  const fetchImpl = mockChat("", false, 500);
  await expect(extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl }))
    .rejects.toThrow("DeepSeek HTTP 500");
});

test("extractFeatures canonicalizes the model output", async () => {
  const fetchImpl = mockChat(JSON.stringify({ features: ["elevator", "winda", "balcony"] }));
  expect(await extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl }))
    .toEqual(["winda", "balkon"]);
});

test("canonicalizeFeatures collapses bilingual + inflected variants to one canonical", () => {
  expect(canonicalizeFeatures(["elevator", "winda", "windy"])).toEqual(["winda"]);
  expect(canonicalizeFeatures(["furnished", "umeblowane", "wyposażone"])).toEqual(["umeblowane"]);
  expect(canonicalizeFeatures(["near the sea", "blisko morza"])).toEqual(["blisko morza"]);
  expect(canonicalizeFeatures(["miejsce parkingowe", "parking", "miejsce postojowe"])).toEqual(["parking"]);
});

test("canonicalizeFeatures drops room/area/floor noise", () => {
  expect(canonicalizeFeatures(["2 pokoje", "51 m²", "5 piętro", "dwupokojowe", "balkon"])).toEqual(["balkon"]);
});

test("canonicalizeFeatures passes unknown tags through normalized and deduped", () => {
  expect(canonicalizeFeatures(["Jacuzzi", "jacuzzi", "kominek"])).toEqual(["jacuzzi", "kominek"]);
});

test("canonicalizeFeatures caps at 12", () => {
  const many = Array.from({ length: 20 }, (_, i) => `unique-tag-${i}`);
  expect(canonicalizeFeatures(many).length).toBe(12);
});

test("canonicalizeFeatures maps the extended aliases", () => {
  expect(canonicalizeFeatures(["district heating"])).toEqual(["ogrzewanie miejskie"]);
  expect(canonicalizeFeatures(["robot vacuum", "odkurzacz robot"])).toEqual(["odkurzacz"]);
  expect(canonicalizeFeatures(["available now"])).toEqual(["gotowe do zamieszkania"]);
  expect(canonicalizeFeatures(["park", "near park"])).toEqual(["blisko parku"]);
  expect(canonicalizeFeatures(["two bathrooms"])).toEqual(["dwie łazienki"]);
});

test("extractFeatures steers the model with the canonical tag list", async () => {
  let sentBody = "";
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"features":[]}' } }] }), { status: 200 });
  };
  await extractFeatures({ title: "t", description: "d" }, { ...opts, fetchImpl });
  expect(sentBody).toContain("winda");
  expect(sentBody).toContain("blisko morza");
});

test("extractFeatures sends the configured model in the request body", async () => {
  let sentBody = "";
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"features":[]}' } }] }), { status: 200 });
  };
  await extractFeatures({ title: "t", description: "d" }, { ...opts, model: "deepseek/deepseek-chat", fetchImpl });
  expect(JSON.parse(sentBody).model).toBe("deepseek/deepseek-chat");
});
