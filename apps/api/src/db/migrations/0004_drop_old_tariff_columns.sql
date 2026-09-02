ALTER TABLE "tariff_periods" DROP CONSTRAINT "end_after_start";--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "start_ts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "end_ts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "rate_chf_per_kwh" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" DROP COLUMN "start_date";--> statement-breakpoint
ALTER TABLE "tariff_periods" DROP COLUMN "end_date";--> statement-breakpoint
ALTER TABLE "tariff_periods" DROP COLUMN "purchase_rate_chf_per_kwh";--> statement-breakpoint
ALTER TABLE "tariff_periods" DROP COLUMN "sell_rate_chf_per_kwh";--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD CONSTRAINT "tariff_periods_end_after_start" CHECK ("tariff_periods"."end_ts" > "tariff_periods"."start_ts");
-- Note: the kind-aware exclusion constraint swap (tariff_periods_no_overlap)
-- already happened in 0003 — it had to run before that migration's backfill
-- INSERT, which the old date-only constraint would otherwise have rejected.