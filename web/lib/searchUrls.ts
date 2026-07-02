import type { Source } from "./api";
import { SOURCE_CATALOG } from "../../src/scraper/sources/catalog";

// Search-URL hosts, derived from the shared catalog (single source of truth,
// also used by the backend). This is a client-side UX convenience only —
// src/api/validate.ts remains the security gate. Only search-URL hosts matter
// here; detail pages on per-city subdomains are never validated client-side.
export const SOURCE_HOSTS: Record<Source, string[]> = Object.fromEntries(
  SOURCE_CATALOG.map((m) => [m.id, [...m.hosts]]),
) as Record<Source, string[]>;

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

/**
 * Split a pasted blob into candidate URL strings (newline / whitespace / comma
 * separators). Commas are valid INSIDE a URL path or query — Trójmiasto and
 * Nieruchomości-online filter URLs depend on them — so a comma only separates
 * when it sits between URLs (directly before "http", or trailing before
 * whitespace); it never fragments a single URL.
 */
export function splitPasted(text: string): string[] {
  return text
    .split(/\s+|,+(?=https?:\/\/)/i)
    .map((s) => s.trim().replace(/,+$/, ""))
    .filter(Boolean);
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
