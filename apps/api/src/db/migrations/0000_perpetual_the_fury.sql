CREATE TYPE "public"."cost_category" AS ENUM('battery', 'solar');--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Zurich' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"purchase_rate_chf_per_kwh" numeric(10, 5) NOT NULL,
	"sell_rate_chf_per_kwh" numeric(10, 5) NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "end_after_start" CHECK ("tariff_periods"."end_date" >= "tariff_periods"."start_date")
);
--> statement-breakpoint
CREATE TABLE "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"label" text NOT NULL,
	"amount_chf" numeric(12, 2) NOT NULL,
	"incurred_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interval_readings" (
	"site_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"produced_kwh" numeric(9, 4) DEFAULT '0' NOT NULL,
	"battery_charge_kwh" numeric(9, 4) DEFAULT '0' NOT NULL,
	"battery_discharge_kwh" numeric(9, 4) DEFAULT '0' NOT NULL,
	"exported_kwh" numeric(9, 4) DEFAULT '0' NOT NULL,
	"imported_kwh" numeric(9, 4) DEFAULT '0' NOT NULL,
	"source" text DEFAULT 'csv_import' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interval_readings_site_id_ts_pk" PRIMARY KEY("site_id","ts")
);
--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD CONSTRAINT "tariff_periods_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interval_readings" ADD CONSTRAINT "interval_readings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;