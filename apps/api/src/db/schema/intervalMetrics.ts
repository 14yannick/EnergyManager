import { pgTable, text, numeric, timestamp, uuid, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";
import { parties } from "./parties.js";

// Attribute model: one row per (site, timestamp, metric), instead of fixed
// columns — mirrors tariff_periods' `kind` column. New metrics (a third
// neighbour, a new flow type) don't need a schema change.
export const intervalMetricKindEnum = pgEnum("interval_metric_kind", [
  /**
   * PV energy that reached the AC bus — the panels' share of inverter output,
   * *excluding* anything that came back out of the battery.
   *
   * Derived, not synced: the inverter reports one AC figure covering both
   * sources (see `inverter_ac`), so the two are separated by splitting that
   * measured AC total in proportion to the DC each source supplied. Using the
   * DC values only as a ratio keeps the result AC-side and needs no assumed
   * conversion efficiency — both sources share the inverter at the same load
   * point, so they convert alike.
   */
  "production",
  /** Raw inverter AC output: PV *plus* battery discharge. The split's input. */
  "inverter_ac",
  /** Raw DC yield of the panels, before conversion. Only used as the ratio. */
  "pv_dc",
  /** The battery's share of inverter AC output — the counterpart of production. */
  "battery_discharge_ac",
  "export_local", // shared directly with a neighbour, not through the grid meter
  "export_grid",
  "import_grid",
  "battery_charge",
  "battery_discharge",
  "consumption", // per-party; partyId required for this kind, null for all others
  "consumption_own", // the household's own total load ("Verbrauch") — site-level, partyId null
  "consumption_grid", // per-party: what that participant drew from the grid, not from local PV
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
