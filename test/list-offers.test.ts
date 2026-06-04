import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { listOffers } from "../src/db/queries";

beforeEach(async () => { await db.delete(offers); });

test("listOffers paginates offers ordered by score desc via SQL", async () => {
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

test("listOffers without page params returns all offers", async () => {
  for (let i = 0; i < 3; i++)
    await db.insert(offers).values({ externalId: `e${i}`, url: `https://x/e${i}`, source: "olx", status: "active", score: i });
  const page = await listOffers();
  expect(page.items.length).toBe(3);
  expect(page.total).toBe(3);
});

test("listOffers returns offers of ALL statuses (active + inactive)", async () => {
  // listOffers intentionally has NO status filter — the dashboard shows a status
  // badge per row, so inactive offers must still appear. Guards against a future
  // accidental WHERE status=active silently slipping in.
  for (let i = 0; i < 3; i++)
    await db.insert(offers).values({ externalId: `a${i}`, url: `https://x/a${i}`, source: "olx", status: "active", score: i });
  for (let i = 0; i < 2; i++)
    await db.insert(offers).values({ externalId: `i${i}`, url: `https://x/i${i}`, source: "olx", status: "inactive", score: i });

  const page = await listOffers();
  expect(page.items.length).toBe(5);
  expect(page.total).toBe(5);
  const statuses = page.items.map((o) => o.status).sort();
  expect(statuses).toEqual(["active", "active", "active", "inactive", "inactive"]);
});

test("listOffers reports total across all pages from SQL count", async () => {
  for (let i = 0; i < 7; i++)
    await db.insert(offers).values({ externalId: `e${i}`, url: `https://x/e${i}`, source: "olx", status: "active", score: i });
  const page = await listOffers({ offset: 4, limit: 10 });
  expect(page.total).toBe(7);
  expect(page.items.length).toBe(3);
});
