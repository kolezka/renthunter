import { test, expect } from "bun:test";
import { fetchPage } from "../src/scraper/fetch";
test("fetchPage rejects when the server never responds within the timeout", async () => {
  const hang = (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await expect(fetchPage("https://example.test/x", { timeoutMs: 20, fetchImpl: hang })).rejects.toThrow();
});

test("fetchPage aborts the in-flight request when the caller signal fires", async () => {
  const controller = new AbortController();
  const fetchImpl = (_url: any, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted by signal")));
    });
  const p = fetchPage("https://example.com/list", { fetchImpl: fetchImpl as any, signal: controller.signal });
  controller.abort();
  await expect(p).rejects.toThrow("aborted by signal");
});
