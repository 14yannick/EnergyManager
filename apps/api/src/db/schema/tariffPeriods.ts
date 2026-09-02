import { pgTable, text, numeric, timestamp, uuid, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";

// "purchase" (grid import), "feed_in" (grid export), "neighbor_sell" (sold
// directly to a neighbour). A data value rather than separate columns so new
// kinds — and later, per-kind dynamic pricing — don't need a schema change.
export const tariffKindEnum = pgEnum("tariff_kind", ["purchase", "feed_in", "neighbor_sell"]);

// The "no overlapping periods per (site, kind)" rule is enforced by a GIST
// exclusion constraint added in a hand-written follow-up migration (drizzle-kit
// has no exclusion-constraint builder) — see db/migrations/0004_drop_old_tariff_columns.sql.
export const tariffPeriods = pgTable(
  "tariff_periods",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    kind: tariffKindEnum("kind").notNull(),
    // Half-open [startTs, endTs). Entered as Europe/Zurich local time, converted
    // to UTC at write time (see tariffPeriods/service.ts) — matches the
    // Europe/Zurich assumption already hardcoded in daily_energy_agg.
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    endTs: timestamp("end_ts", { withTimezone: true }).notNull(),
    rateChfPerKwh: numeric("rate_chf_per_kwh", { precision: 10, scale: 5 }).notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("tariff_periods_end_after_start", sql`${table.endTs} > ${table.startTs}`)],
);
