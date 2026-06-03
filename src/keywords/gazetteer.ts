/** Diacritic-insensitive, lowercased normalization (Śródmieście -> srodmiescie). */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[łŁ]/g, "l").trim();
}

export interface KeywordHit {
  districtCanonical: string | null;
  kind: string | null;
}

// Canonical "City Dzielnica" forms. Extend freely — this is a starter taxonomy.
const DISTRICTS: string[] = [
  "Gdańsk Wrzeszcz", "Gdańsk Oliwa", "Gdańsk Przymorze", "Gdańsk Zaspa",
  "Gdańsk Brzeźno", "Gdańsk Śródmieście", "Gdańsk Jelitkowo", "Gdańsk Stogi",
  "Gdańsk Orunia", "Gdańsk Chełm", "Gdańsk Osowa", "Gdańsk Żabianka",
  "Gdańsk Piecki-Migowo", "Gdańsk Ujeścisko", "Gdańsk Łostowice", "Gdańsk Morena",
  "Gdynia Śródmieście", "Gdynia Orłowo", "Gdynia Redłowo", "Gdynia Witomino",
  "Gdynia Chylonia", "Gdynia Oksywie", "Gdynia Działki Leśne", "Gdynia Wzgórze",
  "Sopot",
];

// Two-tier alias structure:
//   - fullAlias: normalizeText(canonical) — used for specific tier matching (e.g. "gdynia srodmiescie")
//   - bareAliases: stem aliases for the dzielnica word only — used for fallback declension matching
//     (e.g. "zaspa","zaspi","zasp" from "Zaspa")
const DISTRICT_ALIASES: { canonical: string; fullAlias: string | null; bareAliases: string[] }[] = DISTRICTS.map((c) => {
  const parts = c.split(" ");
  const word = parts.length > 1 ? parts.slice(1).join(" ") : parts[0]!;
  const normalized = normalizeText(word);
  // Build bare stems by stripping common Polish noun endings (-a, -e, -ie).
  // The -ą rule is omitted because normalizeText already converts ą→a before
  // aliases are built, so a `.replace(/ą$/, "")` rule would never fire.
  const bareAliases = new Set<string>([normalized]);
  bareAliases.add(normalized.replace(/e$/, ""));
  bareAliases.add(normalized.replace(/a$/, ""));
  bareAliases.add(normalized.replace(/ie$/, ""));
  // fullAlias is the entire normalized canonical — only set for multi-word districts
  // so we can distinguish e.g. "gdynia srodmiescie" vs "gdansk srodmiescie".
  const fullAlias = parts.length > 1 ? normalizeText(c) : null;
  return { canonical: c, fullAlias, bareAliases: Array.from(bareAliases) };
});

// kind keyword -> canonical kind. Order matters: most specific first.
const KINDS: { needle: string; kind: string }[] = [
  { needle: "kawalerk", kind: "kawalerka" },
  { needle: "apartament", kind: "apartament" },
  { needle: "dom", kind: "dom" },
  { needle: "pokoj", kind: "pokój" },
  { needle: "studio", kind: "studio" },
  { needle: "mieszkan", kind: "mieszkanie" },
];

function matchDistrict(haystack: string): string | null {
  // Tier 1 — specific: match the full normalized canonical (city + dzielnica).
  // This disambiguates districts sharing the same dzielnica name (e.g. both
  // Gdańsk and Gdynia have "Śródmieście").
  for (const { canonical, fullAlias } of DISTRICT_ALIASES) {
    if (fullAlias && haystack.includes(fullAlias)) return canonical;
  }
  // Tier 2 — fallback: match bare dzielnica stems (handles Polish declensions
  // like "Zaspie" matching "zasp"). First-match-wins is an acceptable last resort.
  for (const { canonical, bareAliases } of DISTRICT_ALIASES) {
    for (const alias of bareAliases) {
      if (haystack.includes(alias)) return canonical;
    }
  }
  return null;
}

function matchKind(haystack: string): string | null {
  // Require needle at a word-start boundary so e.g. "dom" doesn't match inside "Radom".
  // Declension prefixes (mieszkan, kawalerk…) still work because they begin words.
  for (const { needle, kind } of KINDS) {
    if (new RegExp(`(^|[\\s-])${needle}`).test(haystack)) return kind;
  }
  return null;
}

export function extractKeywords(input: { district: string | null; title: string }): KeywordHit {
  const districtHay = normalizeText(`${input.district ?? ""} ${input.title}`);
  const titleHay = normalizeText(input.title);
  return {
    districtCanonical: matchDistrict(districtHay),
    kind: matchKind(titleHay),
  };
}
