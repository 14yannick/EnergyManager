import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  CumulativeSavingsPoint,
  DailySavings,
  SavingsSummary,
  SavingsQuery,
} from "@energy-manager/shared";
import { makeRateResolver, type ResolvedRate } from "./rates.js";
import { db } from "../../db/client.js";
import {
  dynamicTariffRates,
  intervalMetrics,
  tariffPeriods,
  tariffSurcharges,
} from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { getCostItemsSummary } from "../costItems/service.js";
import {
  aggregateDailyToMonthly,
  aggregateDailyToOverall,
  aggregateDailyToQuarterly,
  aggregateDailyToYearly,
  aggregateIntervalsToDaily,
  computeDirectUseKwh,
  computeSavingsFromInputs,
  summarizeMonthlySavings,
  summarizeOverallSavings,
  summarizeQuarterlySavings,
  summarizeSavings,
  summarizeYearlySavings,
} from "./engine.js";

export async function getDailySavings(
  siteId: string,
  from: string,
  to: string,
  granularity: SavingsQuery["granularity"] = "daily",
): Promise<DailySavings[]> {
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
  // exportedKwh deliberately comes only from export_grid, not export_local —
  // locally-shared-to-neighbours energy doesn't feed savings math yet (needs
  // a real per-neighbour allocation model first).
  const [readingRows, flatRows, dynamicRows, surchargeRows] = await Promise.all([
    db
      .select({
        ts: intervalMetrics.ts,
        date: sql<string>`to_char(${intervalMetrics.ts} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
        producedKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'production'), 0)`,
        batteryChargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)`,
        batteryDischargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_discharge'), 0)`,
        exportedKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'export_grid'), 0)`,
        exportLocalKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'export_local'), 0)`,
        // Summed across every party — the per-party split matters for billing,
        // not for the site's revenue total.
        neighborConsumptionKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'consumption'), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
          inArray(intervalMetrics.metricKind, [
            "production",
            "battery_charge",
            "battery_discharge",
            "export_grid",
            "export_local",
            "consumption",
          ]),
        ),
      )
      .groupBy(intervalMetrics.ts)
      .orderBy(intervalMetrics.ts),
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

  const flatPeriods: ResolvedRate[] = flatRows.map((r) => ({
    kind: r.kind,
    startTs: r.startTs.toISOString(),
    endTs: r.endTs.toISOString(),
    rateChfPerKwh: toNumber(r.rateChfPerKwh),
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
  const resolveRate = makeRateResolver(flatPeriods, dynamicRates, surcharges);

  const intervalRows: DailySavings[] = readingRows.map((row) => {
    const instantIso = row.ts.toISOString();
    const producedKwh = toNumber(row.producedKwh);
    const batteryChargeKwh = toNumber(row.batteryChargeKwh);
    const batteryDischargeKwh = toNumber(row.batteryDischargeKwh);
    const exportedKwh = toNumber(row.exportedKwh);
    const exportLocalKwh = toNumber(row.exportLocalKwh);
    const neighborConsumptionKwh = toNumber(row.neighborConsumptionKwh);

    return computeSavingsFromInputs({
      date: row.date,
      producedKwh,
      directUseKwh: computeDirectUseKwh({ producedKwh, batteryChargeKwh, exportedKwh }),
      batteryChargeKwh,
      batteryDischargeKwh,
      exportedKwh,
      exportLocalKwh,
      neighborConsumptionKwh,
      purchaseRateChfPerKwh: resolveRate("purchase", instantIso),
      sellRateChfPerKwh: resolveRate("feed_in", instantIso),
      neighborSellRateChfPerKwh: resolveRate("neighbor_sell", instantIso),
    });
  });

  const daily = aggregateIntervalsToDaily(intervalRows);
  if (granularity === "monthly") return aggregateDailyToMonthly(daily);
  if (granularity === "quarterly") return aggregateDailyToQuarterly(daily);
  if (granularity === "yearly") return aggregateDailyToYearly(daily);
  if (granularity === "overall") return aggregateDailyToOverall(daily);
  return daily;
}

export async function getSavingsSummary(
  siteId: string,
  from: string,
  to: string,
  granularity: SavingsQuery["granularity"] = "daily",
): Promise<{ summary: SavingsSummary; cumulative: CumulativeSavingsPoint[] }> {
  const [dailyRows, costs] = await Promise.all([
    getDailySavings(siteId, from, to),
    getCostItemsSummary(siteId),
  ]);
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
