import type { OfferDetail } from "../parse";
import type { SourceId } from "./catalog";

export type { SourceId };

export interface ListItem {
  externalId: string; // namespaced, e.g. "trojmiasto:123"
  url: string;        // absolute
  source: SourceId;
}

export type { OfferDetail };

/** A source's parsing logic. Host/label metadata lives in the catalog and is
 *  merged onto this by registry.ts to form a full Source. */
export interface SourceParser {
  id: SourceId;
  listPageUrls(searchUrl: string, pages: number): string[];
  parseList(html: string): ListItem[];
  parseDetail(html: string): OfferDetail;
}

export interface Source extends SourceParser {
  hosts: string[];
  /** Optional domain suffixes; resolveSource() matches a host that equals or is
   *  a subdomain of any suffix (e.g. "nieruchomosci-online.pl" matches
   *  "gdansk.nieruchomosci-online.pl"). For sources whose detail pages live on
   *  per-city subdomains. */
  hostSuffixes?: string[];
}
