ALTER TABLE "sites" ADD COLUMN "live_export_power_entity_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "live_pv_power_entity_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "forecast_today_entity_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "forecast_remaining_entity_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "forecast_tomorrow_entity_id" text;