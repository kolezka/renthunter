import { test, expect, beforeEach } from "bun:test";
import { db } from "../src/db/client";
import { offers } from "../src/db/schema";
import { getFacets } from "../src/db/queries";

beforeEach(async () => { await db.delete(offers); });

test("getFacets returns distinct districts and kinds from active offers", async () => {
  await db.insert(offers).values({ externalId: "a", url: "u", source: "olx", status: "active", districtCanonical: "wrzeszcz", kind: "mieszkanie" });
  await db.insert(offers).values({ externalId: "b", url: "u", source: "olx", status: "active", districtCanonical: "wrzeszcz", kind: "pokoj" });
  const f = await getFacets();
  expect([...f.districts].sort()).toEqual(["wrzeszcz"]);
  expect([...f.kinds].sort()).toEqual(["mieszkanie", "pokoj"]);
});

test("getFacets ignores inactive offers and null values", async () => {
  await db.insert(offers).values({ externalId: "a", url: "u", source: "olx", status: "active", districtCanonical: "wrzeszcz", kind: "mieszkanie", features: ["balkon"] });
  await db.insert(offers).values({ externalId: "b", url: "u", source: "otodom", status: "inactive", districtCanonical: "oliwa", kind: "dom", features: ["garaz"] });
  await db.insert(offers).values({ externalId: "c", url: "u", source: "olx", status: "active", districtCanonical: null, kind: null });
  const f = await getFacets();
  expect([...f.districts].sort()).toEqual(["wrzeszcz"]);
  expect([...f.kinds].sort()).toEqual(["mieszkanie"]);
  expect([...f.sources].sort()).toEqual(["olx"]);
  expect([...f.features].sort()).toEqual(["balkon"]);
});

test("getFacets returns distinct features from active offers", async () => {
  await db.insert(offers).values({ externalId: "a", url: "u", source: "olx", status: "active", features: ["balkon", "garaz"] });
  await db.insert(offers).values({ externalId: "b", url: "u", source: "olx", status: "active", features: ["balkon", "winda"] });
  const f = await getFacets();
  expect([...f.features].sort()).toEqual(["balkon", "garaz", "winda"]);
});
