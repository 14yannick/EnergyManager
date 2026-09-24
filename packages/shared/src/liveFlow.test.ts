import { describe, expect, it } from "vitest";
import { allocateLivePower, type LivePowerReading } from "./liveFlow.js";

const reading = (r: Partial<LivePowerReading>): LivePowerReading => ({
  pvW: null,
  exportW: null,
  importW: null,
  batteryChargeW: null,
  batteryDischargeW: null,
  loadW: null,
  ...r,
});

describe("allocateLivePower", () => {
  // The allocation may move energy between sinks, never invent or lose it:
  // what each source's flows add up to is what its meter said.
  const conserves = (r: LivePowerReading) => {
    const f = allocateLivePower(r);
    expect(f.sunToHouse + f.sunToBattery + f.sunToGrid).toBeCloseTo(Math.max(r.pvW ?? 0, 0), 6);
    expect(f.batteryToHouse + f.batteryToGrid).toBeCloseTo(Math.max(r.batteryDischargeW ?? 0, 0), 6);
    expect(f.gridToHouse + f.gridToBattery).toBeCloseTo(Math.max(r.importW ?? 0, 0), 6);
    for (const v of Object.values(f)) expect(v).toBeGreaterThanOrEqual(0);
    return f;
  };

  it("at night, a battery covering the house and a little more sends the excess to the grid", () => {
    // The panel's own picture: 467 W out of the battery, 419 W of load.
    const f = conserves(reading({ pvW: 0, exportW: 48, batteryDischargeW: 467, loadW: 419 }));
    expect(f.batteryToGrid).toBeCloseTo(48, 6);
    expect(f.batteryToHouse).toBeCloseTo(419, 6);
    expect(f.houseW).toBe(419);
  });

  it("at night, the battery and the grid share the house", () => {
    const f = conserves(reading({ pvW: 0, importW: 59, batteryDischargeW: 376, loadW: 435 }));
    expect(f.batteryToHouse).toBeCloseTo(376, 6);
    expect(f.gridToHouse).toBeCloseTo(59, 6);
  });

  it("in sunshine, the sun charges the battery and exports before what the house keeps", () => {
    const f = conserves(reading({ pvW: 5000, exportW: 3000, batteryChargeW: 1500, loadW: 500 }));
    expect(f.sunToBattery).toBeCloseTo(1500, 6);
    expect(f.sunToGrid).toBeCloseTo(3000, 6);
    expect(f.sunToHouse).toBeCloseTo(500, 6);
  });

  it("charges the battery from the grid when the sun cannot", () => {
    const f = conserves(reading({ pvW: 0, importW: 2000, batteryChargeW: 1800, loadW: 200 }));
    expect(f.gridToBattery).toBeCloseTo(1800, 6);
    expect(f.gridToHouse).toBeCloseTo(200, 6);
  });

  it("derives the house's draw from its three sources when there is no load sensor", () => {
    const f = conserves(reading({ pvW: 800, importW: 100, batteryDischargeW: 50 }));
    expect(f.houseW).toBeCloseTo(950, 6);
  });

  it("reads nothing as nothing, and a negative reading as zero", () => {
    expect(allocateLivePower(reading({}))).toEqual({
      sunToHouse: 0, sunToBattery: 0, sunToGrid: 0, batteryToHouse: 0, batteryToGrid: 0, gridToHouse: 0, gridToBattery: 0, houseW: 0,
    });
    const f = conserves(reading({ pvW: -3, exportW: -20, importW: -1, batteryChargeW: -5, batteryDischargeW: -7, loadW: -9 }));
    expect(f.houseW).toBe(0);
  });
});
