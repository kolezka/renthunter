import { test, expect } from "bun:test";
import { scoreOffer } from "../src/scorer/deepseek";

function fakeFetch(content: string) {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      headers: { "content-type": "application/json" },
    });
}

const opts = { apiKey: "k", baseUrl: "https://api.deepseek.com" };

test("scoreOffer parses score and reasons from JSON content", async () => {
  const result = await scoreOffer(
    { description: "ładne mieszkanie blisko SKM", criteria: "blisko SKM" },
    { ...opts, fetchImpl: fakeFetch('{"score": 85, "reasons": "blisko SKM, balkon"}') },
  );
  expect(result.score).toBe(85);
  expect(result.reasons).toContain("SKM");
});

test("scoreOffer clamps score to 0-100", async () => {
  const r = await scoreOffer(
    { description: "x", criteria: "y" },
    { ...opts, fetchImpl: fakeFetch('{"score": 250, "reasons": "z"}') },
  );
  expect(r.score).toBe(100);
});

test("scoreOffer handles non-JSON content gracefully", async () => {
  const r = await scoreOffer(
    { description: "x", criteria: "y" },
    { ...opts, fetchImpl: fakeFetch("nonsense") },
  );
  expect(r.score).toBe(0);
  expect(r.reasons).toContain("parse");
});
