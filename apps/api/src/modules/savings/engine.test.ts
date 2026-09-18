import { describe, expect, it } from "vitest";
import type { DailySavings } from "@energy-manager/shared";
import {
  aggregateDailyToMonthly,
  aggregateDailyToOverall,
  aggregateDailyToQuarterly,
  aggregateDailyToYearly,
  aggregateIntervalsToDaily,
  buildCumulativeSeries,
  chargeAcEquivalentKwh,
  computeBatteryRevenue,
  computeDirectUseKwh,
  computeSavingsFromInputs,
  summarizeMonthlySavings,
  summarizeOverallSavings,
  summarizeQuarterlySavings,
  summarizeSavings,
  summarizeYearlySavings,
} from "./engine.js";

/**
 * Synthetic scenarios, chosen for round arithmetic rather than realism.
 *
 * These replace a fixture cached from the original planning spreadsheet. That
 * fixture pinned the engine to totals copied out of a workbook, which meant the
 * tests could only ever say "the numbers still match the numbers" — and it put
 * real household production and revenue figures in the repo. The tests below
 * assert the engine's *relationships* instead: the identities between the two
 * counterfactuals, what a null rate contributes, how the battery's value
 * reduces to a rate spread, and that accumulation is order-independent. Those
 * hold for any inputs, so they catch a broken formula without anyone's data.
 */
interface Scenario {
  date: string;
  producedKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  purchaseRateChfPerKwh: number;
  sellRateChfPerKwh: number;
}

const scenarios: Scenario[] = [
  { date: "2024-01-31", producedKwh: 100, batteryDischargeKwh: 20, exportedKwh: 30, purchaseRateChfPerKwh: 0.3, sellRateChfPerKwh: 0.1 },
  { date: "2024-02-29", producedKwh: 200, batteryDischargeKwh: 50, exportedKwh: 80, purchaseRateChfPerKwh: 0.25, sellRateChfPerKwh: 0.08 },
  { date: "2024-03-31", producedKwh: 400, batteryDischargeKwh: 60, exportedKwh: 250, purchaseRateChfPerKwh: 0.28, sellRateChfPerKwh: 0.12 },
];

/**
 * Prices one scenario through the engine the way the discharge-based model
 * did, so the legacy direct-use figure is the one under test.
 */
function priceScenario(s: Scenario): DailySavings {
  return computeSavingsFromInputs({
    date: s.date,
    producedKwh: s.producedKwh,
    directUseKwh: computeDirectUseKwh(s),
    batteryChargeKwh: 0,
    batteryDischargeKwh: s.batteryDischargeKwh,
    exportedKwh: s.exportedKwh,
    exportLocalKwh: 0,
    neighborConsumptionKwh: 0,
    purchaseRateChfPerKwh: s.purchaseRateChfPerKwh,
    sellRateChfPerKwh: s.sellRateChfPerKwh,
    neighborSellRateChfPerKwh: null,
  });
}

describe("computeDirectUseKwh", () => {
  it("is PV output that did not leave for the grid", () => {
    // No charging term: production is already the panels' share of AC output,
    // so energy sent to the battery never entered this figure.
    expect(computeDirectUseKwh({ producedKwh: 100, exportedKwh: 30 })).toBe(70);
  });

  it("goes negative when the battery exported more than the panels made", () => {
    // Real, if rare: the battery can discharge to the grid. The floor belongs
    // on the summed period (see clampDirectUse), not here, so interval-level
    // meter timing noise can still cancel out.
    expect(computeDirectUseKwh({ producedKwh: 1, exportedKwh: 3 })).toBe(-2);
  });
});

describe("computeSavingsFromInputs", () => {
  it("prices self-consumption at the purchase rate and grid export at the sell rate", () => {
    const row = priceScenario(scenarios[0]!);

    // direct use 70 (100 produced - 30 exported) + discharge 20, both
    // displacing imports at 0.30
    expect(row.selfConsumptionValueChf).toBeCloseTo(27, 10);
    // 30 kWh exported at 0.10
    expect(row.exportRevenueChf).toBeCloseTo(3, 10);
    expect(row.savingsWithBatteryChf).toBeCloseTo(30, 10);
  });

  it.each(scenarios)(
    "$date: with-battery savings are self-consumption plus export revenue",
    (s) => {
      const row = priceScenario(s);
      expect(row.savingsWithBatteryChf).toBeCloseTo(
        row.selfConsumptionValueChf + row.exportRevenueChf,
        10,
      );
    },
  );

  it.each(scenarios)(
    "$date: the no-battery counterfactual re-prices discharged energy at the sell rate",
    (s) => {
      const row = priceScenario(s);
      const directUseKwh = computeDirectUseKwh(s);

      // Without a battery the discharged kWh could not have been stored, so it
      // would have left for the grid alongside whatever was already exported.
      expect(row.savingsWithoutBatteryChf).toBeCloseTo(
        directUseKwh * s.purchaseRateChfPerKwh +
          (s.batteryDischargeKwh + s.exportedKwh) * s.sellRateChfPerKwh,
        10,
      );
    },
  );

  it.each(scenarios)("$date: battery-only savings reduce to discharge x rate spread", (s) => {
    const row = priceScenario(s);

    // Everything else cancels between the two counterfactuals: all the battery
    // does is move a kWh from the sell price to the purchase price.
    expect(row.batteryOnlySavingsChf).toBeCloseTo(
      s.batteryDischargeKwh * (s.purchaseRateChfPerKwh - s.sellRateChfPerKwh),
      10,
    );
    expect(row.batteryOnlySavingsChf).toBeCloseTo(
      row.savingsWithBatteryChf - row.savingsWithoutBatteryChf,
      10,
    );
  });

  it("is worthless to have a battery when buying and selling cost the same", () => {
    const row = priceScenario({ ...scenarios[0]!, purchaseRateChfPerKwh: 0.2, sellRateChfPerKwh: 0.2 });
    expect(row.batteryOnlySavingsChf).toBeCloseTo(0, 10);
  });

  it("treats an unknown rate as zero contribution rather than throwing", () => {
    const row = computeSavingsFromInputs({
      date: "2024-01-31",
      producedKwh: 100,
      directUseKwh: 50,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 20,
      exportedKwh: 30,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: null,
      sellRateChfPerKwh: null,
      neighborSellRateChfPerKwh: null,
    });

    expect(row.selfConsumptionValueChf).toBe(0);
    expect(row.exportRevenueChf).toBe(0);
    expect(row.savingsWithBatteryChf).toBe(0);
  });
});

describe("summarizeSavings", () => {
  const rows = scenarios.map(priceScenario);
  const costs = { battery: 4000, solar: 12000, total: 16000 };
  const range = { from: "2024-01-01", to: "2024-03-31" };

  it("totals each series across the rows and counts one period per row", () => {
    const { summary } = summarizeSavings(rows, costs, range.from, range.to);

    const total = (key: "savingsWithBatteryChf" | "savingsWithoutBatteryChf" | "batteryOnlySavingsChf") =>
      rows.reduce((acc, r) => acc + r[key], 0);

    expect(summary.totals.withBatteryChf).toBeCloseTo(total("savingsWithBatteryChf"), 10);
    expect(summary.totals.withoutBatteryChf).toBeCloseTo(total("savingsWithoutBatteryChf"), 10);
    expect(summary.totals.batteryOnlyChf).toBeCloseTo(total("batteryOnlySavingsChf"), 10);
    expect(summary.daysWithData).toBe(rows.length);
  });

  it("averages by dividing each total by the number of periods with data", () => {
    const { summary } = summarizeSavings(rows, costs, range.from, range.to);

    expect(summary.avgDaily.withBatteryChf).toBeCloseTo(
      summary.totals.withBatteryChf / summary.daysWithData,
      10,
    );
    expect(summary.avgDaily.batteryOnlyChf).toBeCloseTo(
      summary.totals.batteryOnlyChf / summary.daysWithData,
      10,
    );
  });

  it("returns a payback that earns the cost back over its own duration", () => {
    const { summary } = summarizeSavings(rows, costs, range.from, range.to);

    // The round trip is the real property: annual savings x payback years
    // must come back to the cost, at 365 daily periods a year.
    const annualSavings = summary.avgDaily.withBatteryChf * 365;
    expect(summary.payback.withBatteryYears! * annualSavings).toBeCloseTo(costs.total, 6);
  });

  it("scales payback linearly with cost, holding savings fixed", () => {
    const cheap = summarizeSavings(rows, { battery: 0, solar: 0, total: 8000 }, range.from, range.to);
    const dear = summarizeSavings(rows, { battery: 0, solar: 0, total: 16000 }, range.from, range.to);

    expect(dear.summary.payback.withBatteryYears!).toBeCloseTo(
      cheap.summary.payback.withBatteryYears! * 2,
      10,
    );
  });
});

describe("buildCumulativeSeries", () => {
  const rows = scenarios.map(priceScenario);

  it("accumulates in chronological order regardless of input order", () => {
    const forward = buildCumulativeSeries(rows);
    const reversed = buildCumulativeSeries([...rows].reverse());

    expect(forward).toEqual(reversed);
  });

  it("ends at the sum of every row", () => {
    const series = buildCumulativeSeries(rows);
    const last = series[series.length - 1]!;

    expect(last.cumulativeWithBatteryChf).toBeCloseTo(
      rows.reduce((acc, r) => acc + r.savingsWithBatteryChf, 0),
      10,
    );
    expect(last.cumulativeBatteryOnlyChf).toBeCloseTo(
      rows.reduce((acc, r) => acc + r.batteryOnlySavingsChf, 0),
      10,
    );
  });

  it("never decreases while every row's savings are positive", () => {
    const series = buildCumulativeSeries(rows);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.cumulativeWithBatteryChf).toBeGreaterThanOrEqual(
        series[i - 1]!.cumulativeWithBatteryChf,
      );
    }
  });
});

describe("summarizeSavings breakeven", () => {
  const rows = scenarios.map(priceScenario);

  it("returns null when cumulative savings never reach the cost threshold", () => {
    const { summary } = summarizeSavings(
      rows,
      { battery: 5_000, solar: 12_000, total: 17_000 },
      "2024-01-01",
      "2024-03-31",
    );

    expect(summary.breakeven.withBatteryDate).toBeNull();
    expect(summary.breakeven.withoutBatteryDate).toBeNull();
    expect(summary.breakeven.batteryOnlyDate).toBeNull();
    // Still far off, but a finite estimate rather than a missing one.
    expect(summary.payback.withBatteryYears).toBeGreaterThan(0);
  });

  it("reports the first date on which cumulative savings cross the cost", () => {
    // Cumulative with-battery savings run 24.00, 60.40, 132.40 — a cost of 50
    // is first covered by the second row, not the first or the last.
    const { summary } = summarizeSavings(
      rows,
      { battery: 0, solar: 0, total: 50 },
      "2024-01-01",
      "2024-03-31",
    );

    expect(summary.breakeven.withBatteryDate).toBe("2024-02-29");
  });

  it("never breaks even on a cost of zero, which would otherwise be trivially met", () => {
    const { summary } = summarizeSavings(
      rows,
      { battery: 0, solar: 0, total: 0 },
      "2024-01-01",
      "2024-03-31",
    );

    expect(summary.breakeven.withBatteryDate).toBeNull();
  });
});

describe("computeBatteryRevenue", () => {
  it("treats discharge as fully consumed when the site isn't net-exporting", () => {
    const result = computeBatteryRevenue({
      producedKwh: 0,
      batteryChargeKwh: 2.2,
      batteryDischargeKwh: 2,
      exportedKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
    });
    expect(result.dischargeConsumedKwh).toBeCloseTo(2, 6);
    expect(result.dischargeExportedKwh).toBe(0);
    // 2.2 kWh DC charged, 10% lost converting -> 1.98 kWh of export forgone
    expect(result.chargingCostChf).toBeCloseTo(2.2 * 0.9 * 0.09, 6);
    expect(result.dischargeConsumedValueChf).toBeCloseTo(2 * 0.28, 6);
    expect(result.dischargeExportedValueChf).toBe(0);
    expect(result.batteryRevenueChf).toBeCloseTo(2 * 0.28 - 2.2 * 0.9 * 0.09, 6);
  });

  it("keeps discharge as consumed while production alone explains the export", () => {
    // A summer day rolled up: 60 kWh of PV reached the AC bus and 45 was
    // exported, so PV alone explains all of it and the night-time discharge
    // covered load. Pricing it at feed-in here is the daily-aggregate trap.
    const result = computeBatteryRevenue({
      producedKwh: 60,
      batteryChargeKwh: 5,
      batteryDischargeKwh: 5,
      exportedKwh: 45,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
    });
    expect(result.dischargeExportedKwh).toBe(0);
    expect(result.dischargeConsumedKwh).toBeCloseTo(5, 6);
    expect(result.batteryRevenueChf).toBeCloseTo(5 * 0.28 - 5 * 0.9 * 0.09, 6);
  });

  it("credits the battery with export that production cannot account for", () => {
    // Nothing produced, nothing charged, yet 5 kWh was exported while the
    // battery discharged 5 — a deliberate discharge-to-grid.
    const result = computeBatteryRevenue({
      producedKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 5,
      exportedKwh: 5,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
    });
    expect(result.dischargeExportedKwh).toBeCloseTo(5, 6);
    expect(result.dischargeConsumedKwh).toBe(0);
    expect(result.dischargeExportedValueChf).toBeCloseTo(5 * 0.09, 6);
    expect(result.dischargeConsumedValueChf).toBe(0);
  });

  it("splits a discharge when production explains only part of the export", () => {
    // 6 kWh of PV reached the AC bus but 8 was exported, so 2 of the 3 kWh
    // discharged went to the grid and the remaining 1 covered load.
    const result = computeBatteryRevenue({
      producedKwh: 6,
      batteryChargeKwh: 4,
      batteryDischargeKwh: 3,
      exportedKwh: 8,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
    });
    expect(result.dischargeExportedKwh).toBeCloseTo(2, 6);
    expect(result.dischargeConsumedKwh).toBeCloseTo(1, 6);
    expect(result.batteryRevenueChf).toBeCloseTo(1 * 0.28 + 2 * 0.09 - 4 * 0.9 * 0.09, 6);
  });

  it("treats a missing rate as zero contribution, not a thrown error", () => {
    const result = computeBatteryRevenue({
      producedKwh: 0,
      batteryChargeKwh: 3,
      batteryDischargeKwh: 3,
      exportedKwh: 0,
      purchaseRateChfPerKwh: null,
      sellRateChfPerKwh: 0.1,
    });
    expect(result.dischargeConsumedValueChf).toBe(0);
    // 3 kWh DC charged, 10% conversion loss -> 2.7 kWh of export forgone
    expect(result.chargingCostChf).toBeCloseTo(0.27, 6);
    expect(result.batteryRevenueChf).toBeCloseTo(-0.27, 6);
  });
});

describe("computeSavingsFromInputs — revenue breakdown", () => {
  it("splits export revenue between production-sourced (direct) and battery-sourced, and prices neighbour sales separately", () => {
    // 4 kWh of PV reached the AC bus but 5 was exported, so 1 kWh of the
    // discharge is credited to the battery and the remaining 4 kWh of export
    // revenue is production-sourced.
    const result = computeSavingsFromInputs({
      date: "2026-06-01",
      producedKwh: 4,
      directUseKwh: 3,
      batteryChargeKwh: 6,
      batteryDischargeKwh: 2,
      exportedKwh: 5,
      exportLocalKwh: 9, // 5 to the grid + 4 taken by neighbours
      neighborConsumptionKwh: 4,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: 0.14,
    });

    expect(result.directExportRevenueChf).toBeCloseTo(4 * 0.09, 6);
    expect(result.batteryDischargeExportedValueChf).toBeCloseTo(1 * 0.09, 6);
    expect(result.directExportRevenueChf + result.batteryDischargeExportedValueChf).toBeCloseTo(
      result.exportRevenueChf,
      6,
    );
    expect(result.neighborSellRevenueChf).toBeCloseTo(4 * 0.14, 6);
  });

  it("prices direct consumption at the purchase rate, disjoint from the battery's consumed leg", () => {
    const result = computeSavingsFromInputs({
      date: "2026-06-01",
      producedKwh: 10,
      directUseKwh: 4,
      batteryChargeKwh: 2,
      batteryDischargeKwh: 3,
      exportedKwh: 4,
      exportLocalKwh: 4,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
    });

    expect(result.directConsumptionRevenueChf).toBeCloseTo(4 * 0.28, 6);
    // The two consumed legs together are exactly the Excel-protected figure.
    expect(result.directConsumptionRevenueChf + result.batteryDischargeConsumedValueChf).toBeCloseTo(
      result.selfConsumptionValueChf,
      6,
    );
  });

  it("prices neighbour sales off neighbour consumption, never off export_local", () => {
    // export_local is everything leaving the household — its grid share is
    // already priced as export revenue, so pricing it again at the neighbour
    // rate would double-count. With no neighbour consumption there is no
    // neighbour revenue, however much left the household.
    const result = computeSavingsFromInputs({
      date: "2026-06-01",
      producedKwh: 10,
      directUseKwh: 2,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      exportedKwh: 8,
      exportLocalKwh: 8,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: 0.14,
    });
    expect(result.neighborSellRevenueChf).toBe(0);
    expect(result.directExportRevenueChf).toBeCloseTo(8 * 0.09, 6);
  });

  it("treats a missing neighbour rate as zero revenue, not a thrown error", () => {
    const result = computeSavingsFromInputs({
      date: "2026-06-01",
      producedKwh: 1,
      directUseKwh: 1,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      exportedKwh: 0,
      exportLocalKwh: 2,
      neighborConsumptionKwh: 2,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
    });
    expect(result.neighborSellRevenueChf).toBe(0);
  });
});

describe("aggregateIntervalsToDaily", () => {
  function interval(date: string, overrides: Partial<Parameters<typeof computeSavingsFromInputs>[0]> = {}) {
    return computeSavingsFromInputs({
      date,
      producedKwh: 1,
      directUseKwh: 0.5,
      batteryChargeKwh: 0.2,
      batteryDischargeKwh: 0.1,
      exportedKwh: 0.3,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
      ...overrides,
    });
  }

  it("sums kWh and CHF fields across intervals on the same day", () => {
    const rows: DailySavings[] = [interval("2026-06-01"), interval("2026-06-01"), interval("2026-06-02")];
    const daily = aggregateIntervalsToDaily(rows);

    expect(daily).toHaveLength(2);
    const day1 = daily.find((d) => d.date === "2026-06-01")!;
    expect(day1.producedKwh).toBeCloseTo(2, 6);
    expect(day1.exportedKwh).toBeCloseTo(0.6, 6);
    expect(day1.savingsWithBatteryChf).toBeCloseTo(2 * interval("2026-06-01").savingsWithBatteryChf, 6);
  });

  it("nulls the per-day rate once a day mixes more than one interval's rate", () => {
    const rows = [
      interval("2026-06-01", { sellRateChfPerKwh: 0.09 }),
      interval("2026-06-01", { sellRateChfPerKwh: 0.15 }),
    ];
    const [day] = aggregateIntervalsToDaily(rows);
    expect(day!.sellRateChfPerKwh).toBeNull();
    expect(day!.purchaseRateChfPerKwh).toBeNull();
  });

  it("keeps a single interval's rate when a day has only one", () => {
    const [day] = aggregateIntervalsToDaily([interval("2026-06-01")]);
    expect(day!.sellRateChfPerKwh).toBe(0.09);
  });

  it("returns days sorted chronologically regardless of input order", () => {
    const rows = [interval("2026-06-03"), interval("2026-06-01"), interval("2026-06-02")];
    const daily = aggregateIntervalsToDaily(rows);
    expect(daily.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
});

describe("aggregateDailyToMonthly", () => {
  function day(date: string, overrides: Partial<Parameters<typeof computeSavingsFromInputs>[0]> = {}) {
    return computeSavingsFromInputs({
      date,
      producedKwh: 10,
      directUseKwh: 5,
      batteryChargeKwh: 2,
      batteryDischargeKwh: 1,
      exportedKwh: 3,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
      ...overrides,
    });
  }

  it("sums same-month days into a single YYYY-MM row", () => {
    const rows = [day("2026-06-01"), day("2026-06-15"), day("2026-07-01")];
    const monthly = aggregateDailyToMonthly(rows);

    expect(monthly).toHaveLength(2);
    const june = monthly.find((m) => m.date === "2026-06")!;
    expect(june.producedKwh).toBeCloseTo(20, 6);
    expect(june.savingsWithBatteryChf).toBeCloseTo(2 * day("2026-06-01").savingsWithBatteryChf, 6);
  });

  it("nulls the rate once a month mixes more than one day's rate, keeps it for a single day", () => {
    const rows = [day("2026-06-01", { sellRateChfPerKwh: 0.09 }), day("2026-06-15", { sellRateChfPerKwh: 0.15 })];
    const [june] = aggregateDailyToMonthly(rows);
    expect(june!.sellRateChfPerKwh).toBeNull();

    const [july] = aggregateDailyToMonthly([day("2026-07-01")]);
    expect(july!.sellRateChfPerKwh).toBe(0.09);
  });
});

describe("summarizeMonthlySavings", () => {
  it("annualizes payback using 12 periods/year instead of 365, unlike summarizeSavings", () => {
    // One "period" worth CHF 100 with-battery savings, cost CHF 1200.
    const row = computeSavingsFromInputs({
      date: "2026-06",
      producedKwh: 1000,
      directUseKwh: 357.14,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      exportedKwh: 0,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
    });
    // Force a clean CHF 100 with-battery savings figure for a legible assertion.
    const scaled = { ...row, savingsWithBatteryChf: 100 };
    const costs = { battery: 0, solar: 1200, total: 1200 };

    const daily = summarizeSavings([scaled], costs, "2026-06", "2026-06");
    const monthly = summarizeMonthlySavings([scaled], costs, "2026-06", "2026-06");

    // Same single row treated as "1 day" vs "1 month": monthly payback should
    // be ~30x longer than treating it as a single day (365/12 ≈ 30.4).
    expect(daily.summary.payback.withBatteryYears).toBeCloseTo(1200 / (100 * 365), 6);
    expect(monthly.summary.payback.withBatteryYears).toBeCloseTo(1200 / (100 * 12), 6);
    expect(monthly.summary.payback.withBatteryYears! / daily.summary.payback.withBatteryYears!).toBeCloseTo(
      365 / 12,
      1,
    );
  });
});

describe("computeDirectUseKwh interval bias", () => {
  it("sums to the true total across intervals instead of keeping only positive noise", () => {
    // Meter timing skew: the same energy is produced in one interval and
    // exported in the next, so interval 2 comes out negative. Clamping each
    // interval at zero would report 6 kWh of direct use where there was 1.
    const intervals = [
      { producedKwh: 10, batteryChargeKwh: 0, exportedKwh: 4 },
      { producedKwh: 0, batteryChargeKwh: 0, exportedKwh: 5 },
    ];
    const summed = intervals.reduce((total, i) => total + computeDirectUseKwh(i), 0);
    const clamped = intervals.reduce((total, i) => total + Math.max(computeDirectUseKwh(i), 0), 0);

    expect(summed).toBeCloseTo(1, 6);
    expect(clamped).toBeCloseTo(6, 6);
  });
});

describe("aggregateIntervalsToDaily direct-use floor", () => {
  function interval(overrides: Partial<Parameters<typeof computeSavingsFromInputs>[0]>) {
    return computeSavingsFromInputs({
      date: "2026-06-01",
      producedKwh: 0,
      directUseKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
      exportedKwh: 0,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
      ...overrides,
    });
  }

  it("floors a grid-charged day at zero rather than reporting negative direct use", () => {
    // More went into the battery than the panels produced, so it was topped up
    // from the grid and no PV reached the load directly.
    const [day] = aggregateIntervalsToDaily([
      interval({ producedKwh: 14, batteryChargeKwh: 15, exportedKwh: 4, directUseKwh: -5 }),
    ]);
    expect(day!.directUseKwh).toBe(0);
    expect(day!.directConsumptionRevenueChf).toBe(0);
  });

  it("still lets interval noise cancel within the period before the floor applies", () => {
    // One interval is negative from meter skew but the day is positive, so the
    // floor must not touch it — otherwise the bias returns.
    const [day] = aggregateIntervalsToDaily([
      interval({ producedKwh: 10, exportedKwh: 4, directUseKwh: 6 }),
      interval({ producedKwh: 0, exportedKwh: 5, directUseKwh: -5 }),
    ]);
    expect(day!.directUseKwh).toBeCloseTo(1, 6);
    expect(day!.directConsumptionRevenueChf).toBeCloseTo(1 * 0.28, 6);
  });
});

describe("aggregateDailyToYearly / summarizeYearlySavings", () => {
  function day(date: string) {
    return computeSavingsFromInputs({
      date,
      producedKwh: 10,
      directUseKwh: 5,
      batteryChargeKwh: 2,
      batteryDischargeKwh: 1,
      exportedKwh: 3,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
    });
  }

  it("groups days into calendar years", () => {
    const yearly = aggregateDailyToYearly([day("2025-12-31"), day("2026-01-01"), day("2026-07-04")]);
    expect(yearly.map((r) => r.date)).toEqual(["2025", "2026"]);
    expect(yearly[1]!.producedKwh).toBeCloseTo(20, 6);
  });

  it("annualises payback over one period a year, so payback is cost divided by the annual figure", () => {
    const row = { ...day("2026-01-01"), savingsWithBatteryChf: 500 };
    const costs = { battery: 0, solar: 2000, total: 2000 };

    const yearly = summarizeYearlySavings([row], costs, "2026-01-01", "2026-12-31");
    const monthly = summarizeMonthlySavings([row], costs, "2026-01-01", "2026-12-31");

    expect(yearly.summary.payback.withBatteryYears).toBeCloseTo(2000 / 500, 6);
    // The same single row read as one month implies a 12x larger annual rate.
    expect(monthly.summary.payback.withBatteryYears).toBeCloseTo(2000 / (500 * 12), 6);
  });
});

describe("no-battery counterfactual revenue", () => {
  const base = {
    date: "2026-06-01",
    producedKwh: 100,
    directUseKwh: 20,
    batteryChargeKwh: 10,
    batteryDischargeKwh: 9,
    exportedKwh: 70,
    exportLocalKwh: 0,
    neighborConsumptionKwh: 0,
    purchaseRateChfPerKwh: 0.28,
    sellRateChfPerKwh: 0.09,
    neighborSellRateChfPerKwh: null,
  };

  it("moves the charged energy into export and drops what came back out of the battery", () => {
    const r = computeSavingsFromInputs(base);
    // Production alone could export 100-10=90 > 70, so none of the discharge is
    // credited to export; the counterfactual is simply export + charge.
    expect(r.batteryDischargeExportedKwh).toBe(0);
    expect(r.noBatteryDirectExportRevenueChf).toBeCloseTo((70 + 10) * 0.09, 6);
  });

  it("removes battery-sourced export from the counterfactual", () => {
    // Nothing produced, so all 5 exported kWh came out of the battery: without
    // one, neither the export nor the charge exists.
    const r = computeSavingsFromInputs({
      ...base,
      producedKwh: 0,
      directUseKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 5,
      exportedKwh: 5,
    });
    expect(r.batteryDischargeExportedKwh).toBeCloseTo(5, 6);
    expect(r.noBatteryDirectExportRevenueChf).toBe(0);
  });

  it("leaves direct consumption untouched — it never involved the battery", () => {
    const r = computeSavingsFromInputs(base);
    expect(r.directConsumptionRevenueChf).toBeCloseTo(20 * 0.28, 6);
  });
});

describe("aggregateDailyToOverall / summarizeOverallSavings", () => {
  function day(date: string) {
    return computeSavingsFromInputs({
      date,
      producedKwh: 10,
      directUseKwh: 5,
      batteryChargeKwh: 2,
      batteryDischargeKwh: 1,
      exportedKwh: 3,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
    });
  }

  it("collapses every row into a single period", () => {
    const rows = aggregateDailyToOverall([day("2025-12-31"), day("2026-01-01"), day("2026-07-04")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.producedKwh).toBeCloseTo(30, 6);
  });

  it("annualises by the true length of the range, not an assumed whole period", () => {
    const row = { ...day("2026-01-01"), savingsWithBatteryChf: 500 };
    const costs = { battery: 0, solar: 2000, total: 2000 };

    // Half a year of data implies twice the annual rate.
    const half = summarizeOverallSavings([row], costs, "2026-01-01", "2026-07-01");
    const days = 182;
    expect(half.summary.payback.withBatteryYears).toBeCloseTo(2000 / (500 * (365 / days)), 4);

    // A full year lands on the same answer as the yearly view.
    const full = summarizeOverallSavings([row], costs, "2026-01-01", "2026-12-31");
    expect(full.summary.payback.withBatteryYears).toBeCloseTo(2000 / 500, 2);
  });
});

describe("aggregateDailyToQuarterly / summarizeQuarterlySavings", () => {
  function day(date: string) {
    return computeSavingsFromInputs({
      date,
      producedKwh: 10,
      directUseKwh: 5,
      batteryChargeKwh: 2,
      batteryDischargeKwh: 1,
      exportedKwh: 3,
      exportLocalKwh: 0,
      neighborConsumptionKwh: 0,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
      neighborSellRateChfPerKwh: null,
    });
  }

  it("groups days into calendar quarters and keeps them in order across years", () => {
    const rows = aggregateDailyToQuarterly([
      day("2026-08-04"), // Q3
      day("2025-12-31"), // Q4 of the previous year
      day("2026-01-01"), // Q1
      day("2026-03-31"), // Q1
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2025-Q4", "2026-Q1", "2026-Q3"]);
    expect(rows[1]!.producedKwh).toBeCloseTo(20, 6); // the two Q1 days
  });

  it("annualises payback over four periods a year", () => {
    const row = { ...day("2026-01-01"), savingsWithBatteryChf: 500 };
    const costs = { battery: 0, solar: 2000, total: 2000 };
    const quarterly = summarizeQuarterlySavings([row], costs, "2026-01-01", "2026-03-31");
    expect(quarterly.summary.payback.withBatteryYears).toBeCloseTo(2000 / (500 * 4), 6);
  });
});

describe("computeBatteryRevenue — conversion loss on charging", () => {
  const base = {
    producedKwh: 50,
    batteryChargeKwh: 10,
    batteryDischargeKwh: 8,
    exportedKwh: 40,
    purchaseRateChfPerKwh: 0.248,
    sellRateChfPerKwh: 0.103,
  };

  it("charges only the AC-equivalent of what went into the battery", () => {
    // 10 kWh DC in, 10% lost converting, so 9 kWh of export was actually forgone.
    const r = computeBatteryRevenue({ ...base, batteryConversionLoss: 0.1 });
    expect(r.chargingCostChf).toBeCloseTo(9 * 0.103, 10);
  });

  it("defaults to 10% when the site states nothing", () => {
    expect(computeBatteryRevenue(base).chargingCostChf).toBeCloseTo(9 * 0.103, 10);
  });

  it("a bigger stated loss lowers the opportunity cost and raises revenue", () => {
    const low = computeBatteryRevenue({ ...base, batteryConversionLoss: 0.05 });
    const high = computeBatteryRevenue({ ...base, batteryConversionLoss: 0.2 });
    expect(high.chargingCostChf).toBeLessThan(low.chargingCostChf);
    expect(high.batteryRevenueChf).toBeGreaterThan(low.batteryRevenueChf);
  });

  it("exposes the exact quantity the cost was priced on", () => {
    // The day view prints this kWh beside a rate and a total, and expands it
    // into the intervals behind it. kWh x rate has to equal CHF exactly, or
    // an expanded list would not add up to the line above it.
    for (const loss of [0, 0.05, 0.1, 0.2]) {
      const r = computeBatteryRevenue({ ...base, batteryConversionLoss: loss });
      const acKwh = chargeAcEquivalentKwh(base.batteryChargeKwh, loss);
      expect(acKwh * base.sellRateChfPerKwh).toBeCloseTo(r.chargingCostChf, 12);
    }
  });

  it("zero loss is the old behaviour — the full DC charge is priced", () => {
    const r = computeBatteryRevenue({ ...base, batteryConversionLoss: 0 });
    expect(r.chargingCostChf).toBeCloseTo(10 * 0.103, 10);
  });

  it("does not subtract charging from production when finding exportable PV", () => {
    // production is already the PV share of AC output, so all of it could have
    // been exported; export beyond it must have come from the battery.
    const r = computeBatteryRevenue({ ...base, exportedKwh: 53 });
    expect(r.dischargeExportedKwh).toBeCloseTo(3, 10);
  });
});
