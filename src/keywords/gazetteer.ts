/** Diacritic-insensitive, lowercased normalization (Śródmieście -> srodmiescie). */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
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

// One normalized alias per district (the dzielnica word, or the city for Sopot).
// Generate aliases with common Polish declension suffixes (e.g., "Zaspa" -> ["zaspa", "zaspie", "zaspą"]).
const DISTRICT_ALIASES: { canonical: string; aliases: string[] }[] = DISTRICTS.map((c) => {
  const parts = c.split(" ");
  const word = parts.length > 1 ? parts.slice(1).join(" ") : parts[0]!;
  const normalized = normalizeText(word);
  // Generate base + common inflected forms for Polish nouns
  const aliases = new Set<string>([normalized]);
  // Add truncated versions to handle -e, -ą, -ie endings
  aliases.add(normalized.replace(/e$/, ""));
  aliases.add(normalized.replace(/a$/, ""));
  aliases.add(normalized.replace(/ie$/, ""));
  aliases.add(normalized.replace(/ą$/, ""));
  return { canonical: c, aliases: Array.from(aliases) };
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
  for (const { canonical, aliases } of DISTRICT_ALIASES) {
    for (const alias of aliases) {
      if (haystack.includes(alias)) return canonical;
    }
  }
  return null;
}

function matchKind(haystack: string): string | null {
  for (const { needle, kind } of KINDS) {
    if (haystack.includes(needle)) return kind;
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
