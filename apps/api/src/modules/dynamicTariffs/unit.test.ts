import { describe, expect, it } from "vitest";
import { isChfPerKwh } from "./unit.js";

describe("isChfPerKwh", () => {
  it("accepts the unit however it is spelled", () => {
    for (const u of ["CHF/kWh", "chf/kwh", " CHF / kWh ", "CHF/KWH"]) expect(isChfPerKwh(u)).toBe(true);
  });

  it("refuses the units a price feed most naturally publishes instead", () => {
    // Wrong currency, wrong magnitude, wrong currency and magnitude, cents.
    for (const u of ["EUR/kWh", "CHF/MWh", "EUR/MWh", "Rp./kWh", "ct/kWh", ""]) {
      expect(isChfPerKwh(u)).toBe(false);
    }
  });
});
