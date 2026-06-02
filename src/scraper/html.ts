/** Shared HTML extraction helpers used by multiple source parsers. */

/** Read the `content` attribute of a `<meta property|name="...">` tag. */
export function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  return html.match(re)?.[1] ?? null;
}

/** Parse the first valid `<script type="application/ld+json">` block. */
export function firstJsonLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      return JSON.parse(m[1]!.trim()) as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Return the first JSON-LD block whose @type matches `type` (e.g. "Product"). */
export function findJsonLd(html: string, type: string): Record<string, unknown> | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      const blocks = Array.isArray(parsed) ? parsed : [parsed];
      for (const b of blocks) {
        const t = (b as Record<string, unknown>)?.["@type"];
        if (t === type || (Array.isArray(t) && t.includes(type))) {
          return b as Record<string, unknown>;
        }
      }
    } catch { /* try next */ }
  }
  return null;
}

/** Pull deduped image URLs out of a JSON-LD `image` field
 *  (string | object{url|contentUrl} | array of those). No cap — callers cap. */
export function ldImages(ld: Record<string, unknown> | null): string[] {
  const img = ld?.image;
  let urls: string[];
  if (Array.isArray(img)) {
    urls = img
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
  } else if (typeof img === "string") {
    urls = [img];
  } else {
    urls = [];
  }
  return [...new Set(urls)];
}
