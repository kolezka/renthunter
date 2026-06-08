import {
  pgTable, serial, integer, text, doublePrecision, real, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  title: text("title").notNull().default(""),
  price: integer("price"),
  area: doublePrecision("area"),
  rooms: integer("rooms"),
  district: text("district"),
  kind: text("kind"),
  districtCanonical: text("district_canonical"),
  features: text("features").array().notNull().default([]),
  embedding: real("embedding").array(),
  embedTextHash: text("embed_text_hash"),
  source: text("source").notNull().default("trojmiasto"),
  url: text("url").notNull(),
  description: text("description"),
  images: text("images").array().notNull().default([]),
  score: integer("score"),
  scoreReasons: text("score_reasons"),
  status: text("status").notNull().default("active"),
  notified: boolean("notified").notNull().default(false),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("offers_status_idx").on(t.status),
  statusScoreIdx: index("offers_status_score_idx").on(t.status, t.score.desc().nullsLast(), t.lastSeen.desc(), t.id.desc()),
}));

export const config = pgTable("config", {
  id: integer("id").primaryKey().default(1),
  searchUrls: text("search_urls").array().notNull().default([]),
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  minArea: doublePrecision("min_area"),
  minRooms: integer("min_rooms"),
  maxArea: doublePrecision("max_area"),
  maxRooms: integer("max_rooms"),
  aiCriteria: text("ai_criteria").notNull().default(""),
  // Language the AI is asked to answer in (score reasons, extracted features).
  // Listings are scraped in Polish, so this defaults to Polish; change it freely.
  outputLanguage: text("output_language").notNull().default("Polish"),
  scoreThreshold: integer("score_threshold").notNull().default(70),
  pollIntervalMin: integer("poll_interval_min").notNull().default(5),
  rescoreIntervalMin: integer("rescore_interval_min").notNull().default(0),
  appriseUrls: text("apprise_urls").array().notNull().default([]),
  deepseekEnabled: boolean("deepseek_enabled").notNull().default(true),
  listPages: integer("list_pages").notNull().default(1),
  maxDetailFetchesPerRun: integer("max_detail_fetches_per_run").notNull().default(30),
  requestDelayMs: integer("request_delay_ms").notNull().default(0),
  concurrencyLimit: integer("concurrency_limit").notNull().default(1),
  extractEnabled: boolean("extract_enabled").notNull().default(true),
  embedEnabled: boolean("embed_enabled").notNull().default(false),
});

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
export type Config = typeof config.$inferSelect;

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  runId: text("run_id"),
  level: text("level").notNull(),
  event: text("event").notNull(),
  message: text("message").notNull().default(""),
  context: jsonb("context"),
}, (t) => ({
  tsIdx: index("logs_ts_idx").on(t.ts.desc(), t.id.desc()),
}));

export type LogRow = typeof logs.$inferSelect;
export type NewLogRow = typeof logs.$inferInsert;

export const runLock = pgTable("run_lock", {
  id: integer("id").primaryKey().default(1),
  holder: text("holder"),
  source: text("source"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
});

export type RunLock = typeof runLock.$inferSelect;

export const offerSnapshots = pgTable("offer_snapshots", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  data: jsonb("data").notNull(),
}, (t) => ({
  offerIdIdx: index("offer_snapshots_offer_id_idx").on(t.offerId, t.id),
}));

export type OfferSnapshot = typeof offerSnapshots.$inferSelect;
export type NewOfferSnapshot = typeof offerSnapshots.$inferInsert;
