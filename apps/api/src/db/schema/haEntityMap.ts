import { pgTable, text, boolean, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";
import { intervalMetricKindEnum } from "./intervalMetrics.js";

// Which Home Assistant statistic feeds which metric kind. Entity ids are
// installation-specific (they encode the user's own device names), so they're
// configuration rather than source: this table is what the HA sync reads to
// know what to pull. One entity per metric kind per site.
export const haEntityMap = pgTable(
  "ha_entity_map",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    metricKind: intervalMetricKindEnum("metric_kind").notNull(),
    // A Home Assistant statistic id — for a sensor entity this is its
    // entity_id (e.g. "sensor.emma_total_charged_energy").
    statisticId: text("statistic_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ha_entity_map_site_metric_idx").on(table.siteId, table.metricKind)],
);
