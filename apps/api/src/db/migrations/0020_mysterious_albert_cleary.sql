CREATE TYPE "public"."party_role" AS ENUM('rcp_party', 'rcp_admin', 'rcp_admin_only', 'viewer');--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "role" "party_role" DEFAULT 'rcp_party' NOT NULL;--> statement-breakpoint
-- Carry the old boolean over. An existing operator becomes `rcp_admin` rather
-- than `rcp_admin_only`: they run the app *and* consume from the connection,
-- which is the ordinary case and the one that keeps them in the billing count.
-- Everyone else takes the column default, `rcp_party`.
UPDATE "parties" SET "role" = 'rcp_admin' WHERE "is_operator";--> statement-breakpoint
CREATE UNIQUE INDEX "parties_one_admin_idx" ON "parties" USING btree ("site_id") WHERE "parties"."role" in ('rcp_admin', 'rcp_admin_only');