import { pgTable, text, numeric, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { tariffKindEnum } from "./tariffPeriods.js";

// Additive per-kWh components layered on top of a `tariffPeriods`/dynamic
// rate of the same `kind` — e.g. a "Herkunftsnachweis" (origin certificate)
// or "Mindestvergütungsprämie" (minimum feed-in premium) on top of the
// feed-in rate. Unlike tariff_periods, these are deliberately allowed to
// overlap each other (and the base rate's period) for the same kind — the
// savings service sums every matching surcharge onto the resolved base
// rate rather than picking a single one. No exclusion constraint here.
export const tariffSurcharges = pgTable(
  "tariff_surcharges",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    kind: tariffKindEnum("kind").notNull(),
    // Half-open [startTs, endTs), Europe/Zurich local input converted to UTC
    // at write time — same convention as tariff_periods.
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    endTs: timestamp("end_ts", { withTimezone: true }).notNull(),
    rateChfPerKwh: numeric("rate_chf_per_kwh", { precision: 10, scale: 5 }).notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("tariff_surcharges_end_after_start", sql`${table.endTs} > ${table.startTs}`)],
);
