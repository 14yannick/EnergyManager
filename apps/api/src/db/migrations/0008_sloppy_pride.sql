ALTER TYPE "public"."interval_metric_kind" ADD VALUE 'consumption_own';--> statement-breakpoint
CREATE TABLE "ha_entity_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"metric_kind" interval_metric_kind NOT NULL,
	"statistic_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ha_entity_map" ADD CONSTRAINT "ha_entity_map_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ha_entity_map_site_metric_idx" ON "ha_entity_map" USING btree ("site_id","metric_kind");