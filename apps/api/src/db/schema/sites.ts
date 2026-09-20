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
  /**
   * The Home Assistant price-forecast entity the dynamic feed-in sync reads
   * for this site (see dynamicTariffs/service.ts) — installation-specific,
   * so it is configuration rather than a constant, chosen under Settings →
   * Home Assistant. Null means this site syncs no dynamic rates at all.
   */
  dynamicTariffEntityId: text("dynamic_tariff_entity_id"),
  /**
   * Live Home Assistant entities for the participants' "right now" view —
   * read on demand and never stored, unlike everything else here, because a
   * current reading has no history worth keeping. All optional: each one
   * missing simply leaves its figure off the view.
   *
   * Power in W, forecasts in kWh. The forecast three are what a
   * Forecast.Solar-style integration exposes; the two power ones are
   * whatever the household's own inverter reports.
   */
  liveExportPowerEntityId: text("live_export_power_entity_id"),
  livePvPowerEntityId: text("live_pv_power_entity_id"),
  forecastTodayEntityId: text("forecast_today_entity_id"),
  forecastRemainingEntityId: text("forecast_remaining_entity_id"),
  forecastTomorrowEntityId: text("forecast_tomorrow_entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
