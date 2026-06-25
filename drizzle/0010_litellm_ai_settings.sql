ALTER TABLE "config" ADD COLUMN "scorer_model" text DEFAULT 'deepseek/deepseek-chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "embed_model" text DEFAULT 'bge-m3' NOT NULL;--> statement-breakpoint
ALTER TABLE "config" ADD COLUMN "ai_base_url" text DEFAULT '' NOT NULL;
