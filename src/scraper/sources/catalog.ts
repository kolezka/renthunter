/**
 * Single source of truth for which marketplaces are supported and how to
 * recognize them by host. Pure data — NO parser/server imports — so the frontend
 * can import it too. Adding a source means: add an entry here + a parser module
 * (and register the parser in registry.ts).
 *
 * - `hosts`: exact search-URL hosts. Used for resolveSource() exact match and for
 *   the SSRF allowlist (allowedHosts) gating user-entered search URLs.
 * - `hostSuffixes`: optional domain suffixes; resolveSource() also matches a host
 *   that equals or is a subdomain of any suffix. For sources whose detail pages
 *   live on per-city subdomains (e.g. gdansk.nieruchomosci-online.pl).
 * - `label`: human-facing name shown in the UI.
 */
export interface SourceMeta {
  id: string;
  label: string;
  hosts: readonly string[];
  hostSuffixes?: readonly string[];
}

export const SOURCE_CATALOG = [
  { id: "trojmiasto", label: "Trójmiasto", hosts: ["ogloszenia.trojmiasto.pl"] },
  { id: "olx", label: "OLX", hosts: ["www.olx.pl", "olx.pl"] },
  { id: "otodom", label: "Otodom", hosts: ["www.otodom.pl", "otodom.pl"] },
  {
    id: "nieruchomosci-online",
    label: "Nieruchomości-online",
    hosts: ["www.nieruchomosci-online.pl", "nieruchomosci-online.pl"],
    hostSuffixes: ["nieruchomosci-online.pl"],
  },
] as const satisfies readonly SourceMeta[];

export type SourceId = (typeof SOURCE_CATALOG)[number]["id"];

/** Catalog entry keyed by id, for composing Source objects / frontend maps. */
export const SOURCE_META: Record<SourceId, SourceMeta> = SOURCE_CATALOG.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<SourceId, SourceMeta>,
);
