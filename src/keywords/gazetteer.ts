import { DISTRICTS, KINDS } from "../../config/gazetteer";

/** Diacritic-insensitive, lowercased normalization (Śródmieście -> srodmiescie). */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[łŁ]/g, "l").trim();
}

export interface KeywordHit {
  districtCanonical: string | null;
  kind: string | null;
}

// Two-tier alias structure derived from the configured DISTRICTS taxonomy:
//   - fullAlias: normalizeText(canonical) — used for specific tier matching (e.g. "gdynia srodmiescie")
//   - bareAliases: stem aliases for the district word only — used for fallback declension matching
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

function matchDistrict(haystack: string): string | null {
  // Tier 1 — specific: match the full normalized canonical (city + district).
  // This disambiguates districts sharing the same district name (e.g. both
  // Gdańsk and Gdynia have "Śródmieście").
  for (const { canonical, fullAlias } of DISTRICT_ALIASES) {
    if (fullAlias && haystack.includes(fullAlias)) return canonical;
  }
  // Tier 2 — fallback: match bare district stems (handles Polish declensions
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
