CREATE TABLE "price_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"kind" "tariff_kind" DEFAULT 'feed_in' NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "price_feed_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "price_feeds_key_idx" ON "price_feeds" USING btree ("key");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_price_feed_id_price_feeds_id_fk" FOREIGN KEY ("price_feed_id") REFERENCES "public"."price_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Each price sensor a site was reading becomes a feed, once, however many
-- sites read it. Its key starts as the entity's own name ("sensor.x" → "x"),
-- which is at least recognisable; the administrator gives it the name the
-- series deserves under Integrations.
INSERT INTO "price_feeds" ("key", "entity_id")
SELECT DISTINCT ON (k."key") k."key", k."entity_id"
FROM (
  SELECT
    trim(both '_' from regexp_replace(lower(regexp_replace(s."dynamic_tariff_entity_id", '^[^.]*\.', '')), '[^a-z0-9]+', '_', 'g')) AS "key",
    s."dynamic_tariff_entity_id" AS "entity_id"
  FROM "sites" s
  WHERE s."dynamic_tariff_entity_id" IS NOT NULL
) k
WHERE k."key" <> ''
ORDER BY k."key", k."entity_id";--> statement-breakpoint

UPDATE "sites" s SET "price_feed_id" = f."id"
FROM "price_feeds" f
WHERE f."entity_id" = s."dynamic_tariff_entity_id";
--> statement-breakpoint

-- The rates already stored are that same series, so they take the feed's key
-- as their source too — a rate says which published series it is, not which
-- relay happened to deliver it. Two older labels become the key:
--   "home_assistant:<entity>"  written by the sync from the feed's own sensor
--   "bkw_dyntariffs"           written when the app still called BKW directly,
--                              before the sensor took over the same tariff
-- Anything else (a seed, an import) is some other series and keeps its label.
UPDATE "dynamic_tariff_rates" r SET "source" = f."key"
FROM "sites" s
JOIN "price_feeds" f ON f."id" = s."price_feed_id"
WHERE r."site_id" = s."id"
  AND (r."source" = 'home_assistant:' || f."entity_id" OR r."source" = 'bkw_dyntariffs');
