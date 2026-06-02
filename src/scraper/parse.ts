import { metaContent, firstJsonLd } from "./html";

export interface ListItem {
  externalId: string;
  url: string;
}

export interface OfferDetail {
  title: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  district: string | null;
  description: string;
  images: string[];
}

export function extractExternalId(url: string): string | null {
  const m = url.match(/-ogl(\d+)\.html/);
  return m ? m[1]! : null;
}

/** Extract the value from a trojmiasto xogField block by CSS modifier class name */
function xogFieldValue(html: string, modifier: string): string | null {
  // Matches: class="xogField xogField--<modifier>..." then finds xogField__value--big or xogField__value content
  const blockRe = new RegExp(
    `xogField--${modifier}[\\s\\S]*?xogField__value[^>]*>([\\s\\S]*?)</span>`,
    "i"
  );
  const m = html.match(blockRe);
  if (!m) return null;
  // Strip inner HTML tags and whitespace
  return m[1]!.replace(/<[^>]+>/g, "").trim() || null;
}

export function parseDetail(html: string): OfferDetail {
  const ld = firstJsonLd(html);

  // Title: og:title meta or h1
  const title =
    metaContent(html, "og:title") ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
    "";

  // Description: JSON-LD Product description (has full text) or og:description fallback
  let description = "";
  if (ld?.["@type"] === "Product" && typeof ld.description === "string") {
    // Decode common HTML entities from JSON-LD description
    description = (ld.description as string)
      .replace(/&sup2;/gi, "²")
      .replace(/&oacute;/gi, "ó")
      .replace(/&amp;/gi, "&")
      .replace(/<[^>]+>/g, "")
      .trim();
  }
  if (!description) {
    description = metaContent(html, "og:description") ?? "";
  }

  // Price: JSON-LD offers.price is most reliable ("3200"), fallback to cena block or raw text
  let price: number | null = null;
  const ldOffers = ld?.offers as Record<string, unknown> | undefined;
  const ldPrice = ldOffers?.price ?? ld?.price;
  if (ldPrice !== undefined && ldPrice !== null) {
    price = parseInt(String(ldPrice).replace(/\D/g, ""), 10) || null;
  }
  if (price === null) {
    // xogField--cena block: "3 200 zł"
    const cenaM = html.match(/xogField--cena[\s\S]*?<span>([0-9][\d\s ]*)\s*z[łl]<\/span>/i);
    if (cenaM) price = parseInt(cenaM[1]!.replace(/[\s ]/g, ""), 10) || null;
  }
  if (price === null) {
    // Generic fallback: first "NNN zł" pattern with at least 3 digits
    const m = html.match(/([0-9][0-9\s ]{2,})\s*z[łl]/i);
    if (m) price = parseInt(m[1]!.replace(/[\s ]/g, ""), 10) || null;
  }

  // Area: xogField--powierzchnia value block → "43", fallback to m² pattern
  let area: number | null = null;
  const areaStr = xogFieldValue(html, "powierzchnia");
  if (areaStr) {
    area = parseFloat(areaStr.replace(",", ".")) || null;
  }
  if (area === null) {
    const am = html.match(/([0-9]+(?:[.,][0-9]+)?)\s*m(?:²|2|<sup>)/i);
    if (am) area = parseFloat(am[1]!.replace(",", ".")) || null;
  }

  // Rooms: xogField--l_pokoi value block → "2", fallback to title
  let rooms: number | null = null;
  const roomsStr = xogFieldValue(html, "l_pokoi");
  if (roomsStr) {
    rooms = parseInt(roomsStr, 10) || null;
  }
  if (rooms === null) {
    const rm = html.match(/Liczba pokoi[^0-9]{0,20}([0-9]+)/i) ??
      title.match(/([0-9]+)\s*pok/i);
    if (rm) rooms = parseInt(rm[1]!, 10) || null;
  }

  // District: xogField--address contains city + neighbourhood + street
  // e.g. "Sopot centrum Niepodległości 865" — we take first two tokens (city + neighbourhood)
  let district: string | null = null;
  const addrM = html.match(
    /xogField--address[\s\S]*?xogField__value[^>]*>([\s\S]*?)<\/span>/i
  );
  if (addrM) {
    const addrText = addrM[1]!
      .replace(/<br[^>]*>/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Take city + district (first two space-separated tokens), drop street
    const parts = addrText.split(/\s+/);
    district = parts.slice(0, 2).join(" ") || null;
  }
  if (!district) {
    district = metaContent(html, "og:locality") ?? null;
  }

  // Images: JSON-LD `image` array (full gallery), fallback to og:image.
  let images: string[] = [];
  const ldImage = ld?.image;
  if (Array.isArray(ldImage)) {
    images = ldImage
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
            ? String((x as Record<string, unknown>).url ?? (x as Record<string, unknown>).contentUrl ?? "")
            : "",
      )
      .filter(Boolean);
  } else if (typeof ldImage === "string") {
    images = [ldImage];
  }
  if (images.length === 0) {
    const og = metaContent(html, "og:image");
    if (og) images = [og];
  }
  images = [...new Set(images)].slice(0, 12);

  return { title, price, area, rooms, district, description, images };
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

/**
 * Build URLs for the first `pages` list pages. Page 1 is the search URL
 * verbatim; subsequent pages set the trojmiasto `strona` query param.
 * NOTE: the pagination param is `strona` — verify against a live page-2 URL
 * (Step 4) and change the single `set("strona", …)` line if the site differs.
 */
export function listPageUrls(searchUrl: string, pages: number): string[] {
  const n = Math.max(1, Math.floor(pages));
  const urls = [searchUrl];
  for (let p = 2; p <= n; p++) {
    const u = new URL(searchUrl);
    u.searchParams.set("strona", String(p));
    urls.push(u.toString());
  }
  return urls;
}
