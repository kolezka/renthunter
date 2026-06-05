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
