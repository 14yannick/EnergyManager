import type { HaBucket } from "./haClient.js";

/**
 * Pure bucket arithmetic — no DB or network, so it can be tested directly
 * (same split as savings/engine.ts vs savings/service.ts).
 */

export interface AggregatedRow {
  ts: Date;
  valueKwh: number;
}

/** Floors a timestamp to the start of its 15-minute slot. */
function floorToQuarter(d: Date): Date {
  const quarter = 15 * 60 * 1000;
  return new Date(d.getTime() - (d.getTime() % quarter));
}

/**
 * Turns Home Assistant buckets into rows at the target granularity. For
 * quarter-hours that means summing the three 5-minute buckets that fall in
 * each slot; hourly buckets already map one-to-one.
 *
 * Buckets with no data are dropped rather than written as zero — a gap in the
 * recorder is not the same statement as "no energy flowed". Negative deltas
 * are dropped and counted: energy flows don't run backwards, so a negative
 * reading is a recorder artefact that would otherwise deflate a sum.
 */
export function aggregateBuckets(
  buckets: HaBucket[],
  granularity: "quarter_hour" | "hour",
): { rows: AggregatedRow[]; negatives: number } {
  const byTs = new Map<number, number>();
  let negatives = 0;

  for (const bucket of buckets) {
    if (bucket.change === null || !Number.isFinite(bucket.change)) continue;
    if (bucket.change < 0) {
      negatives++;
      continue;
    }
    const slot = granularity === "quarter_hour" ? floorToQuarter(bucket.start) : bucket.start;
    const key = slot.getTime();
    byTs.set(key, (byTs.get(key) ?? 0) + bucket.change);
  }

  const rows = [...byTs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, valueKwh]) => ({ ts: new Date(ms), valueKwh }));
  return { rows, negatives };
}

/**
 * A raw "now minus N hours" start would leave the oldest day of every
 * scheduled run permanently half-covered, since nothing re-reads earlier than
 * the window start. Extending back to a whole UTC day plus a day of slack
 * makes each run cover whole *local* days whatever the site's offset from UTC,
 * so re-running completes a day rather than freezing a partial one.
 */
export function startOfDayBefore(to: Date, lookbackHours: number): Date {
  const start = new Date(to.getTime() - lookbackHours * 60 * 60 * 1000);
  start.setUTCHours(0, 0, 0, 0);
  return new Date(start.getTime() - 24 * 60 * 60 * 1000);
}
