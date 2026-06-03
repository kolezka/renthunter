export interface OfferNotification {
  title: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
  district: string | null;
  url: string;
  reasons: string | null;
}

/** Build the Apprise notification title/body for an offer. Shared by the crawl
 *  (fresh offers) and rescore (offers that newly cross the score threshold). */
export function buildOfferNotification(o: OfferNotification): { title: string; body: string } {
  const title = `New offer: ${o.title}`.slice(0, 120);
  const body =
    `${o.price ?? "?"} PLN · ${o.area ?? "?"} m² · ${o.rooms ?? "?"} rooms · ${o.district ?? ""}\n` +
    (o.reasons ? `AI: ${o.reasons}\n` : "") +
    o.url;
  return { title, body };
}
