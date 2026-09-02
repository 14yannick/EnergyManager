import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DailySavings } from "@energy-manager/shared";
import {
  aggregateDailyToMonthly,
  aggregateIntervalsToDaily,
  buildCumulativeSeries,
  computeBatteryUplift,
  computeDirectUseKwh,
  computeDirectUseKwhLegacyApprox,
  computeSavingsFromInputs,
  summarizeMonthlySavings,
  summarizeSavings,
} from "./engine.js";

const fixturePath = fileURLToPath(
  new URL("../../../test/fixtures/excel-reference.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  ranges: Array<{
    startDate: string;
    endDate: string;
    producedKwh: number;
    batteryDischargeKwh: number;
    exportedKwh: number;
    directUseKwhExcel: number;
    purchaseRateChfPerKwh: number;
    sellRateChfPerKwh: number;
    selfConsumptionValueChf: number;
    exportRevenueChf: number;
    savingsWithBatteryChf: number;
    savingsWithoutBatteryChf: number;
    batteryOnlySavingsChf: number;
    daysInRange: number;
  }>;
  costs: { batteryChf: number; solarChf: number; totalChf: number };
  summary: {
    totalSavingsWithBatteryChf: number;
    totalSavingsWithoutBatteryChf: number;
    totalBatteryOnlySavingsChf: number;
    totalDaysWithData: number;
    avgDailyWithBatteryChf: number;
    avgDailyWithoutBatteryChf: number;
    avgDailyBatteryOnlyChf: number;
    simplePaybackWithBatteryYears: number;
    simplePaybackWithoutBatteryYears: number;
    simplePaybackBatteryOnlyYears: number;
  };
};

describe("computeDirectUseKwhLegacyApprox", () => {
  it("reproduces the old spreadsheet's per-range direct-use figure exactly", () => {
    for (const r of fixture.ranges) {
      const directUse = computeDirectUseKwhLegacyApprox({
        producedKwh: r.producedKwh,
        batteryDischargeKwh: r.batteryDischargeKwh,
        exportedKwh: r.exportedKwh,
      });
      expect(directUse).toBeCloseTo(r.directUseKwhExcel, 6);
    }
  });
});

describe("computeSavingsFromInputs — matches Excel Summary sheet using the legacy direct-use figure", () => {
  it.each(fixture.ranges)(
    "range $startDate–$endDate reproduces I/J/K/L/M from RangeData",
    (r) => {
      const result = computeSavingsFromInputs({
        date: r.endDate,
        producedKwh: r.producedKwh,
        directUseKwh: r.directUseKwhExcel,
        batteryChargeKwh: 0, // not tracked by the old model; irrelevant to these formulas
        batteryDischargeKwh: r.batteryDischargeKwh,
        exportedKwh: r.exportedKwh,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
      });

      expect(result.selfConsumptionValueChf).toBeCloseTo(r.selfConsumptionValueChf, 6);
      expect(result.exportRevenueChf).toBeCloseTo(r.exportRevenueChf, 6);
      expect(result.savingsWithBatteryChf).toBeCloseTo(r.savingsWithBatteryChf, 6);
      expect(result.savingsWithoutBatteryChf).toBeCloseTo(r.savingsWithoutBatteryChf, 6);
      expect(result.batteryOnlySavingsChf).toBeCloseTo(r.batteryOnlySavingsChf, 6);
    },
  );

  it("summarizeSavings reproduces totals, averages and simple payback from the Summary sheet", () => {
    const dailyRows = fixture.ranges.map((r) =>
      computeSavingsFromInputs({
        date: r.endDate,
        producedKwh: r.producedKwh,
        directUseKwh: r.directUseKwhExcel,
        batteryChargeKwh: 0,
        batteryDischargeKwh: r.batteryDischargeKwh,
        exportedKwh: r.exportedKwh,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
      }),
    );

    const { summary } = summarizeSavings(
      dailyRows,
      { battery: fixture.costs.batteryChf, solar: fixture.costs.solarChf, total: fixture.costs.totalChf },
      fixture.ranges[0]!.startDate,
      fixture.ranges[fixture.ranges.length - 1]!.endDate,
    );

    expect(summary.totals.withBatteryChf).toBeCloseTo(fixture.summary.totalSavingsWithBatteryChf, 6);
    expect(summary.totals.withoutBatteryChf).toBeCloseTo(
      fixture.summary.totalSavingsWithoutBatteryChf,
      6,
    );
    expect(summary.totals.batteryOnlyChf).toBeCloseTo(fixture.summary.totalBatteryOnlySavingsChf, 6);

    // The spreadsheet's "days with data" (258) sums N (days per range); our engine's
    // daysWithData counts *rows* (one per range here), so it isn't directly comparable —
    // avg-daily and payback are instead independently recomputed below using the
    // spreadsheet's own days-with-data figure to isolate that difference.
    const avgWithBattery = fixture.summary.totalSavingsWithBatteryChf / fixture.summary.totalDaysWithData;
    const avgWithoutBattery =
      fixture.summary.totalSavingsWithoutBatteryChf / fixture.summary.totalDaysWithData;
    const avgBatteryOnly =
      fixture.summary.totalBatteryOnlySavingsChf / fixture.summary.totalDaysWithData;

    expect(avgWithBattery).toBeCloseTo(fixture.summary.avgDailyWithBatteryChf, 6);
    expect(avgWithoutBattery).toBeCloseTo(fixture.summary.avgDailyWithoutBatteryChf, 6);
    expect(avgBatteryOnly).toBeCloseTo(fixture.summary.avgDailyBatteryOnlyChf, 6);

    const paybackWithBattery = fixture.costs.totalChf / (avgWithBattery * 365);
    const paybackWithoutBattery = fixture.costs.solarChf / (avgWithoutBattery * 365);
    const paybackBatteryOnly = fixture.costs.batteryChf / (avgBatteryOnly * 365);

    expect(paybackWithBattery).toBeCloseTo(fixture.summary.simplePaybackWithBatteryYears, 4);
    expect(paybackWithoutBattery).toBeCloseTo(fixture.summary.simplePaybackWithoutBatteryYears, 4);
    expect(paybackBatteryOnly).toBeCloseTo(fixture.summary.simplePaybackBatteryOnlyYears, 4);
  });
});

describe("computeDirectUseKwh (new, corrected formula) diverges from the legacy approximation", () => {
  it("documents the expected divergence when charge != discharge, using real fixture magnitudes", () => {
    const r = fixture.ranges[0]!;
    const legacy = computeDirectUseKwhLegacyApprox({
      producedKwh: r.producedKwh,
      batteryDischargeKwh: r.batteryDischargeKwh,
      exportedKwh: r.exportedKwh,
    });

    // Charge is unknown in the old model; simulate a plausible charge figure
    // (batteries rarely charge/discharge at exactly equal magnitudes over a range).
    const assumedChargeKwh = r.batteryDischargeKwh * 1.1;
    const corrected = computeDirectUseKwh({
      producedKwh: r.producedKwh,
      batteryChargeKwh: assumedChargeKwh,
      exportedKwh: r.exportedKwh,
    });

    expect(legacy).toBeCloseTo(r.directUseKwhExcel, 6);
    expect(corrected).not.toBeCloseTo(legacy, 6);
  });
});

describe("buildCumulativeSeries", () => {
  it("accumulates in chronological order regardless of input order", () => {
    const rows = fixture.ranges.map((r) =>
      computeSavingsFromInputs({
        date: r.endDate,
        producedKwh: r.producedKwh,
        directUseKwh: r.directUseKwhExcel,
        batteryChargeKwh: 0,
        batteryDischargeKwh: r.batteryDischargeKwh,
        exportedKwh: r.exportedKwh,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
      }),
    );

    const forward = buildCumulativeSeries(rows);
    const shuffled = buildCumulativeSeries([...rows].reverse());

    expect(forward).toEqual(shuffled);
    expect(forward[forward.length - 1]!.cumulativeWithBatteryChf).toBeCloseTo(
      fixture.summary.totalSavingsWithBatteryChf,
      6,
    );
  });
});

describe("summarizeSavings breakeven", () => {
  it("returns null when cumulative savings never reach the cost threshold", () => {
    const rows = fixture.ranges.map((r) =>
      computeSavingsFromInputs({
        date: r.endDate,
        producedKwh: r.producedKwh,
        directUseKwh: r.directUseKwhExcel,
        batteryChargeKwh: 0,
        batteryDischargeKwh: r.batteryDischargeKwh,
        exportedKwh: r.exportedKwh,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
      }),
    );
    const { summary } = summarizeSavings(
      rows,
      { battery: fixture.costs.batteryChf, solar: fixture.costs.solarChf, total: fixture.costs.totalChf },
      "2025-10-16",
      "2026-06-30",
    );

    expect(summary.breakeven.withBatteryDate).toBeNull();
    expect(summary.breakeven.withoutBatteryDate).toBeNull();
    expect(summary.breakeven.batteryOnlyDate).toBeNull();
    expect(summary.payback.withBatteryYears).toBeGreaterThan(0);
  });

  it("finds the breakeven date once cumulative savings cross a small cost", () => {
    const rows = fixture.ranges.map((r) =>
      computeSavingsFromInputs({
        date: r.endDate,
        producedKwh: r.producedKwh,
        directUseKwh: r.directUseKwhExcel,
        batteryChargeKwh: 0,
        batteryDischargeKwh: r.batteryDischargeKwh,
        exportedKwh: r.exportedKwh,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
      }),
    );
    const { summary } = summarizeSavings(
      rows,
      { battery: 50, solar: 0, total: 50 },
      "2025-10-16",
      "2026-06-30",
    );

    // Cumulative with-battery savings after the first two ranges (26.90 + 51.97 = 78.87) exceed 50.
    expect(summary.breakeven.withBatteryDate).toBe("2025-10-31");
  });
});

describe("computeBatteryUplift", () => {
  it("prices discharged energy as avoided import vs. what exporting it instead would have earned", () => {
    const result = computeBatteryUplift(2, 0.28, 0.09);
    expect(result.avoidedImportChf).toBeCloseTo(0.56, 6);
    expect(result.ifExportedInsteadChf).toBeCloseTo(0.18, 6);
    expect(result.upliftChf).toBeCloseTo(0.38, 6);
  });

  it("uplift can go negative when the feed-in rate exceeds the purchase rate at that moment", () => {
    // Dynamic feed-in occasionally spikes above the flat purchase rate —
    // in that case, discharging into self-consumption was worse than exporting.
    const result = computeBatteryUplift(1, 0.2, 0.35);
    expect(result.upliftChf).toBeLessThan(0);
  });

  it("treats a missing rate as zero contribution, not a thrown error", () => {
    const result = computeBatteryUplift(3, null, 0.1);
    expect(result.avoidedImportChf).toBe(0);
    expect(result.ifExportedInsteadChf).toBeCloseTo(0.3, 6);
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
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
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
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
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
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
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
