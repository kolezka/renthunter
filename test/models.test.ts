import { test, expect, beforeEach } from "bun:test";
import { fetchAiModels, getAiModels, clearModelsCache, MODELS_CACHE_TTL_MS } from "../src/api/models";

/** Build a fetchImpl stub. `handler` gets the requested URL string. */
function upstream(handler: (url: string, init?: RequestInit) => Response | Promise<Response> | never): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}

const okBody = (ids: string[]) =>
  new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), {
    status: 200, headers: { "content-type": "application/json" },
  });

beforeEach(() => clearModelsCache());

test("fetchAiModels parses, sorts and dedupes model ids from /v1/models", async () => {
  let requested = "";
  const r = await fetchAiModels({
    baseUrl: "https://proxy.example", apiKey: "sk-test",
    fetchImpl: upstream((url) => { requested = url; return okBody(["deepseek/deepseek-chat", "bge-m3", "bge-m3"]); }),
  });
  expect(requested).toBe("https://proxy.example/v1/models");
  expect(r.models).toEqual(["bge-m3", "deepseek/deepseek-chat"]);
  expect(r.error).toBeUndefined();
});

test("fetchAiModels sends the key as a bearer header", async () => {
  let auth: unknown;
  await fetchAiModels({
    baseUrl: "https://proxy.example", apiKey: "sk-test",
    fetchImpl: upstream((_url, init) => { auth = new Headers(init?.headers).get("authorization"); return okBody([]); }),
  });
  expect(auth).toBe("Bearer sk-test");
});

test("fetchAiModels maps non-OK upstream to a 200-shaped error result", async () => {
  const r = await fetchAiModels({
    baseUrl: "https://proxy.example", apiKey: "sk-test",
    fetchImpl: upstream(() => new Response("nope", { status: 401 })),
  });
  expect(r.models).toEqual([]);
  expect(r.error).toBe("LiteLLM returned HTTP 401");
});

test("fetchAiModels maps invalid JSON to an error result", async () => {
  const r = await fetchAiModels({
    baseUrl: "https://proxy.example", apiKey: "sk-test",
    fetchImpl: upstream(() => new Response("<html>gateway error</html>", { status: 200 })),
  });
  expect(r.models).toEqual([]);
  expect(r.error).toBe("LiteLLM returned invalid JSON");
});

test("fetchAiModels maps a timeout abort to a friendly error", async () => {
  const r = await fetchAiModels({
    baseUrl: "https://proxy.example", apiKey: "sk-test",
    // Simulates what Bun's fetch throws when AbortSignal.timeout fires.
    fetchImpl: upstream(() => { throw new DOMException("The operation timed out.", "TimeoutError"); }),
  });
  expect(r.models).toEqual([]);
  expect(r.error).toBe("LiteLLM request timed out");
});

test("the API key never appears in the result payload", async () => {
  for (const impl of [
    upstream(() => okBody(["m1"])),
    upstream(() => new Response("x", { status: 500 })),
    upstream(() => { throw new Error("boom sk-secret-123 leaked?"); }),
  ]) {
    const r = await fetchAiModels({ baseUrl: "https://proxy.example", apiKey: "sk-secret-123", fetchImpl: impl });
    expect(JSON.stringify(r)).not.toContain("sk-secret-123");
  }
});

test("getAiModels caches per baseUrl within the TTL", async () => {
  let calls = 0;
  const fetchImpl = upstream(() => { calls++; return okBody(["m1"]); });
  const opts = { baseUrl: "https://proxy.example", apiKey: "k", fetchImpl };
  await getAiModels(opts);
  await getAiModels(opts);
  expect(calls).toBe(1);
  await getAiModels({ ...opts, baseUrl: "https://other.example" });
  expect(calls).toBe(2);
});

test("getAiModels fresh=true bypasses the cache", async () => {
  let calls = 0;
  const fetchImpl = upstream(() => { calls++; return okBody(["m1"]); });
  const opts = { baseUrl: "https://proxy.example", apiKey: "k", fetchImpl };
  await getAiModels(opts);
  await getAiModels({ ...opts, fresh: true });
  expect(calls).toBe(2);
});

test("getAiModels never serves a cached error", async () => {
  let calls = 0;
  const fetchImpl = upstream(() => {
    calls++;
    return calls === 1 ? new Response("x", { status: 503 }) : okBody(["m1"]);
  });
  const opts = { baseUrl: "https://proxy.example", apiKey: "k", fetchImpl };
  const first = await getAiModels(opts);
  expect(first.error).toBeDefined();
  const second = await getAiModels(opts);   // must re-fetch, not replay the failure
  expect(second.models).toEqual(["m1"]);
  expect(calls).toBe(2);
});

test("getAiModels re-fetches after the TTL expires", async () => {
  let calls = 0;
  let t = 1_000_000;
  const fetchImpl = upstream(() => { calls++; return okBody(["m1"]); });
  const opts = { baseUrl: "https://proxy.example", apiKey: "k", fetchImpl, now: () => t };
  await getAiModels(opts);
  t += MODELS_CACHE_TTL_MS - 1;
  await getAiModels(opts);
  expect(calls).toBe(1);
  t += 2;
  await getAiModels(opts);
  expect(calls).toBe(2);
});
