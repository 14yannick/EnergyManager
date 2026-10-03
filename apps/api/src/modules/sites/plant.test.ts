import { describe, expect, it, vi } from "vitest";

// The combination is pure; the module's other half reads the database.
vi.mock("../../db/client.js", () => ({ db: {} }));
const { combinePlantSettings } = await import("./plant.js");

describe("combinePlantSettings", () => {
  it("is the one producer's own figures when there is one", () => {
    expect(combinePlantSettings([{ productionStartDate: "2025-04-01", batteryConversionLoss: 0.12 }])).toEqual({
      productionStartDate: "2025-04-01",
      batteryConversionLoss: 0.12,
    });
  });

  it("falls back to no start and the default loss with no producer, or none stating them", () => {
    expect(combinePlantSettings([])).toEqual({ productionStartDate: null, batteryConversionLoss: 0.1 });
    expect(combinePlantSettings([{ productionStartDate: null, batteryConversionLoss: null }])).toEqual({
      productionStartDate: null,
      batteryConversionLoss: 0.1,
    });
  });

  it("starts the site with its first plant, and averages the losses that are stated", () => {
    const site = combinePlantSettings([
      { productionStartDate: "2026-02-01", batteryConversionLoss: 0.1 },
      { productionStartDate: "2025-04-01", batteryConversionLoss: 0.2 },
      { productionStartDate: null, batteryConversionLoss: null },
    ]);
    expect(site.productionStartDate).toBe("2025-04-01");
    expect(site.batteryConversionLoss).toBeCloseTo(0.15, 10);
  });
});
