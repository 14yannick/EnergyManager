-- Added nullable, filled, then made mandatory: an existing site has no
-- external identifier to be given, so it starts as the site's own name
-- (what a newly created site gets too, see modules/sites/routes.ts).
ALTER TABLE "sites" ADD COLUMN "external_uuid" text;--> statement-breakpoint
UPDATE "sites" SET "external_uuid" = "name";--> statement-breakpoint
ALTER TABLE "sites" ALTER COLUMN "external_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "sync_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_external_uuid_idx" ON "sites" USING btree ("external_uuid");
