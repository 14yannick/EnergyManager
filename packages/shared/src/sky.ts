/**
 * What the brand mark shows: the sky as the installation sees it.
 *
 * A moon at night, the sun on the horizon at dawn and dusk, and by day the
 * sun as strong as the panels say it is — full when they are near their
 * peak, behind a small cloud, behind a cloud, or a snow cloud when almost
 * nothing comes through. Decided here, away from any component, so the
 * thresholds are one list and tested.
 */

export type Sky = "night" | "dawn" | "dusk" | "clear" | "partly" | "cloudy" | "snow";

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
 * less than this share of its best hour today: the ramp up and the ramp
 * down, whatever the season. On the day this was set, 17:00 stood at 43%
 * and 18:00 at 24% of the peak, 09:00 at 34% and 10:00 at 64%.
 */
const RAMP_BELOW = 0.5;

/** Full sun from here up — a strong day for this roof, whose peak is a little over 8 kW. */
export const CLEAR_FROM_KW = 7;
/** A small cloud in front of the sun from here to CLEAR_FROM_KW. */
export const PARTLY_FROM_KW = 5;
/** Overcast from here to PARTLY_FROM_KW; below it, snow on the panels or a sky as good as. */
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
 * climbing towards the day's peak and below RAMP_BELOW of it, dusk once it
 * has fallen back under. Null when there is no forecast to read, or nothing
 * expected at all today.
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
  const now = forecast.find((p) => p.hour === input.hour)?.kwh ?? 0;
  if (now >= RAMP_BELOW * peak) return "day";
  // Which side of the peak: the sun sensor knows; failing that, the clock.
  const rising = input.sun ? input.sun.rising : input.hour <= peakHour;
  return rising ? "dawn" : "dusk";
}

/** By day with no PV figure, the sun as it was: the mark must not read as a forecast it cannot make. */
export function skyFor(input: SkyInput): Sky {
  const base = input.sun ? phaseFromSun(input.sun) : phaseFromClock(input.hour);
  if (base === "night") return "night";
  const phase = phaseFromForecast(input) ?? base;
  if (phase !== "day") return phase;
  if (input.pvW == null) return "clear";
  const kw = input.pvW / 1000;
  if (kw >= CLEAR_FROM_KW) return "clear";
  if (kw >= PARTLY_FROM_KW) return "partly";
  if (kw >= CLOUDY_FROM_KW) return "cloudy";
  return "snow";
}
