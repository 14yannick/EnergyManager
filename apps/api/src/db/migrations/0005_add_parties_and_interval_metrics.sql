CREATE TYPE "public"."interval_metric_kind" AS ENUM('production', 'export_local', 'export_grid', 'import_grid', 'battery_charge', 'battery_discharge', 'consumption');--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interval_metrics" (
	"site_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"metric_kind" interval_metric_kind NOT NULL,
	"party_id" uuid,
	"value_kwh" numeric(9, 4) DEFAULT '0' NOT NULL,
	"source" text DEFAULT 'csv_import' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interval_metrics" ADD CONSTRAINT "interval_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interval_metrics" ADD CONSTRAINT "interval_metrics_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_site_name_idx" ON "parties" USING btree ("site_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "interval_metrics_no_party_idx" ON "interval_metrics" USING btree ("site_id","ts","metric_kind") WHERE "interval_metrics"."party_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interval_metrics_party_idx" ON "interval_metrics" USING btree ("site_id","ts","metric_kind","party_id") WHERE "interval_metrics"."party_id" IS NOT NULL;
--> statement-breakpoint

-- Hand-written from here on (see CONTRIBUTING.md): hypertables, backfill
-- data migration, and continuous-aggregate teardown aren't representable in
-- Drizzle's schema builder.

-- Table is freshly created and empty at this point, so no migrate_data
-- needed. Both unique indexes above include `ts`, satisfying Timescale's
-- requirement that unique constraints include the partitioning column.
SELECT create_hypertable('interval_metrics', 'ts', chunk_time_interval => INTERVAL '1 month');
--> statement-breakpoint

-- Backfill: interval_readings' five fixed columns become five metric_kind
-- rows each. All rows are ported unconditionally (including zeros — e.g. "no
-- production at 2am" is meaningful data, not absence of data). No
-- `consumption` rows are backfilled; that data never existed before.
INSERT INTO interval_metrics (site_id, ts, metric_kind, value_kwh, source, created_at)
SELECT site_id, ts, 'production', produced_kwh, source, created_at FROM interval_readings;
--> statement-breakpoint
INSERT INTO interval_metrics (site_id, ts, metric_kind, value_kwh, source, created_at)
SELECT site_id, ts, 'battery_charge', battery_charge_kwh, source, created_at FROM interval_readings;
--> statement-breakpoint
INSERT INTO interval_metrics (site_id, ts, metric_kind, value_kwh, source, created_at)
SELECT site_id, ts, 'battery_discharge', battery_discharge_kwh, source, created_at FROM interval_readings;
--> statement-breakpoint
-- All historical export was through the grid meter (pre-VZEV) — none of it
-- becomes export_local.
INSERT INTO interval_metrics (site_id, ts, metric_kind, value_kwh, source, created_at)
SELECT site_id, ts, 'export_grid', exported_kwh, source, created_at FROM interval_readings;
--> statement-breakpoint
INSERT INTO interval_metrics (site_id, ts, metric_kind, value_kwh, source, created_at)
SELECT site_id, ts, 'import_grid', imported_kwh, source, created_at FROM interval_readings;
--> statement-breakpoint

-- daily_energy_agg is dead code as of the interval-level savings rewrite in
-- 0002_realtime_aggregation.sql's follow-up work — nothing queries it
-- anymore, and its column list can't survive this restructuring anyway.
SELECT remove_continuous_aggregate_policy('daily_energy_agg');
--> statement-breakpoint
DROP MATERIALIZED VIEW daily_energy_agg;