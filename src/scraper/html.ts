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
