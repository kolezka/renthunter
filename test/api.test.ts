import { test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/api/server";
import { db } from "../src/db/client";
import { offers, config } from "../src/db/schema";
import { ensureConfig } from "../src/db/queries";

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  await db.delete(offers);
  await db.delete(config);
  await ensureConfig("https://search.example");
  server = createServer(0);
  base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

test("GET /api/config returns seeded config", async () => {
  const res = await fetch(`${base}/api/config`);
  expect(res.status).toBe(200);
  const c = (await res.json()) as Record<string, unknown>;
  expect(c.searchUrl).toBe("https://search.example");
});

test("PUT /api/config updates fields", async () => {
  const res = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPrice: 3800, aiCriteria: "balkon", appriseUrls: ["json://x"] }),
  });
  expect(res.status).toBe(200);
  const c = (await res.json()) as Record<string, unknown>;
  expect(c.maxPrice).toBe(3800);
  expect(c.appriseUrls).toEqual(["json://x"]);
});

test("GET /api/offers returns array", async () => {
  const res = await fetch(`${base}/api/offers`);
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});
