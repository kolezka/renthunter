import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { listOffers, searchOffers } from "../src/db/queries";

beforeEach(async () => { await db.delete(offers); });

test("listOffers does not return the embedding column", async () => {
  await db.insert(offers).values({ externalId: "e1", url: "https://x/e1", source: "olx", status: "active", embedding: [0.1, 0.2, 0.3] });
  const page = await listOffers({ offset: 0, limit: 10 });
  expect(page.items[0]).not.toHaveProperty("embedding");
  expect(page.items[0]).not.toHaveProperty("embedTextHash");
  // The detail-only column description is still part of the shared client shape.
  expect(page.items[0]).toHaveProperty("description");
});

test("searchOffers does not return the embedding column (no-embedding branch)", async () => {
  await db.insert(offers).values({ externalId: "e1", url: "https://x/e1", source: "olx", status: "active", embedding: [0.1, 0.2, 0.3] });
  const page = await searchOffers({ sort: "score" }, { offset: 0, limit: 10 });
  expect(page.items[0]).not.toHaveProperty("embedding");
});

test("searchOffers does not return the embedding column (embedding branch)", async () => {
  await db.insert(offers).values({ externalId: "e1", url: "https://x/e1", source: "olx", status: "active", embedding: [0.9, 0.1] });
  const page = await searchOffers({ queryEmbedding: [0.9, 0.1], sort: "score" }, { offset: 0, limit: 10 });
  expect(page.items[0]).not.toHaveProperty("embedding");
});
