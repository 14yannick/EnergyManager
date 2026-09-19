import type {
  GridTariffPosition,
  PartyConsumption,
  PartyConsumptionPeriod,
  PartyConsumptionWarning,
  SavingsQuery,
} from "@energy-manager/shared";
import { consumptionCosts } from "../billing/engine.js";

/**
 * A party's consumption, priced — pure, like billing/engine.ts it builds on.
 *
 * The range is priced in small units (a day, or an hour on the hourly view)
 * and the units summed into the periods the chart shows. Each unit is costed
 * with the invoice's own arithmetic, so what the dashboard says a quarter
 * cost is what the invoice for that quarter says. Pricing unit by unit rather
 * than period by period is also what lets a tariff change mid-quarter land on
 * the right days, where the invoice run can only warn about it.
 */

type Granularity = NonNullable<SavingsQuery["granularity"]>;

export interface PricingUnit {
  /** The calendar day, YYYY-MM-DD in Europe/Zurich. */
  day: string;
  /** Which chart period the unit belongs to. */
  key: string;
  /** How much of a day the unit spans — 1, or 1/24 for an hour. */
  days: number;
  localKwh: number;
  gridKwh: number;
}

export interface PricingContext {
  participantCount: number;
  /** Grid-tariff positions valid on the given day. */
  positionsOn: (day: string) => GridTariffPosition[];
  /** The agreed neighbour rate on the given day, or null when none is set. */
  localRateOn: (day: string) => number | null;
}

const OVERALL_KEY = "overall";

/** The chart period a day (or an hour of it) falls in — same keys as the savings series. */
export function periodKeyOf(day: string, granularity: Granularity, hour?: number): string {
  switch (granularity) {
    case "hourly":
      return `${day}T${String(hour ?? 0).padStart(2, "0")}`;
    case "daily":
      return day;
    case "monthly":
      return day.slice(0, 7);
    case "quarterly":
      return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
    case "yearly":
      return day.slice(0, 4);
    case "overall":
      return OVERALL_KEY;
  }
}

/** Every calendar day in [from, to], stepped in UTC so DST cannot skip one. */
export function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const emptyTotals = (): Omit<PartyConsumptionPeriod, "date"> => ({
  localKwh: 0,
  gridKwh: 0,
  rcpCostChf: 0,
  localEnergyChf: 0,
  rcpFixedChf: 0,
  directCostChf: 0,
  directFixedChf: 0,
  savedChf: 0,
});

function addInto(target: Omit<PartyConsumptionPeriod, "date">, add: Omit<PartyConsumptionPeriod, "date">) {
  target.localKwh += add.localKwh;
  target.gridKwh += add.gridKwh;
  target.rcpCostChf += add.rcpCostChf;
  target.localEnergyChf += add.localEnergyChf;
  target.rcpFixedChf += add.rcpFixedChf;
  target.directCostChf += add.directCostChf;
  target.directFixedChf += add.directFixedChf;
  target.savedChf += add.savedChf;
}

export function priceConsumption(
  units: PricingUnit[],
  ctx: PricingContext,
): Pick<PartyConsumption, "totals" | "periods" | "warnings"> {
  const byKey = new Map<string, PartyConsumptionPeriod>();
  const totals = emptyTotals();
  const warnings = new Set<PartyConsumptionWarning>();

  for (const unit of units) {
    const positions = ctx.positionsOn(unit.day);
    const localRateChf = ctx.localRateOn(unit.day);
    if (positions.length === 0) warnings.add("no_positions");
    if (localRateChf == null && unit.localKwh > 0) warnings.add("no_local_rate");

    const costs = consumptionCosts({
      from: unit.day,
      to: unit.day,
      days: unit.days,
      participantCount: ctx.participantCount,
      positions,
      localRateChf,
      usage: {
        partyId: null,
        partyReference: null,
        partyName: "",
        gridKwh: unit.gridKwh,
        localKwh: unit.localKwh,
      },
    });
    const priced = {
      localKwh: unit.localKwh,
      gridKwh: unit.gridKwh,
      rcpCostChf: costs.rcpChf,
      localEnergyChf: costs.localEnergyChf,
      rcpFixedChf: costs.rcpFixedChf,
      directCostChf: costs.directChf,
      directFixedChf: costs.directFixedChf,
      savedChf: costs.directChf - costs.rcpChf,
    };

    const period = byKey.get(unit.key) ?? { date: unit.key, ...emptyTotals() };
    addInto(period, priced);
    byKey.set(unit.key, period);
    addInto(totals, priced);
  }

  return {
    totals,
    // Units arrive in time order, and a Map keeps insertion order.
    periods: [...byKey.values()],
    warnings: [...warnings],
  };
}
