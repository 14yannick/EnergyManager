/**
 * Whether a sensor's unit is the one every rate in this app is stored in.
 *
 * `dynamic_tariff_rates.rate_chf_per_kwh` is CHF per kWh by name, so a value
 * written into it in anything else is silently wrong by a factor of a
 * thousand or a currency — the two mistakes a day-ahead feed most naturally
 * makes, since the public sources publish EUR/MWh. The sensor says what it
 * publishes; this is the check that it matches before a single row lands.
 *
 * Lenient only about spelling: case, whitespace and "kWh" vs "kwh". Strict
 * about everything else. A missing unit is the caller's decision, not a
 * match — see `syncSite`.
 */
export function isChfPerKwh(unit: string): boolean {
  return unit.replace(/\s+/g, "").toLowerCase() === "chf/kwh";
}

export const EXPECTED_UNIT = "CHF/kWh";
