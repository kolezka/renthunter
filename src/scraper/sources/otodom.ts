import type { Source, ListItem, OfferDetail } from "./types";
import { makeListPageUrls } from "./types";

const OTODOM_ORIGIN = "https://www.otodom.pl";

/** Pull and parse the `__NEXT_DATA__` JSON blob Otodom (Next.js) embeds on
 *  both list and detail pages. Throws if the script is entirely absent. */
export function extractNextData(html: string): any {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("otodom: __NEXT_DATA__ not found");
  return JSON.parse(m[1]!);
}

export function parseList(html: string): ListItem[] {
  const data = extractNextData(html);
  const items: unknown[] =
    data?.props?.pageProps?.data?.searchAds?.items ?? [];
  const seen = new Map<string, ListItem>();
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const id = it?.id;
    const slug = it?.slug;
    if (id == null || typeof slug !== "string" || !slug) continue;
    const externalId = `otodom:${id}`;
    if (seen.has(externalId)) continue;
    seen.set(externalId, {
      externalId,
      url: `${OTODOM_ORIGIN}/pl/oferta/${slug}`,
      source: "otodom",
    });
  }
  return [...seen.values()];
}

export const listPageUrls = makeListPageUrls("page");

/** Otodom detail characteristics are `{ key, value, localizedValue }` rows. */
function charValue(
  characteristics: Array<Record<string, unknown>>,
  key: string,
): string | null {
  const row = characteristics.find((c) => c?.key === key);
  const v = row?.value;
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

function toNumber(v: string | null): number | null {
  if (v == null) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: string | null): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseDetail(html: string): OfferDetail {
  // Otodom detail data lives under props.pageProps.ad. Prefer the structured
  // `characteristics` rows (price/m/rooms_num) for numeric fields; fall back to
  // sane nulls when an ad is present but a field is missing.
  const data = extractNextData(html);
  const ad = (data?.props?.pageProps?.ad ?? {}) as Record<string, unknown>;

  const title = typeof ad.title === "string" ? ad.title : "";
  const description =
    typeof ad.description === "string" ? ad.description : "";

  const characteristics = Array.isArray(ad.characteristics)
    ? (ad.characteristics as Array<Record<string, unknown>>)
    : [];

  const price = toNumber(charValue(characteristics, "price"));
  const area = toNumber(charValue(characteristics, "m"));
  const rooms = toInt(charValue(characteristics, "rooms_num"));

  // District: the location entry whose locationLevel === "district".
  let district: string | null = null;
  const locations =
    (ad.location as Record<string, unknown> | undefined)?.reverseGeocoding;
  const locs = (locations as Record<string, unknown> | undefined)?.locations;
  if (Array.isArray(locs)) {
    const dist = locs.find(
      (l) => (l as Record<string, unknown>)?.locationLevel === "district",
    ) as Record<string, unknown> | undefined;
    if (dist && typeof dist.name === "string") district = dist.name || null;
  }

  // Images: prefer the largest variant available per image object.
  let images: string[] = [];
  if (Array.isArray(ad.images)) {
    images = (ad.images as Array<Record<string, unknown>>)
      .map((img) => {
        const u = img?.large ?? img?.medium ?? img?.small ?? img?.thumbnail;
        return typeof u === "string" ? u : null;
      })
      .filter((u): u is string => !!u);
  }
  images = [...new Set(images)].slice(0, 12);

  return { title, price, area, rooms, district, description, images };
}

export const otodom: Source = {
  id: "otodom",
  hosts: ["www.otodom.pl", "otodom.pl"],
  listPageUrls,
  parseList,
  parseDetail,
};
