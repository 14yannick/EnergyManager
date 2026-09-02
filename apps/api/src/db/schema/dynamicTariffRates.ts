import { pgTable, text, numeric, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";
import { tariffKindEnum } from "./tariffPeriods.js";

// Quarter-hour rates bulk-ingested from an external dynamic-pricing feed
// (e.g. BKW's dyntariffs API). Kept separate from tariff_periods: this table
// is upserted wholesale by an automated poller (see modules/dynamicTariffs),
// while tariff_periods is small and hand-entered. A plain indexed table, not
// a Timescale hypertable — a few years of quarter-hour data per site is at
// most a few hundred thousand rows, well within plain Postgres territory.
export const dynamicTariffRates = pgTable(
  "dynamic_tariff_rates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    kind: tariffKindEnum("kind").notNull(),
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    endTs: timestamp("end_ts", { withTimezone: true }).notNull(),
    rateChfPerKwh: numeric("rate_chf_per_kwh", { precision: 10, scale: 5 }).notNull(),
    source: text("source").notNull(),
    publicationTimestamp: timestamp("publication_timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dynamic_tariff_rates_site_kind_start_idx").on(
      table.siteId,
      table.kind,
      table.startTs,
    ),
  ],
);
