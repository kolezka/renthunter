CREATE TABLE "config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"search_url" text NOT NULL,
	"min_price" integer,
	"max_price" integer,
	"min_area" double precision,
	"min_rooms" integer,
	"max_area" double precision,
	"max_rooms" integer,
	"ai_criteria" text DEFAULT '' NOT NULL,
	"score_threshold" integer DEFAULT 70 NOT NULL,
	"poll_interval_min" integer DEFAULT 5 NOT NULL,
	"apprise_urls" text[] DEFAULT '{}' NOT NULL,
	"deepseek_enabled" boolean DEFAULT true NOT NULL,
	"list_pages" integer DEFAULT 1 NOT NULL,
	"max_detail_fetches_per_run" integer DEFAULT 30 NOT NULL,
	"request_delay_ms" integer DEFAULT 0 NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" text,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"price" integer,
	"area" double precision,
	"rooms" integer,
	"district" text,
	"url" text NOT NULL,
	"description" text,
	"score" integer,
	"score_reasons" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_external_id_unique" UNIQUE("external_id")
);
