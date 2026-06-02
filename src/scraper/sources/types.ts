import type { OfferDetail } from "../parse";

export type SourceId = "trojmiasto" | "olx" | "otodom";

export interface ListItem {
  externalId: string; // namespaced, e.g. "trojmiasto:123"
  url: string;        // absolute
  source: SourceId;
}

export type { OfferDetail };

export interface Source {
  id: SourceId;
  hosts: string[];
  listPageUrls(searchUrl: string, pages: number): string[];
  parseList(html: string): ListItem[];
  parseDetail(html: string): OfferDetail;
}
