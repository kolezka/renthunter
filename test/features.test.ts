import { test, expect } from "bun:test";
import { extractFeatures } from "../src/keywords/features";

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
