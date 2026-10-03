import { describe, expect, it } from "vitest";
import { allocateVzevPower } from "./vzevFlow.js";

const reading = (over: Partial<Parameters<typeof allocateVzevPower>[0]> = {}) => ({
  productionW: 6000,
  feedInW: 4000,
  ownW: 500,
  othersW: 1500,
  ...over,
});

describe("allocateVzevPower", () => {
  it("covers the participants first and sends the rest to the grid", () => {
    const f = allocateVzevPower(reading());
    expect(f.sunToOwners).toBe(2000);
    expect(f.sunToVzev).toBe(4000);
    expect(f.vzevToYou).toBe(500);
    expect(f.vzevToOthers).toBe(1500);
    expect(f.vzevToGrid).toBe(2000);
    expect(f.gridToYou).toBe(0);
    expect(f.gridToOthers).toBe(0);
  });

  it("shares a feed-in that is too small in proportion to the draw", () => {
    const f = allocateVzevPower(reading({ feedInW: 1000 }));
    expect(f.vzevToYou).toBeCloseTo(250, 10);
    expect(f.vzevToOthers).toBeCloseTo(750, 10);
    expect(f.vzevToGrid).toBe(0);
    expect(f.gridToYou).toBeCloseTo(250, 10);
    expect(f.gridToOthers).toBeCloseTo(750, 10);
  });

  it.each([
    reading(),
    reading({ feedInW: 1000 }),
    reading({ feedInW: 0, productionW: 0 }),
    reading({ ownW: 0 }),
    reading({ othersW: null, ownW: null }),
    reading({ feedInW: 9000, productionW: 9000 }),
  ])("loses nothing and invents nothing (%o)", (r) => {
    const f = allocateVzevPower(r);
    const own = Math.max(r.ownW ?? 0, 0);
    const others = Math.max(r.othersW ?? 0, 0);
    // The feed-in is what the vZEV hands on, to the last watt.
    expect(f.vzevToYou + f.vzevToOthers + f.vzevToGrid).toBeCloseTo(f.sunToVzev, 8);
    // Each side's draw is met, from the vZEV or the grid.
    expect(f.vzevToYou + f.gridToYou).toBeCloseTo(own, 8);
    expect(f.vzevToOthers + f.gridToOthers).toBeCloseTo(others, 8);
    for (const v of Object.values(f)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("draws everything from the grid at night", () => {
    const f = allocateVzevPower(reading({ productionW: 0, feedInW: 0 }));
    expect(f.gridToYou).toBe(500);
    expect(f.gridToOthers).toBe(1500);
    expect(f.vzevToYou + f.vzevToOthers + f.vzevToGrid + f.sunToOwners).toBe(0);
  });

  it("covers a producer's own draw from another producer's feed-in, like anyone's", () => {
    // Two plants. One is feeding 1 kW in; the viewer — the other producer —
    // has theirs idle and is drawing 400 W, beside a neighbour's 600 W.
    const f = allocateVzevPower(reading({ productionW: 1800, feedInW: 1000, ownW: 400, othersW: 600 }));
    expect(f.vzevToYou).toBeCloseTo(400, 10);
    expect(f.vzevToOthers).toBeCloseTo(600, 10);
    expect(f.gridToYou).toBeCloseTo(0, 10);
    expect(f.vzevToGrid).toBe(0);
  });

  it("says nothing about what was kept when production is unknown", () => {
    expect(allocateVzevPower(reading({ productionW: null })).sunToOwners).toBe(0);
  });

  it("never lets a battery discharging to the grid read as negative own use", () => {
    // Feed-in above production: the producers' battery is exporting.
    expect(allocateVzevPower(reading({ productionW: 300, feedInW: 6000 })).sunToOwners).toBe(0);
  });
});
