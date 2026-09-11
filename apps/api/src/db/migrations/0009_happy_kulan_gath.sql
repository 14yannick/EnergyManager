CREATE TYPE "public"."billing_allocation" AS ENUM('per_kwh', 'pool_shared', 'per_participant');--> statement-breakpoint
CREATE TYPE "public"."billing_category" AS ENUM('energie', 'netznutzung', 'messung', 'abgaben');--> statement-breakpoint
ALTER TYPE "public"."interval_metric_kind" ADD VALUE 'consumption_grid';--> statement-breakpoint
CREATE TABLE "grid_tariff_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"category" "billing_category" NOT NULL,
	"label" text NOT NULL,
	"allocation" "billing_allocation" NOT NULL,
	"rate_chf" numeric(12, 6) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"counts_in_direct_billing" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grid_tariff_positions_valid_range" CHECK ("grid_tariff_positions"."valid_to" > "grid_tariff_positions"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "grid_tariff_positions" ADD CONSTRAINT "grid_tariff_positions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;