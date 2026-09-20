import { describe, expect, it } from "vitest";
import type { TariffKind } from "@energy-manager/shared";
import { priceNeighbourSales, type PartyDraw } from "./neighbourSales.js";

// Synthetic round rates: neighbour 0.20 flat, feed-in 0.08 by day and 0.12 in
// the evening, so the per-interval pricing has something to get wrong.
const rates = (overrides: Partial<Record<TariffKind, number | null>> = {}) =>
  (kind: TariffKind, ts: string): number | null => {
    if (kind in overrides) return overrides[kind] ?? null;
    if (kind === "neighbor_sell") return 0.2;
    if (kind === "feed_in") return ts.slice(11, 13) >= "18" ? 0.12 : 0.08;
    return 0.3;
  };

const draws: PartyDraw[] = [
  { partyId: "a", name: "Neighbour A", ts: "2026-06-01T10:00:00.000Z", kwh: 2 },
  { partyId: "a", name: "Neighbour A", ts: "2026-06-01T19:00:00.000Z", kwh: 1 },
  { partyId: "b", name: "Neighbour B", ts: "2026-06-01T10:00:00.000Z", kwh: 4 },
];
const range = { from: "2026-06-01", to: "2026-06-01" };

describe("priceNeighbourSales", () => {
  it("gains exactly the sale price less the export it replaced, interval by interval", () => {
    const { parties } = priceNeighbourSales(draws, rates(), range);
    const a = parties.find((p) => p.partyId === "a")!;
    expect(a.kwh).toBe(3);
    expect(a.revenueChf).toBeCloseTo(3 * 0.2, 9);
    // Priced at each interval's own feed-in rate, not an average of them.
    expect(a.exportValueChf).toBeCloseTo(2 * 0.08 + 1 * 0.12, 9);
    for (const p of parties) expect(p.gainChf).toBeCloseTo(p.revenueChf - p.exportValueChf, 9);
  });

  it("adds its participants up to its totals", () => {
    const { parties, totals } = priceNeighbourSales(draws, rates(), range);
    for (const k of ["kwh", "revenueChf", "exportValueChf", "gainChf", "unpricedKwh"] as const) {
      expect(parties.reduce((s, p) => s + p[k], 0)).toBeCloseTo(totals[k], 9);
    }
  });

  it("counts selling as worth more than its price when exporting would have cost money", () => {
    const { totals } = priceNeighbourSales(draws, rates({ feed_in: -0.05 }), range);
    expect(totals.exportValueChf).toBeLessThan(0);
    expect(totals.gainChf).toBeGreaterThan(totals.revenueChf);
  });

  it("still counts the revenue earned when there is no export price to compare it with", () => {
    const { totals } = priceNeighbourSales(draws, rates({ feed_in: null }), range);
    expect(totals.revenueChf).toBeCloseTo(7 * 0.2, 9);
    // …but no comparison: no export value, no gain, and the kWh are named.
    expect(totals.exportValueChf).toBe(0);
    expect(totals.gainChf).toBe(0);
    expect(totals.unpricedKwh).toBe(7);
  });

  it("compares only the intervals with both prices", () => {
    // Evening feed-in missing: the 1 kWh A drew then is sold but not compared.
    const eveningGap = (kind: TariffKind, ts: string) =>
      kind === "feed_in" && ts.slice(11, 13) >= "18" ? null : rates()(kind, ts);
    const a = priceNeighbourSales(draws, eveningGap, range).parties.find((p) => p.partyId === "a")!;
    expect(a.revenueChf).toBeCloseTo(3 * 0.2, 9);
    expect(a.unpricedKwh).toBe(1);
    expect(a.gainChf).toBeCloseTo(2 * (0.2 - 0.08), 9);
  });
});

describe("what the participants themselves saved", () => {
  it("carries each party's figure through and totals them", () => {
    const saved = new Map([["a", 12.5], ["b", 7.25]]);
    const { parties, totals } = priceNeighbourSales(draws, rates(), range, saved);
    expect(parties.map((p) => p.participantSavedChf)).toEqual([12.5, 7.25]);
    expect(totals.participantSavedChf).toBeCloseTo(19.75, 10);
  });

  it("reads zero for a party with no figure rather than inventing one", () => {
    const { parties } = priceNeighbourSales(draws, rates(), range, new Map([["a", 3]]));
    expect(parties.find((p) => p.partyId === "b")!.participantSavedChf).toBe(0);
  });
});
