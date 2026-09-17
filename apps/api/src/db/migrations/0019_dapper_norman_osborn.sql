ALTER TABLE "parties" ADD COLUMN "is_operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "iban" text;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_one_operator_idx" ON "parties" USING btree ("site_id") WHERE "parties"."is_operator";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_iban";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_name";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_address";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_building_number";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_zip";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_city";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "creditor_country";