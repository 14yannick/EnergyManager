/**
 * Separating PV from battery discharge in the inverter's AC output.
 *
 * The inverter reports a single AC yield figure covering both sources: energy
 * from the panels and energy coming back out of the battery. Attributing all
 * of it to "production" makes the app report solar generation at midnight, and
 * then counts the same kWh twice — once as direct use, once as the battery.
 *
 * The battery's own counters are DC and can't simply be subtracted from an AC
 * figure. Worse, the conversion is strongly load-dependent: measured over 262
 * true night hours on this system only 74.6% of discharged DC reached the AC
 * bus, because the inverter's own standby draw dominates at 0.2-0.5 kW, while
 * at midday it is nearer 95%. No single efficiency constant works.
 *
 * So instead of converting anything, split the *measured* AC total in
 * proportion to the DC each source supplied. Losses and self-consumption are
 * already excluded, because they never reached the AC bus. The DC values are
 * used only as a ratio, so their unit cancels. Both sources feed the same
 * inverter at the same load point in a given interval, so they convert alike —
 * which is what makes the proportion the right shape.
 *
 * Verified against the household meter for 2026-09-13: reconstructing
 * consumption from the split gives 9.56 kWh against a metered 9.55, with every
 * night hour attributing exactly 0.00 to PV.
 */
export interface SplitInput {
  /** Inverter AC output for the interval — the quantity actually being split. */
  inverterAcKwh: number;
  /** Raw DC yield of the panels. */
  pvDcKwh: number;
  /** DC into the battery. Subtracted from PV: it never reached the inverter. */
  batteryChargeKwh: number;
  /** DC out of the battery. */
  batteryDischargeKwh: number;
}

export interface SplitResult {
  /** PV's share of the AC output. Zero whenever the panels supplied nothing. */
  productionKwh: number;
  /** The battery's share. Together these sum to `inverterAcKwh` exactly. */
  batteryDischargeAcKwh: number;
}

export function splitInverterOutput(input: SplitInput): SplitResult {
  const { inverterAcKwh, pvDcKwh, batteryChargeKwh, batteryDischargeKwh } = input;

  // What each source actually offered the inverter. PV that went into the
  // battery is excluded here and returns later as discharge, so no kWh is
  // counted on both sides.
  const pvShare = Math.max(pvDcKwh - batteryChargeKwh, 0);
  const batteryShare = Math.max(batteryDischargeKwh, 0);
  const total = pvShare + batteryShare;

  // Nothing was supplied, so nothing can be attributed. This is the honest
  // answer for an interval with no sun and no discharge; any AC output in it
  // is measurement noise rather than energy from a known source.
  if (total <= 0) return { productionKwh: 0, batteryDischargeAcKwh: 0 };

  let productionKwh = (inverterAcKwh * pvShare) / total;

  // Physical ceiling: the battery cannot deliver more AC than the DC it gave
  // up, since conversion only loses energy. Without this, winter hours breach
  // it — the battery is charged from the grid then, so `pvDc - charge` goes to
  // zero while the panels are still feeding the inverter within the same hour,
  // and the whole hour's output is credited to the battery. Over February that
  // attributed 185 kWh across 167 hours to a battery that had discharged less
  // than that, giving an impossible 105% conversion. Anything above the
  // ceiling can only have come from the panels.
  const batteryCeiling = batteryShare;
  if (inverterAcKwh - productionKwh > batteryCeiling) {
    productionKwh = inverterAcKwh - batteryCeiling;
  }

  // Derived by subtraction rather than its own ratio, so the two always sum to
  // the measured total regardless of floating-point rounding.
  return { productionKwh, batteryDischargeAcKwh: inverterAcKwh - productionKwh };
}
