import { test, expect } from "bun:test";
import { normalizeText, extractKeywords } from "../src/keywords/gazetteer";

test("normalizeText strips Polish diacritics and lowercases", () => {
  expect(normalizeText("Śródmieście")).toBe("srodmiescie");
  expect(normalizeText("Gdańsk Wrzeszcz")).toBe("gdansk wrzeszcz");
});

test("extractKeywords maps a messy district to a canonical dzielnica", () => {
  const r = extractKeywords({ district: "Gdańsk Wrzeszcz ul. Grunwaldzka", title: "Mieszkanie 2 pok" });
  expect(r.districtCanonical).toBe("Gdańsk Wrzeszcz");
  expect(r.kind).toBe("mieszkanie");
});

test("extractKeywords finds district from title when district field is null", () => {
  const r = extractKeywords({ district: null, title: "Kawalerka na Zaspie, Gdańsk" });
  expect(r.districtCanonical).toBe("Gdańsk Zaspa");
  expect(r.kind).toBe("kawalerka");
});

test("extractKeywords returns nulls when nothing matches", () => {
  const r = extractKeywords({ district: "Warszawa Mokotów", title: "Lokal" });
  expect(r.districtCanonical).toBeNull();
  expect(r.kind).toBeNull();
});

test("normalizeText folds Polish ł to l", () => {
  expect(normalizeText("Chełm")).toBe("chelm");
  expect(normalizeText("Łostowice")).toBe("lostowice");
  expect(normalizeText("Orłowo")).toBe("orlowo");
});

test("extractKeywords matches a ł-district written in plain ASCII", () => {
  const r = extractKeywords({ district: "Gdansk Chelm", title: "Mieszkanie 2 pok" });
  expect(r.districtCanonical).toBe("Gdańsk Chełm");
});
