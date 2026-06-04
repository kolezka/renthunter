import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { listOffers } from "../src/db/queries";

beforeEach(async () => { await db.delete(offers); });

test("listOffers paginates active offers ordered by score desc via SQL", async () => {
  for (let i = 0; i < 5; i++)
    await db.insert(offers).values({ externalId: `e${i}`, url: `https://x/e${i}`, source: "olx", status: "active", score: i * 10 });
  const page1 = await listOffers({ offset: 0, limit: 2 });
  expect(page1.items.length).toBe(2);
  expect(page1.total).toBe(5);
  expect(page1.items[0]!.score).toBe(40);
  expect(page1.items[1]!.score).toBe(30);

  const page2 = await listOffers({ offset: 2, limit: 2 });
  expect(page2.items.length).toBe(2);
  expect(page2.items[0]!.score).toBe(20);
});

test("listOffers without page params returns all active offers", async () => {
  for (let i = 0; i < 3; i++)
    await db.insert(offers).values({ externalId: `e${i}`, url: `https://x/e${i}`, source: "olx", status: "active", score: i });
  const page = await listOffers();
  expect(page.items.length).toBe(3);
  expect(page.total).toBe(3);
});

test("listOffers reports total across all pages from SQL count", async () => {
  for (let i = 0; i < 7; i++)
    await db.insert(offers).values({ externalId: `e${i}`, url: `https://x/e${i}`, source: "olx", status: "active", score: i });
  const page = await listOffers({ offset: 4, limit: 10 });
  expect(page.total).toBe(7);
  expect(page.items.length).toBe(3);
});
