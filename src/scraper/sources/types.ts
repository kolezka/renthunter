import type { OfferDetail } from "../parse";

export type SourceId = "trojmiasto" | "olx" | "otodom" | "nieruchomosci-online";

export interface ListItem {
  externalId: string; // namespaced, e.g. "trojmiasto:123"
  url: string;        // absolute
  source: SourceId;
}

export type { OfferDetail };

export interface Source {
  id: SourceId;
  hosts: string[];
  /** Optional domain suffixes; resolveSource() matches a host that equals or is
   *  a subdomain of any suffix (e.g. "nieruchomosci-online.pl" matches
   *  "gdansk.nieruchomosci-online.pl"). For sources whose detail pages live on
   *  per-city subdomains. */
  hostSuffixes?: string[];
  listPageUrls(searchUrl: string, pages: number): string[];
  parseList(html: string): ListItem[];
  parseDetail(html: string): OfferDetail;
}
