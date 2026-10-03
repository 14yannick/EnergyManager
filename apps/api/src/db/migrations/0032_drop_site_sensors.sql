ALTER TABLE "ha_entity_map" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ha_entity_map" CASCADE;--> statement-breakpoint
ALTER TABLE "cost_items" ALTER COLUMN "party_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_export_power_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_export_negative";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_pv_power_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_battery_power_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_battery_charge_negative";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_battery_soc_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "live_load_power_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "forecast_today_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "forecast_remaining_entity_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "forecast_tomorrow_entity_id";