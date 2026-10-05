import { describe, expect, it } from "vitest";
import { settleReadings, type SettlementParty, type SettlementReading } from "./engine.js";

const producer: SettlementParty = { id: "producer", member: true, producer: true };
const anna: SettlementParty = { id: "anna", member: true, producer: false };
const ben: SettlementParty = { id: "ben", member: true, producer: false };
const viewer: SettlementParty = { id: "viewer", member: false, producer: false };
const everyone = [producer, anna, ben, viewer];

const t0 = new Date("2026-06-01T10:00:00Z");
const t1 = new Date("2026-06-01T10:15:00Z");
const reading = (
  metricKind: SettlementReading["metricKind"],
  kwh: number,
  partyId: string | null = "producer",
  ts: Date = t0,
): SettlementReading => ({ ts, partyId, metricKind, kwh });
const one = (readings: SettlementReading[]) => {
  const settled = settleReadings(readings, everyone);
  expect(settled).toHaveLength(1);
  return settled[0]!;
};

describe("settleReadings — from sensors alone", () => {
  it("sells the participants what they drew and leaves the rest for the grid", () => {
    const s = one([reading("export", 1), reading("import_grid", 0.3, "anna"), reading("import_grid", 0.2, "ben")]);
    expect(s.gridOfficial).toBe(false);
    expect(s.salesKwh).toBeCloseTo(0.5, 12);
    // Every exported kWh is sold to a participant or paid at the feed-in rate, once.
    expect(s.salesKwh + s.unsoldKwh).toBeCloseTo(s.exportKwh, 12);
    expect(s.sales.map((x) => x.partyId).sort()).toEqual(["anna", "ben"]);
  });

  it("is all grid export while no participant reports a draw", () => {
    const s = one([reading("export", 0.8)]);
    expect(s.unsoldKwh).toBe(0.8);
    expect(s.sales).toEqual([]);
  });

  it("does not sell a producer their own feed-in", () => {
    // The producer drew in the same quarter-hour they fed in. The vZEV covers
    // that draw, but nothing was sold: it stays with the export.
    const s = one([reading("export", 1), reading("import_grid", 0.2, "producer"), reading("import_grid", 0.3, "anna")]);
    expect(s.shares.find((x) => x.partyId === "producer")!.local).toBeCloseTo(0.2, 12);
    expect(s.sales).toEqual([{ partyId: "anna", kwh: expect.closeTo(0.3, 12) }]);
    expect(s.unsoldKwh).toBeCloseTo(0.7, 12);
  });

  it("ignores the import sensor of somebody with no meter in the vZEV", () => {
    const s = one([reading("export", 1), reading("import_grid", 0.6, "viewer")]);
    expect(s.shares).toEqual([]);
    expect(s.unsoldKwh).toBe(1);
  });

  it("never sells more than was exported", () => {
    const s = one([reading("export", 0.2), reading("import_grid", 0.5, "anna"), reading("import_grid", 0.5, "ben")]);
    expect(s.salesKwh).toBeCloseTo(0.2, 12);
    expect(s.unsoldKwh).toBeCloseTo(0, 12);
  });
});

describe("settleReadings — with the grid provider's figures", () => {
  it("takes the provider's grid export over what the sensors would have worked out", () => {
    const sensors = [reading("export", 1), reading("import_grid", 0.3, "anna")];
    const computed = one(sensors);
    const official = one([...sensors, reading("export_grid", 0.9)]);
    expect(official.gridOfficial).toBe(true);
    expect(official.unsoldKwh).toBe(0.9);
    expect(official.unsoldKwh).not.toBeCloseTo(computed.unsoldKwh, 6);
  });

  it("takes the provider's split of a participant over their sensor", () => {
    const s = one([
      reading("export", 1),
      reading("export_grid", 0.6),
      reading("import_grid", 0.9, "anna"),
      reading("consumption", 0.4, "anna"),
      reading("consumption_grid", 0.1, "anna"),
    ]);
    expect(s.shares).toEqual([{ partyId: "anna", local: 0.4, grid: 0.1, official: true }]);
    expect(s.sales).toEqual([{ partyId: "anna", kwh: 0.4 }]);
  });

  it("counts the provider's split as a sale whoever it names", () => {
    const s = one([reading("export", 1), reading("export_grid", 0.8), reading("consumption", 0.2, "producer")]);
    expect(s.sales).toEqual([{ partyId: "producer", kwh: 0.2 }]);
  });

  it("works without any export reading, from the provider's two figures", () => {
    const s = one([reading("export_grid", 0.6), reading("consumption", 0.4, "anna")]);
    expect(s.exportKwh).toBeCloseTo(1, 12);
    expect(s.salesKwh + s.unsoldKwh).toBeCloseTo(s.exportKwh, 12);
  });
});

describe("settleReadings — over a range", () => {
  it("settles each interval on its own, in order: a surplus at one covers nobody at the next", () => {
    const settled = settleReadings(
      [
        reading("import_grid", 0.5, "anna", t1),
        reading("export", 1, "producer", t0),
        reading("export", 0, "producer", t1),
      ],
      everyone,
    );
    expect(settled.map((s) => s.ts)).toEqual([t0, t1]);
    expect(settled[0]!.unsoldKwh).toBe(1);
    expect(settled[1]!.salesKwh).toBe(0);
    expect(settled[1]!.shares[0]).toMatchObject({ partyId: "anna", local: 0, grid: 0.5 });
  });

  it("adds up several producers' exports", () => {
    const s = one([reading("export", 0.6, "producer"), reading("export", 0.4, "other-producer")]);
    expect(s.exportKwh).toBeCloseTo(1, 12);
  });
});
