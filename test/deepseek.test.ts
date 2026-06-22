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

test("scoreOffer throws on non-JSON content (no fabricated score 0)", async () => {
  await expect(
    scoreOffer(
      { description: "x", criteria: "y" },
      { ...opts, fetchImpl: fakeFetch("nonsense") },
    ),
  ).rejects.toThrow();
});

test("scoreOffer sends the configured model in the request body", async () => {
  let sentBody = "";
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":1,"reasons":"x"}' } }] }), { status: 200 });
  };
  await scoreOffer({ description: "x", criteria: "y" }, { ...opts, model: "deepseek/deepseek-chat", fetchImpl });
  expect(JSON.parse(sentBody).model).toBe("deepseek/deepseek-chat");
});

test("scoreOffer falls back to deepseek-chat when no model is given", async () => {
  let sentBody = "";
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":1,"reasons":"x"}' } }] }), { status: 200 });
  };
  await scoreOffer({ description: "x", criteria: "y" }, { ...opts, fetchImpl });
  expect(JSON.parse(sentBody).model).toBe("deepseek-chat");
});
