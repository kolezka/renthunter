import { normalizeText } from "./gazetteer";
import { FEATURE_TAXONOMY, FEATURE_NOISE } from "../../config/features";

// alias (normalized) -> canonical. Built once from the taxonomy; the canonical
// is registered as its own alias so already-canonical tags map to themselves.
const ALIAS_TO_CANON = new Map<string, string>();
for (const { canonical, aliases } of FEATURE_TAXONOMY) {
  ALIAS_TO_CANON.set(normalizeText(canonical), canonical);
  for (const a of aliases) ALIAS_TO_CANON.set(normalizeText(a), canonical);
}

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
  const doFetch = opts.fetchImpl ?? fetch;
  const language = opts.language || "Polish";
  const system =
    "You extract apartment features from a rental listing. " +
    'Return ONLY JSON: {"features": ["<feature>", ...]}. ' +
    `Each feature is a short lowercase tag in ${language} (e.g. balcony, garage, ` +
    "furnished, near the sea, elevator, parking). At most 12 features.";
  const user = `Title:\n${input.title}\n\nDescription:\n${input.description}`;

  const res = await doFetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed.features) ? parsed.features : [];
    return canonicalizeFeatures(arr.map((f: unknown) => String(f)));
  } catch {
    return [];
  }
}
