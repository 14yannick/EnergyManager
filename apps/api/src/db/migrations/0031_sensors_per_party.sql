CREATE TYPE "public"."party_sensor_kind" AS ENUM('import', 'live_import_power', 'export', 'live_export_power', 'inverter_ac', 'pv_dc', 'battery_charge', 'battery_discharge', 'consumption_own', 'live_pv_power', 'live_battery_power', 'live_battery_soc', 'live_load_power', 'forecast_today', 'forecast_remaining', 'forecast_tomorrow');--> statement-breakpoint
CREATE TABLE "party_sensors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" "party_sensor_kind" NOT NULL,
	"entity_id" text NOT NULL,
	"inverted" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_items" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "feed_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "detailed_revenue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "detailed_live_view" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "party_sensors" ADD CONSTRAINT "party_sensors_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_sensors_party_kind_idx" ON "party_sensors" USING btree ("party_id","kind");--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Move what was the site's to the participant who produces.
--
-- Until now a site had one implicit producer: its sensors hung off the site,
-- its readings carried no party, its investment was the site's. That
-- producer is named here. It is the administrator who is also a member
-- (`rcp_admin`) — the owner, in every installation so far. A site with plant
-- data and no such party gets one called "Producer" to hold it, for the
-- administrator to rename or merge.
-- ---------------------------------------------------------------------------
CREATE TABLE "_site_producer" AS
SELECT
  s."id" AS "site_id",
  (SELECT p."id" FROM "parties" p WHERE p."site_id" = s."id" AND p."role" = 'rcp_admin' ORDER BY p."created_at" LIMIT 1) AS "party_id",
  (
    EXISTS (SELECT 1 FROM "ha_entity_map" m WHERE m."site_id" = s."id")
    OR EXISTS (SELECT 1 FROM "cost_items" c WHERE c."site_id" = s."id")
    OR EXISTS (SELECT 1 FROM "interval_metrics" i WHERE i."site_id" = s."id" AND i."party_id" IS NULL)
    OR s."live_export_power_entity_id" IS NOT NULL
    OR s."live_pv_power_entity_id" IS NOT NULL
    OR s."live_battery_power_entity_id" IS NOT NULL
    OR s."live_battery_soc_entity_id" IS NOT NULL
    OR s."live_load_power_entity_id" IS NOT NULL
    OR s."forecast_today_entity_id" IS NOT NULL
    OR s."forecast_remaining_entity_id" IS NOT NULL
    OR s."forecast_tomorrow_entity_id" IS NOT NULL
  ) AS "has_plant"
FROM "sites" s;--> statement-breakpoint

INSERT INTO "parties" ("site_id", "name")
SELECT "site_id", 'Producer' FROM "_site_producer" WHERE "party_id" IS NULL AND "has_plant"
ON CONFLICT ("site_id", "name") DO NOTHING;--> statement-breakpoint

UPDATE "_site_producer" sp SET "party_id" = p."id"
FROM "parties" p
WHERE sp."party_id" IS NULL AND sp."has_plant" AND p."site_id" = sp."site_id" AND p."name" = 'Producer';--> statement-breakpoint

-- The energy counters. One export counter now feeds both export metrics (see
-- PARTY_SENSOR_SPECS), so the two old rows become one: the `export_local`
-- mapping where there is one, else the `export_grid` one.
INSERT INTO "party_sensors" ("party_id", "kind", "entity_id", "enabled")
SELECT sp."party_id", k."kind"::"party_sensor_kind", m."statistic_id", m."enabled"
FROM "ha_entity_map" m
JOIN "_site_producer" sp ON sp."site_id" = m."site_id"
JOIN (VALUES
  ('import_grid', 'import'),
  ('export_local', 'export'),
  ('inverter_ac', 'inverter_ac'),
  ('pv_dc', 'pv_dc'),
  ('battery_charge', 'battery_charge'),
  ('battery_discharge', 'battery_discharge'),
  ('consumption_own', 'consumption_own')
) AS k("metric", "kind") ON k."metric" = m."metric_kind"::text
WHERE sp."party_id" IS NOT NULL;--> statement-breakpoint

INSERT INTO "party_sensors" ("party_id", "kind", "entity_id", "enabled")
SELECT sp."party_id", 'export', m."statistic_id", m."enabled"
FROM "ha_entity_map" m
JOIN "_site_producer" sp ON sp."site_id" = m."site_id"
WHERE m."metric_kind" = 'export_grid' AND sp."party_id" IS NOT NULL
ON CONFLICT ("party_id", "kind") DO NOTHING;--> statement-breakpoint

-- The live readings and the forecast, with the two sign flags carried onto
-- the sensors they describe.
INSERT INTO "party_sensors" ("party_id", "kind", "entity_id", "inverted")
SELECT sp."party_id", v."kind"::"party_sensor_kind", v."entity_id", v."inverted"
FROM "sites" s
JOIN "_site_producer" sp ON sp."site_id" = s."id"
CROSS JOIN LATERAL (VALUES
  ('live_export_power', s."live_export_power_entity_id", s."live_export_negative"),
  ('live_pv_power', s."live_pv_power_entity_id", false),
  ('live_battery_power', s."live_battery_power_entity_id", s."live_battery_charge_negative"),
  ('live_battery_soc', s."live_battery_soc_entity_id", false),
  ('live_load_power', s."live_load_power_entity_id", false),
  ('forecast_today', s."forecast_today_entity_id", false),
  ('forecast_remaining', s."forecast_remaining_entity_id", false),
  ('forecast_tomorrow', s."forecast_tomorrow_entity_id", false)
) AS v("kind", "entity_id", "inverted")
WHERE sp."party_id" IS NOT NULL AND v."entity_id" IS NOT NULL;--> statement-breakpoint

-- The producer feeds in; the two detailed options are on exactly where
-- there is a sensor that needs them, so nothing mapped today goes dark.
UPDATE "parties" p SET
  "feed_in" = true,
  "detailed_revenue" = EXISTS (
    SELECT 1 FROM "party_sensors" x WHERE x."party_id" = p."id"
      AND x."kind" IN ('inverter_ac', 'pv_dc', 'battery_charge', 'battery_discharge', 'consumption_own')),
  "detailed_live_view" = EXISTS (
    SELECT 1 FROM "party_sensors" x WHERE x."party_id" = p."id"
      AND x."kind" IN ('live_pv_power', 'live_battery_power', 'live_battery_soc', 'live_load_power',
                       'forecast_today', 'forecast_remaining', 'forecast_tomorrow'))
FROM "_site_producer" sp
WHERE sp."party_id" = p."id" AND sp."has_plant";--> statement-breakpoint

UPDATE "cost_items" c SET "party_id" = sp."party_id"
FROM "_site_producer" sp
WHERE sp."site_id" = c."site_id";--> statement-breakpoint

-- The readings that carried no party were the producer's. A row is left
-- alone if the producer already has one for the same instant and metric:
-- two cannot both be theirs, and the one already attributed wins.
UPDATE "interval_metrics" i SET "party_id" = sp."party_id"
FROM "_site_producer" sp
WHERE i."site_id" = sp."site_id" AND i."party_id" IS NULL AND sp."party_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "interval_metrics" x
    WHERE x."site_id" = i."site_id" AND x."ts" = i."ts" AND x."metric_kind" = i."metric_kind" AND x."party_id" = sp."party_id");--> statement-breakpoint

DROP TABLE "_site_producer";
