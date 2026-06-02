import type { Source } from "./types";
import { trojmiasto } from "./trojmiasto";

export const SOURCES: Source[] = [trojmiasto];

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
  return null;
}

export function allowedHosts(): Set<string> {
  return new Set(SOURCES.flatMap((s) => s.hosts.map(normalizeHost)));
}
