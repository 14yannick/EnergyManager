import { describe, expect, it } from "vitest";
import { splitInverterOutput } from "./split.js";

describe("splitInverterOutput", () => {
  it("attributes nothing to PV at night, however much AC the inverter put out", () => {
    // Real 23:00 interval: the inverter reported 0.41 kWh with the sun down.
    const r = splitInverterOutput({
      inverterAcKwh: 0.41,
      pvDcKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0.51,
    });
    expect(r.productionKwh).toBe(0);
    expect(r.batteryDischargeAcKwh).toBeCloseTo(0.41, 10);
  });

  it("attributes everything to PV when the battery is idle", () => {
    const r = splitInverterOutput({
      inverterAcKwh: 8.91,
      pvDcKwh: 10.73,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
    });
    expect(r.productionKwh).toBeCloseTo(8.91, 10);
    expect(r.batteryDischargeAcKwh).toBe(0);
  });

  it("splits proportionally when both supply at once", () => {
    // Both sources well clear of the discharge ceiling, so the proportion
    // stands as computed.
    const r = splitInverterOutput({
      inverterAcKwh: 1.0,
      pvDcKwh: 0.6,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0.6,
    });
    expect(r.productionKwh).toBeCloseTo(0.5, 10);
    expect(r.batteryDischargeAcKwh).toBeCloseTo(0.5, 10);
  });

  it("caps a dusk hour at the energy the battery actually discharged", () => {
    // Real 15:00 interval. Proportionally the battery would take 2.11 x 0.09/0.75
    // = 0.25 kWh of AC, from 0.09 kWh of DC. The ceiling gives the excess to PV.
    const r = splitInverterOutput({
      inverterAcKwh: 2.11,
      pvDcKwh: 0.66,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0.09,
    });
    expect(r.batteryDischargeAcKwh).toBeCloseTo(0.09, 10);
    expect(r.productionKwh).toBeCloseTo(2.02, 10);
  });

  it("always sums back to the measured AC output", () => {
    for (const c of [
      { inverterAcKwh: 0.41, pvDcKwh: 0, batteryChargeKwh: 0, batteryDischargeKwh: 0.51 },
      { inverterAcKwh: 4.27, pvDcKwh: 9.18, batteryChargeKwh: 5.76, batteryDischargeKwh: 0 },
      { inverterAcKwh: 2.11, pvDcKwh: 0.66, batteryChargeKwh: 0, batteryDischargeKwh: 0.09 },
      { inverterAcKwh: 0.24, pvDcKwh: 1.06, batteryChargeKwh: 0, batteryDischargeKwh: 0.33 },
    ]) {
      const r = splitInverterOutput(c);
      expect(r.productionKwh + r.batteryDischargeAcKwh).toBeCloseTo(c.inverterAcKwh, 10);
    }
  });

  it("excludes PV that went into the battery, so it is not counted twice", () => {
    // 11:00: panels made 9.18 but 5.76 of it went straight to storage.
    const r = splitInverterOutput({
      inverterAcKwh: 4.27,
      pvDcKwh: 9.18,
      batteryChargeKwh: 5.76,
      batteryDischargeKwh: 0,
    });
    // All AC output is still PV — the charged energy simply never reached the
    // inverter, rather than belonging to the battery.
    expect(r.productionKwh).toBeCloseTo(4.27, 10);
  });

  it("treats charging that exceeds production as no PV offered, not negative", () => {
    const r = splitInverterOutput({
      inverterAcKwh: 0.5,
      pvDcKwh: 1,
      batteryChargeKwh: 3,
      batteryDischargeKwh: 0.6,
    });
    expect(r.productionKwh).toBe(0);
    expect(r.batteryDischargeAcKwh).toBeCloseTo(0.5, 10);
  });

  it("attributes nothing when neither source supplied anything", () => {
    const r = splitInverterOutput({
      inverterAcKwh: 0.02,
      pvDcKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
    });
    expect(r.productionKwh).toBe(0);
    expect(r.batteryDischargeAcKwh).toBe(0);
  });
});

describe("splitInverterOutput — the battery cannot out-deliver what it discharged", () => {
  it("credits the excess to PV when the proportional share would breach the ceiling", () => {
    // A winter hour: the battery is charged from the grid, so `pvDc - charge`
    // is zero, yet the panels are still feeding the inverter within that hour.
    const r = splitInverterOutput({
      inverterAcKwh: 1.5,
      pvDcKwh: 0.4,
      batteryChargeKwh: 0.9,
      batteryDischargeKwh: 0.2,
    });
    expect(r.batteryDischargeAcKwh).toBeCloseTo(0.2, 10);
    expect(r.productionKwh).toBeCloseTo(1.3, 10);
    expect(r.productionKwh + r.batteryDischargeAcKwh).toBeCloseTo(1.5, 10);
  });

  it("leaves a normal split untouched", () => {
    const r = splitInverterOutput({
      inverterAcKwh: 0.41,
      pvDcKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0.51,
    });
    expect(r.batteryDischargeAcKwh).toBeCloseTo(0.41, 10);
    expect(r.productionKwh).toBe(0);
  });
});
