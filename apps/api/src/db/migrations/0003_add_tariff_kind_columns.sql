CREATE TYPE "public"."tariff_kind" AS ENUM('purchase', 'feed_in', 'neighbor_sell');--> statement-breakpoint
CREATE TABLE "dynamic_tariff_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "tariff_kind" NOT NULL,
	"start_ts" timestamp with time zone NOT NULL,
	"end_ts" timestamp with time zone NOT NULL,
	"rate_chf_per_kwh" numeric(10, 5) NOT NULL,
	"source" text NOT NULL,
	"publication_timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD COLUMN "kind" "tariff_kind";--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD COLUMN "start_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD COLUMN "end_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD COLUMN "rate_chf_per_kwh" numeric(10, 5);--> statement-breakpoint
ALTER TABLE "dynamic_tariff_rates" ADD CONSTRAINT "dynamic_tariff_rates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_tariff_rates_site_kind_start_idx" ON "dynamic_tariff_rates" USING btree ("site_id","kind","start_ts");
--> statement-breakpoint

-- Hand-written from here on (see CONTRIBUTING.md's pattern for hand-editing
-- generated migrations): backfill the new columns from the old ones before
-- dropping the old ones in 0004. Each existing row represented BOTH a
-- purchase and a sell rate for one date range; split it into two rows.
-- Old `date` columns are interpreted as Europe/Zurich local time, converted
-- to half-open UTC timestamp ranges — matches the Europe/Zurich assumption
-- already hardcoded in daily_energy_agg.

-- The backfill below inserts a same-date-range "feed_in" clone of each
-- "purchase" row, which the OLD (date-range-only, kind-unaware) exclusion
-- constraint would reject as an overlap. Swap it for the kind-aware one here
-- rather than in 0004, so the backfill itself can proceed.
ALTER TABLE "tariff_periods" DROP CONSTRAINT "tariff_periods_no_overlap";
--> statement-breakpoint
ALTER TABLE "tariff_periods"
  ADD CONSTRAINT "tariff_periods_no_overlap"
  EXCLUDE USING gist (site_id WITH =, kind WITH =, tstzrange(start_ts, end_ts, '[)') WITH &&);
--> statement-breakpoint
UPDATE "tariff_periods" SET
  "kind" = 'purchase',
  "start_ts" = (start_date::timestamp AT TIME ZONE 'Europe/Zurich'),
  "end_ts" = ((end_date + 1)::timestamp AT TIME ZONE 'Europe/Zurich'),
  "rate_chf_per_kwh" = purchase_rate_chf_per_kwh
WHERE "kind" IS NULL;
--> statement-breakpoint
-- The old columns are still NOT NULL at this point (dropped in the next
-- migration), so the synthetic feed_in row must supply them too even though
-- their values are meaningless for it.
INSERT INTO "tariff_periods" (
  site_id, start_date, end_date, purchase_rate_chf_per_kwh, sell_rate_chf_per_kwh,
  kind, start_ts, end_ts, rate_chf_per_kwh, label, created_at, updated_at
)
SELECT
  site_id, start_date, end_date, purchase_rate_chf_per_kwh, sell_rate_chf_per_kwh,
  'feed_in', start_ts, end_ts, sell_rate_chf_per_kwh, label, created_at, updated_at
FROM "tariff_periods"
WHERE "kind" = 'purchase';
--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "start_ts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "end_ts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "rate_chf_per_kwh" SET NOT NULL;