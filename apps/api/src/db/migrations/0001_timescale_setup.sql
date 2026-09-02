-- Hand-written migration: Drizzle's schema builder has no support for
-- hypertables, exclusion constraints, or continuous aggregates, so this
-- follow-up to the base schema migration is maintained manually. See
-- CONTRIBUTING.md.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- Convert interval_readings into a hypertable partitioned by time. Chunk
-- interval is deliberately large (1 month): a single household's 15-minute
-- data is only ~35k rows/year, so Timescale's benefit here is query pruning
-- and continuous aggregates, not chunk-count scaling.
SELECT create_hypertable('interval_readings', 'ts', chunk_time_interval => INTERVAL '1 month');
--> statement-breakpoint

-- Enforce "tariff periods must not overlap per site" at the DB layer, not
-- just in application code.
ALTER TABLE tariff_periods
  ADD CONSTRAINT tariff_periods_no_overlap
  EXCLUDE USING gist (site_id WITH =, daterange(start_date, end_date, '[]') WITH &&);
--> statement-breakpoint

-- Daily rollup of interval readings, bucketed in the site's local calendar
-- day (not naive UTC days) so it lines up with how tariff periods and
-- savings are reasoned about. Real-time aggregation (Timescale's default)
-- means recently imported data shows up immediately without waiting for the
-- refresh policy below.
CREATE MATERIALIZED VIEW daily_energy_agg
WITH (timescaledb.continuous) AS
SELECT
  site_id,
  time_bucket('1 day', ts, 'Europe/Zurich') AS day,
  sum(produced_kwh) AS produced_kwh,
  sum(battery_charge_kwh) AS battery_charge_kwh,
  sum(battery_discharge_kwh) AS battery_discharge_kwh,
  sum(exported_kwh) AS exported_kwh,
  sum(imported_kwh) AS imported_kwh
FROM interval_readings
GROUP BY site_id, day
WITH NO DATA;
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('daily_energy_agg',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
