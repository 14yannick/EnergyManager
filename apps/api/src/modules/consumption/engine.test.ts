import { describe, expect, it } from "vitest";
import type { GridTariffPosition, SavingsQuery } from "@energy-manager/shared";
import { consumptionCosts } from "../billing/engine.js";
import { daysIn, periodKeyOf, priceConsumption, type PricingContext, type PricingUnit } from "./engine.js";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

// Round synthetic numbers — never real tariffs or readings.
function position(
  label: string,
  allocation: GridTariffPosition["allocation"],
  rateChf: number,
  countsInDirectBilling = true,
): GridTariffPosition {
  return {
    id: label,
    siteId: "s",
    category: "energie",
    label,
    allocation,
    rateChf,
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2027-01-01T00:00:00Z",
    countsInDirectBilling,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
}

const positions = [
  position("Base", "pool_shared", 120),
  position("Energy", "per_kwh", 0.2),
  position("Levy", "per_kwh_total", 0.02),
  position("Meter", "per_participant", 60),
  position("Virtual meter", "pool_shared", 30, false),
];

const ctx = (overrides: Partial<PricingContext> = {}): PricingContext => ({
  participantCount: 3,
  positionsOn: () => positions,
  localRateOn: () => 0.1,
  ...overrides,
});

/** A daily unit per day of the range, with varying usage so no day looks like another. */
function dailyUnits(from: string, to: string, granularity: Granularity = "daily"): PricingUnit[] {
  return daysIn(from, to).map((day, i) => ({
    day,
    key: periodKeyOf(day, granularity),
    days: 1,
    localKwh: (i % 5) + 1,
    gridKwh: (i % 3) * 2,
  }));
}

const sumOf = (units: PricingUnit[], k: "localKwh" | "gridKwh") => units.reduce((s, u) => s + u[k], 0);

describe("priceConsumption", () => {
  it("prices a range day by day to exactly what one invoice for the range costs", () => {
    const units = dailyUnits("2026-04-01", "2026-06-30");
    const { totals } = priceConsumption(units, ctx());
    const whole = consumptionCosts({
      from: "2026-04-01",
      to: "2026-06-30",
      days: units.length,
      participantCount: 3,
      positions,
      localRateChf: 0.1,
      usage: {
        partyId: null,
        partyReference: null,
        partyName: "",
        localKwh: sumOf(units, "localKwh"),
        gridKwh: sumOf(units, "gridKwh"),
      },
    });
    expect(totals.rcpCostChf).toBeCloseTo(whole.rcpChf, 9);
    expect(totals.directCostChf).toBeCloseTo(whole.directChf, 9);
    expect(totals.localEnergyChf).toBeCloseTo(whole.localEnergyChf, 9);
  });

  it("gives the same totals whichever periods the range is grouped into", () => {
    const at = (g: Granularity) => priceConsumption(dailyUnits("2026-01-01", "2026-12-31", g), ctx()).totals;
    const daily = at("daily");
    for (const g of ["monthly", "quarterly", "yearly", "overall"] as const) {
      const other = at(g);
      for (const k of Object.keys(daily) as Array<keyof typeof daily>) {
        expect(other[k]).toBeCloseTo(daily[k], 9);
      }
    }
    expect(priceConsumption(dailyUnits("2026-01-01", "2026-12-31", "quarterly"), ctx()).periods.map((p) => p.date))
      .toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  });

  it("gives the same day whether priced whole or as 24 hours", () => {
    const day = "2026-05-10";
    const hours: PricingUnit[] = Array.from({ length: 24 }, (_, h) => ({
      day,
      key: periodKeyOf(day, "hourly", h),
      days: 1 / 24,
      localKwh: h >= 8 && h < 18 ? 0.5 : 0,
      gridKwh: h < 8 || h >= 18 ? 0.25 : 0,
    }));
    const whole: PricingUnit = { day, key: day, days: 1, localKwh: sumOf(hours, "localKwh"), gridKwh: sumOf(hours, "gridKwh") };
    const byHour = priceConsumption(hours, ctx());
    const byDay = priceConsumption([whole], ctx()).totals;
    expect(byHour.periods).toHaveLength(24);
    expect(byHour.totals.rcpCostChf).toBeCloseTo(byDay.rcpCostChf, 9);
    expect(byHour.totals.directCostChf).toBeCloseTo(byDay.directCostChf, 9);
  });

  it("adds its periods up to its totals, and saves exactly the gap between the two costs", () => {
    const { totals, periods } = priceConsumption(dailyUnits("2026-02-01", "2026-03-31", "monthly"), ctx());
    for (const p of periods) expect(p.savedChf).toBeCloseTo(p.directCostChf - p.rcpCostChf, 9);
    for (const k of ["localKwh", "gridKwh", "rcpCostChf", "directCostChf", "savedChf"] as const) {
      expect(periods.reduce((s, p) => s + p[k], 0)).toBeCloseTo(totals[k], 9);
    }
  });

  it("saves nothing for a household alone on its connection that took nothing locally", () => {
    const units = dailyUnits("2026-01-01", "2026-01-31").map((u) => ({ ...u, localKwh: 0 }));
    const direct = positions.filter((p) => p.countsInDirectBilling);
    const { totals } = priceConsumption(units, ctx({ participantCount: 1, positionsOn: () => direct }));
    expect(totals.savedChf).toBeCloseTo(0, 9);
  });

  it("makes a kWh taken locally cheaper through the RCP, and no cheaper billed directly", () => {
    // The same energy each day, one kWh of it supplied locally instead of by the grid.
    const base = dailyUnits("2026-01-01", "2026-01-31");
    const before = priceConsumption(base.map((u) => ({ ...u, gridKwh: u.gridKwh + 1 })), ctx()).totals;
    const after = priceConsumption(base.map((u) => ({ ...u, localKwh: u.localKwh + 1 })), ctx()).totals;
    expect(after.directCostChf).toBeCloseTo(before.directCostChf, 9);
    // Per moved kWh: the grid energy rate (0.2) is replaced by the local rate (0.1).
    expect(before.rcpCostChf - after.rcpCostChf).toBeCloseTo(base.length * (0.2 - 0.1), 9);
  });

  it("prices each day at the tariff valid on it when the tariff changes mid-range", () => {
    const cheaper = positions.map((p) => (p.label === "Energy" ? { ...p, rateChf: 0.1 } : p));
    const positionsOn = (day: string) => (day < "2026-02-15" ? positions : cheaper);
    const units = dailyUnits("2026-02-01", "2026-02-28", "monthly");
    const split = priceConsumption(units, ctx({ positionsOn })).totals;
    const first = priceConsumption(units.filter((u) => u.day < "2026-02-15"), ctx()).totals;
    const second = priceConsumption(units.filter((u) => u.day >= "2026-02-15"), ctx({ positionsOn: () => cheaper })).totals;
    expect(split.rcpCostChf).toBeCloseTo(first.rcpCostChf + second.rcpCostChf, 9);
  });

  it("prices local energy at the neighbour rate valid on each day", () => {
    const units = dailyUnits("2026-02-01", "2026-02-28");
    const localRateOn = (day: string) => (day < "2026-02-15" ? 0.1 : 0.15);
    const expected = units.reduce((s, u) => s + u.localKwh * localRateOn(u.day), 0);
    expect(priceConsumption(units, ctx({ localRateOn })).totals.localEnergyChf).toBeCloseTo(expected, 9);
  });

  it("warns about a missing local rate only when there was local energy to price", () => {
    const noRate = ctx({ localRateOn: () => null });
    const gridOnly = dailyUnits("2026-01-01", "2026-01-07").map((u) => ({ ...u, localKwh: 0 }));
    expect(priceConsumption(gridOnly, noRate).warnings).toEqual([]);
    expect(priceConsumption(dailyUnits("2026-01-01", "2026-01-07"), noRate).warnings).toEqual(["no_local_rate"]);
    expect(priceConsumption(gridOnly, ctx({ positionsOn: () => [] })).warnings).toEqual(["no_positions"]);
  });
});

describe("daysIn", () => {
  it("steps across a DST change without skipping or repeating a day", () => {
    expect(daysIn("2026-03-28", "2026-03-31")).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
  });
});

describe("fixed charges", () => {
  it("accrue by the day whatever was consumed, divided as the invoice divides them", () => {
    const units = dailyUnits("2026-01-01", "2026-03-31");
    const idle = units.map((u) => ({ ...u, localKwh: 0, gridKwh: 0 }));
    const busy = priceConsumption(units, ctx()).totals;
    const quiet = priceConsumption(idle, ctx()).totals;
    expect(busy.rcpFixedChf).toBeCloseTo(quiet.rcpFixedChf, 9);
    expect(busy.directFixedChf).toBeCloseTo(quiet.directFixedChf, 9);
    // Base (120) and virtual meter (30) shared three ways, meter (60) alone.
    expect(busy.rcpFixedChf).toBeCloseTo((units.length * (150 / 3 + 60)) / 365, 9);
    // Billed directly: base and meter in full, no virtual meter at all.
    expect(busy.directFixedChf).toBeCloseTo((units.length * (120 + 60)) / 365, 9);
    // With nothing consumed, the whole bill is standing charges.
    expect(quiet.rcpCostChf).toBeCloseTo(quiet.rcpFixedChf, 9);
  });

  it("split over periods add up to the whole, like every other figure", () => {
    const { totals, periods } = priceConsumption(dailyUnits("2026-01-01", "2026-12-31", "quarterly"), ctx());
    for (const k of ["rcpFixedChf", "directFixedChf"] as const) {
      expect(periods.reduce((s, p) => s + p[k], 0)).toBeCloseTo(totals[k], 9);
    }
  });
});
