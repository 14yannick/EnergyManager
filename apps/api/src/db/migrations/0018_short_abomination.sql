ALTER TABLE "sites" ADD COLUMN "creditor_iban" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "creditor_name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "creditor_address" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "creditor_building_number" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "creditor_zip" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "creditor_city" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "creditor_country" text DEFAULT 'CH' NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "building_number" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "country" text DEFAULT 'CH' NOT NULL;