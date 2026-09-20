import type { HourKwh } from "@energy-manager/shared";

/**
 * Pure bucketing for the participants' "today, hour by hour" chart — no DB,
 * no network, so the hour arithmetic can be tested without either.
 *
 * Home Assistant's solar forecast comes as `wh_hours`: a map from a
 * period's start (ISO, UTC) to the watt-hours expected in it. Most periods
 * are whole hours; the first and last of a day are the stubs from sunrise
 * and to sunset, so a day is not simply 24 keys. Everything is folded onto
 * the local hour it starts in, and summed — two stubs in one hour add up.
 */

export const SITE_TZ = "Europe/Zurich";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** `{ day: "YYYY-MM-DD", hour: 0-23 }` in the site's zone, for any instant. */
export function localDayHour(instant: Date): { day: string; hour: number } {
  const p = Object.fromEntries(parts.formatToParts(instant).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Today's date in the site's zone. */
export function localToday(now: Date = new Date()): string {
  return localDayHour(now).day;
}

/**
 * The forecast for one local day, one entry per hour that has any, in kWh,
 * sorted. Hours the feed says nothing about (night) are simply absent — the
 * chart draws the gap as zero, which is what the feed means by silence.
 */
export function forecastForDay(whHours: Record<string, number>, day: string): HourKwh[] {
  const byHour = new Map<number, number>();
  for (const [iso, wh] of Object.entries(whHours)) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !Number.isFinite(wh)) continue;
    const local = localDayHour(at);
    if (local.day !== day) continue;
    byHour.set(local.hour, (byHour.get(local.hour) ?? 0) + wh / 1000);
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, kwh]) => ({ hour, kwh: Number(kwh.toFixed(3)) }));
}

/**
 * Sums several forecast sources (one per Home Assistant config entry — a
 * second roof, a second inverter) into one `wh_hours` map before bucketing.
 */
export function mergeForecastSources(sources: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const source of sources) {
    for (const [iso, wh] of Object.entries(source)) merged[iso] = (merged[iso] ?? 0) + wh;
  }
  return merged;
}
