import { pgTable, text, numeric, timestamp, uuid, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";
import { parties } from "./parties.js";

// Attribute model: one row per (site, timestamp, metric), instead of fixed
// columns — mirrors tariff_periods' `kind` column. New metrics (a third
// neighbour, a new flow type) don't need a schema change.
export const intervalMetricKindEnum = pgEnum("interval_metric_kind", [
  "production",
  "export_local", // shared directly with a neighbour, not through the grid meter
  "export_grid",
  "import_grid",
  "battery_charge",
  "battery_discharge",
  "consumption", // per-party; partyId required for this kind, null for all others
]);

// Converted into a Timescale hypertable (partitioned on `ts`), and given two
// partial unique indexes (partyId set / unset) for upsert — by a hand-written
// follow-up migration, since neither is representable in Drizzle's schema
// builder for a hypertable. See db/migrations/0005_*.sql.
export const intervalMetrics = pgTable(
  "interval_metrics",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    metricKind: intervalMetricKindEnum("metric_kind").notNull(),
    partyId: uuid("party_id").references(() => parties.id, { onDelete: "cascade" }),
    valueKwh: numeric("value_kwh", { precision: 9, scale: 4 }).notNull().default("0"),
    source: text("source").notNull().default("csv_import"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("interval_metrics_no_party_idx")
      .on(table.siteId, table.ts, table.metricKind)
      .where(sql`${table.partyId} IS NULL`),
    uniqueIndex("interval_metrics_party_idx")
      .on(table.siteId, table.ts, table.metricKind, table.partyId)
      .where(sql`${table.partyId} IS NOT NULL`),
  ],
);
