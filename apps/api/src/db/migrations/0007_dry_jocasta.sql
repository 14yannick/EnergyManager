CREATE TABLE "tariff_surcharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "tariff_kind" NOT NULL,
	"start_ts" timestamp with time zone NOT NULL,
	"end_ts" timestamp with time zone NOT NULL,
	"rate_chf_per_kwh" numeric(10, 5) NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_surcharges_end_after_start" CHECK ("tariff_surcharges"."end_ts" > "tariff_surcharges"."start_ts")
);
--> statement-breakpoint
ALTER TABLE "tariff_surcharges" ADD CONSTRAINT "tariff_surcharges_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;