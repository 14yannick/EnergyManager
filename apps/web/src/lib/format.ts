/**
 * The app's numeric display, in one place: grouped in thousands, always
 * with a period as the decimal mark, whichever of the three interface
 * languages is active.
 *
 * Switzerland's own convention — apostrophe thousands, period decimals —
 * already holds for German and English; only French differs, and only on
 * the decimal mark (`Intl.NumberFormat("fr-CH", …)` gives "4'617,3", comma
 * not period). Money and energy figures are read the same way regardless
 * of which language the interface happens to be in, so this pins every
 * figure to the de-CH pattern rather than following the interface
 * language — a reader switching to French should not see numbers reshape
 * under them.
 */
const GROUPED_TAG = "de-CH";

function grouped(value: number, digits: number): string {
  return new Intl.NumberFormat(GROUPED_TAG, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** A plain number, grouped, to a fixed number of decimals (0 by default). */
export function formatNumber(value: number, digits = 0): string {
  return grouped(value, digits);
}

/** A money amount — always two decimals. Caller adds its own "CHF" text. */
export function formatChf(value: number): string {
  return grouped(value, 2);
}

/**
 * An energy figure, to a fixed number of decimals (1 by default). Caller
 * adds its own unit text.
 */
export function formatKwh(value: number, digits = 1): string {
  return grouped(value, digits);
}

/**
 * The threshold several kWh displays already used ad hoc: a whole number
 * once a figure is into the hundreds, where a decimal adds no useful
 * precision and only a summed total ever reaches it; a tenth below that,
 * where the fraction is the only variation between two readings.
 */
export function formatKwhAuto(value: number): string {
  return grouped(value, Math.abs(value) >= 100 ? 0 : 1);
}
