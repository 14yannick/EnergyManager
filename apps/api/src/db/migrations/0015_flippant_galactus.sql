ALTER TYPE "public"."interval_metric_kind" ADD VALUE 'inverter_ac' BEFORE 'export_local';--> statement-breakpoint
ALTER TYPE "public"."interval_metric_kind" ADD VALUE 'pv_dc' BEFORE 'export_local';--> statement-breakpoint
ALTER TYPE "public"."interval_metric_kind" ADD VALUE 'battery_discharge_ac' BEFORE 'export_local';
