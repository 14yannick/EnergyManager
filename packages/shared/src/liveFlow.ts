/**
 * The house's power flows at one instant, allocated from what the meters
 * report: PV output, the grid meter (one direction at a time), the battery
 * (likewise) and, if there is one, the load.
 *
 * The meters say how much each source made and each sink took, not who fed
 * whom; that is decided here, the way a home-energy panel decides it. The
 * sun charges the battery before anything else and the grid tops it up;
 * export is the sun's surplus first, and a battery discharging past the
 * load covers the rest; whatever remains of each source went to the house.
 * Every figure is clamped at zero, so a moment where the sensors disagree
 * by a few watts draws a small flow rather than a negative one.
 */

export interface LivePowerReading {
  pvW: number | null;
  exportW: number | null;
  importW: number | null;
  batteryChargeW: number | null;
  batteryDischargeW: number | null;
  loadW: number | null;
}

export interface LivePowerFlows {
  sunToHouse: number;
  sunToBattery: number;
  sunToGrid: number;
  batteryToHouse: number;
  batteryToGrid: number;
  gridToHouse: number;
  gridToBattery: number;
  /** What the house draws: the load sensor where there is one, else what the three sources deliver to it. */
  houseW: number;
}

export function allocateLivePower(r: LivePowerReading): LivePowerFlows {
  const pv = Math.max(r.pvW ?? 0, 0);
  const exp = Math.max(r.exportW ?? 0, 0);
  const imp = Math.max(r.importW ?? 0, 0);
  const charge = Math.max(r.batteryChargeW ?? 0, 0);
  const discharge = Math.max(r.batteryDischargeW ?? 0, 0);

  const sunToBattery = Math.min(charge, pv);
  const gridToBattery = Math.min(charge - sunToBattery, imp);
  const sunToGrid = Math.min(exp, pv - sunToBattery);
  const batteryToGrid = Math.min(exp - sunToGrid, discharge);
  const sunToHouse = Math.max(pv - sunToBattery - sunToGrid, 0);
  const batteryToHouse = Math.max(discharge - batteryToGrid, 0);
  const gridToHouse = Math.max(imp - gridToBattery, 0);
  const houseW = r.loadW != null ? Math.max(r.loadW, 0) : sunToHouse + batteryToHouse + gridToHouse;

  return { sunToHouse, sunToBattery, sunToGrid, batteryToHouse, batteryToGrid, gridToHouse, gridToBattery, houseW };
}
