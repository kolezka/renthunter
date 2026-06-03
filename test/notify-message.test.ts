import { test, expect } from "bun:test";
import { buildOfferNotification } from "../src/notify/message";

test("buildOfferNotification renders title, stats line, AI reasons and url", () => {
  const { title, body } = buildOfferNotification({
    title: "Mieszkanie 2 pok", price: 3200, area: 48, rooms: 2,
    district: "Gdańsk Wrzeszcz", url: "https://x/1", reasons: "blisko SKM",
  });
  expect(title).toBe("New offer: Mieszkanie 2 pok");
  expect(body).toBe("3200 PLN · 48 m² · 2 rooms · Gdańsk Wrzeszcz\nAI: blisko SKM\nhttps://x/1");
});

test("buildOfferNotification handles nulls and omits the AI line when no reasons", () => {
  const { title, body } = buildOfferNotification({
    title: "T", price: null, area: null, rooms: null, district: null, url: "https://x/2", reasons: null,
  });
  expect(title).toBe("New offer: T");
  expect(body).toBe("? PLN · ? m² · ? rooms · \nhttps://x/2");
});

test("buildOfferNotification caps the title at 120 chars", () => {
  const long = "x".repeat(200);
  const { title } = buildOfferNotification({
    title: long, price: 1, area: 1, rooms: 1, district: "d", url: "u", reasons: null,
  });
  expect(title.length).toBe(120);
});
