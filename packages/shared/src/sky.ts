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
  /** The local hour (0–23), for the clock fallback when there is no sun sensor. */
  hour: number;
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

/** By day with no PV figure, the sun as it was: the mark must not read as a forecast it cannot make. */
export function skyFor(input: SkyInput): Sky {
  const phase = input.sun ? phaseFromSun(input.sun) : phaseFromClock(input.hour);
  if (phase !== "day") return phase;
  if (input.pvW == null) return "clear";
  const kw = input.pvW / 1000;
  if (kw >= CLEAR_FROM_KW) return "clear";
  if (kw >= PARTLY_FROM_KW) return "partly";
  if (kw >= CLOUDY_FROM_KW) return "cloudy";
  return "snow";
}
