import type { Source } from "./api";

// Mirror of host lists in src/scraper/sources/registry.ts (trojmiasto/olx/otodom).
// KEEP IN SYNC: if a source's hosts change there, change them here too. This is a
// client-side UX convenience only — src/api/validate.ts remains the security gate.
export const SOURCE_HOSTS: Record<Source, string[]> = {
  trojmiasto: ["ogloszenia.trojmiasto.pl"],
  olx: ["www.olx.pl", "olx.pl"],
  otodom: ["otodom.pl", "www.otodom.pl"],
};

/** Strip a leading "www." and lowercase, so "www.olx.pl" and "olx.pl" match. */
export function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** Detect which registered source a URL targets, or null if unsupported/malformed. */
export function resolveSource(url: string): Source | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  const norm = normalizeHost(host);
  for (const src of Object.keys(SOURCE_HOSTS) as (keyof typeof SOURCE_HOSTS)[]) {
    if (SOURCE_HOSTS[src].some((h) => normalizeHost(h) === norm)) return src;
  }
  return null;
}

/** Split a pasted blob into candidate URL strings (newline / comma / whitespace). */
export function splitPasted(text: string): string[] {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export interface AddResult {
  urls: string[]; // existing + newly added, order preserved
  added: string[];
  skipped: { url: string; reason: "unsupported" | "duplicate" }[];
}

/**
 * Add candidates to an existing list. A candidate is appended only if its host is a
 * recognized source AND it isn't an exact duplicate of an already-present (or
 * earlier-in-batch) URL. Everything else is reported in `skipped`.
 */
export function addUrls(existing: string[], candidates: string[]): AddResult {
  const urls = [...existing];
  const added: string[] = [];
  const skipped: AddResult["skipped"] = [];
  for (const raw of candidates) {
    const url = raw.trim();
    if (!url) continue;
    if (resolveSource(url) === null) { skipped.push({ url, reason: "unsupported" }); continue; }
    if (urls.includes(url)) { skipped.push({ url, reason: "duplicate" }); continue; }
    urls.push(url);
    added.push(url);
  }
  return { urls, added, skipped };
}
