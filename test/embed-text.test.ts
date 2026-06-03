import { test, expect } from "bun:test";
import { buildEmbedText, embedTextHash } from "../src/embeddings/embedText";

const offer = {
  title: "Mieszkanie 2 pok",
  districtCanonical: "Gdańsk Wrzeszcz",
  kind: "mieszkanie",
  features: ["balkon", "umeblowane"],
  description: "Ładne mieszkanie blisko morza.",
};

test("buildEmbedText joins the salient fields", () => {
  const t = buildEmbedText(offer);
  expect(t).toContain("Gdańsk Wrzeszcz");
  expect(t).toContain("balkon umeblowane");
  expect(t).toContain("Ładne mieszkanie");
});

test("buildEmbedText truncates very long descriptions", () => {
  const t = buildEmbedText({ ...offer, description: "x".repeat(5000) });
  expect(t.length).toBeLessThanOrEqual(2200);
});

test("embedTextHash is stable and changes with content", () => {
  const a = embedTextHash(buildEmbedText(offer));
  const b = embedTextHash(buildEmbedText(offer));
  const c = embedTextHash(buildEmbedText({ ...offer, kind: "kawalerka" }));
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});
