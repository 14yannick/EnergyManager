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
 */
export function computeDirectUseKwh(
  day: Pick<DailyEnergyAggregate, "producedKwh" | "batteryChargeKwh" | "exportedKwh">,
): number {
  return Math.max(day.producedKwh - day.batteryChargeKwh - day.exportedKwh, 0);
}

/**
 * The original spreadsheet's approximation: max(produced - batteryDischarge - exported, 0).
 * It only tracked battery *discharge*, not charge, so it's a proxy that's accurate only
 * to the extent charge ≈ discharge over the aggregation range. Kept solely so the M4
 * regression tests can assert against the historical Excel numbers and make the
 * intentional divergence from `computeDirectUseKwh` visible rather than silent.
 */
export function computeDirectUseKwhLegacyApprox(
  day: Pick<DailyEnergyAggregate, "producedKwh" | "batteryDischargeKwh" | "exportedKwh">,
): number {
  return Math.max(day.producedKwh - day.batteryDischargeKwh - day.exportedKwh, 0);
}

export interface SavingsInputs {
  date: string;
  producedKwh: number;
  directUseKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  purchaseRateChfPerKwh: number | null;
  sellRateChfPerKwh: number | null;
}

/**
 * The value of battery-discharged energy under two counterfactuals: what
 * import it avoided (priced at the purchase rate) vs. what it would have
 * earned had it been exported instead (priced at the feed-in rate) at that
 * same moment. Only meaningful as a *marginal* KPI once feed-in pricing can
 * vary interval to interval — with a flat feed-in rate the two counterfactuals
 * in `computeSavingsFromInputs` already capture this implicitly, but dynamic
 * pricing means the spread itself varies, so it's worth surfacing directly.
 */
export function computeBatteryUplift(
  batteryDischargeKwh: number,
  purchaseRateChfPerKwh: number | null,
  sellRateChfPerKwh: number | null,
): { avoidedImportChf: number; ifExportedInsteadChf: number; upliftChf: number } {
  const avoidedImportChf =
    purchaseRateChfPerKwh != null ? batteryDischargeKwh * purchaseRateChfPerKwh : 0;
  const ifExportedInsteadChf =
    sellRateChfPerKwh != null ? batteryDischargeKwh * sellRateChfPerKwh : 0;
  return { avoidedImportChf, ifExportedInsteadChf, upliftChf: avoidedImportChf - ifExportedInsteadChf };
}

/**
 * The actual savings formulas, factored out so tests can feed in a
 * `directUseKwh` computed either way (see the two functions above) without
 * duplicating this logic. Operates on one "unit of aggregation" worth of
 * kWh + already-resolved rates — a whole day under flat pricing, or a single
 * 15-minute interval under dynamic pricing; the arithmetic doesn't care which.
 */
export function computeSavingsFromInputs(inputs: SavingsInputs): DailySavings {
  const { purchaseRateChfPerKwh: purchaseRate, sellRateChfPerKwh: sellRate } = inputs;
  const { directUseKwh, batteryDischargeKwh, exportedKwh } = inputs;

  const selfConsumptionValueChf =
    purchaseRate != null ? (batteryDischargeKwh + directUseKwh) * purchaseRate : 0;
  const exportRevenueChf = sellRate != null ? exportedKwh * sellRate : 0;
  const savingsWithBatteryChf = selfConsumptionValueChf + exportRevenueChf;

  // Counterfactual: without a battery, energy that was discharged from it would
  // instead have been exported at the sell rate (it couldn't have been stored).
  const savingsWithoutBatteryChf =
    (purchaseRate != null ? directUseKwh * purchaseRate : 0) +
    (sellRate != null ? (batteryDischargeKwh + exportedKwh) * sellRate : 0);

  const batteryOnlySavingsChf = savingsWithBatteryChf - savingsWithoutBatteryChf;
  const uplift = computeBatteryUplift(batteryDischargeKwh, purchaseRate, sellRate);

  return {
    ...inputs,
    selfConsumptionValueChf,
    exportRevenueChf,
    savingsWithBatteryChf,
    savingsWithoutBatteryChf,
    batteryOnlySavingsChf,
    batteryAvoidedImportChf: uplift.avoidedImportChf,
    batteryIfExportedInsteadChf: uplift.ifExportedInsteadChf,
    batteryUpliftChf: uplift.upliftChf,
  };
}

const SUMMABLE_FIELDS = [
  "producedKwh",
  "directUseKwh",
  "batteryChargeKwh",
  "batteryDischargeKwh",
  "exportedKwh",
  "selfConsumptionValueChf",
  "exportRevenueChf",
  "savingsWithBatteryChf",
  "savingsWithoutBatteryChf",
  "batteryOnlySavingsChf",
  "batteryAvoidedImportChf",
  "batteryIfExportedInsteadChf",
  "batteryUpliftChf",
] as const satisfies readonly (keyof DailySavings)[];

/**
 * Groups rows sharing the same `periodKey(row.date)` and sums their summable
 * fields, replacing `date` with the period key. `purchaseRateChfPerKwh`/
 * `sellRateChfPerKwh` are nulled once a period mixes more than one row —
 * there's no single rate that describes a period built from several
 * differently-priced rows.
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
  }

  return [...byPeriod.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Rolls interval-level priced rows (already tagged with their Europe/Zurich
 * calendar `date`) up into the daily-shaped rows `summarizeSavings` and
 * `buildCumulativeSeries` expect, so those two need no changes at all.
 */
export function aggregateIntervalsToDaily(rows: DailySavings[]): DailySavings[] {
  return aggregateByPeriod(rows, (date) => date);
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
      acc.batteryUpliftChf += r.batteryUpliftChf;
      return acc;
    },
    { withBatteryChf: 0, withoutBatteryChf: 0, batteryOnlyChf: 0, batteryUpliftChf: 0 },
  );

  const daysWithData = rows.length; // "periods with data" — days or months, depending on periodsPerYear
  const avgDaily = {
    withBatteryChf: daysWithData > 0 ? totals.withBatteryChf / daysWithData : 0,
    withoutBatteryChf: daysWithData > 0 ? totals.withoutBatteryChf / daysWithData : 0,
    batteryOnlyChf: daysWithData > 0 ? totals.batteryOnlyChf / daysWithData : 0,
    batteryUpliftChf: daysWithData > 0 ? totals.batteryUpliftChf / daysWithData : 0,
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
    summary: { from, to, totals, daysWithData, avgDaily, costs, payback, breakeven },
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

/** Same as `summarizeSavings`, but for rows produced by `aggregateDailyToMonthly`. */
export function summarizeMonthlySavings(
  monthlyRows: DailySavings[],
  costs: CostItemsSummary,
  from: string,
  to: string,
): { summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] } {
  return summarizePeriodSavings(monthlyRows, costs, from, to, 12);
}
