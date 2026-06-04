import { test, expect } from "bun:test";
import { fetchPage } from "../src/scraper/fetch";
test("fetchPage rejects when the server never responds within the timeout", async () => {
  const hang: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await expect(fetchPage("https://example.test/x", { timeoutMs: 20, fetchImpl: hang })).rejects.toThrow();
});
