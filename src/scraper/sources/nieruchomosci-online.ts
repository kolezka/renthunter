import type { SourceParser, ListItem, OfferDetail } from "./types";
import { makeListPageUrls } from "./pagination";
import { metaContent, findJsonLd, ldImages } from "../html";

/** Offer detail links live on per-city subdomains, e.g.
 *  https://gdansk.nieruchomosci-online.pl/<slug>/<id>.html — the trailing run of
 *  digits before .html is the offer id. */
const LIST_RE =
  /https:\/\/[a-z0-9-]+\.nieruchomosci-online\.pl\/[^"\s]*?\/(\d+)\.html/g;

export function parseList(html: string): ListItem[] {
  const seen = new Map<string, ListItem>();
  for (const m of html.matchAll(LIST_RE)) {
    const externalId = `nieruchomosci-online:${m[1]!}`;
    if (seen.has(externalId)) continue;
    seen.set(externalId, {
      externalId,
      url: m[0]!,
      source: "nieruchomosci-online",
    });
  }
  return [...seen.values()];
}

export const listPageUrls = makeListPageUrls("p");

export function parseDetail(html: string): OfferDetail {
  // Detail pages embed a rich `Apartment` JSON-LD block with top-level
  // name/description/offers/floorSize/numberOfRooms/address/image. Prefer it;
  // fall back to og: meta / nulls when a field is missing.
  const ld = findJsonLd(html, "Apartment");
  const offersRaw = ld?.offers;
  const offer = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as
    | Record<string, unknown>
    | undefined;

  let title =
    (typeof ld?.name === "string" ? (ld.name as string) : "") ||
    metaContent(html, "og:title") ||
    "";
  title = title.trim();

  let description =
    (typeof ld?.description === "string" ? (ld.description as string) : "") ||
    metaContent(html, "og:description") ||
    "";
  description = description.trim();

  let price: number | null = null;
  const ldPrice = offer?.price;
  if (ldPrice !== undefined && ldPrice !== null) {
    const n = parseInt(String(ldPrice).replace(/\D/g, ""), 10);
    price = Number.isFinite(n) ? n : null;
  }

  let area: number | null = null;
  const floorSize = ld?.floorSize as Record<string, unknown> | undefined;
  if (floorSize?.value != null) {
    const n = parseFloat(String(floorSize.value).replace(",", "."));
    area = Number.isFinite(n) ? n : null;
  }

  let rooms: number | null = null;
  if (ld?.numberOfRooms != null) {
    const n = parseInt(String(ld.numberOfRooms), 10);
    rooms = Number.isFinite(n) ? n : null;
  }

  let district: string | null = null;
  const address = ld?.address as Record<string, unknown> | undefined;
  if (address && typeof address.addressLocality === "string") {
    district = (address.addressLocality as string).trim() || null;
  }
  if (!district) district = metaContent(html, "og:locality") ?? null;

  let images = ldImages(ld);
  if (images.length === 0) {
    const og = metaContent(html, "og:image");
    if (og) images = [og];
  }
  images = [...new Set(images)].slice(0, 12);

  return { title, price, area, rooms, district, description, images };
}

export const nieruchomosciOnline: SourceParser = {
  id: "nieruchomosci-online",
  listPageUrls,
  parseList,
  parseDetail,
};
