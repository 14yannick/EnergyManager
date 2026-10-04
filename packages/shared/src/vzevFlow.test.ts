import { describe, expect, it } from "vitest";
import { allocateVzevPower, settleVzevInterval, splitAvailable } from "./vzevFlow.js";

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

describe("splitAvailable", () => {
  const parties = [
    { id: "a", demand: 300 },
    { id: "b", demand: 600 },
    { id: "c", demand: 100 },
  ];

  it("covers everyone in full while there is enough, and leaves the rest as surplus", () => {
    const { shares, surplus } = splitAvailable(1500, parties);
    expect(shares.map((s) => s.local)).toEqual([300, 600, 100]);
    expect(shares.every((s) => s.grid === 0)).toBe(true);
    expect(surplus).toBe(500);
  });

  it("splits what is available by each party's share of the total draw once it is not enough", () => {
    // 500 available against 1000 drawn: everybody's quota is a half.
    const { shares, surplus } = splitAvailable(500, parties);
    expect(shares.map((s) => s.local)).toEqual([150, 300, 50]);
    expect(shares.map((s) => s.grid)).toEqual([150, 300, 50]);
    expect(surplus).toBe(0);
    // A party drawing 60 % of everything receives 60 % of what there is.
    expect(shares[1]!.local / 500).toBeCloseTo(shares[1]!.demand / 1000, 12);
  });

  it.each([0, 1, 250, 999.9, 1000, 1000.1, 5000])("hands out exactly what is available: %d", (available) => {
    const { shares, surplus } = splitAvailable(available, parties);
    expect(shares.reduce((s, x) => s + x.local, 0) + surplus).toBeCloseTo(available, 9);
    for (const share of shares) {
      expect(share.local + share.grid).toBeCloseTo(share.demand, 9);
      expect(share.local).toBeGreaterThanOrEqual(0);
      expect(share.grid).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("is the same rule in watts and in kilowatt-hours", () => {
    const power = splitAvailable(500, parties);
    const energy = splitAvailable(0.125, parties.map((p) => ({ ...p, demand: p.demand / 4000 })));
    for (let i = 0; i < parties.length; i++) {
      expect(energy.shares[i]!.local / energy.shares[i]!.demand).toBeCloseTo(power.shares[i]!.local / power.shares[i]!.demand, 12);
    }
  });

  it("gives nothing to a party that draws nothing, and does not let it change the others' shares", () => {
    const withIdle = splitAvailable(500, [...parties, { id: "idle", demand: 0 }]);
    expect(withIdle.shares[3]).toEqual({ id: "idle", demand: 0, local: 0, grid: 0 });
    expect(withIdle.shares.slice(0, 3)).toEqual(splitAvailable(500, parties).shares);
  });

  it("has nothing to split when nobody draws", () => {
    expect(splitAvailable(800, [])).toEqual({ shares: [], surplus: 800 });
  });
});

describe("settleVzevInterval", () => {
  it("is the plain split when every party arrives with a metered draw", () => {
    const { shares, surplus } = settleVzevInterval(0.5, [
      { id: "a", demand: 0.6 },
      { id: "b", demand: 0.4 },
    ]);
    expect(shares.map((s) => s.local)).toEqual([0.3, 0.2]);
    expect(surplus).toBe(0);
  });

  it("takes the grid provider's split as given, and shares what it leaves", () => {
    const { shares, surplus } = settleVzevInterval(1, [
      { id: "official", official: { local: 0.4, grid: 0.1 } },
      { id: "a", demand: 0.9 },
      { id: "b", demand: 0.3 },
    ]);
    const byId = Object.fromEntries(shares.map((s) => [s.id, s]));
    expect(byId.official).toEqual({ id: "official", demand: 0.5, local: 0.4, grid: 0.1 });
    // 0.6 left, against 1.2 drawn: a half each.
    expect(byId.a!.local).toBeCloseTo(0.45, 12);
    expect(byId.b!.local).toBeCloseTo(0.15, 12);
    expect(surplus).toBe(0);
  });

  it("gives a producer back part of what they fed in, within the same interval", () => {
    // A quarter-hour in which a producer both fed in and drew: their draw is
    // a demand on the pool like any other, and the pool holds their own energy.
    const { shares, surplus } = settleVzevInterval(0.8, [{ id: "producer", demand: 0.2 }]);
    expect(shares[0]).toEqual({ id: "producer", demand: 0.2, local: 0.2, grid: 0 });
    expect(surplus).toBeCloseTo(0.6, 12);
  });

  it("leaves a party with no reading out, rather than counting it as drawing nothing", () => {
    expect(settleVzevInterval(1, [{ id: "silent" }]).shares).toEqual([]);
  });
});
