import { describe, expect, it } from "vitest";
import { tariffSurchargeInputSchema } from "./validation.js";

describe("tariffSurchargeInputSchema", () => {
  const surcharge = {
    startTs: "2026-10-01T00:00",
    endTs: "2027-01-01T00:00",
    rateChfPerKwh: 0.015,
    label: "Mindestvergütungsprämie",
  };

  it("accepts a surcharge on the feed-in rate", () => {
    expect(tariffSurchargeInputSchema.safeParse({ ...surcharge, kind: "feed_in" }).success).toBe(true);
  });

  it("refuses one on the neighbour-sale rate, which is the agreed price", () => {
    const result = tariffSurchargeInputSchema.safeParse({ ...surcharge, kind: "neighbor_sell" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["kind"]);
  });
});
