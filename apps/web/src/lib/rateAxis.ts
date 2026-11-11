/**
 * The feed-in rate's axis, shared by every chart that draws the rate: a
 * fixed window from 0 to 25 ct. in 5-ct. steps, so the same rate reads at
 * the same height day after day and chart after chart. Only a rate outside
 * the window moves an end, and only to the next step.
 */
export const RATE_AXIS_MAX = 0.25;
export const RATE_AXIS_STEP = 0.05;

/**
 * The rate axis's ticks: every 5 ct. from 0 to 25, and beyond either end
 * only as far as the rates reach, rounded out to the next step so the axis
 * still ends on a tick.
 */
export function rateAxisTicks(rates: number[]): number[] {
  const low = Math.min(0, ...rates);
  const high = Math.max(RATE_AXIS_MAX, ...rates);
  const first = Math.floor(low / RATE_AXIS_STEP + 1e-9) * RATE_AXIS_STEP;
  const last = Math.ceil(high / RATE_AXIS_STEP - 1e-9) * RATE_AXIS_STEP;
  const ticks: number[] = [];
  for (let v = first; v <= last + 1e-9; v += RATE_AXIS_STEP) ticks.push(Number(v.toFixed(2)));
  return ticks;
}
