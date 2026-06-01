import { test, expect } from "bun:test";
import { sendNotification } from "../src/notify/apprise";

test("sendNotification posts urls/title/body to apprise /notify", async () => {
  let captured: any = null;
  const fakeFetch = (async (url: string, init: any) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  await sendNotification({
    appriseUrl: "http://apprise:8000",
    targets: ["json://host", "tgram://token/chat"],
    title: "Nowa oferta",
    body: "3 pokoje, 3500 zł",
    fetchImpl: fakeFetch,
  });

  expect(captured.url).toBe("http://apprise:8000/notify");
  expect(captured.body.urls).toBe("json://host,tgram://token/chat");
  expect(captured.body.title).toBe("Nowa oferta");
  expect(captured.body.body).toBe("3 pokoje, 3500 zł");
});

test("sendNotification skips when no targets", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return new Response("ok"); }) as unknown as typeof fetch;
  await sendNotification({ appriseUrl: "http://x", targets: [], title: "t", body: "b", fetchImpl: fakeFetch });
  expect(called).toBe(false);
});
