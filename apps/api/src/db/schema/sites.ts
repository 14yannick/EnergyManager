import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sites = pgTable("sites", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Zurich"),
  /**
   * When the PV system started producing. Bounds payback: savings accrued
   * before the panels existed would understate how long the investment takes
   * to repay. Null means "not stated", in which case callers fall back to the
   * first day with recorded production.
   */
  productionStartDate: date("production_start_date"),
  /**
   * Share of energy lost converting battery charge to usable AC, as a fraction.
   *
   * Charging is metered DC while everything priced is AC, so the opportunity
   * cost of charging — the export forgone — has to be reduced by whatever the
   * conversion would have cost anyway. Configurable rather than derived: the
   * implied figure is only stable over a day or more (hourly it swings from
   * 40% to 400% on counter-read timing), so a stated value is steadier than a
   * computed one.
   */
  batteryConversionLoss: numeric("battery_conversion_loss", { precision: 5, scale: 4 })
    .notNull()
    .default("0.1000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
