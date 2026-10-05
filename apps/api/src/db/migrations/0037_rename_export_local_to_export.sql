-- The metric holds what left the producer's meter, whoever took it; "local"
-- named the opposite. Renamed in place: the generated version rebuilt the
-- type through text, which rewrites every chunk of the hypertable and cannot
-- cast the old value back anyway.
ALTER TYPE "public"."interval_metric_kind" RENAME VALUE 'export_local' TO 'export';--> statement-breakpoint
-- The export sensor used to be written twice: as what left the meter and, the
-- same figure again, as what reached the grid. Grid export is the grid
-- provider's figure from here on, worked out until it arrives (see
-- modules/vzev/settlement.ts), so the sensor's copies go — each one still
-- stands, to the last digit, in `export` for the same interval. A row the
-- provider's data has taken over carries its source and is kept.
DELETE FROM "interval_metrics"
WHERE "metric_kind" = 'export_grid'
  AND ("source" = 'home_assistant' OR "source" LIKE 'ha:%' OR "source" LIKE 'derived:%');
