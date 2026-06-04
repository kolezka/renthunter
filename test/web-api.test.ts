import { test, expect, afterEach } from "bun:test";
import { getOffers } from "../web/lib/api";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
test("getOffers throws on a non-ok response instead of returning the error body", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as unknown as typeof fetch;
  await expect(getOffers(0, 10)).rejects.toThrow();
});
