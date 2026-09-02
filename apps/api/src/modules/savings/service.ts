import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type {
  CumulativeSavingsPoint,
  DailySavings,
  SavingsSummary,
  SavingsQuery,
  TariffKind,
} from "@energy-manager/shared";
import { findRateForInstant } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { dynamicTariffRates, intervalMetrics, tariffPeriods } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { getCostItemsSummary } from "../costItems/service.js";
import {
  aggregateDailyToMonthly,
  aggregateIntervalsToDaily,
  computeDirectUseKwh,
  computeSavingsFromInputs,
  summarizeMonthlySavings,
  summarizeSavings,
} from "./engine.js";

interface ResolvedRate {
  kind: TariffKind;
  startTs: string;
  endTs: string;
  rateChfPerKwh: number;
}

/**
 * Resolves the rate for `kind` at `instantIso`: an exact-timestamp dynamic
 * rate takes precedence (both BKW's feed and CSV-imported readings are UTC
 * quarter-hour aligned, so exact `start_ts` matching is reliable), falling
 * back to whichever flat tariff_periods row covers that instant. This is the
 * whole mechanism behind "flat until a cutover date, dynamic after" — no
 * manual cutover config needed, since dynamic rows simply don't exist yet for
 * dates before ingestion started.
 */
function makeRateResolver(flatPeriods: ResolvedRate[], dynamicRates: ResolvedRate[]) {
  const dynamicByKindAndTs = new Map<string, number>();
  for (const r of dynamicRates) dynamicByKindAndTs.set(`${r.kind}|${r.startTs}`, r.rateChfPerKwh);

  return (kind: TariffKind, instantIso: string): number | null => {
    const dynamic = dynamicByKindAndTs.get(`${kind}|${instantIso}`);
    if (dynamic !== undefined) return dynamic;
    return findRateForInstant(kind, instantIso, flatPeriods)?.rateChfPerKwh ?? null;
  };
}

export async function getDailySavings(
  siteId: string,
  from: string,
  to: string,
): Promise<DailySavings[]> {
  const fromBound = new Date(`${from}T00:00:00Z`);
  const toBound = new Date(`${to}T23:59:59Z`);

  // interval_metrics stores one row per (site, ts, metric) instead of fixed
  // columns; pivot it back into the wide per-interval shape the engine
  // expects via conditional aggregation, so engine.ts needs no changes.
  // exportedKwh deliberately comes only from export_grid, not export_local —
  // locally-shared-to-neighbours energy doesn't feed savings math yet (needs
  // a real per-neighbour allocation model first).
  const [readingRows, flatRows, dynamicRows] = await Promise.all([
    db
      .select({
        ts: intervalMetrics.ts,
        date: sql<string>`to_char(${intervalMetrics.ts} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
        producedKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'production'), 0)`,
        batteryChargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)`,
        batteryDischargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_discharge'), 0)`,
        exportedKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'export_grid'), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          gte(intervalMetrics.ts, fromBound),
          lte(intervalMetrics.ts, toBound),
          inArray(intervalMetrics.metricKind, [
            "production",
            "battery_charge",
            "battery_discharge",
            "export_grid",
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
          gte(dynamicTariffRates.startTs, fromBound),
          lte(dynamicTariffRates.startTs, toBound),
        ),
      ),
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
  const resolveRate = makeRateResolver(flatPeriods, dynamicRates);

  const intervalRows: DailySavings[] = readingRows.map((row) => {
    const instantIso = row.ts.toISOString();
    const producedKwh = toNumber(row.producedKwh);
    const batteryChargeKwh = toNumber(row.batteryChargeKwh);
    const batteryDischargeKwh = toNumber(row.batteryDischargeKwh);
    const exportedKwh = toNumber(row.exportedKwh);

    return computeSavingsFromInputs({
      date: row.date,
      producedKwh,
      directUseKwh: computeDirectUseKwh({ producedKwh, batteryChargeKwh, exportedKwh }),
      batteryChargeKwh,
      batteryDischargeKwh,
      exportedKwh,
      purchaseRateChfPerKwh: resolveRate("purchase", instantIso),
      sellRateChfPerKwh: resolveRate("feed_in", instantIso),
    });
  });

  return aggregateIntervalsToDaily(intervalRows);
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
  return summarizeSavings(dailyRows, costs, from, to);
}
