import { describe, expect, it } from "vitest";
import { priceFeedKeySchema, siteCreateInputSchema, tariffSurchargeInputSchema } from "./validation.js";

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

describe("siteCreateInputSchema", () => {
  it("takes a name and trims it", () => {
    expect(siteCreateInputSchema.parse({ name: "  Second site " })).toEqual({ name: "Second site" });
  });

  it("refuses a site with no name to tell it apart by", () => {
    expect(siteCreateInputSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(siteCreateInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("priceFeedKeySchema", () => {
  it("takes a key that reads the same in a URL, a log and a column", () => {
    for (const key of ["public_bkw_dynamic_feed_in", "dynamic_tariff", "feed2"]) {
      expect(priceFeedKeySchema.safeParse(key).success, key).toBe(true);
    }
  });

  it("refuses spaces, capitals, punctuation and stray underscores", () => {
    for (const key of ["Public BKW", "public-bkw", "bkw.feed", "_bkw", "bkw_", "bkw__feed", "x", ""]) {
      expect(priceFeedKeySchema.safeParse(key).success, key).toBe(false);
    }
  });
});
