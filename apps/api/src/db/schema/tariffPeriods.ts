import { pgTable, text, numeric, timestamp, uuid, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";

// "purchase" (grid import), "feed_in" (grid export), "neighbor_sell" (sold
// directly to a neighbour). A data value rather than separate columns so new
// kinds — and later, per-kind dynamic pricing — don't need a schema change.
export const tariffKindEnum = pgEnum("tariff_kind", ["purchase", "feed_in", "neighbor_sell"]);

/**
 * Which source prices a period.
 *
 * "flat" uses the period's own `rateChfPerKwh`. "dynamic" prices each interval
 * from `dynamic_tariff_rates` instead (BKW's day-ahead feed), with the period's
 * rate — if set — acting only as a fallback for intervals the feed never
 * delivered.
 *
 * This exists because the previous design inferred the flat/dynamic cutover
 * from whether a dynamic row happened to exist for an instant. Once ingestion
 * started running ahead of the contract date, stored day-ahead rates began
 * overriding a quarterly rate that was still the one actually being paid. The
 * contract is a fact about the period, so it is recorded on the period.
 */
export const tariffPricingModeEnum = pgEnum("tariff_pricing_mode", ["flat", "dynamic"]);

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
    pricingMode: tariffPricingModeEnum("pricing_mode").notNull().default("flat"),
    // Nullable because a dynamic period need not carry one. When set on a
    // dynamic period it is a fallback for intervals with no feed rate; when
    // null, such intervals stay unpriced rather than silently becoming zero.
    rateChfPerKwh: numeric("rate_chf_per_kwh", { precision: 10, scale: 5 }),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("tariff_periods_end_after_start", sql`${table.endTs} > ${table.startTs}`),
    // A flat period with no rate would price nothing at all, so require one.
    // Dynamic periods may leave it null (no fallback).
    check(
      "tariff_periods_flat_requires_rate",
      sql`${table.pricingMode} <> 'flat' OR ${table.rateChfPerKwh} IS NOT NULL`,
    ),
  ],
);
