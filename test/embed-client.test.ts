import { test, expect } from "bun:test";
import { embed } from "../src/embeddings/client";

function mockFetch(body: unknown, ok = true, status = 200) {
  return async () => new Response(JSON.stringify(body), { status: ok ? 200 : status });
}
const opts = { baseUrl: "https://x", apiKey: "k", model: "m" };

test("embed returns the vector from an OpenAI-compatible response", async () => {
  const fetchImpl = mockFetch({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
  expect(await embed("hi", { ...opts, fetchImpl })).toEqual([0.1, 0.2, 0.3]);
});

test("embed throws on non-OK HTTP", async () => {
  const fetchImpl = mockFetch({}, false, 500);
  await expect(embed("hi", { ...opts, fetchImpl })).rejects.toThrow("Embeddings HTTP 500");
});

test("embed throws on malformed response", async () => {
  const fetchImpl = mockFetch({ data: [] });
  await expect(embed("hi", { ...opts, fetchImpl })).rejects.toThrow("malformed");
});
