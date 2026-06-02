ALTER TABLE "config" ADD COLUMN "search_urls" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "config" SET "search_urls" = ARRAY["search_url"] WHERE "search_url" IS NOT NULL AND "search_url" <> '';--> statement-breakpoint
ALTER TABLE "config" DROP COLUMN "search_url";
