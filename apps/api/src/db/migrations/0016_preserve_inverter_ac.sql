-- `production` has until now held `sensor.emma_inverter_total_energy_yield`,
-- which is inverter AC output: PV *plus* battery discharge, and *minus*
-- whatever the panels sent into the battery. Preserve it under its true name
-- before the PV/battery split overwrites `production` with the PV-only share.
--
-- Copying rather than refetching keeps the whole history, including the months
-- Home Assistant can no longer serve — its statistics begin 2025-12-31 while
-- this data starts 2025-10-15.
--
-- Separate from 0015 because Postgres refuses to use an enum value in the same
-- transaction that added it, and drizzle runs each migration in one.
INSERT INTO interval_metrics (site_id, ts, metric_kind, value_kwh, source, created_at)
SELECT site_id, ts, 'inverter_ac', value_kwh, source, created_at
FROM interval_metrics WHERE metric_kind = 'production'
ON CONFLICT DO NOTHING;
