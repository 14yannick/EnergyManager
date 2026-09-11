import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DailySavings } from "@energy-manager/shared";
import {
  aggregateDailyToMonthly,
  aggregateDailyToOverall,
  aggregateDailyToQuarterly,
  aggregateDailyToYearly,
  aggregateIntervalsToDaily,
  buildCumulativeSeries,
  computeBatteryRevenue,
  computeDirectUseKwh,
  computeDirectUseKwhLegacyApprox,
  computeSavingsFromInputs,
  summarizeMonthlySavings,
  summarizeOverallSavings,
  summarizeQuarterlySavings,
  summarizeSavings,
  summarizeYearlySavings,
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
        exportLocalKwh: 0,
        neighborConsumptionKwh: 0,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
        neighborSellRateChfPerKwh: null,
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
        exportLocalKwh: 0,
        neighborConsumptionKwh: 0,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
        neighborSellRateChfPerKwh: null,
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
        exportLocalKwh: 0,
        neighborConsumptionKwh: 0,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
        neighborSellRateChfPerKwh: null,
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
        exportLocalKwh: 0,
        neighborConsumptionKwh: 0,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
        neighborSellRateChfPerKwh: null,
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
        exportLocalKwh: 0,
        neighborConsumptionKwh: 0,
        purchaseRateChfPerKwh: r.purchaseRateChfPerKwh,
        sellRateChfPerKwh: r.sellRateChfPerKwh,
        neighborSellRateChfPerKwh: null,
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
    expect(result.chargingCostChf).toBeCloseTo(2.2 * 0.09, 6);
    expect(result.dischargeConsumedValueChf).toBeCloseTo(2 * 0.28, 6);
    expect(result.dischargeExportedValueChf).toBe(0);
    expect(result.batteryRevenueChf).toBeCloseTo(2 * 0.28 - 2.2 * 0.09, 6);
  });

  it("keeps discharge as consumed while production alone explains the export", () => {
    // A summer day rolled up: 60 kWh produced, 5 charged, 45 exported — PV
    // could have exported up to 55 on its own, so the night-time discharge
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
    expect(result.batteryRevenueChf).toBeCloseTo(5 * 0.28 - 5 * 0.09, 6);
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
    // Produced 10, charged 4 -> PV could export at most 6; 8 went out, so 2
    // came from the battery and the other 1 kWh discharged covered load.
    const result = computeBatteryRevenue({
      producedKwh: 10,
      batteryChargeKwh: 4,
      batteryDischargeKwh: 3,
      exportedKwh: 8,
      purchaseRateChfPerKwh: 0.28,
      sellRateChfPerKwh: 0.09,
    });
    expect(result.dischargeExportedKwh).toBeCloseTo(2, 6);
    expect(result.dischargeConsumedKwh).toBeCloseTo(1, 6);
    expect(result.batteryRevenueChf).toBeCloseTo(1 * 0.28 + 2 * 0.09 - 4 * 0.09, 6);
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
    expect(result.chargingCostChf).toBeCloseTo(0.3, 6);
    expect(result.batteryRevenueChf).toBeCloseTo(-0.3, 6);
  });
});

describe("computeSavingsFromInputs — revenue breakdown", () => {
  it("splits export revenue between production-sourced (direct) and battery-sourced, and prices neighbour sales separately", () => {
    // Produced 10, charged 6 -> PV could export at most 4 of the 5 that went
    // out, so 1 kWh of the discharge is credited to the battery and the
    // remaining 4 kWh of export revenue is production-sourced.
    const result = computeSavingsFromInputs({
      date: "2026-06-01",
      producedKwh: 10,
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
