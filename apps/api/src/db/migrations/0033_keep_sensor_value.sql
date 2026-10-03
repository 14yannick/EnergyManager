ALTER TABLE "interval_metrics" ADD COLUMN "sensor_value_kwh" numeric(9, 4);--> statement-breakpoint
-- Every reading a sensor wrote is, so far, also the value in force: record it
-- as the sensor's too, so the column means the same for old rows as for new.
UPDATE "interval_metrics" SET "sensor_value_kwh" = "value_kwh"
WHERE "source" = 'home_assistant' OR "source" LIKE 'ha:%' OR "source" LIKE 'derived:%';
