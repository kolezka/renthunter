CREATE TABLE "run_lock" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"holder" text,
	"source" text,
	"acquired_at" timestamp with time zone
);
