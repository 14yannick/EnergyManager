import { splitInverterOutput } from "./split.js";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  PARTY_SENSOR_SPECS,
  SENSOR_SOURCE,
  type HaDynamicTariffCandidate,
  type HaStatisticOption,
  type HaSyncResult,
  type IntervalMetricKind,
} from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics } from "../../db/schema/index.js";
import { isSensorReading } from "../../lib/readingSource.js";
import { activeSensors } from "../partySensors/service.js";
import {
  fetchStatistics,
  listEnergyStatistics,
  listHaDynamicTariffEntities as fetchDynamicTariffEntities,
  type HaPeriod,
} from "./haClient.js";
import { aggregateBuckets, startOfDayBefore } from "./buckets.js";

/** What the sync stamps on its rows — and the mark of a reading it may later revise. */
export const HA_SOURCE = SENSOR_SOURCE;

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

export async function listHaStatistics(): Promise<HaStatisticOption[]> {
  return listEnergyStatistics();
}

/** Live entities shaped like a price-forecast sensor — for the dynamic-tariff mapping row. */
export async function listHaDynamicTariffEntities(): Promise<HaDynamicTariffCandidate[]> {
  return fetchDynamicTariffEntities();
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

/**
 * Writes one participant's rows. Every synced reading belongs to the
 * participant whose sensor reported it — two producers on a site each keep
 * their own production, export and battery, and nothing is summed away.
 *
 * A sensor's reading is provisional. It is always recorded as the sensor's
 * (`sensorValueKwh`), and it is the value that counts only while nothing
 * better exists: once the grid provider's data holds the interval, that
 * takes precedence and this leaves `valueKwh` and `source` as they are (see
 * isSensorSource). Those rows are counted as `kept`, so a sync can say the
 * official figure stood rather than seem to have changed nothing.
 */
async function upsertMetricRows(
  siteId: string,
  partyId: string,
  rows: UpsertRow[],
): Promise<{ inserted: number; updated: number; kept: number }> {
  let inserted = 0;
  let updated = 0;
  let kept = 0;
  for (const batch of chunk(rows, 500)) {
    const result = await db
      .insert(intervalMetrics)
      .values(
        batch.map((r) => ({
          siteId,
          ts: r.ts,
          metricKind: r.metricKind,
          partyId,
          valueKwh: r.valueKwh.toFixed(4),
          sensorValueKwh: r.valueKwh.toFixed(4),
          source: HA_SOURCE,
        })),
      )
      .onConflictDoUpdate({
        target: [intervalMetrics.siteId, intervalMetrics.ts, intervalMetrics.metricKind, intervalMetrics.partyId],
        targetWhere: sql`${intervalMetrics.partyId} IS NOT NULL`,
        set: {
          // The sensor's own figure, whatever else the row holds.
          sensorValueKwh: sql`excluded.sensor_value_kwh`,
          // The value that counts, only where a sensor's still is it.
          valueKwh: sql`case when ${isSensorReading} then excluded.value_kwh else ${intervalMetrics.valueKwh} end`,
          source: sql`case when ${isSensorReading} then excluded.source else ${intervalMetrics.source} end`,
        },
      })
      // Read after the write: an official row kept its source, so it still
      // is not a sensor's — which is exactly the rows whose value stood.
      .returning({ wasInsert: sql<boolean>`(xmax = 0)`, official: sql<boolean>`not ${isSensorReading}` });
    for (const r of result) {
      if (r.wasInsert) inserted++;
      else if (r.official) kept++;
      else updated++;
    }
  }
  return { inserted, updated, kept };
}

export interface SyncOptions {
  from?: Date;
  to?: Date;
  granularity?: "quarter_hour" | "hour";
  lookbackHours?: number;
}

/**
 * Pulls every participant's mapped counter for the window and writes it into
 * `interval_metrics` under that participant. Re-running over the same window
 * is deliberately safe: rows upsert on (site, ts, metric, participant), so a
 * re-sync corrects late-arriving or
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

  // The energy counters of every participant on the site — whoever may
  // have one (see activeSensors). One Home Assistant call covers them all.
  const sensors = await activeSensors(siteId, "stored");
  const skipped: string[] = [];
  if (sensors.length === 0) {
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      metrics: [],
      inserted: 0,
      updated: 0,
      skipped: ["No Home Assistant sensors are mapped for this site's participants."],
    };
  }

  const stats = await fetchStatistics(
    [...new Set(sensors.map((s) => s.entityId))],
    from,
    to,
    PERIOD_BY_GRANULARITY[granularity],
  );

  const metrics: HaSyncResult["metrics"] = [];
  const byParty = new Map<string, { rows: UpsertRow[]; kinds: Set<IntervalMetricKind> }>();

  for (const sensor of sensors) {
    const metricKinds = PARTY_SENSOR_SPECS[sensor.kind].metricKinds;
    const party = byParty.get(sensor.partyId) ?? { rows: [], kinds: new Set<IntervalMetricKind>() };
    byParty.set(sensor.partyId, party);
    // Named with its participant: two of them can map the same kind.
    const label = `${sensor.entityId} (${sensor.partyName})`;
    const buckets = stats.get(sensor.entityId);
    if (!buckets || buckets.length === 0) {
      skipped.push(`${label}: no statistics in this window`);
      for (const metricKind of metricKinds) metrics.push({ metricKind, statisticId: label, rows: 0 });
      continue;
    }
    const { rows, negatives } = aggregateBuckets(buckets, granularity);
    if (negatives > 0) {
      skipped.push(`${label}: dropped ${negatives} negative bucket(s)`);
    }
    // One counter can feed more than one metric — the export, as what left
    // the house and as what reached the grid (see PARTY_SENSOR_SPECS).
    for (const metricKind of metricKinds) {
      party.kinds.add(metricKind);
      for (const row of rows) party.rows.push({ ts: row.ts, metricKind, valueKwh: row.valueKwh });
      metrics.push({ metricKind, statisticId: label, rows: rows.length });
    }
  }

  let inserted = 0;
  let updated = 0;
  let kept = 0;
  let derivedRows = 0;
  for (const [partyId, { rows, kinds }] of byParty) {
    // See the note above: hourly rows must not be laid over finer ones.
    if (granularity === "hour" && rows.length > 0) {
      await db
        .delete(intervalMetrics)
        .where(
          and(
            eq(intervalMetrics.siteId, siteId),
            eq(intervalMetrics.partyId, partyId),
            gte(intervalMetrics.ts, from),
            lt(intervalMetrics.ts, to),
            inArray(intervalMetrics.metricKind, [...kinds]),
            // Only where a sensor's figure is the one that counts: a row
            // the provider's data holds is not this sync's to clear, at any
            // granularity.
            isSensorReading,
          ),
        );
    }

    // Raw metrics first: the split reads them back out of the database, so it
    // has to run *after* they land. Deriving first silently reads the previous
    // sync's state — pv_dc missing for the newest hours, those intervals
    // skipped, and any stale `production` left in place reading as pure solar
    // at midnight.
    const raw = await upsertMetricRows(siteId, partyId, rows);

    // `production` and `battery_discharge_ac` are not synced — they are the
    // two halves of the inverter's AC output, and the inverter reports only
    // the total. Derive them from the raw metrics just written, per
    // participant: each plant has its own inverter and its own split.
    const derived = await deriveSplitRows(siteId, partyId, from, to);
    const split = await upsertMetricRows(siteId, partyId, derived);
    inserted += raw.inserted + split.inserted;
    updated += raw.updated + split.updated;
    kept += raw.kept + split.kept;
    derivedRows += derived.length;
  }
  if (kept > 0) {
    skipped.push(`${kept} reading(s) recorded beside the grid provider's data, which takes precedence for them`);
  }
  if (derivedRows > 0) {
    metrics.push({ metricKind: "production", statisticId: "(derived: PV share of AC)", rows: derivedRows / 2 });
    metrics.push({ metricKind: "battery_discharge_ac", statisticId: "(derived: battery share of AC)", rows: derivedRows / 2 });
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
 * Splits one participant's inverter AC output into its PV and battery halves
 * for every interval in the window, reading back the raw metrics just written.
 *
 * The ratio is taken per hour, because `pv_dc` only exists hourly (Home
 * Assistant keeps 5-minute statistics for about 10 days but hourly ones
 * indefinitely), and then applied to each interval inside that hour so
 * sub-hour shape survives. The battery's share is additionally capped at the
 * DC that interval actually discharged: conversion only loses energy, so it
 * can never deliver more AC than it gave up, and that bound binds per interval
 * rather than merely across the hour.
 */
async function deriveSplitRows(siteId: string, partyId: string, from: Date, to: Date): Promise<UpsertRow[]> {
  const hours = await db
    .select({
      h: sql<string>`date_trunc('hour', ${intervalMetrics.ts})`,
      ac: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'inverter_ac'), 0)::float8`,
      pv: sql<number | null>`sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'pv_dc')::float8`,
      chg: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)::float8`,
      dis: sql<number>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_discharge'), 0)::float8`,
    })
    .from(intervalMetrics)
    .where(
      and(
        eq(intervalMetrics.siteId, siteId),
        eq(intervalMetrics.partyId, partyId),
        gte(intervalMetrics.ts, from),
        lt(intervalMetrics.ts, to),
      ),
    )
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
    .where(
      and(
        eq(intervalMetrics.siteId, siteId),
        eq(intervalMetrics.partyId, partyId),
        gte(intervalMetrics.ts, from),
        lt(intervalMetrics.ts, to),
      ),
    )
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
