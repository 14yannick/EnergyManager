CREATE TYPE "public"."tariff_pricing_mode" AS ENUM('flat', 'dynamic');--> statement-breakpoint
ALTER TABLE "tariff_periods" ALTER COLUMN "rate_chf_per_kwh" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD COLUMN "pricing_mode" "tariff_pricing_mode" DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD CONSTRAINT "tariff_periods_flat_requires_rate" CHECK ("tariff_periods"."pricing_mode" <> 'flat' OR "tariff_periods"."rate_chf_per_kwh" IS NOT NULL);