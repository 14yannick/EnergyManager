import { pgTable, text, numeric, timestamp, uuid, pgEnum, integer, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";

// The sections a Swiss grid invoice is laid out in — kept so a generated
// invoice can mirror the provider's own structure line for line.
export const billingCategoryEnum = pgEnum("billing_category", [
  "energie",
  "netznutzung",
  "messung",
  "abgaben",
]);

/**
 * How a position is spread across a VZEV pool:
 * - `per_kwh`         charged on each participant's own grid kWh (rate is CHF/kWh)
 * - `per_kwh_total`   charged on everything they consumed, local PV included —
 *                     a commune levy is due on all electricity used, not only
 *                     on what came off the grid
 * - `pool_shared`     billed once to the pool and divided by participants (CHF/year)
 * - `per_participant` billed once per participant, so the pool pays it N times (CHF/year)
 */
export const billingAllocationEnum = pgEnum("billing_allocation", [
  "per_kwh",
  "per_kwh_total",
  "pool_shared",
  "per_participant",
]);

// One line of the grid provider's invoice. Storing the positions rather than a
// single blended rate is what lets a participant's bill be laid out the same
// way theirs is — and lets a levy change be seen for what it is instead of
// disappearing into a rate that simply moved.
export const gridTariffPositions = pgTable(
  "grid_tariff_positions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    category: billingCategoryEnum("category").notNull(),
    label: text("label").notNull(),
    allocation: billingAllocationEnum("allocation").notNull(),
    /** CHF per kWh for `per_kwh`, CHF per year otherwise. */
    rateChf: numeric("rate_chf", { precision: 12, scale: 6 }).notNull(),
    /** Half-open [validFrom, validTo), Europe/Zurich local time as everywhere else. */
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }).notNull(),
    /**
     * Whether this position would also exist if the participant were billed
     * directly by the grid provider. False for VZEV-only costs such as the
     * virtual metering fee — those must not appear in the comparison, or the
     * saving would be overstated.
     */
    countsInDirectBilling: boolean("counts_in_direct_billing").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("grid_tariff_positions_valid_range", sql`${table.validTo} > ${table.validFrom}`)],
);
