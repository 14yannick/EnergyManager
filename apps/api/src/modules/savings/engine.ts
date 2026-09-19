import type { CostItemsSummary, CumulativeSavingsPoint, DailySavings, SavingsSummary } from "@energy-manager/shared";

/**
 * Pure calculation engine — no I/O, no DB access. Callers (routes/services)
 * are responsible for fetching interval readings, resolving the applicable
 * rate for each interval (dynamic-tariff lookup with flat-period fallback —
 * see `findRateForInstant` in @energy-manager/shared) and cost totals, and
 * converting Postgres numeric strings to JS numbers first.
 */

export interface DailyEnergyAggregate {
  date: string; // YYYY-MM-DD
  producedKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  importedKwh: number;
}

/**
 * Energy-balance-correct direct-use formula, usable now that we store
 * `batteryChargeKwh` per interval: produced = directUse + batteryCharge + exported.
 *
 * Deliberately *not* clamped at zero. Production, charging and export come
 * from different meters, so energy produced near an interval boundary can be
 * exported in the neighbouring bucket — at sub-daily resolution that makes
 * individual intervals come out slightly negative. Clamping would discard
 * that negative noise while keeping the positive noise, biasing the total
 * upward: on real hourly data for one month it inflated direct use by 130 of
 * 311 kWh. The skew cancels once intervals are summed, so the caller's
 * aggregate is the meaningful figure and a single interval is not.
 */
/**
 * PV that the household used as it was produced.
 *
 * No charging term: `producedKwh` is now the panels' share of inverter AC
 * output, and energy that went into the battery never reached the inverter, so
 * it was already excluded upstream (see homeAssistant/split.ts). Subtracting
 * charging here as well would remove it twice.
 *
 * It previously did subtract charging, because `producedKwh` then held raw
 * inverter AC yield — a figure that both included battery discharge and
 * excluded charging. That made direct use collapse to the discharge figure
 * overnight, reporting solar self-consumption at 3am.
 */
export function computeDirectUseKwh(
  day: Pick<DailyEnergyAggregate, "producedKwh" | "exportedKwh">,
): number {
  return day.producedKwh - day.exportedKwh;
}

/**
 * Everything that left the house in an interval: the `export_local` reading,
 * or the grid export where an interval has none.
 *
 * Direct use has to subtract *this*, not grid export alone. Grid export is
 * what is left once the participants have taken their share, so subtracting
 * only that would count every kWh sold to a participant as consumed at home
 * too — priced at the purchase rate on top of the neighbour rate it was sold
 * at. Readings without participants carry the same value in both, so the
 * choice only matters once somebody draws from the pool.
 *
 * The fallback is per interval: a missing `export_local` must not read as
 * "nothing left the house", which would count every exported kWh as used.
 */
export function energyLeftHouseKwh(exportGridKwh: number, exportLocalKwh: number | null): number {
  return exportLocalKwh ?? exportGridKwh;
}


export interface SavingsInputs {
  date: string;
  /** Fraction (0-1) of battery charge lost to conversion; site-level setting. */
  batteryConversionLoss?: number;
  producedKwh: number;
  directUseKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  /**
   * Total energy leaving the household (the inverter's own export figure).
   * `exportedKwh` is what's left of it once neighbours take their share. It
   * is what direct use is measured against (see `energyLeftHouseKwh`), and is
   * never priced itself: its two parts are, as grid export and as neighbour
   * sales, and pricing the whole as well would count them twice.
   */
  exportLocalKwh: number;
  /** Energy consumed by neighbours (summed across parties) — this is what's sold at the neighbour rate. */
  neighborConsumptionKwh: number;
  purchaseRateChfPerKwh: number | null;
  sellRateChfPerKwh: number | null;
  neighborSellRateChfPerKwh: number | null;
}

/** Fraction of battery charge lost to conversion when no site value is given. */
export const DEFAULT_BATTERY_CONVERSION_LOSS = 0.1;

/**
 * Charge measured DC, expressed as the AC export it displaced.
 *
 * Charging is metered on the DC side but everything priced is AC, so the
 * export forgone is the charge less what conversion would have taken anyway.
 * Exported because the day view shows this quantity next to the rate applied
 * to it, and recomputing it there would let the two drift apart.
 */
export function chargeAcEquivalentKwh(
  batteryChargeKwh: number,
  conversionLoss: number = DEFAULT_BATTERY_CONVERSION_LOSS,
): number {
  return batteryChargeKwh * (1 - conversionLoss);
}

export interface BatteryRevenueInputs {
  producedKwh: number;
  /** Fraction (0-1). Falls back to DEFAULT_BATTERY_CONVERSION_LOSS. */
  batteryConversionLoss?: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  purchaseRateChfPerKwh: number | null;
  /** Feed-in rate — expected to already include any surcharges (see `makeRateResolver` in savings/service.ts). */
  sellRateChfPerKwh: number | null;
}

export interface BatteryRevenue {
  dischargeConsumedKwh: number;
  dischargeExportedKwh: number;
  chargingCostChf: number;
  dischargeConsumedValueChf: number;
  dischargeExportedValueChf: number;
  batteryRevenueChf: number;
}

/**
 * The battery's own economics, priced from what actually happened rather
 * than a counterfactual: charging costs whatever that energy could have
 * earned as an export instead of being stored (priced at the feed-in rate);
 * discharging earns the purchase rate for the portion that covered load
 * (avoided import) or the feed-in rate for the portion pushed back out to
 * the grid (a deliberate discharge-to-grid / arbitrage interval).
 *
 * Net metering only reports total export, not its source, so a discharged
 * kWh can't be traced through the meter directly. Energy balance bounds it:
 * production splits into direct use, charging, and export, so PV alone can
 * never have exported more than `produced - charged`. Anything exported
 * beyond that had to come out of the battery. Consumption takes priority
 * (a self-consumption battery discharges to cover load), so the battery is
 * credited with export only for that unexplained remainder, capped by the
 * discharge itself.
 *
 * Deliberately *not* "export > 0 while discharging": that reads as a
 * discharge-to-grid signal only at interval resolution. Aggregated to a day,
 * a summer site exports at noon and discharges at night, so it would flag
 * every day and price the whole battery at the feed-in rate.
 */
export function computeBatteryRevenue(inputs: BatteryRevenueInputs): BatteryRevenue {
  const { producedKwh, batteryChargeKwh, batteryDischargeKwh, exportedKwh, purchaseRateChfPerKwh, sellRateChfPerKwh } =
    inputs;
  const conversionLoss = inputs.batteryConversionLoss ?? DEFAULT_BATTERY_CONVERSION_LOSS;

  // No charge term: `producedKwh` is already the panels' share of AC output, so
  // energy that went into the battery was excluded upstream by the split.
  // Subtracting it again here understated what PV could have exported.
  const pvAvailableToExportKwh = Math.max(producedKwh, 0);
  const unexplainedExportKwh = Math.max(exportedKwh - pvAvailableToExportKwh, 0);
  const dischargeExportedKwh = Math.min(unexplainedExportKwh, batteryDischargeKwh);
  const dischargeConsumedKwh = batteryDischargeKwh - dischargeExportedKwh;

  const chargeAcKwh = chargeAcEquivalentKwh(batteryChargeKwh, conversionLoss);
  const chargingCostChf = sellRateChfPerKwh != null ? chargeAcKwh * sellRateChfPerKwh : 0;
  const dischargeConsumedValueChf =
    purchaseRateChfPerKwh != null ? dischargeConsumedKwh * purchaseRateChfPerKwh : 0;
  const dischargeExportedValueChf =
    sellRateChfPerKwh != null ? dischargeExportedKwh * sellRateChfPerKwh : 0;

  return {
    dischargeConsumedKwh,
    dischargeExportedKwh,
    chargingCostChf,
    dischargeConsumedValueChf,
    dischargeExportedValueChf,
    batteryRevenueChf: dischargeConsumedValueChf + dischargeExportedValueChf - chargingCostChf,
  };
}

/**
 * The actual savings formulas, factored out so tests can feed in a
 * `directUseKwh` computed either way (see the two functions above) without
 * duplicating this logic. Operates on one "unit of aggregation" worth of
 * kWh + already-resolved rates — a whole day under flat pricing, or a single
 * 15-minute interval under dynamic pricing; the arithmetic doesn't care which.
 */
export function computeSavingsFromInputs(inputs: SavingsInputs): DailySavings {
  const { purchaseRateChfPerKwh: purchaseRate, sellRateChfPerKwh: sellRate, neighborSellRateChfPerKwh: neighborSellRate } = inputs;
  const { directUseKwh, batteryChargeKwh, batteryDischargeKwh, exportedKwh, neighborConsumptionKwh } = inputs;

  const selfConsumptionValueChf =
    purchaseRate != null ? (batteryDischargeKwh + directUseKwh) * purchaseRate : 0;
  const exportRevenueChf = sellRate != null ? exportedKwh * sellRate : 0;
  // Priced off what neighbours actually consumed, not off export_local: the
  // latter is everything leaving the household, of which the grid share is
  // already priced as export revenue.
  const neighborSellRevenueChf = neighborSellRate != null ? neighborConsumptionKwh * neighborSellRate : 0;
  // Every kWh the site produced ends up in exactly one of these: used at home
  // (directly or through the battery), sold to a participant, or exported.
  const savingsWithBatteryChf = selfConsumptionValueChf + exportRevenueChf + neighborSellRevenueChf;

  // Counterfactual: without a battery, energy that was discharged from it would
  // instead have been exported at the sell rate (it couldn't have been stored).
  // Neighbour sales don't involve the battery, so they are the same in both.
  const savingsWithoutBatteryChf =
    (purchaseRate != null ? directUseKwh * purchaseRate : 0) +
    (sellRate != null ? (batteryDischargeKwh + exportedKwh) * sellRate : 0) +
    neighborSellRevenueChf;

  const batteryOnlySavingsChf = savingsWithBatteryChf - savingsWithoutBatteryChf;
  const revenue = computeBatteryRevenue({
    producedKwh: inputs.producedKwh,
    batteryConversionLoss: inputs.batteryConversionLoss,
    batteryChargeKwh,
    batteryDischargeKwh,
    exportedKwh,
    purchaseRateChfPerKwh: purchaseRate,
    sellRateChfPerKwh: sellRate,
  });

  // Revenue breakdown for the "Umsatz" chart: exportRevenueChf already prices
  // *all* grid export (production- and battery-sourced combined) at the
  // feed-in rate, so the production-only slice is whatever's left once the
  // battery's share (already counted inside batteryRevenueChf) is removed —
  // dischargeExportedKwh <= exportedKwh always, so this can't go negative.
  const directExportRevenueChf = exportRevenueChf - revenue.dischargeExportedValueChf;
  // PV consumed the moment it was produced: worth the import it avoided.
  // Disjoint from batteryRevenueChf's consumed leg, which covers the kWh that
  // went through the battery first — together they make up
  // selfConsumptionValueChf, which keeps pricing both as one figure.
  const directConsumptionRevenueChf = purchaseRate != null ? directUseKwh * purchaseRate : 0;
  // Counterfactual export revenue if the battery weren't there at all. The PV
  // that went into it would have gone to the grid instead (+ charged), and the
  // export that actually came *out* of it never happens (- dischargeExported).
  // Direct consumption is untouched: PV used as it was produced never involved
  // the battery, so removing the battery doesn't change it.
  const noBatteryExportedKwh = Math.max(
    exportedKwh - revenue.dischargeExportedKwh + batteryChargeKwh,
    0,
  );
  const noBatteryDirectExportRevenueChf = sellRate != null ? noBatteryExportedKwh * sellRate : 0;

  return {
    ...inputs,
    selfConsumptionValueChf,
    exportRevenueChf,
    savingsWithBatteryChf,
    savingsWithoutBatteryChf,
    batteryOnlySavingsChf,
    batteryChargingCostChf: revenue.chargingCostChf,
    batteryDischargeConsumedKwh: revenue.dischargeConsumedKwh,
    batteryDischargeExportedKwh: revenue.dischargeExportedKwh,
    batteryDischargeConsumedValueChf: revenue.dischargeConsumedValueChf,
    batteryDischargeExportedValueChf: revenue.dischargeExportedValueChf,
    batteryRevenueChf: revenue.batteryRevenueChf,
    directExportRevenueChf,
    directConsumptionRevenueChf,
    neighborSellRevenueChf,
    exportedPricedKwh: sellRate != null ? exportedKwh : 0,
    neighborPricedKwh: neighborSellRate != null ? neighborConsumptionKwh : 0,
    noBatteryDirectExportRevenueChf,
  };
}

const SUMMABLE_FIELDS = [
  "producedKwh",
  "directUseKwh",
  "batteryChargeKwh",
  "batteryDischargeKwh",
  "exportedKwh",
  "exportLocalKwh",
  "neighborConsumptionKwh",
  "selfConsumptionValueChf",
  "exportRevenueChf",
  "savingsWithBatteryChf",
  "savingsWithoutBatteryChf",
  "batteryOnlySavingsChf",
  "batteryChargingCostChf",
  "batteryDischargeConsumedKwh",
  "batteryDischargeExportedKwh",
  "batteryDischargeConsumedValueChf",
  "batteryDischargeExportedValueChf",
  "batteryRevenueChf",
  "directExportRevenueChf",
  "directConsumptionRevenueChf",
  "neighborSellRevenueChf",
  "exportedPricedKwh",
  "neighborPricedKwh",
  "noBatteryDirectExportRevenueChf",
] as const satisfies readonly (keyof DailySavings)[];

/**
 * Groups rows sharing the same `periodKey(row.date)` and sums their summable
 * fields, replacing `date` with the period key. `purchaseRateChfPerKwh`/
 * `sellRateChfPerKwh`/`neighborSellRateChfPerKwh` are nulled once a period
 * mixes more than one row — there's no single rate that describes a period
 * built from several differently-priced rows.
 */
function aggregateByPeriod(rows: DailySavings[], periodKey: (date: string) => string): DailySavings[] {
  const byPeriod = new Map<string, DailySavings>();

  for (const row of rows) {
    const key = periodKey(row.date);
    const existing = byPeriod.get(key);
    if (!existing) {
      byPeriod.set(key, { ...row, date: key });
      continue;
    }
    for (const field of SUMMABLE_FIELDS) existing[field] += row[field];
    existing.purchaseRateChfPerKwh = null;
    existing.sellRateChfPerKwh = null;
    existing.neighborSellRateChfPerKwh = null;
  }

  return [...byPeriod.values()].map(clampDirectUse).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Direct use is `produced - charged - exported`, which goes negative over a
 * whole period only when the battery was charged from the grid: more went into
 * it than the panels made. The honest reading of that is "no PV reached the
 * load directly", not a negative quantity of energy — so the floor belongs
 * here, on a summed period, rather than on a single interval where it would
 * instead be discarding meter-timing noise (see `computeDirectUseKwh`).
 */
function clampDirectUse(row: DailySavings): DailySavings {
  if (row.directUseKwh >= 0) return row;
  return { ...row, directUseKwh: 0, directConsumptionRevenueChf: 0 };
}

/**
 * Rolls interval-level priced rows (already tagged with their Europe/Zurich
 * calendar `date`) up into the daily-shaped rows `summarizeSavings` and
 * `buildCumulativeSeries` expect, so those two need no changes at all.
 */
export function aggregateIntervalsToDaily(rows: DailySavings[]): DailySavings[] {
  // Interval rows carry "YYYY-MM-DDTHH" so they can also be rolled up hourly;
  // slicing to the date is what makes this a *daily* rollup. Rows that already
  // carry a plain date slice to themselves, so this is a no-op for them.
  return aggregateByPeriod(rows, (date) => date.slice(0, 10));
}

/** Same interval rows, grouped by their "YYYY-MM-DDTHH" hour instead. */
export function aggregateIntervalsToHourly(rows: DailySavings[]): DailySavings[] {
  return aggregateByPeriod(rows, (date) => date.slice(0, 13));
}

/**
 * Rolls already-daily rows up to monthly — for data that's only ever
 * available at monthly granularity (e.g. an inverter's monthly report),
 * where treating each day as its own "period" would badly distort
 * avg-per-period and payback math (see `summarizeMonthlySavings`).
 */
export function aggregateDailyToMonthly(dailyRows: DailySavings[]): DailySavings[] {
  return aggregateByPeriod(dailyRows, (date) => date.slice(0, 7)); // "YYYY-MM-DD" -> "YYYY-MM"
}

/**
 * Rolls daily rows up to calendar quarters, keyed "YYYY-Qn" — which also sorts
 * correctly as a string, both within a year and across one.
 */
export function aggregateDailyToQuarterly(dailyRows: DailySavings[]): DailySavings[] {
  return aggregateByPeriod(dailyRows, (date) => {
    const month = Number(date.slice(5, 7));
    return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
  });
}

/**
 * Rolls daily rows up to calendar years. Works off daily rows rather than
 * monthly ones so a year is never a sum of sums — the direct-use floor is
 * applied per day (see `clampDirectUse`), and re-aggregating already-floored
 * monthly rows would give the same answer only by coincidence.
 */
export function aggregateDailyToYearly(dailyRows: DailySavings[]): DailySavings[] {
  return aggregateByPeriod(dailyRows, (date) => date.slice(0, 4)); // "YYYY-MM-DD" -> "YYYY"
}

/**
 * Collapses the whole range into a single row. The period key is a constant
 * rather than a date, since "overall" is one period however long the range is.
 */
export function aggregateDailyToOverall(dailyRows: DailySavings[]): DailySavings[] {
  return aggregateByPeriod(dailyRows, () => OVERALL_PERIOD_KEY);
}

export const OVERALL_PERIOD_KEY = "overall";

export function buildCumulativeSeries(dailyRows: DailySavings[]): CumulativeSavingsPoint[] {
  const sorted = [...dailyRows].sort((a, b) => a.date.localeCompare(b.date));
  let cumulativeWithBattery = 0;
  let cumulativeWithoutBattery = 0;
  let cumulativeBatteryOnly = 0;

  return sorted.map((row) => {
    cumulativeWithBattery += row.savingsWithBatteryChf;
    cumulativeWithoutBattery += row.savingsWithoutBatteryChf;
    cumulativeBatteryOnly += row.batteryOnlySavingsChf;
    return {
      date: row.date,
      cumulativeWithBatteryChf: cumulativeWithBattery,
      cumulativeWithoutBatteryChf: cumulativeWithoutBattery,
      cumulativeBatteryOnlyChf: cumulativeBatteryOnly,
    };
  });
}

function findBreakevenDate(
  series: CumulativeSavingsPoint[],
  key: "cumulativeWithBatteryChf" | "cumulativeWithoutBatteryChf" | "cumulativeBatteryOnlyChf",
  costChf: number,
): string | null {
  if (costChf <= 0) return null;
  const hit = series.find((p) => p[key] >= costChf);
  return hit ? hit.date : null;
}

/**
 * `periodsPerYear` is what turns "average per row" into an annualized
 * payback figure — 365 when each row is a day, 12 when each row is a month
 * (see `summarizeMonthlySavings`). Getting this wrong is exactly the bug a
 * monthly-aggregate import would otherwise cause: treating each of 11
 * monthly rows as if it were one day inflates "days with data" and
 * understates payback by roughly 30x.
 */
function summarizePeriodSavings(
  rows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
  periodsPerYear: number,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  const totals = rows.reduce(
    (acc, r) => {
      acc.withBatteryChf += r.savingsWithBatteryChf;
      acc.withoutBatteryChf += r.savingsWithoutBatteryChf;
      acc.batteryOnlyChf += r.batteryOnlySavingsChf;
      acc.batteryRevenueChf += r.batteryRevenueChf;
      return acc;
    },
    { withBatteryChf: 0, withoutBatteryChf: 0, batteryOnlyChf: 0, batteryRevenueChf: 0 },
  );

  // What the energy leaving the house fetched, per kWh. Under a dynamic
  // feed-in rate and a separate neighbour rate this swings a lot, and a
  // weighted average over what was actually sold is the honest summary of it.
  // Grid export excludes what neighbours took (`exportedKwh` is the remainder),
  // so the two parts never count the same kWh.
  const sold = rows.reduce(
    (acc, r) => {
      acc.gridKwh += r.exportedPricedKwh;
      acc.gridChf += r.exportRevenueChf;
      acc.neighbourKwh += r.neighborPricedKwh;
      acc.neighbourChf += r.neighborSellRevenueChf;
      acc.unpricedKwh += r.exportedKwh - r.exportedPricedKwh + (r.neighborConsumptionKwh - r.neighborPricedKwh);
      return acc;
    },
    { gridKwh: 0, gridChf: 0, neighbourKwh: 0, neighbourChf: 0, unpricedKwh: 0 },
  );
  const soldKwh = sold.gridKwh + sold.neighbourKwh;
  const soldPricePerKwhChf = soldKwh > 0 ? (sold.gridChf + sold.neighbourChf) / soldKwh : null;

  const daysWithData = rows.length; // "periods with data" — days or months, depending on periodsPerYear
  const avgDaily = {
    withBatteryChf: daysWithData > 0 ? totals.withBatteryChf / daysWithData : 0,
    withoutBatteryChf: daysWithData > 0 ? totals.withoutBatteryChf / daysWithData : 0,
    batteryOnlyChf: daysWithData > 0 ? totals.batteryOnlyChf / daysWithData : 0,
    batteryRevenueChf: daysWithData > 0 ? totals.batteryRevenueChf / daysWithData : 0,
  };

  // Mirrors the old Summary sheet: "with battery" payback uses total cost,
  // "no battery" uses the solar-only cost, "battery only" uses battery-only cost.
  const payback = {
    withBatteryYears:
      avgDaily.withBatteryChf > 0 ? costs.total / (avgDaily.withBatteryChf * periodsPerYear) : null,
    withoutBatteryYears:
      avgDaily.withoutBatteryChf > 0
        ? costs.solar / (avgDaily.withoutBatteryChf * periodsPerYear)
        : null,
    batteryOnlyYears:
      avgDaily.batteryOnlyChf > 0
        ? costs.battery / (avgDaily.batteryOnlyChf * periodsPerYear)
        : null,
  };

  const cumulative = buildCumulativeSeries(rows);
  const breakeven = {
    withBatteryDate: findBreakevenDate(cumulative, "cumulativeWithBatteryChf", costs.total),
    withoutBatteryDate: findBreakevenDate(cumulative, "cumulativeWithoutBatteryChf", costs.solar),
    batteryOnlyDate: findBreakevenDate(cumulative, "cumulativeBatteryOnlyChf", costs.battery),
  };

  return {
    summary: { from, to, totals, sold, soldPricePerKwhChf, daysWithData, avgDaily, costs, payback, breakeven },
    cumulative,
  };
}

export function summarizeSavings(
  dailyRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(dailyRows, costs, from, to, 365);
}

/** Same as `summarizeSavings`, but for `aggregateIntervalsToHourly` rows. */
export function summarizeHourlySavings(
  hourlyRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(hourlyRows, costs, from, to, 8760);
}

/** Same as `summarizeSavings`, but for rows produced by `aggregateDailyToMonthly`. */
export function summarizeMonthlySavings(
  monthlyRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(monthlyRows, costs, from, to, 12);
}

/**
 * Same again for `aggregateDailyToYearly` rows. One period per year, so the
 * average *is* the annual figure and payback is simply cost ÷ that.
 */
export function summarizeYearlySavings(
  yearlyRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(yearlyRows, costs, from, to, 1);
}

/** Same as `summarizeSavings`, for `aggregateDailyToQuarterly` rows. */
export function summarizeQuarterlySavings(
  quarterlyRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(quarterlyRows, costs, from, to, 4);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(Math.round((b - a) / 86400000) + 1, 1);
}

/**
 * One period covering the whole range, annualised by how long that range
 * actually is. This is the most faithful payback of the four: the fixed 365
 * and 12 assume every period is complete, whereas here a range of 287 days is
 * scaled by 365/287 and a partial month or year can't quietly distort it.
 */
export function summarizeOverallSavings(
  overallRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(overallRows, costs, from, to, 365 / inclusiveDays(from, to));
}
