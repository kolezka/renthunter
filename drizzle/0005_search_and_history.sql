ALTER TABLE "offers" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "district_canonical" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "features" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "embedding" real[];--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "embed_text_hash" text;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "extract_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "embed_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE "offer_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "offer_snapshots" ADD CONSTRAINT "offer_snapshots_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
