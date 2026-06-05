import { normalizeText } from "./gazetteer";
import { FEATURE_TAXONOMY, FEATURE_NOISE } from "../../config/features";
import { chatJson } from "../scorer/chat";

// alias (normalized) -> canonical. Built once from the taxonomy; the canonical
// is registered as its own alias so already-canonical tags map to themselves.
const ALIAS_TO_CANON = new Map<string, string>();
for (const { canonical, aliases } of FEATURE_TAXONOMY) {
  ALIAS_TO_CANON.set(normalizeText(canonical), canonical);
  for (const a of aliases) ALIAS_TO_CANON.set(normalizeText(a), canonical);
}

/** Canonical feature labels — fed to the model to steer it toward consistent tags. */
export const CANONICAL_FEATURES: string[] = FEATURE_TAXONOMY.map((t) => t.canonical);

/**
 * Snap free-form AI feature tags onto the canonical taxonomy: alias → canonical,
 * drop non-feature noise (room counts, areas, floors), pass unknown tags through
 * normalized (lowercased/trimmed) so nothing is lost, dedupe (first wins), cap 12.
 */
export function canonicalizeFeatures(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const norm = normalizeText(String(t));
    if (!norm || FEATURE_NOISE.some((re) => re.test(norm))) continue;
    const canon = ALIAS_TO_CANON.get(norm) ?? String(t).trim().toLowerCase();
    const key = normalizeText(canon);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(canon);
  }
  return out.slice(0, 12);
}

export interface ExtractFeaturesInput { title: string; description: string; }
export interface ExtractFeaturesOptions {
  apiKey: string;
  baseUrl: string;
  /** Language the extracted feature tags are written in. Defaults to "Polish"
   *  because listings are Polish; configurable via the `outputLanguage` setting. */
  language?: string;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function extractFeatures(
  input: ExtractFeaturesInput,
  opts: ExtractFeaturesOptions,
): Promise<string[]> {
  const language = opts.language || "Polish";
  const system =
    "You extract apartment features from a rental listing. " +
    'Return ONLY JSON: {"features": ["<feature>", ...]}. ' +
    `Each feature is a short lowercase tag in ${language}. At most 12 features. ` +
    "Prefer these standard tags whenever the listing matches one (reuse them verbatim); " +
    `only invent a new tag for a feature none of these cover: ${CANONICAL_FEATURES.join(", ")}.`;
  const user = `Title:\n${input.title}\n\nDescription:\n${input.description}`;

  const content = await chatJson(opts, { system, user, temperature: 0.1 });
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed.features) ? parsed.features : [];
    return canonicalizeFeatures(arr.map((f: unknown) => String(f)));
  } catch {
    // feature extraction is non-fatal; degrade to [] on parse failure
    return [];
  }
}
