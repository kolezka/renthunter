import {
  pgTable, serial, integer, text, doublePrecision, boolean, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  title: text("title").notNull().default(""),
  price: integer("price"),
  area: doublePrecision("area"),
  rooms: integer("rooms"),
  district: text("district"),
  url: text("url").notNull(),
  description: text("description"),
  images: text("images").array().notNull().default([]),
  score: integer("score"),
  scoreReasons: text("score_reasons"),
  status: text("status").notNull().default("active"),
  notified: boolean("notified").notNull().default(false),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

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
  scoreThreshold: integer("score_threshold").notNull().default(70),
  pollIntervalMin: integer("poll_interval_min").notNull().default(5),
  appriseUrls: text("apprise_urls").array().notNull().default([]),
  deepseekEnabled: boolean("deepseek_enabled").notNull().default(true),
  listPages: integer("list_pages").notNull().default(1),
  maxDetailFetchesPerRun: integer("max_detail_fetches_per_run").notNull().default(30),
  requestDelayMs: integer("request_delay_ms").notNull().default(0),
  concurrencyLimit: integer("concurrency_limit").notNull().default(1),
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
});

export type LogRow = typeof logs.$inferSelect;
export type NewLogRow = typeof logs.$inferInsert;

export const runLock = pgTable("run_lock", {
  id: integer("id").primaryKey().default(1),
  holder: text("holder"),
  source: text("source"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
});

export type RunLock = typeof runLock.$inferSelect;
