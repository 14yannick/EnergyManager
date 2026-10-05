import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type {
  CumulativeSavingsPoint,
  NeighbourSales,
  DailySavings,
  FeedInRatePoint,
  SavingsDayDetail,
  SavingsDayParty,
  SavingsSlot,
  SavingsSummary,
  SavingsQuery,
} from "@energy-manager/shared";
import {
  makeRateResolver,
  type RateResolver,
  type ResolvedPeriod,
  type ResolvedRate,
} from "./rates.js";
import { db } from "../../db/client.js";
import {
  dynamicTariffRates,
  intervalMetrics,
  parties,
  tariffPeriods,
  tariffSurcharges,
} from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { priceNeighbourSales } from "./neighbourSales.js";
import { loadOwnerFixedCosts } from "../billing/service.js";
import { periodBounds } from "../billing/engine.js";
import { savedByParty } from "../consumption/service.js";
import { getCostItemsSummary } from "../costItems/service.js";
import {
  addOwnerFixedAdvantage,
  aggregateDailyToMonthly,
  aggregateDailyToOverall,
  aggregateDailyToQuarterly,
  aggregateDailyToYearly,
  aggregateIntervalsToDaily,
  aggregateIntervalsToHourly,
  chargeAcEquivalentKwh,
  computeDirectUseKwh,
  computeSavingsFromInputs,
  summarizeHourlySavings,
  summarizeMonthlySavings,
  summarizeOverallSavings,
  summarizeQuarterlySavings,
  summarizeSavings,
  summarizeYearlySavings,
} from "./engine.js";
import { plantSettingsOf } from "../sites/plant.js";
import { loadVzevSettlement } from "../vzev/settlement.js";

/**
 * Every rate that can apply inside the bounds: tariff periods, the day-ahead
 * feed, and surcharges on top. One loader, so the site's revenue and the
 * per-participant breakdown can never price the same interval differently.
 */
async function loadRateResolver(siteId: string, fromBound: SQL, toBoundExclusive: SQL): Promise<RateResolver> {
  const [flatRows, dynamicRows, surchargeRows] = await Promise.all([
    db.select().from(tariffPeriods).where(eq(tariffPeriods.siteId, siteId)),
    db
      .select()
      .from(dynamicTariffRates)
      .where(
        and(
          eq(dynamicTariffRates.siteId, siteId),
          sql`${dynamicTariffRates.startTs} >= ${fromBound}`,
          sql`${dynamicTariffRates.startTs} < ${toBoundExclusive}`,
        ),
      ),
    db.select().from(tariffSurcharges).where(eq(tariffSurcharges.siteId, siteId)),
  ]);

  const periods: ResolvedPeriod[] = flatRows.map((r) => ({
    kind: r.kind,
    startTs: r.startTs.toISOString(),
    endTs: r.endTs.toISOString(),
    pricingMode: r.pricingMode,
    rateChfPerKwh: r.rateChfPerKwh == null ? null : toNumber(r.rateChfPerKwh),
  }));
  const dynamicRates: ResolvedRate[] = dynamicRows.map((r) => ({
    kind: r.kind,
    startTs: r.startTs.toISOString(),
    endTs: r.endTs.toISOString(),
    rateChfPerKwh: toNumber(r.rateChfPerKwh),
  }));
  const surcharges: ResolvedRate[] = surchargeRows.map((r) => ({
    kind: r.kind,
    startTs: r.startTs.toISOString(),
    endTs: r.endTs.toISOString(),
    rateChfPerKwh: toNumber(r.rateChfPerKwh),
  }));
  return makeRateResolver(periods, dynamicRates, surcharges);
}

/**
 * Every metering interval in the range, priced.
 *
 * The one place readings and rates are loaded: `getDailySavings` rolls these
 * up, and `getSavingsDay` hands them out as the detail behind a day's
 * averages. Sharing the loader is what guarantees an expanded interval list
 * adds up to the total printed above it.
 */
async function loadPricedSlots(
  siteId: string,
  from: string,
  to: string,
): Promise<{ slots: SavingsSlot[]; resolveRate: RateResolver }> {
  // Half-open [from, to] range in Europe/Zurich calendar days, converted to UTC
  // in SQL (DST-aware) — not naive `${from}T00:00:00Z`. A row stamped at
  // Zurich-local midnight on `from` (as every monthly/daily import is) lands at
  // the *previous* UTC day whenever Zurich is ahead of UTC (CEST, or CET for a
  // few morning hours), so a naive UTC bound silently dropped that whole day —
  // most visibly a query scoped to a single calendar month (e.g. the revenue
  // chart), which lost its first day's data for every CEST month.
  const fromBound = sql`(${from}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;

  // interval_metrics stores one row per (site, ts, metric) instead of fixed
  // columns; pivot it back into the wide per-interval shape the engine
  // expects via conditional aggregation, so engine.ts needs no changes.
  //
  // The plant's own figures come from the pivot. Where the export went —
  // to the participants or on to the grid — comes from the settlement, which
  // takes the grid provider's figures where they are in and works the split
  // out where they are not (see vzev/settlement.ts).
  const [plant, readingRows, settlement, resolveRate] = await Promise.all([
    plantSettingsOf(siteId),
    db
      .select({
        ts: intervalMetrics.ts,
        // Hour resolution: aggregateIntervalsToDaily slices this back to the
        // date, aggregateIntervalsToHourly keeps the hour.
        date: sql<string>`to_char(${intervalMetrics.ts} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD"T"HH24')`,
        producedKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'production'), 0)`,
        batteryChargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)`,
        // The AC share, not the DC counter: everything priced here is energy
        // that actually reached the house or the grid. The DC figure is kept
        // as its own metric for battery diagnostics.
        batteryDischargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_discharge_ac'), 0)`,
        // Unpriced: the savings maths never touches it. It is here so the
        // energy-flow view can show where the house's power came from without
        // a second query over the same intervals.
        //
        // Only what a *producer's* meter drew. Any member may map their own
        // grid import now, and a neighbour's draw is not the plant's: it is
        // not part of this balance at all. A reading with no participant
        // predates that distinction and was the producer's.
        importedKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'import_grid' and (${intervalMetrics.partyId} is null or ${intervalMetrics.partyId} in (select ${parties.id} from ${parties} where ${parties.siteId} = ${siteId} and ${parties.feedIn}))), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
          // The export and the participants' draw are not summed here, but
          // an interval that has only those still needs its row.
          inArray(intervalMetrics.metricKind, [
            "production",
            "battery_charge",
            "battery_discharge",
            "battery_discharge_ac",
            "export_grid",
            "export",
            "consumption",
            "import_grid",
          ]),
        ),
      )
      .groupBy(intervalMetrics.ts)
      .orderBy(intervalMetrics.ts),
    loadVzevSettlement(siteId, fromBound, toBoundExclusive),
    loadRateResolver(siteId, fromBound, toBoundExclusive),
  ]);
  const settledAt = new Map(settlement.map((s) => [s.ts.getTime(), s]));

  // The producers' own figure, combined for the site (see sites/plant.ts).
  const batteryConversionLoss = plant.batteryConversionLoss;

  const slots = readingRows.map((row) => {
    const instantIso = row.ts.toISOString();
    const producedKwh = toNumber(row.producedKwh);
    const batteryChargeKwh = toNumber(row.batteryChargeKwh);
    const batteryDischargeKwh = toNumber(row.batteryDischargeKwh);
    const settled = settledAt.get(row.ts.getTime());
    // What reached the grid and is paid at the feed-in rate, everything that
    // left the house, and what the participants took of it.
    const exportedKwh = settled?.unsoldKwh ?? 0;
    const exportLocalKwh = settled?.exportKwh ?? 0;
    const neighborConsumptionKwh = settled?.salesKwh ?? 0;

    const priced = computeSavingsFromInputs({
      date: row.date,
      batteryConversionLoss,
      producedKwh,
      // Against everything that left the house, so energy sold to a
      // participant is not also counted as used at home — less what the
      // battery pushed out, which was never the panels' to begin with.
      directUseKwh: computeDirectUseKwh({ producedKwh, exportedKwh: exportLocalKwh, batteryDischargeKwh }),
      batteryChargeKwh,
      batteryDischargeKwh,
      exportedKwh,
      exportLocalKwh,
      neighborConsumptionKwh,
      importedKwh: toNumber(row.importedKwh),
      purchaseRateChfPerKwh: resolveRate("purchase", instantIso),
      sellRateChfPerKwh: resolveRate("feed_in", instantIso),
      neighborSellRateChfPerKwh: resolveRate("neighbor_sell", instantIso),
    });
    return {
      ...priced,
      ts: instantIso,
      batteryChargeAcKwh: chargeAcEquivalentKwh(batteryChargeKwh, batteryConversionLoss),
    };
  });

  return { slots, resolveRate };
}

/**
 * Drop the per-interval-only fields before aggregating. `ts` describes one
 * instant and `batteryChargeAcKwh` is not in the engine's summable list, so
 * either one surviving into a period row would carry the first interval's
 * value while claiming to describe the whole period.
 */
function toDailySavings({ ts: _ts, batteryChargeAcKwh: _ac, ...row }: SavingsSlot): DailySavings {
  return row;
}

export async function getDailySavings(
  siteId: string,
  from: string,
  to: string,
  granularity: SavingsQuery["granularity"] = "daily",
): Promise<DailySavings[]> {
  const [{ slots }, ownerCosts] = await Promise.all([
    loadPricedSlots(siteId, from, to),
    loadOwnerFixedCosts(siteId),
  ]);
  const intervalRows = slots.map(toDailySavings);
  // Per day (or hour) of readings, before any rolling up.
  const withOwner = (rows: DailySavings[]) => (ownerCosts ? addOwnerFixedAdvantage(rows, ownerCosts) : rows);

  if (granularity === "hourly") return withOwner(aggregateIntervalsToHourly(intervalRows));

  const daily = withOwner(aggregateIntervalsToDaily(intervalRows));
  if (granularity === "monthly") return aggregateDailyToMonthly(daily);
  if (granularity === "quarterly") return aggregateDailyToQuarterly(daily);
  if (granularity === "yearly") return aggregateDailyToYearly(daily);
  if (granularity === "overall") return aggregateDailyToOverall(daily);
  return daily;
}

/**
 * One day's totals with the intervals behind them.
 *
 * `totals` is null for a day with no readings at all, which the day view
 * shows as "nothing recorded" rather than a page of zeros that look like a
 * day the system produced nothing.
 */
export async function getSavingsDay(siteId: string, date: string): Promise<SavingsDayDetail> {
  const { slots, resolveRate } = await loadPricedSlots(siteId, date, date);
  const daily = aggregateIntervalsToDaily(slots.map(toDailySavings));
  const parties = await loadDayParties(siteId, date, resolveRate);
  return { date, totals: daily[0] ?? null, slots, parties };
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/**
 * The feed-in rate for every metering interval of a local day, whether or
 * not anything has been read for it yet.
 *
 * Resolved from periods, the day-ahead feed and surcharges alone — the same
 * inputs `loadPricedSlots` prices actual readings against — so it needs no
 * metering and covers hours still ahead exactly as readily as ones already
 * past. A rate is a rate regardless of whether the hour behind it has
 * elapsed, unlike a reading, so there is no separate "actual" curve to
 * reconcile this against once the day catches up to it.
 */
export async function getFeedInRateCurve(siteId: string, date: string): Promise<FeedInRatePoint[]> {
  const fromBound = sql`(${date}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${date}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;
  const resolveRate = await loadRateResolver(siteId, fromBound, toBoundExclusive);
  const { startIso, endExclusiveIso } = periodBounds(date, date);
  const points: FeedInRatePoint[] = [];
  for (let t = new Date(startIso).getTime(); t < new Date(endExclusiveIso).getTime(); t += QUARTER_HOUR_MS) {
    const ts = new Date(t).toISOString();
    points.push({ ts, rateChfPerKwh: resolveRate("feed_in", ts), purchaseRateChfPerKwh: resolveRate("purchase", ts) });
  }
  return points;
}

/**
 * What each participant took from the export, interval by interval: the grid
 * provider's split where it is in, the vZEV's own rule where it is not (see
 * vzev/settlement.ts). The same settlement the site's revenue is priced
 * from, so the participants' sales here add up to the neighbour-sale
 * revenue the dashboard charts.
 */
async function loadPartySales(
  siteId: string,
  fromBound: SQL,
  toBoundExclusive: SQL,
): Promise<Array<{ partyId: string; name: string; ts: Date; kwh: number }>> {
  const [settlement, siteParties] = await Promise.all([
    loadVzevSettlement(siteId, fromBound, toBoundExclusive),
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.siteId, siteId)),
  ]);
  const nameOf = new Map(siteParties.map((p) => [p.id, p.name]));
  return settlement.flatMap((interval) =>
    interval.sales.flatMap((sale) => {
      const name = nameOf.get(sale.partyId);
      return name == null ? [] : [{ partyId: sale.partyId, name, ts: interval.ts, kwh: sale.kwh }];
    }),
  );
}

/**
 * Who drew what from the local pool, priced per interval.
 *
 * Kept as its own query rather than widening the pivot above: that one groups
 * by instant alone, and adding the party would multiply every site-level
 * metric by the number of parties. Summed here, so the figures still tie back
 * to `totals.neighborConsumptionKwh`.
 */
async function loadDayParties(
  siteId: string,
  date: string,
  resolveRate: RateResolver,
): Promise<SavingsDayParty[]> {
  const fromBound = sql`(${date}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${date}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;

  const rows = await loadPartySales(siteId, fromBound, toBoundExclusive);

  const byParty = new Map<string, SavingsDayParty>();
  for (const row of rows) {
    const kwh = row.kwh;
    const rate = resolveRate("neighbor_sell", row.ts.toISOString());
    const entry = byParty.get(row.partyId) ?? {
      partyId: row.partyId,
      name: row.name,
      kwh: 0,
      chf: 0,
    };
    entry.kwh += kwh;
    entry.chf += rate != null ? kwh * rate : 0;
    byParty.set(row.partyId, entry);
  }
  return [...byParty.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSavingsSummary(
  siteId: string,
  from: string,
  to: string,
  granularity: SavingsQuery["granularity"] = "daily",
): Promise<{ summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] }> {
  // Hourly summarises its own rows; every other granularity rolls up from daily.
  const [dailyRows, costs] = await Promise.all([
    getDailySavings(siteId, from, to, granularity === "hourly" ? "hourly" : "daily"),
    getCostItemsSummary(siteId),
  ]);
  if (granularity === "hourly") {
    return summarizeHourlySavings(dailyRows, costs, from, to);
  }
  if (granularity === "monthly") {
    return summarizeMonthlySavings(aggregateDailyToMonthly(dailyRows), costs, from, to);
  }
  if (granularity === "quarterly") {
    return summarizeQuarterlySavings(aggregateDailyToQuarterly(dailyRows), costs, from, to);
  }
  if (granularity === "yearly") {
    return summarizeYearlySavings(aggregateDailyToYearly(dailyRows), costs, from, to);
  }
  if (granularity === "overall") {
    return summarizeOverallSavings(aggregateDailyToOverall(dailyRows), costs, from, to);
  }
  return summarizeSavings(dailyRows, costs, from, to);
}

/**
 * Each participant's draw from the local pool over a range, with what it
 * earned and what exporting the same energy would have earned instead.
 *
 * Per interval and per party, for the same reason as `loadDayParties`: the
 * site-level pivot groups by instant alone. Priced through the same resolver
 * as the site's revenue, so the participants' revenue here adds up to the
 * neighbour-sale revenue the dashboard charts.
 */
export async function getNeighbourSales(siteId: string, from: string, to: string): Promise<NeighbourSales> {
  const fromBound = sql`(${from}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;

  const [rows, resolveRate] = await Promise.all([
    loadPartySales(siteId, fromBound, toBoundExclusive),
    loadRateResolver(siteId, fromBound, toBoundExclusive),
  ]);

  const draws = rows.map((r) => ({ partyId: r.partyId, name: r.name, ts: r.ts.toISOString(), kwh: r.kwh }));
  // Read off the savings rows themselves, so this can never disagree with the
  // revenue chart or the savings totals about which days it covers.
  const [overall, ownerCosts, saved] = await Promise.all([
    getDailySavings(siteId, from, to, "overall"),
    loadOwnerFixedCosts(siteId),
    savedByParty(siteId, from, to),
  ]);
  const row = overall[0];
  const owner = ownerCosts
    ? {
        aloneChf: row?.ownerFixedAloneChf ?? 0,
        rcpChf: row?.ownerFixedRcpChf ?? 0,
        advantageChf: row?.rcpFixedAdvantageChf ?? 0,
      }
    : null;
  return { ...priceNeighbourSales(draws, resolveRate, { from, to }, saved), owner };
}
