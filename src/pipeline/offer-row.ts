import type { NewOffer } from "../db/schema";
import type { OfferDetail } from "../scraper/sources/types";
import type { EnrichFields } from "./enrich";

/** Build the shared `NewOffer` base from an offer's identity, its parsed detail,
 *  and the enriched fields. Does NOT set `score`/`scoreReasons` — callers spread
 *  those on top when they have them (the crawl filter-fail path persists without
 *  a score, refresh always re-scores). */
export function buildOfferRow(
  identity: { externalId: string; url: string; source: string },
  detail: OfferDetail,
  enriched: EnrichFields,
): NewOffer {
  return {
    externalId: identity.externalId,
    url: identity.url,
    source: identity.source,
    title: detail.title,
    price: detail.price,
    area: detail.area,
    rooms: detail.rooms,
    district: detail.district,
    description: detail.description,
    images: detail.images,
    ...enriched,
  };
}
