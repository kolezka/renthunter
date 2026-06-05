CREATE INDEX IF NOT EXISTS "offers_status_idx" ON "offers" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_status_score_idx" ON "offers" ("status","score" DESC NULLS LAST,"last_seen" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_snapshots_offer_id_idx" ON "offer_snapshots" ("offer_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_ts_idx" ON "logs" ("ts" DESC,"id" DESC);
