import { eq, notInArray, sql, desc, lt, and, isNotNull, asc, inArray } from "drizzle-orm";
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
  const existing = (
    await db.select().from(offers).where(eq(offers.externalId, o.externalId)).limit(1)
  )[0] ?? null;

  // The would-be new tracked state (incoming non-null value, else keep existing).
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const k of Object.keys(o) as (keyof NewOffer)[]) {
    if (o[k] !== undefined && o[k] !== null) merged[k] = o[k];
  }

  await db
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
    });

  if (hasTrackedChange(existing, merged)) {
    const row = (
      await db.select({ id: offers.id }).from(offers).where(eq(offers.externalId, o.externalId)).limit(1)
    )[0];
    if (row) await db.insert(offerSnapshots).values({ offerId: row.id, data: trackedFields(merged) });
  }
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

/** Mark offers that are NOT in the current list of active external_ids as inactive. */
export async function markInactive(activeExternalIds: string[]): Promise<void> {
  if (activeExternalIds.length === 0) {
    await db.update(offers).set({ status: "inactive" }).where(eq(offers.status, "active"));
    return;
  }
  await db
    .update(offers)
    .set({ status: "inactive" })
    .where(notInArray(offers.externalId, activeExternalIds));
}

export async function listOffers(page?: PageParams): Promise<Page<Offer>> {
  // NULLS LAST so unscored offers don't float above scored ones (Postgres defaults NULLS FIRST on DESC).
  // id desc is the final tiebreaker so a row can't drift between page fetches.
  const rows = await db
    .select()
    .from(offers)
    .orderBy(sql`${offers.score} desc nulls last`, desc(offers.lastSeen), desc(offers.id));
  return paginate(rows, page);
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

export async function listLogs(opts: { limit?: number } = {}): Promise<LogRow[]> {
  return db
    .select()
    .from(logs)
    .orderBy(desc(logs.ts), desc(logs.id))
    .limit(opts.limit ?? 300);
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
}

export async function searchOffers(params: SearchParams, page?: PageParams): Promise<Page<Offer>> {
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

  // Deterministic base order so JS sorts (stable in ES2019+) and cosine tie-breaks are reproducible across pages.
  const rows = await db.select().from(offers).where(and(...conds)).orderBy(desc(offers.id));

  // Keyword (embedding) search narrows to the most semantically relevant offers:
  // rank embeddable offers by cosine and keep the top RELEVANCE_LIMIT as the candidate
  // set. "Relevance" (score / default) returns them in relevance order; an explicit
  // newest/price/area sort then reorders that relevant subset (see switch below).
  let candidates = rows;
  if (params.queryEmbedding && params.queryEmbedding.length) {
    const embeddable = rows.filter((o) => o.embedding && o.embedding.length);
    const ranked = rankByCosine(embeddable, params.queryEmbedding, (o) => o.embedding ?? null);
    candidates = ranked.slice(0, RELEVANCE_LIMIT);
    if (!params.sort || params.sort === "score") return paginate(candidates, page);
  }

  const sorted = [...candidates];
  switch (params.sort) {
    case "newest": sorted.sort((a, b) => +new Date(b.firstSeen) - +new Date(a.firstSeen) || b.id - a.id); break;
    case "price": sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || b.id - a.id); break;
    case "area": sorted.sort((a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity) || b.id - a.id); break;
    default: sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || +new Date(b.lastSeen) - +new Date(a.lastSeen) || b.id - a.id);
  }
  return paginate(sorted, page);
}

export async function getFacets(): Promise<{ districts: string[]; kinds: string[]; features: string[]; sources: string[] }> {
  const rows = await db
    .select({ districtCanonical: offers.districtCanonical, kind: offers.kind, features: offers.features, source: offers.source })
    .from(offers)
    .where(eq(offers.status, "active"));
  const districts = new Set<string>(), kinds = new Set<string>(), features = new Set<string>(), sources = new Set<string>();
  for (const r of rows) {
    if (r.districtCanonical) districts.add(r.districtCanonical);
    if (r.kind) kinds.add(r.kind);
    if (r.source) sources.add(r.source);
    for (const f of r.features ?? []) features.add(f);
  }
  return { districts: [...districts], kinds: [...kinds], features: [...features], sources: [...sources] };
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
