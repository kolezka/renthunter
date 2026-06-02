import type { Source, ListItem, OfferDetail } from "./types";
import { metaContent, firstJsonLd } from "../html";

const OLX_ORIGIN = "https://www.olx.pl";

export function parseList(html: string): ListItem[] {
  const re = /href="(\/d\/oferta\/[^"]*-ID([0-9A-Za-z]+)\.html)[^"]*"/g;
  const seen = new Map<string, ListItem>();
  for (const m of html.matchAll(re)) {
    const id = `olx:${m[2]!}`;
    if (seen.has(id)) continue;
    const url = new URL(m[1]!, OLX_ORIGIN);
    url.search = "";
    seen.set(id, { externalId: id, url: url.toString(), source: "olx" });
  }
  return [...seen.values()];
}

export function listPageUrls(searchUrl: string, pages: number): string[] {
  const n = Math.max(1, Math.floor(pages));
  const urls = [searchUrl];
  for (let p = 2; p <= n; p++) {
    const u = new URL(searchUrl);
    u.searchParams.set("page", String(p));
    urls.push(u.toString());
  }
  return urls;
}

/** Pull image URLs out of a JSON-LD `image` field (string or array of strings/objects). */
function ldImages(ld: Record<string, unknown> | null): string[] {
  const img = ld?.image;
  if (Array.isArray(img)) {
    return img
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
            ? String(
                (x as Record<string, unknown>).url ??
                  (x as Record<string, unknown>).contentUrl ??
                  "",
              )
            : "",
      )
      .filter(Boolean);
  }
  if (typeof img === "string") return [img];
  return [];
}

export function parseDetail(html: string): OfferDetail {
  // OLX detail pages carry a rich JSON-LD Product block (title, images, price,
  // description, locality) plus rendered "Powierzchnia: NN m²" / "Liczba pokoi: N"
  // param labels. Prefer JSON-LD; fall back to og: meta and regex.
  const ld = firstJsonLd(html);
  const offers = ld?.offers as Record<string, unknown> | undefined;

  // Title: JSON-LD name, then og:title (strip the " • OLX.pl" tail).
  let title =
    (typeof ld?.name === "string" ? (ld.name as string) : "") ||
    metaContent(html, "og:title") ||
    "";
  title = title.replace(/\s*•\s*OLX\.pl\s*$/i, "").trim();

  // Description: JSON-LD description, then og:description.
  let description =
    (typeof ld?.description === "string" ? (ld.description as string) : "") ||
    metaContent(html, "og:description") ||
    "";
  description = description.trim();

  // Price: JSON-LD offers.price, then a "NNN zł" pattern in the body.
  let price: number | null = null;
  const ldPrice = offers?.price ?? ld?.price;
  if (ldPrice !== undefined && ldPrice !== null) {
    price = parseInt(String(ldPrice).replace(/\D/g, ""), 10) || null;
  }
  if (price === null) {
    const m = html.match(/([0-9][0-9\s ]{2,})\s*z[łl]/i);
    if (m) price = parseInt(m[1]!.replace(/[\s ]/g, ""), 10) || null;
  }

  // Area: rendered "Powierzchnia: NN m²" label (also "NN,N m2"). Fallback to any "NN m²".
  let area: number | null = null;
  const areaLabel = html.match(/Powierzchnia:\s*([0-9]+(?:[.,][0-9]+)?)\s*m/i);
  const areaM = areaLabel ?? html.match(/([0-9]+(?:[.,][0-9]+)?)\s*m(?:²|2|<sup>)/i);
  if (areaM) area = parseFloat(areaM[1]!.replace(",", ".")) || null;

  // Rooms: rendered "Liczba pokoi: N" label, else digits-then-"pok" in the title.
  let rooms: number | null = null;
  const roomsM =
    html.match(/Liczba pokoi:\s*([0-9]+)/i) ?? title.match(/([0-9]+)\s*pok/i);
  if (roomsM) rooms = parseInt(roomsM[1]!, 10) || null;

  // District: JSON-LD offers.areaServed.name, then og:locality.
  let district: string | null = null;
  const areaServed = offers?.areaServed as Record<string, unknown> | undefined;
  if (areaServed && typeof areaServed.name === "string") {
    district = (areaServed.name as string).trim() || null;
  }
  if (!district) district = metaContent(html, "og:locality") ?? null;

  // Images: JSON-LD image list, then og:image. Dedupe + cap.
  let images = ldImages(ld);
  if (images.length === 0) {
    const og = metaContent(html, "og:image");
    if (og) images = [og];
  }
  images = [...new Set(images)].slice(0, 12);

  return { title, price, area, rooms, district, description, images };
}

export const olx: Source = {
  id: "olx",
  hosts: ["www.olx.pl", "olx.pl"],
  listPageUrls,
  parseList,
  parseDetail,
};
