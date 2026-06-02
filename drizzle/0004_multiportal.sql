ALTER TABLE "offers" ADD COLUMN "source" text DEFAULT 'trojmiasto' NOT NULL;--> statement-breakpoint
UPDATE "offers" SET "external_id" = 'trojmiasto:' || "external_id" WHERE "external_id" NOT LIKE '%:%';
