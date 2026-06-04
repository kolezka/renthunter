import { test, expect, afterEach } from "bun:test";
import { getOffers, saveConfig } from "../web/lib/api";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
test("getOffers throws on a non-ok response instead of returning the error body", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as unknown as typeof fetch;
  await expect(getOffers(0, 10)).rejects.toThrow();
});
test("saveConfig surfaces the server error message on a non-ok response", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Score threshold must be 0-100" }), { status: 400 })) as unknown as typeof fetch;
  await expect(saveConfig({})).rejects.toThrow("Score threshold must be 0-100");
});
