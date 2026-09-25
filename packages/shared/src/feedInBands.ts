/**
 * How good a feed-in rate is, for colouring the rate line on the day
 * chart: a loss below zero, poor under 8 ct., fair under 14 ct., good
 * from there up, and best once it beats what the household pays to buy
 * — the point past which exporting a kWh earns more than using it saved.
 */

export type RateBand = "loss" | "poor" | "fair" | "good" | "best";

export const RATE_POOR_BELOW_CHF = 0.08;
export const RATE_FAIR_BELOW_CHF = 0.14;

export function rateBand(rateChfPerKwh: number, purchaseChfPerKwh: number | null): RateBand {
  if (rateChfPerKwh < 0) return "loss";
  if (rateChfPerKwh < RATE_POOR_BELOW_CHF) return "poor";
  if (rateChfPerKwh < RATE_FAIR_BELOW_CHF) return "fair";
  if (purchaseChfPerKwh != null && rateChfPerKwh >= purchaseChfPerKwh) return "best";
  return "good";
}

export interface RateGradientStop {
  /** 0 at the top of the line's own box (its highest value), 1 at the bottom. */
  offset: number;
  band: RateBand;
}

/**
 * A vertical gradient that paints a line by the band each of its heights
 * falls in — hard steps, two stops at every threshold the line crosses.
 * Offsets are fractions of the line's own vertical extent (an SVG
 * `objectBoundingBox` gradient), so the caller only needs the line's
 * lowest and highest value. A flat line is one band, top to bottom.
 */
export function rateGradientStops(
  min: number,
  max: number,
  purchaseChfPerKwh: number | null,
): RateGradientStop[] {
  const span = max - min;
  if (!(span > 0)) {
    const band = rateBand(max, purchaseChfPerKwh);
    return [
      { offset: 0, band },
      { offset: 1, band },
    ];
  }
  const offsetOf = (v: number) => Math.min(1, Math.max(0, (max - v) / span));
  const thresholds = [purchaseChfPerKwh, RATE_FAIR_BELOW_CHF, RATE_POOR_BELOW_CHF, 0]
    .filter((t): t is number => t != null)
    .sort((a, b) => b - a);
  const stops: RateGradientStop[] = [{ offset: 0, band: rateBand(max, purchaseChfPerKwh) }];
  for (const t of thresholds) {
    if (t <= min || t >= max) continue;
    const offset = offsetOf(t);
    // The band from the threshold up, then the band just under it.
    stops.push({ offset, band: rateBand(t, purchaseChfPerKwh) });
    stops.push({ offset, band: rateBand(t - 1e-9, purchaseChfPerKwh) });
  }
  stops.push({ offset: 1, band: rateBand(min, purchaseChfPerKwh) });
  return stops;
}
