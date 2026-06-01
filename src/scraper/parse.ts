export interface ListItem {
  externalId: string;
  url: string;
}

export function extractExternalId(url: string): string | null {
  const m = url.match(/-ogl(\d+)\.html/);
  return m ? m[1]! : null;
}

export function parseListUrls(html: string): ListItem[] {
  const re = /https?:\/\/ogloszenia\.trojmiasto\.pl\/nieruchomosci-mam-do-wynajecia\/[^"'\s]*-ogl(\d+)\.html/g;
  const seen = new Map<string, ListItem>();
  for (const match of html.matchAll(re)) {
    const url = match[0];
    const externalId = match[1]!;
    if (!seen.has(externalId)) seen.set(externalId, { externalId, url });
  }
  return [...seen.values()];
}
