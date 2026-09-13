import { describe, expect, it } from "vitest";
import { makeRateResolver, type ResolvedPeriod, type ResolvedRate } from "./rates.js";

const Q3: ResolvedPeriod = {
  kind: "feed_in",
  startTs: "2026-06-30T22:00:00.000Z",
  endTs: "2026-09-30T22:00:00.000Z",
  pricingMode: "flat",
  rateChfPerKwh: 0.085,
};

const Q4_DYNAMIC: ResolvedPeriod = {
  kind: "feed_in",
  startTs: "2026-09-30T22:00:00.000Z",
  endTs: "2027-12-31T23:00:00.000Z",
  pricingMode: "dynamic",
  rateChfPerKwh: null,
};

const PURCHASE: ResolvedPeriod = {
  kind: "purchase",
  startTs: "2026-01-01T00:00:00.000Z",
  endTs: "2027-01-01T00:00:00.000Z",
  pricingMode: "flat",
  rateChfPerKwh: 0.248,
};

const surcharges: ResolvedRate[] = [
  { kind: "feed_in", startTs: "2026-09-30T22:00:00.000Z", endTs: "2026-12-31T23:00:00.000Z", rateChfPerKwh: 0.02 },
  { kind: "feed_in", startTs: "2026-09-30T22:00:00.000Z", endTs: "2026-12-31T23:00:00.000Z", rateChfPerKwh: 0.01 },
];

const dynamicRates: ResolvedRate[] = [
  // Inside the flat Q3 period — captured early, must not be used as a price.
  { kind: "feed_in", startTs: "2026-09-13T15:00:00.000Z", endTs: "2026-09-13T15:15:00.000Z", rateChfPerKwh: 0.163 },
  // Inside the dynamic Q4 period.
  { kind: "feed_in", startTs: "2026-10-01T10:00:00.000Z", endTs: "2026-10-01T10:15:00.000Z", rateChfPerKwh: 0.179 },
];

describe("makeRateResolver — the period decides which source prices it", () => {
  it("ignores a day-ahead rate that falls inside a flat period", () => {
    const resolve = makeRateResolver([Q3], dynamicRates, surcharges);
    // A dynamic rate of 0.163 exists for this exact instant, but the quarter is
    // contracted flat — this is the regression that silently repriced September.
    expect(resolve("feed_in", "2026-09-13T15:00:00.000Z")).toBeCloseTo(0.085, 10);
  });

  it("uses the day-ahead rate inside a dynamic period, plus every surcharge", () => {
    const resolve = makeRateResolver([Q3, Q4_DYNAMIC], dynamicRates, surcharges);
    expect(resolve("feed_in", "2026-10-01T10:00:00.000Z")).toBeCloseTo(0.179 + 0.02 + 0.01, 10);
  });

  it("adds surcharges to a flat base too, so the rule does not depend on the source", () => {
    const flatQ4: ResolvedPeriod = { ...Q4_DYNAMIC, pricingMode: "flat", rateChfPerKwh: 0.085 };
    const resolve = makeRateResolver([flatQ4], [], surcharges);
    expect(resolve("feed_in", "2026-10-01T10:00:00.000Z")).toBeCloseTo(0.085 + 0.03, 10);
  });

  it("switches source at the period boundary, not at a configured cutover", () => {
    const resolve = makeRateResolver([Q3, Q4_DYNAMIC], dynamicRates, surcharges);
    // Last interval of Q3 is still flat and carries no surcharge.
    expect(resolve("feed_in", "2026-09-30T21:45:00.000Z")).toBeCloseTo(0.085, 10);
  });

  it("returns null inside a dynamic period when the feed has no rate and no fallback is set", () => {
    const resolve = makeRateResolver([Q4_DYNAMIC], [], surcharges);
    // Deliberately unpriced rather than silently zero — a gap stays visible.
    expect(resolve("feed_in", "2026-10-01T10:00:00.000Z")).toBeNull();
  });

  it("uses the period's rate as a fallback when the feed missed an interval", () => {
    const withFallback: ResolvedPeriod = { ...Q4_DYNAMIC, rateChfPerKwh: 0.06 };
    const resolve = makeRateResolver([withFallback], [], surcharges);
    expect(resolve("feed_in", "2026-10-01T10:00:00.000Z")).toBeCloseTo(0.06 + 0.03, 10);
  });

  it("prefers the feed over the fallback when both are available", () => {
    const withFallback: ResolvedPeriod = { ...Q4_DYNAMIC, rateChfPerKwh: 0.06 };
    const resolve = makeRateResolver([withFallback], dynamicRates, surcharges);
    expect(resolve("feed_in", "2026-10-01T10:00:00.000Z")).toBeCloseTo(0.179 + 0.03, 10);
  });

  it("matches a day-ahead rate only on an exact interval start", () => {
    const resolve = makeRateResolver([Q4_DYNAMIC], dynamicRates, []);
    expect(resolve("feed_in", "2026-10-01T10:07:00.000Z")).toBeNull();
  });

  it("returns null when no period covers the instant at all", () => {
    const resolve = makeRateResolver([Q3], dynamicRates, surcharges);
    // 2027 export with no period defined — the surcharges alone are not a price.
    expect(resolve("feed_in", "2027-02-01T10:00:00.000Z")).toBeNull();
  });

  it("keeps surcharges and dynamic rates off other tariff kinds", () => {
    const resolve = makeRateResolver([PURCHASE, Q4_DYNAMIC], dynamicRates, surcharges);
    expect(resolve("purchase", "2026-10-01T10:00:00.000Z")).toBeCloseTo(0.248, 10);
    expect(resolve("neighbor_sell", "2026-10-01T10:00:00.000Z")).toBeNull();
  });
});
