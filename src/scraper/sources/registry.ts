import type { Source } from "./types";
import { trojmiasto } from "./trojmiasto";
import { olx } from "./olx";
import { otodom } from "./otodom";
import { nieruchomosciOnline } from "./nieruchomosci-online";

export const SOURCES: Source[] = [trojmiasto, olx, otodom, nieruchomosciOnline];

/** Strip a leading "www." so "www.olx.pl" and "olx.pl" both match. */
export function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

export function resolveSource(url: string): Source | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  const norm = normalizeHost(host);
  for (const s of SOURCES) {
    if (s.hosts.some((h) => normalizeHost(h) === norm)) return s;
  }
  // Fall back to domain-suffix matching for sources whose detail pages live on
  // per-city subdomains (e.g. gdansk.nieruchomosci-online.pl).
  for (const s of SOURCES) {
    if (
      s.hostSuffixes?.some((suf) => {
        const n = normalizeHost(suf);
        return norm === n || norm.endsWith("." + n);
      })
    ) {
      return s;
    }
  }
  return null;
}

/** Set of normalized (www.-stripped, lowercased) hosts of all registered sources.
 *  Callers comparing a URL hostname must normalizeHost() it first. */
export function allowedHosts(): Set<string> {
  return new Set(SOURCES.flatMap((s) => s.hosts.map(normalizeHost)));
}
