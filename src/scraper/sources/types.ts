import type { OfferDetail } from "../parse";

export type SourceId = "trojmiasto" | "olx" | "otodom";

export interface ListItem {
  externalId: string; // namespaced, e.g. "trojmiasto:123"
  url: string;        // absolute
  source: SourceId;
}

export type { OfferDetail };

/** Build a `listPageUrls(searchUrl, pages)` fn. Page 1 is the search URL
 *  verbatim; subsequent pages set `param` to the page number. */
export function makeListPageUrls(param: string) {
  return (searchUrl: string, pages: number): string[] => {
    const n = Math.max(1, Math.floor(pages));
    const urls = [searchUrl];
    for (let p = 2; p <= n; p++) {
      const u = new URL(searchUrl);
      u.searchParams.set(param, String(p));
      urls.push(u.toString());
    }
    return urls;
  };
}

export interface Source {
  id: SourceId;
  hosts: string[];
  listPageUrls(searchUrl: string, pages: number): string[];
  parseList(html: string): ListItem[];
  parseDetail(html: string): OfferDetail;
}
