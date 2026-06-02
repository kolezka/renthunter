import { eq, notInArray, sql, desc, lt } from "drizzle-orm";
import { db } from "./client";
import { offers, config, logs, type Config, type NewOffer, type Offer, type LogRow } from "./schema";

export async function ensureConfig(defaultSearchUrl: string): Promise<void> {
  await db.insert(config).values({ id: 1, searchUrl: defaultSearchUrl }).onConflictDoNothing();
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
        description: o.description ?? sql`${offers.description}`,
        score: o.score ?? sql`${offers.score}`,
        scoreReasons: o.scoreReasons ?? sql`${offers.scoreReasons}`,
        status: "active",
        lastSeen: sql`now()`,
      },
    });
}

export async function markNotified(externalId: string): Promise<void> {
  await db.update(offers).set({ notified: true }).where(eq(offers.externalId, externalId));
}

/** Oferty, których NIE ma na bieżącej liście aktywnych external_id, oznacz jako inactive. */
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

export async function listOffers(): Promise<Offer[]> {
  // NULLS LAST so unscored offers don't float above scored ones (Postgres defaults NULLS FIRST on DESC).
  return db
    .select()
    .from(offers)
    .orderBy(sql`${offers.score} desc nulls last`, desc(offers.lastSeen));
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
