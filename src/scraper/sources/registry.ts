import type { Source, SourceParser } from "./types";
import { SOURCE_META } from "./catalog";
import { trojmiasto } from "./trojmiasto";
import { olx } from "./olx";
import { otodom } from "./otodom";
import { nieruchomosciOnline } from "./nieruchomosci-online";

// Parser modules carry only parsing logic; host/label metadata lives in the
// catalog. Compose each parser with its catalog entry to form a full Source.
const PARSERS: SourceParser[] = [trojmiasto, olx, otodom, nieruchomosciOnline];

export const SOURCES: Source[] = PARSERS.map((p) => {
  const meta = SOURCE_META[p.id];
  return {
    ...p,
    hosts: [...meta.hosts],
    ...(meta.hostSuffixes ? { hostSuffixes: [...meta.hostSuffixes] } : {}),
  };
});

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
