ALTER TABLE "parties" ADD COLUMN "production_start_date" date;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "battery_conversion_loss" numeric(5, 4);--> statement-breakpoint

-- The site's two plant figures go to its producer: the participant with
-- feed-in, the member-administrator first where there are several (the same
-- party 0031 named). A site with no producer had no plant for them to
-- describe, and they are dropped with the columns.
--
-- A start date only counts with the detailed revenue option on, so moving
-- one switches that option on rather than leave the date stored and unread.
UPDATE "parties" p SET
  "production_start_date" = s."production_start_date",
  "battery_conversion_loss" = s."battery_conversion_loss",
  "detailed_revenue" = p."detailed_revenue" OR s."production_start_date" IS NOT NULL
FROM "sites" s
WHERE p."id" = (
  SELECT x."id" FROM "parties" x
  WHERE x."site_id" = s."id" AND x."feed_in"
  ORDER BY (x."role" = 'rcp_admin') DESC, x."created_at"
  LIMIT 1
);--> statement-breakpoint

ALTER TABLE "sites" DROP COLUMN "production_start_date";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "battery_conversion_loss";
