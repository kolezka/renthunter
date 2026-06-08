import { test, expect } from "bun:test";
import { fetchPage, buildBrowserlessRequest } from "../../src/scraper/fetch";

const TARGET = "https://www.otodom.pl/pl/oferta/abc";

test("buildBrowserlessRequest targets the /content endpoint with stealth + token", () => {
  const { endpoint, init } = buildBrowserlessRequest(TARGET, {
    url: "http://192.168.1.50:3000",
    token: "secret",
  });
  expect(endpoint).toBe(
    "http://192.168.1.50:3000/content?token=secret&stealth=true&blockAds=true",
  );
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  const body = JSON.parse(init.body as string);
  expect(body.url).toBe(TARGET);
  expect(body.gotoOptions.waitUntil).toBe("networkidle2");
  expect(body.bestAttempt).toBe(true);
});

test("buildBrowserlessRequest omits the token param when empty", () => {
  const { endpoint } = buildBrowserlessRequest(TARGET, { url: "http://host:3000" });
  expect(endpoint).toBe("http://host:3000/content?stealth=true&blockAds=true");
});

test("fetchPage routes through browserless when configured", async () => {
  let seenUrl: string | undefined;
  let seenInit: RequestInit | undefined;
  const spy = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seenUrl = String(url);
    seenInit = init;
    return Promise.resolve(new Response("<html>rendered</html>", { status: 200 }));
  };
  const html = await fetchPage(TARGET, {
    fetchImpl: spy,
    browserless: { url: "http://host:3000", token: "t" },
  });
  expect(html).toBe("<html>rendered</html>");
  expect(seenUrl).toBe("http://host:3000/content?token=t&stealth=true&blockAds=true");
  expect(seenInit?.method).toBe("POST");
});

test("fetchPage fetches the target directly when browserless is not configured", async () => {
  let seenUrl: string | undefined;
  let seenInit: RequestInit | undefined;
  const spy = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seenUrl = String(url);
    seenInit = init;
    return Promise.resolve(new Response("<html>direct</html>", { status: 200 }));
  };
  const html = await fetchPage(TARGET, { fetchImpl: spy });
  expect(html).toBe("<html>direct</html>");
  expect(seenUrl).toBe(TARGET);
  expect(seenInit?.method).toBeUndefined();
});

test("fetchPage throws on a non-ok browserless response", async () => {
  const spy = (): Promise<Response> => Promise.resolve(new Response("nope", { status: 500 }));
  await expect(
    fetchPage(TARGET, { fetchImpl: spy, browserless: { url: "http://host:3000" } }),
  ).rejects.toThrow();
});
