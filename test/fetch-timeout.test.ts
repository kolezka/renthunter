import { test, expect } from "bun:test";
import { fetchPage } from "../src/scraper/fetch";
test("fetchPage rejects when the server never responds within the timeout", async () => {
  const hang = (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await expect(fetchPage("https://example.test/x", { timeoutMs: 20, fetchImpl: hang })).rejects.toThrow();
});
