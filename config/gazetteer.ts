/**
 * Gazetteer configuration — the Polish-specific taxonomy the keyword extractor
 * matches against. This file is intentionally the ONE place where Polish domain
 * vocabulary lives; the rest of the codebase stays language-neutral.
 *
 * Edit freely to cover more cities/districts or property kinds. The matching
 * logic (normalization, declension stems, disambiguation) lives in
 * `src/keywords/gazetteer.ts` and consumes these values.
 */

/**
 * Canonical "City District" forms. Used both as the stored canonical value and
 * as the source for alias generation. Extend freely — this is a starter taxonomy
 * for the Tricity (Trójmiasto) area.
 */
export const DISTRICTS: string[] = [
  "Gdańsk Wrzeszcz", "Gdańsk Oliwa", "Gdańsk Przymorze", "Gdańsk Zaspa",
  "Gdańsk Brzeźno", "Gdańsk Śródmieście", "Gdańsk Jelitkowo", "Gdańsk Stogi",
  "Gdańsk Orunia", "Gdańsk Chełm", "Gdańsk Osowa", "Gdańsk Żabianka",
  "Gdańsk Piecki-Migowo", "Gdańsk Ujeścisko", "Gdańsk Łostowice", "Gdańsk Morena",
  "Gdynia Śródmieście", "Gdynia Orłowo", "Gdynia Redłowo", "Gdynia Witomino",
  "Gdynia Chylonia", "Gdynia Oksywie", "Gdynia Działki Leśne", "Gdynia Wzgórze",
  "Sopot",
];

/**
 * Property-kind keywords. `needle` is matched (diacritic-insensitive, at a word
 * boundary) against the listing title; `kind` is the canonical value stored on
 * the offer. Order matters: most specific first. The needles are deliberately
 * declension stems (e.g. "mieszkan" covers mieszkanie/mieszkania/mieszkaniu).
 */
export const KINDS: { needle: string; kind: string }[] = [
  { needle: "kawalerk", kind: "kawalerka" },
  { needle: "apartament", kind: "apartament" },
  { needle: "dom", kind: "dom" },
  { needle: "pokoj", kind: "pokój" },
  { needle: "studio", kind: "studio" },
  { needle: "mieszkan", kind: "mieszkanie" },
];
