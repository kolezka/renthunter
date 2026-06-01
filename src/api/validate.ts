import { resolve, sep } from "node:path";
import type { Config } from "../db/schema";

const EDITABLE: (keyof Config)[] = [
  "searchUrl", "minPrice", "maxPrice", "minArea", "minRooms",
  "aiCriteria", "scoreThreshold", "pollIntervalMin", "appriseUrls", "deepseekEnabled",
];

// Only trojmiasto search pages are allowed as the scrape target — searchUrl is
// fetched server-side by the pipeline, so an arbitrary URL would be an SSRF vector.
const ALLOWED_SEARCH_HOST = "ogloszenia.trojmiasto.pl";
const APPRISE_SCHEME = /^[a-z][a-z0-9+.\-]*:\/\/\S+$/i;

export type ValidationResult =
  | { ok: true; patch: Partial<Config> }
  | { ok: false; error: string };

function isNonNegNumberOrNull(v: unknown): boolean {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e7);
}

/**
 * Whitelist + validate an incoming config patch. Ignores unknown keys (e.g. `id`),
 * and rejects values that could enable SSRF (searchUrl), bad notification targets
 * (appriseUrls), or out-of-range numbers.
 */
export function validateConfigPatch(body: Record<string, unknown>): ValidationResult {
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];

  if ("searchUrl" in patch) {
    const v = patch.searchUrl;
    if (typeof v !== "string") return { ok: false, error: "searchUrl must be a string" };
    let u: URL;
    try { u = new URL(v); } catch { return { ok: false, error: "searchUrl is not a valid URL" }; }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { ok: false, error: "searchUrl must be http(s)" };
    }
    if (u.hostname !== ALLOWED_SEARCH_HOST) {
      return { ok: false, error: `searchUrl host must be ${ALLOWED_SEARCH_HOST}` };
    }
  }

  if ("appriseUrls" in patch) {
    const v = patch.appriseUrls;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      return { ok: false, error: "appriseUrls must be an array of strings" };
    }
    for (const t of v as string[]) {
      if (t.length > 512 || !APPRISE_SCHEME.test(t)) {
        return { ok: false, error: `invalid apprise target: ${t.slice(0, 40)}` };
      }
    }
  }

  for (const k of ["minPrice", "maxPrice", "minArea", "minRooms"] as const) {
    if (k in patch && !isNonNegNumberOrNull(patch[k])) {
      return { ok: false, error: `${k} must be a non-negative number or null` };
    }
  }

  if ("scoreThreshold" in patch) {
    const v = patch.scoreThreshold;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
      return { ok: false, error: "scoreThreshold must be an integer 0-100" };
    }
  }

  if ("pollIntervalMin" in patch) {
    const v = patch.pollIntervalMin;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1440) {
      return { ok: false, error: "pollIntervalMin must be an integer 1-1440" };
    }
  }

  if ("aiCriteria" in patch) {
    if (typeof patch.aiCriteria !== "string" || patch.aiCriteria.length > 5000) {
      return { ok: false, error: "aiCriteria must be a string up to 5000 chars" };
    }
  }

  if ("deepseekEnabled" in patch && typeof patch.deepseekEnabled !== "boolean") {
    return { ok: false, error: "deepseekEnabled must be a boolean" };
  }

  return { ok: true, patch: patch as Partial<Config> };
}

/**
 * Resolve a request path under `distRoot`, returning the absolute file path only
 * if it stays inside the root (defends against `../` path traversal). Returns null
 * for traversal attempts, NUL bytes, or undecodable paths.
 */
export function safeStaticPath(distRoot: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const root = resolve(distRoot);
  const candidate = resolve(root, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}
