ALTER TABLE "sites" ADD COLUMN "live_battery_power_entity_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "live_battery_charge_negative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "live_battery_soc_entity_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "live_load_power_entity_id" text;