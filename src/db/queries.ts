import { eq, notInArray, sql, desc, lt, and, isNotNull, asc, inArray, gt, gte } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "./client";
import { offers, config, logs, runLock, offerSnapshots, type Config, type NewOffer, type Offer, type LogRow, type OfferSnapshot } from "./schema";
import { hasTrackedChange, trackedFields } from "./snapshot";
import { rankByCosine } from "../embeddings/cosine";

export async function ensureConfig(defaultSearchUrl: string): Promise<void> {
  await db.insert(config).values({ id: 1, searchUrls: [defaultSearchUrl] }).onConflictDoNothing();
}

export async function getConfig(): Promise<Config> {
  const rows = await db.select().from(config).where(eq(config.id, 1)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("Config not seeded; call ensureConfig first");
  return row;
}

export async function updateConfig(patch: Partial<Omit<Config, "id">>): Promise<Config> {
  await db.update(config).set(patch).where(eq(config.id, 1));
  return getConfig();
}

export async function getKnownExternalIds(): Promise<Set<string>> {
  const rows = await db.select({ externalId: offers.externalId }).from(offers);
  return new Set(rows.map((r) => r.externalId));
}

export async function upsertOffer(o: NewOffer): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = (
      await tx.select().from(offers).where(eq(offers.externalId, o.externalId)).limit(1)
    )[0] ?? null;

    // The would-be new tracked state (incoming non-null value, else keep existing).
    const merged: Record<string, unknown> = { ...(existing ?? {}) };
    for (const k of Object.keys(o) as (keyof NewOffer)[]) {
      if (o[k] !== undefined && o[k] !== null) merged[k] = o[k];
    }

    const [row] = await tx
      .insert(offers)
      .values({ ...o, lastSeen: sql`now()` })
      .onConflictDoUpdate({
        target: offers.externalId,
        set: {
          title: o.title ?? sql`${offers.title}`,
          price: o.price ?? sql`${offers.price}`,
          area: o.area ?? sql`${offers.area}`,
          rooms: o.rooms ?? sql`${offers.rooms}`,
          url: o.url,
          district: o.district ?? sql`${offers.district}`,
          districtCanonical: o.districtCanonical ?? sql`${offers.districtCanonical}`,
          kind: o.kind ?? sql`${offers.kind}`,
          features: o.features ?? sql`${offers.features}`,
          embedding: o.embedding ?? sql`${offers.embedding}`,
          embedTextHash: o.embedTextHash ?? sql`${offers.embedTextHash}`,
          description: o.description ?? sql`${offers.description}`,
          images: o.images ?? sql`${offers.images}`,
          score: o.score ?? sql`${offers.score}`,
          scoreReasons: o.scoreReasons ?? sql`${offers.scoreReasons}`,
          status: "active",
          lastSeen: sql`now()`,
        },
      })
      .returning({ id: offers.id });

    if (row && hasTrackedChange(existing, merged)) {
      await tx.insert(offerSnapshots).values({ offerId: row.id, data: trackedFields(merged) });
    }
  });
}

export async function getOfferHistory(externalId: string): Promise<OfferSnapshot[]> {
  const row = (
    await db.select({ id: offers.id }).from(offers).where(eq(offers.externalId, externalId)).limit(1)
  )[0];
  if (!row) return [];
  return db
    .select()
    .from(offerSnapshots)
    .where(eq(offerSnapshots.offerId, row.id))
    .orderBy(asc(offerSnapshots.capturedAt), asc(offerSnapshots.id));
}

export async function markNotified(externalId: string): Promise<void> {
  await db.update(offers).set({ notified: true }).where(eq(offers.externalId, externalId));
}

/** Mark offers that are NOT in the current list of active external_ids as inactive.
 *  An empty list is treated as "no signal" (likely a total scrape failure), NOT
 *  "everything is gone" — so it deactivates nothing. `excludeSources` extends the
 *  same principle to a partial failure: a source whose list scrape failed this
 *  run is missing signal, so its offers are shielded from deactivation while the
 *  healthy sources reconcile normally. */
export async function markInactive(
  activeExternalIds: string[],
  opts: { excludeSources?: string[] } = {},
): Promise<void> {
  if (activeExternalIds.length === 0) return;
  const excluded = opts.excludeSources ?? [];
  await db
    .update(offers)
    .set({ status: "inactive" })
    .where(and(
      eq(offers.status, "active"),
      notInArray(offers.externalId, activeExternalIds),
      ...(excluded.length > 0 ? [notInArray(offers.source, excluded)] : []),
    ));
}

export async function listOffers(page?: PageParams): Promise<Page<ListOffer>> {
  // Returns offers of ALL statuses (active + inactive) by design — the dashboard
  // renders a per-row status badge and relies on inactive rows still showing up.
  // There is no `WHERE status=` predicate, so the status-leading
  // offers_status_score_idx does NOT serve this query (that index primarily
  // benefits searchOffers, which filters status=active). Order + paginate + count
  // happen in SQL (NOT in JS) so the DB only ships the requested page.
  // listColumns omits the heavy server-only embedding column from the payload.
  // NULLS LAST so unscored offers don't float above scored ones (Postgres defaults NULLS FIRST on DESC).
  // id desc is the final tiebreaker so a row can't drift between page fetches.
  const ordered = db
    .select(listColumns)
    .from(offers)
    .orderBy(sql`${offers.score} desc nulls last`, desc(offers.lastSeen), desc(offers.id));
  if (!page) {
    const rows = await ordered;
    return { items: rows, total: rows.length };
  }
  const [items, [countRow]] = await Promise.all([
    ordered.limit(page.limit).offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(offers),
  ]);
  return { items, total: countRow?.count ?? 0 };
}

export async function appendLog(entry: {
  level: string;
  event: string;
  message: string;
  context?: unknown;
  runId?: string | null;
}): Promise<void> {
  await db.insert(logs).values({
    level: entry.level,
    event: entry.event,
    message: entry.message,
    context: entry.context ?? null,
    runId: entry.runId ?? null,
  });
}

export async function listLogs(opts: { limit?: number; sinceId?: number } = {}): Promise<LogRow[]> {
  const limit = opts.limit ?? 300;
  // Tail-cursor read for the SSE stream: rows strictly newer than sinceId,
  // oldest-first so the client can append in order.
  if (opts.sinceId !== undefined) {
    return db.select().from(logs).where(gt(logs.id, opts.sinceId)).orderBy(asc(logs.id)).limit(limit);
  }
  return db
    .select()
    .from(logs)
    .orderBy(desc(logs.ts), desc(logs.id))
    .limit(limit);
}

export async function pruneLogs(): Promise<void> {
  await db.delete(logs).where(lt(logs.ts, sql`now() - interval '7 days'`));
}

export async function getOfferByExternalId(externalId: string): Promise<Offer | null> {
  const rows = await db.select().from(offers).where(eq(offers.externalId, externalId)).limit(1);
  return rows[0] ?? null;
}

/** Active offers that have a description to score. Re-score reuses the stored
 *  description (no re-fetch); offers without one can't be scored. */
export async function getActiveScorableOffers(): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(and(eq(offers.status, "active"), isNotNull(offers.description)));
}

/** Narrow update of just the AI score columns. Unlike upsertOffer this does NOT
 *  touch status, lastSeen, or any scraped field. */
export async function updateOfferScore(
  externalId: string,
  score: number | null,
  reasons: string | null,
): Promise<void> {
  await db
    .update(offers)
    .set({ score, scoreReasons: reasons })
    .where(eq(offers.externalId, externalId));
}

export interface PageParams { limit: number; offset: number }
export interface Page<T> { items: T[]; total: number }

/** List/search payload projection: every column the client `Offer` type reads, and
 *  NOTHING the browser never uses. Excludes `embedding` (a large per-row float[] used
 *  only for server-side cosine ranking) and `embedTextHash` (an internal dedupe key).
 *  `description` is kept — the client `Offer` shape is shared with the detail view. */
const listColumns = {
  id: offers.id,
  externalId: offers.externalId,
  title: offers.title,
  price: offers.price,
  area: offers.area,
  rooms: offers.rooms,
  district: offers.district,
  kind: offers.kind,
  districtCanonical: offers.districtCanonical,
  features: offers.features,
  source: offers.source,
  url: offers.url,
  description: offers.description,
  images: offers.images,
  score: offers.score,
  scoreReasons: offers.scoreReasons,
  status: offers.status,
  notified: offers.notified,
  firstSeen: offers.firstSeen,
  lastSeen: offers.lastSeen,
} as const;

/** The row shape returned by the list/search endpoints (full `Offer` minus the
 *  server-only `embedding`/`embedTextHash` columns). */
export type ListOffer = { [K in keyof typeof listColumns]: Offer[K & keyof Offer] };

/** A keyword (embedding) search returns at most this many of the most relevant
 *  offers; the chosen sort then orders that relevant subset. */
const RELEVANCE_LIMIT = 100;

function paginate<T>(rows: T[], page?: PageParams): Page<T> {
  if (!page) return { items: rows, total: rows.length };
  return { items: rows.slice(page.offset, page.offset + page.limit), total: rows.length };
}

export interface SearchParams {
  q?: string; // raw query text; the API layer turns this into queryEmbedding

  queryEmbedding?: number[] | null;
  districts?: string[];
  kinds?: string[];
  features?: string[];
  sources?: string[];
  sort?: "score" | "newest" | "price" | "area";
  // Only offers whose firstSeen is within the last N hours (omit/0 = no limit).
  sinceHours?: number;
}

export async function searchOffers(params: SearchParams, page?: PageParams): Promise<Page<ListOffer>> {
  const conds = [eq(offers.status, "active")];
  if (params.districts?.length) conds.push(inArray(offers.districtCanonical, params.districts));
  if (params.kinds?.length) conds.push(inArray(offers.kind, params.kinds));
  if (params.sources?.length) conds.push(inArray(offers.source, params.sources));
  if (params.features?.length) {
    // PGlite can't bind a JS array to a Postgres array parameter for the @> operator,
    // so we build a Postgres array literal and cast it. The literal is passed as a
    // BOUND parameter (not concatenated into SQL), so this is injection-safe.
    const pgLiteral = "{" + params.features.map((f) => f.replace(/\\/g, "\\\\").replace(/"/g, '\\"')).join(",") + "}";
    conds.push(sql`${offers.features} @> ${pgLiteral}::text[]`);
  }
  if (params.sinceHours && params.sinceHours > 0) {
    const cutoff = new Date(Date.now() - params.sinceHours * 3600_000);
    conds.push(gte(offers.firstSeen, cutoff));
  }

  const where = and(...conds);

  // No query embedding: order + paginate + count entirely in SQL (the DB ships only
  // the requested page instead of every matching row). The embedding branch below
  // still needs all candidate rows in JS to rank them by cosine similarity.
  if (!params.queryEmbedding || !params.queryEmbedding.length) {
    const ordered = db.select(listColumns).from(offers).where(where).orderBy(...searchOrderBy(params.sort));
    if (!page) {
      const rows = await ordered;
      return { items: rows, total: rows.length };
    }
    const [items, [countRow]] = await Promise.all([
      ordered.limit(page.limit).offset(page.offset),
      db.select({ count: sql<number>`count(*)::int` }).from(offers).where(where),
    ]);
    return { items, total: countRow?.count ?? 0 };
  }

  // Keyword (embedding) search narrows to the most semantically relevant offers:
  // rank embeddable offers by cosine and keep the top RELEVANCE_LIMIT as the candidate
  // set. "Relevance" (score / default) returns them in relevance order; an explicit
  // newest/price/area sort then reorders that relevant subset (see switch below).
  // Deterministic base order so JS sorts (stable in ES2019+) and cosine tie-breaks are reproducible across pages.
  const rows = await db.select().from(offers).where(where).orderBy(desc(offers.id));
  const embeddable = rows.filter((o) => o.embedding && o.embedding.length);
  const ranked = rankByCosine(embeddable, params.queryEmbedding, (o) => o.embedding ?? null);
  const candidates = ranked.slice(0, RELEVANCE_LIMIT);
  // Strip the server-only embedding column from the payload (the client never reads
  // it, and it's a large float[] per row). Rank first, project last.
  if (!params.sort || params.sort === "score") return paginate(candidates.map(toListOffer), page);

  const sorted = [...candidates];
  switch (params.sort) {
    case "newest": sorted.sort((a, b) => +new Date(b.firstSeen) - +new Date(a.firstSeen) || b.id - a.id); break;
    case "price": sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || b.id - a.id); break;
    case "area": sorted.sort((a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity) || b.id - a.id); break;
  }
  return paginate(sorted.map(toListOffer), page);
}

/** Project a full DB offer row down to the client-facing `ListOffer` shape,
 *  dropping `embedding`/`embedTextHash` (used only server-side for ranking/dedupe).
 *  Reused at the API boundary (e.g. the single-offer refresh response) so every
 *  offer payload the browser receives has the same embedding-free shape. */
export function toListOffer(o: Offer): ListOffer {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(listColumns)) out[k] = o[k as keyof Offer];
  return out as ListOffer;
}

/** SQL ORDER BY clause matching the JS sort semantics used for the embedding path,
 *  so the two search branches order identically. id desc is the final tiebreaker. */
function searchOrderBy(sort: SearchParams["sort"]) {
  switch (sort) {
    case "newest": return [desc(offers.firstSeen), desc(offers.id)];
    case "price": return [sql`${offers.price} asc nulls last`, desc(offers.id)];
    case "area": return [sql`${offers.area} desc nulls last`, desc(offers.id)];
    default: return [sql`${offers.score} desc nulls last`, desc(offers.lastSeen), desc(offers.id)];
  }
}

export async function getFacets(): Promise<{ districts: string[]; kinds: string[]; features: { value: string; count: number }[]; sources: string[] }> {
  // SELECT DISTINCT for the scalar facets so the DB collapses duplicates instead of
  // us pulling every active row's column and de-duping in JS. Features is a text[]
  // column, so we unnest it to one row per element, then GROUP BY + count() server-side.
  const active = eq(offers.status, "active");
  const distinct = (col: AnyPgColumn): Promise<{ v: string | null }[]> =>
    db.selectDistinct({ v: col }).from(offers).where(and(active, isNotNull(col)));
  const [districtRows, kindRows, sourceRows, featureResult] = await Promise.all([
    distinct(offers.districtCanonical),
    distinct(offers.kind),
    distinct(offers.source),
    db.execute(sql`
      SELECT unnest(${offers.features}) AS v, count(*)::int AS n
      FROM ${offers}
      WHERE ${active}
      GROUP BY v
      ORDER BY n DESC, v ASC
    `),
  ]);
  // Driver envelope differs: postgres-js returns a bare row array, drizzle-pglite
  // returns { rows: [...] }. Normalize before reading.
  const featureRows = (Array.isArray(featureResult) ? featureResult : (featureResult as { rows?: unknown[] }).rows ?? []) as { v: string | null; n: number | string }[];
  return {
    districts: districtRows.map((r) => r.v).filter((v): v is string => v != null),
    kinds: kindRows.map((r) => r.v).filter((v): v is string => v != null),
    sources: sourceRows.map((r) => r.v).filter((v): v is string => v != null),
    features: featureRows
      .filter((r): r is { v: string; n: number | string } => r.v != null)
      .map((r) => ({ value: r.v, count: Number(r.n) })),
  };
}

/**
 * Atomically acquire the single-row run lock. Returns true if acquired (lock was
 * free, stale beyond staleMs, or first use), false if currently held by a live
 * holder. One statement — the ON CONFLICT row-lock prevents two racers winning.
 */
export async function acquireRunLock(holder: string, source: string, staleMs: number): Promise<boolean> {
  const staleSeconds = staleMs / 1000;
  const result = await db.execute(sql`
    INSERT INTO run_lock (id, holder, source, acquired_at)
    VALUES (1, ${holder}, ${source}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, source = ${source}, acquired_at = now()
      WHERE run_lock.holder IS NULL
         OR run_lock.acquired_at <= now() - make_interval(secs => ${staleSeconds})
    RETURNING holder
  `);
  // Result envelope differs by driver: postgres-js returns a bare row array,
  // drizzle-pglite returns { rows: [...] }. Normalize before counting.
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  return rows.length === 1;
}

/** Release the lock only if `holder` still owns it (a stolen, expired lease is left alone). */
export async function releaseRunLock(holder: string): Promise<void> {
  await db.execute(sql`
    UPDATE run_lock SET holder = NULL, source = NULL WHERE id = 1 AND holder = ${holder}
  `);
}
