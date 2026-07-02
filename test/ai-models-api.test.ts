import { test, expect } from "bun:test";
import { createServer } from "../src/api/server";
import type { AiModelsResult } from "../src/api/models";

function serve(stub: (fresh: boolean, baseUrlOverride?: string) => Promise<AiModelsResult>) {
  const s = createServer(0, { getAiModels: stub });
  return { s, base: `http://localhost:${s.port}` };
}

test("GET /api/ai/models returns the model list", async () => {
  const { s, base } = serve(async () => ({ models: ["bge-m3", "deepseek/deepseek-chat"] }));
  try {
    const res = await fetch(`${base}/api/ai/models`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: ["bge-m3", "deepseek/deepseek-chat"] });
  } finally { s.stop(true); }
});

test("GET /api/ai/models forwards fresh=1 and baseUrl to the resolver", async () => {
  const seen: Array<{ fresh: boolean; baseUrlOverride?: string }> = [];
  const { s, base } = serve(async (fresh, baseUrlOverride) => {
    seen.push({ fresh, baseUrlOverride });
    return { models: [] };
  });
  try {
    await fetch(`${base}/api/ai/models`);
    await fetch(`${base}/api/ai/models?fresh=1&baseUrl=${encodeURIComponent("https://proxy.example")}`);
    expect(seen).toEqual([
      { fresh: false, baseUrlOverride: undefined },
      { fresh: true, baseUrlOverride: "https://proxy.example" },
    ]);
  } finally { s.stop(true); }
});

test("a degraded upstream is still HTTP 200 with an error field", async () => {
  const { s, base } = serve(async () => ({ models: [], error: "LiteLLM returned HTTP 401" }));
  try {
    const res = await fetch(`${base}/api/ai/models`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [], error: "LiteLLM returned HTTP 401" });
  } finally { s.stop(true); }
});

test("a malformed baseUrl param is a 400, not an upstream call", async () => {
  let called = false;
  const { s, base } = serve(async () => { called = true; return { models: [] }; });
  try {
    for (const bad of ["notaurl", "ftp://x.example", "https://" + "x".repeat(300)]) {
      const res = await fetch(`${base}/api/ai/models?baseUrl=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
    expect(called).toBe(false);
  } finally { s.stop(true); }
});
