import { splitInverterOutput } from "./split.js";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type {
  HaEntityMapping,
  HaEntityMappingInput,
  HaStatisticOption,
  HaSyncResult,
  IntervalMetricKind,
} from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { haEntityMap, intervalMetrics } from "../../db/schema/index.js";
import { fetchStatistics, listEnergyStatistics, type HaPeriod } from "./haClient.js";
import { aggregateBuckets, startOfDayBefore } from "./buckets.js";

export const HA_SOURCE = "home_assistant";

/**
 * Home Assistant keeps 5-minute statistics for ~10 days (`purge_keep_days`)
 * and hourly ones indefinitely. Quarter-hour rows are built by summing three
 * 5-minute buckets, so they're only reachable inside that recent window;
 * anything older has to come from the hourly series.
 */
const PERIOD_BY_GRANULARITY: Record<"quarter_hour" | "hour", HaPeriod> = {
  quarter_hour: "5minute",
  hour: "hour",
};

type Row = typeof haEntityMap.$inferSelect;

function toDomain(row: Row): HaEntityMapping {
  return {
    id: row.id,
    siteId: row.siteId,
    metricKind: row.metricKind,
    statisticId: row.statisticId,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listHaStatistics(): Promise<HaStatisticOption[]> {
  return listEnergyStatistics();
}

export async function listMappings(siteId: string): Promise<HaEntityMapping[]> {
  const rows = await db
    .select()
    .from(haEntityMap)
    .where(eq(haEntityMap.siteId, siteId))
    .orderBy(haEntityMap.metricKind);
  return rows.map(toDomain);
}

/** One mapping per (site, metric kind) — setting it again replaces it. */
export async function upsertMapping(
  siteId: string,
  input: HaEntityMappingInput,
): Promise<HaEntityMapping> {
  const [row] = await db
    .insert(haEntityMap)
    .values({
      siteId,
      metricKind: input.metricKind,
      statisticId: input.statisticId,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: [haEntityMap.siteId, haEntityMap.metricKind],
      set: {
        statisticId: sql`excluded.statistic_id`,
        enabled: sql`excluded.enabled`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return toDomain(row!);
}

export async function deleteMapping(id: string): Promise<boolean> {
  const rows = await db.delete(haEntityMap).where(eq(haEntityMap.id, id)).returning({ id: haEntityMap.id });
  return rows.length > 0;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface UpsertRow {
  ts: Date;
  metricKind: IntervalMetricKind;
  valueKwh: number;
}

async function upsertMetricRows(
  siteId: string,
  rows: UpsertRow[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const batch of chunk(rows, 500)) {
    const result = await db
      .insert(intervalMetrics)
      .values(
        batch.map((r) => ({
          siteId,
          ts: r.ts,
          metricKind: r.metricKind,
          partyId: null,
          valueKwh: r.valueKwh.toFixed(4),
          source: HA_SOURCE,
        })),
      )
      .onConflictDoUpdate({
        target: [intervalMetrics.siteId, intervalMetrics.ts, intervalMetrics.metricKind],
        targetWhere: sql`${intervalMetrics.partyId} IS NULL`,
        set: { valueKwh: sql`excluded.value_kwh`, source: sql`excluded.source` },
      })
      .returning({ wasInsert: sql<boolean>`(xmax = 0)` });
    for (const r of result) {
      if (r.wasInsert) inserted++;
      else updated++;
    }
  }
  return { inserted, updated };
}

export interface SyncOptions {
  from?: Date;
  to?: Date;
  granularity?: "quarter_hour" | "hour";
  lookbackHours?: number;
}

/**
 * Pulls every mapped statistic for the window and writes it into
 * `interval_metrics`. Re-running over the same window is deliberately safe:
 * rows upsert on (site, ts, metric), so a re-sync corrects late-arriving or
 * revised statistics instead of duplicating them.
 *
 * Mixing granularities across runs is safe in one direction only. An hourly
 * row sits at :00, which is also the first quarter of that hour, so a later
 * quarter-hour sync overwrites it and adds :15/:30/:45 — the hour still totals
 * correctly. Going the other way would leave the :15/:30/:45 rows behind and
 * double-count, so an hourly backfill clears the window first.
 */
export async function syncHomeAssistant(
  siteId: string,
  options: SyncOptions = {},
): Promise<HaSyncResult> {
  const granularity = options.granularity ?? "quarter_hour";
  const to = options.to ?? new Date();
  // A raw "now minus N hours" start would leave the oldest day of every
  // scheduled run permanently half-covered, since nothing ever re-reads
  // earlier than the window start. Extending back to a whole UTC day, plus a
  // day of slack, makes each run cover whole *local* days whatever the site's
  // offset from UTC — so re-running always completes a day rather than
  // freezing a partial one.
  const from = options.from ?? startOfDayBefore(to, options.lookbackHours ?? 48);

  const mappings = (await listMappings(siteId)).filter((m) => m.enabled);
  const skipped: string[] = [];
  if (mappings.length === 0) {
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      metrics: [],
      inserted: 0,
      updated: 0,
      skipped: ["No Home Assistant entities are mapped for this site."],
    };
  }

  const byStatisticId = new Map(mappings.map((m) => [m.statisticId, m]));
  const stats = await fetchStatistics(
    [...byStatisticId.keys()],
    from,
    to,
    PERIOD_BY_GRANULARITY[granularity],
  );

  const toWrite: UpsertRow[] = [];
  const metrics: HaSyncResult["metrics"] = [];

  for (const mapping of mappings) {
    const buckets = stats.get(mapping.statisticId);
    if (!buckets || buckets.length === 0) {
      skipped.push(`${mapping.statisticId}: no statistics in this window`);
      metrics.push({ metricKind: mapping.metricKind, statisticId: mapping.statisticId, rows: 0 });
      continue;
    }
    const { rows, negatives } = aggregateBuckets(buckets, granularity);
    if (negatives > 0) {
      skipped.push(`${mapping.statisticId}: dropped ${negatives} negative bucket(s)`);
    }
    for (const r of rows) {
      toWrite.push({ ts: r.ts, metricKind: mapping.metricKind, valueKwh: r.valueKwh });
    }
    metrics.push({
      metricKind: mapping.metricKind,
      statisticId: mapping.statisticId,
      rows: rows.length,
    });
  }

  // See the note above: hourly rows must not be laid over finer ones.
  if (granularity === "hour" && toWrite.length > 0) {
    const kinds = [...new Set(mappings.map((m) => m.metricKind))];
    await db
      .delete(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          gte(intervalMetrics.ts, from),
          lt(intervalMetrics.ts, to),
          inArray(intervalMetrics.metricKind, kinds),
          isNull(intervalMetrics.partyId),
        ),
      );
  }

  // Raw metrics first: the split reads them back out of the database, so it has
  // to run *after* they land. Deriving first silently reads the previous
  // sync's state — pv_dc missing for the newest hours, those intervals skipped,
  // and any stale `production` left in place reading as pure solar at midnight.
  const raw = await upsertMetricRows(siteId, toWrite);

  // `production` and `battery_discharge_ac` are not synced — they are the two
  // halves of the inverter's AC output, and the inverter reports only the
  // total. Derive them from the raw metrics just written, so freshly synced
  // data is split the same way the historical backfill was.
  const derived = await deriveSplitRows(siteId, from, to);
  const split = await upsertMetricRows(siteId, derived);
  const inserted = raw.inserted + split.inserted;
  const updated = raw.updated + split.updated;
  if (derived.length > 0) {
    metrics.push({ metricKind: "production", statisticId: "(derived: PV share of AC)", rows: derived.length / 2 });
    metrics.push({ metricKind: "battery_discharge_ac", statisticId: "(derived: battery share of AC)", rows: derived.length / 2 });
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    metrics,
    inserted,
    updated,
    skipped,
  };
}


/**
 * Splits inverter AC output into its PV and battery halves for every interval
 * in the window, reading back the raw metrics just written.
 *
 * The ratio is taken per hour, because `pv_dc` only exists hourly (Home
 * Assistant keeps 5-minute statistics for about 10 days but hourly ones
 * indefinitely), and then applied to each interval inside that hour so
 * sub-hour shape survives. The battery's share is additionally capped at the
 * DC that interval actually discharged: conversion only loses energy, so it
 * can never deliver more AC than it gave up, and that bound binds per interval
 * rather than merely across the hour.
 */
async function deriveSplitRows(siteId: string, from: Date, to: Date): Promise<UpsertRow[]> {
  const hours = await db
    .select({
      h: sql<string>`date_trunc('hour', ${intervalMetrics.ts})`,
      ac: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'inverter_ac'), 0)::float8`,
      pv: sql<number | null>`sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'pv_dc')::float8`,
      chg: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)::float8`,
      dis: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_discharge'), 0)::float8`,
    })
    .from(intervalMetrics)
    .where(and(eq(intervalMetrics.siteId, siteId), gte(intervalMetrics.ts, from), lt(intervalMetrics.ts, to)))
    .groupBy(sql`date_trunc('hour', ${intervalMetrics.ts})`);

  const ratioByHour = new Map<number, number>();
  for (const h of hours) {
    if (h.pv == null) continue; // no PV figure for this hour: nothing to split by
    const { productionKwh } = splitInverterOutput({
      inverterAcKwh: h.ac,
      pvDcKwh: h.pv,
      batteryChargeKwh: h.chg,
      batteryDischargeKwh: h.dis,
    });
    ratioByHour.set(new Date(h.h).getTime(), h.ac > 0 ? productionKwh / h.ac : 0);
  }
  if (ratioByHour.size === 0) return [];

  const intervals = await db
    .select({
      ts: intervalMetrics.ts,
      ac: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'inverter_ac'), 0)::float8`,
      dis: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_discharge'), 0)::float8`,
    })
    .from(intervalMetrics)
    .where(and(eq(intervalMetrics.siteId, siteId), gte(intervalMetrics.ts, from), lt(intervalMetrics.ts, to)))
    .groupBy(intervalMetrics.ts);

  const rows: UpsertRow[] = [];
  for (const i of intervals) {
    const hourKey = new Date(i.ts);
    hourKey.setUTCMinutes(0, 0, 0);
    const ratio = ratioByHour.get(hourKey.getTime());
    if (ratio === undefined) continue;

    let production = i.ac * ratio;
    if (i.ac - production > i.dis) production = i.ac - i.dis;
    production = Math.max(production, 0);

    rows.push({ ts: i.ts, metricKind: "production", valueKwh: Number(production.toFixed(4)) });
    rows.push({ ts: i.ts, metricKind: "battery_discharge_ac", valueKwh: Number((i.ac - production).toFixed(4)) });
  }
  return rows;
}
