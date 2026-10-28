/**
 * What the brand mark shows: the sky as the installation sees it.
 *
 * A moon at night, the sun on the horizon at dawn and dusk — behind a cloud
 * when the panels make well under what they did at that moment on their
 * best recent day — and by day the
 * sun as strong as the panels say it is — full when they are near what
 * this roof makes at this hour on a clear day, behind a small cloud, or
 * behind a cloud. Decided here, away from any component, so the thresholds
 * are one list and tested.
 */

export type Sky = "night" | "dawn" | "dawnCloudy" | "dusk" | "duskCloudy" | "clear" | "partly" | "cloudy" | "snow";

export interface SkyInput {
  /** The sun's elevation above the horizon in degrees, and whether it is on its way up. Null without a sun sensor. */
  sun: { elevation: number; rising: boolean } | null;
  /** PV output right now, in watts. Null without a live PV sensor. */
  pvW: number | null;
  /** The local hour (0–23): which hour of the forecast is now, and the clock fallback when there is no sun sensor. */
  hour: number;
  /**
   * Today's expected output per local hour, when a forecast exists. This is
   * what says where the roof's own ramp is: the forecast already knows the
   * hills, the pitch and the season, which the sun's bare elevation does
   * not — here the evening ramp begins with the sun still 20° up.
   */
  forecast?: ReadonlyArray<{ hour: number; kwh: number }> | null;
  /**
   * What this roof made at this time of day on its best recent day, in
   * watts: the clear sky as the panels know it, for this season, this hour
   * and this roof's shading. The day is graded as a share of it. Null
   * without the history to say — the fixed thresholds below stand in.
   */
  pvReferenceW?: number | null;
}

/**
 * Civil twilight is the sun between -6° and 0°; the mark keeps the sun on
 * the horizon well past that, up to 10°, because the panels' ramp is what
 * the mark is about and it runs long: the sun clears the hills and the
 * roof's pitch late, so output is still climbing at 6°. Not further —
 * here the winter noon sun stands at about 20°, and a wider band would
 * call a December morning "sunrise" until eleven. Below -6° it is night
 * by any definition.
 */
const NIGHT_BELOW_DEG = -6;
const TWILIGHT_BELOW_DEG = 10;

/**
 * With a forecast, dawn and dusk are the hours the roof is expected to make
 * less than a share of its best hour today: the ramp up and the ramp down.
 *
 * The share follows the length of the day. On a long one the ramps are long
 * too, and half the peak marks them: on the September day this was set,
 * 17:00 stood at 43% and 18:00 at 24%, 09:00 at 34% and 10:00 at 64%. On a
 * short one the same half would put the sun on the horizon for most of the
 * day — a late-October day of ten productive hours spends four of them under
 * half its peak — so the share narrows as the day does, down to a fifth on a
 * winter day of eight hours, where only the first and last hour remain.
 */
export const RAMP_BELOW_LONG_DAY = 0.5;
export const RAMP_BELOW_SHORT_DAY = 0.2;
/** Productive hours from which the day counts as long, and up to which as short. */
export const LONG_DAY_HOURS = 12;
export const SHORT_DAY_HOURS = 8;
/** An hour counts as productive from this share of the peak: a trace at dawn is not a day yet. */
const PRODUCTIVE_FROM = 0.02;

/** The ramp's share for a day of this many productive hours, straight between the two ends. */
export function rampShareFor(productiveHours: number): number {
  const t = (productiveHours - SHORT_DAY_HOURS) / (LONG_DAY_HOURS - SHORT_DAY_HOURS);
  const clamped = Math.min(Math.max(t, 0), 1);
  return RAMP_BELOW_SHORT_DAY + clamped * (RAMP_BELOW_LONG_DAY - RAMP_BELOW_SHORT_DAY);
}

/**
 * Graded against the roof's best recent output at this time of day: full
 * sun from three quarters of it, a small cloud from under a half, overcast
 * below that. A thin cloud already takes a quarter off; a broken sky swings
 * between the two upper bands; a closed one rarely passes 15 %.
 */
export const CLEAR_FROM_SHARE = 0.75;
export const PARTLY_FROM_SHARE = 0.45;
/**
 * Below this the reference itself is too small to grade against — the
 * roof's shade, or an hour the sun barely reaches it — and a few hundred
 * watts either way would swing the icon from sun to cloud.
 */
export const MIN_REFERENCE_W = 500;

/**
 * Without a reference — no history yet, or no PV statistic to read it
 * from — fixed figures for this roof stand in: full sun from 7 kW, a small
 * cloud from 5, overcast from 1, and below that snow on the panels or a sky
 * as good as. They suit a summer noon and nothing else, which is why the
 * reference replaces them wherever it can.
 */
export const CLEAR_FROM_KW = 7;
export const PARTLY_FROM_KW = 5;
export const CLOUDY_FROM_KW = 1;

/** Without a sun sensor, the clock stands in: night from 21 to 6, the edges of that as dawn and dusk. */
function phaseFromClock(hour: number): "night" | "dawn" | "dusk" | "day" {
  if (hour < 6 || hour >= 21) return "night";
  if (hour < 8) return "dawn";
  if (hour >= 19) return "dusk";
  return "day";
}

function phaseFromSun(sun: { elevation: number; rising: boolean }): "night" | "dawn" | "dusk" | "day" {
  if (sun.elevation < NIGHT_BELOW_DEG) return "night";
  if (sun.elevation < TWILIGHT_BELOW_DEG) return sun.rising ? "dawn" : "dusk";
  return "day";
}

/**
 * The ramp, read off the forecast: dawn while the expected output is still
 * climbing towards the day's peak and below the day's ramp share of it
 * (see rampShareFor), dusk once it has fallen back under. Null when there
 * is no forecast to read, or nothing expected at all today.
 */
function phaseFromForecast(input: SkyInput): "dawn" | "dusk" | "day" | null {
  const forecast = input.forecast;
  if (!forecast || forecast.length === 0) return null;
  let peak = 0;
  let peakHour = input.hour;
  for (const p of forecast) {
    if (p.kwh > peak) {
      peak = p.kwh;
      peakHour = p.hour;
    }
  }
  if (peak <= 0) return null;
  const productiveHours = forecast.filter((p) => p.kwh >= PRODUCTIVE_FROM * peak).length;
  const now = forecast.find((p) => p.hour === input.hour)?.kwh ?? 0;
  if (now >= rampShareFor(productiveHours) * peak) return "day";
  // Which side of the peak: the sun sensor knows; failing that, the clock.
  const rising = input.sun ? input.sun.rising : input.hour <= peakHour;
  return rising ? "dawn" : "dusk";
}

/** By day with no PV figure, the sun as it was: the mark must not read as a forecast it cannot make. */
export function skyFor(input: SkyInput): Sky {
  const base = input.sun ? phaseFromSun(input.sun) : phaseFromClock(input.hour);
  if (base === "night") return "night";
  const phase = phaseFromForecast(input) ?? base;
  if (phase !== "day") {
    // The ramp graded like the day, against the same reference: a sunrise
    // the panels barely notice is a cloudy one. Only where there is a
    // reference big enough to grade against — the first minutes of the
    // ramp have none, and say nothing worse than the sun.
    const reference = input.pvReferenceW;
    const dull =
      input.pvW != null && reference != null && reference >= MIN_REFERENCE_W && input.pvW / reference < PARTLY_FROM_SHARE;
    if (!dull) return phase;
    return phase === "dawn" ? "dawnCloudy" : "duskCloudy";
  }
  if (input.pvW == null) return "clear";
  const reference = input.pvReferenceW;
  if (reference != null) {
    // Too little to grade against: say nothing worse than the sun.
    if (reference < MIN_REFERENCE_W) return "clear";
    const share = input.pvW / reference;
    if (share >= CLEAR_FROM_SHARE) return "clear";
    if (share >= PARTLY_FROM_SHARE) return "partly";
    // A dull sky, whatever it is doing: output alone cannot tell rain from
    // snow from fog, so it does not try.
    return "cloudy";
  }
  const kw = input.pvW / 1000;
  if (kw >= CLEAR_FROM_KW) return "clear";
  if (kw >= PARTLY_FROM_KW) return "partly";
  if (kw >= CLOUDY_FROM_KW) return "cloudy";
  return "snow";
}
