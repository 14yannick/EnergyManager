import { describe, expect, it } from "vitest";
import { RATE_FAIR_BELOW_CHF, RATE_POOR_BELOW_CHF, rateBand, rateGradientStops } from "./feedInBands.js";

describe("rateBand", () => {
  it("steps through the bands at the stated thresholds, best only past the purchase price", () => {
    expect(rateBand(-0.01, 0.25)).toBe("loss");
    expect(rateBand(0, 0.25)).toBe("poor");
    expect(rateBand(RATE_POOR_BELOW_CHF - 0.001, 0.25)).toBe("poor");
    expect(rateBand(RATE_POOR_BELOW_CHF, 0.25)).toBe("fair");
    expect(rateBand(RATE_FAIR_BELOW_CHF - 0.001, 0.25)).toBe("fair");
    expect(rateBand(RATE_FAIR_BELOW_CHF, 0.25)).toBe("good");
    expect(rateBand(0.249, 0.25)).toBe("good");
    expect(rateBand(0.25, 0.25)).toBe("best");
  });

  it("never reaches best without a purchase price to beat", () => {
    expect(rateBand(0.9, null)).toBe("good");
  });
});

describe("rateGradientStops", () => {
  it("paints a line spanning every band with a hard step at each threshold it crosses", () => {
    const stops = rateGradientStops(-0.02, 0.3, 0.25);
    expect(stops.map((s) => s.band)).toEqual(["best", "best", "good", "good", "fair", "fair", "poor", "poor", "loss", "loss"]);
    // Each threshold's two stops share an offset, and offsets run top to bottom.
    const offsets = stops.map((s) => s.offset);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets[1]).toBe(offsets[2]);
    expect(offsets[1]).toBeCloseTo((0.3 - 0.25) / 0.32, 6);
  });

  it("leaves out thresholds the line never crosses", () => {
    const stops = rateGradientStops(0.09, 0.12, 0.25);
    expect(stops).toEqual([
      { offset: 0, band: "fair" },
      { offset: 1, band: "fair" },
    ]);
  });

  it("gives a flat line one band, top to bottom", () => {
    expect(rateGradientStops(0.2, 0.2, 0.25)).toEqual([
      { offset: 0, band: "good" },
      { offset: 1, band: "good" },
    ]);
  });
});
