import { test, expect } from "bun:test";
import { scoreOffer } from "../src/scorer/deepseek";
import { embed } from "../src/embeddings/client";
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
test("scoreOffer retries on 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return jsonRes({ choices: [{ message: { content: JSON.stringify({ score: 88, reasons: "ok" }) } }] });
  };
  const r = await scoreOffer({ description: "d", criteria: "c" }, { apiKey: "k", baseUrl: "http://x", fetchImpl });
  expect(calls).toBe(2);
  expect(r.score).toBe(88);
});
test("scoreOffer throws (does not fabricate score 0) on unparseable content", async () => {
  const fetchImpl = async (): Promise<Response> =>
    jsonRes({ choices: [{ message: { content: "not json at all" } }] });
  await expect(
    scoreOffer({ description: "d", criteria: "c" }, { apiKey: "k", baseUrl: "http://x", fetchImpl }),
  ).rejects.toThrow();
});
test("embed rejects on non-finite vector elements", async () => {
  const fetchImpl = async (): Promise<Response> => jsonRes({ data: [{ embedding: ["x", 1, 2] }] });
  await expect(embed("t", { apiKey: "k", baseUrl: "http://x", model: "m", fetchImpl })).rejects.toThrow();
});
