import { SITE_TZ } from "./forecastCurve.js";

/**
 * The clear sky as the panels know it: for each local hour, what they made
 * on average across that hour on their best day of the recent past. The
 * brand mark grades the current output against it (see shared/sky.ts), so
 * a clear December noon reads as clear though it is half a June one.
 *
 * Pure: the hourly means come in, the profile and the reading at an
 * instant come out. Fetching and caching are liveView's.
 */

/** The site's local hour (0–23) and minute of an instant. */
export function localHourMinute(instant: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute") };
}

/**
 * The best hourly mean at each local hour, over the buckets given — one
 * sensor's. Index 0–23; an hour nothing was recorded in is 0.
 */
export function bestByHour(buckets: ReadonlyArray<{ start: Date; mean: number }>): number[] {
  const best = new Array<number>(24).fill(0);
  for (const b of buckets) {
    const { hour } = localHourMinute(b.start);
    if (b.mean > best[hour]!) best[hour] = b.mean;
  }
  return best;
}

/**
 * The profile read at an instant. An hour's mean is what that hour averaged,
 * so it belongs at its middle: at 10:15 the reading lies a quarter of the
 * way from 9:30's mean to 10:30's, not on 10:30's. Without this the
 * reference would step up or down on the hour while the sky did nothing.
 */
export function referenceAt(profile: ReadonlyArray<number>, instant: Date): number {
  const { hour, minute } = localHourMinute(instant);
  const at = (h: number) => profile[(h + 24) % 24] ?? 0;
  if (minute < 30) {
    const w = (minute + 30) / 60;
    return at(hour - 1) * (1 - w) + at(hour) * w;
  }
  const w = (minute - 30) / 60;
  return at(hour) * (1 - w) + at(hour + 1) * w;
}
