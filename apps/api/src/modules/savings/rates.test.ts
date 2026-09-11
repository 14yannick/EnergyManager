import { describe, expect, it } from "vitest";
import { makeRateResolver, type ResolvedRate } from "./rates.js";

const flat = (kind: ResolvedRate["kind"], from: string, to: string, rate: number): ResolvedRate => ({
  kind,
  startTs: from,
  endTs: to,
  rateChfPerKwh: rate,
});

// The real cutover: flat feed-in runs out at 2026-10-01, dynamic quarter-hour
// pricing takes over, and the two surcharges begin the same instant.
const FLAT_Q3 = flat("feed_in", "2026-06-30T22:00:00.000Z", "2026-09-30T22:00:00.000Z", 0.085);
const SURCHARGES = [
  flat("feed_in", "2026-09-30T22:00:00.000Z", "2026-12-31T23:00:00.000Z", 0.02), // Herkunftsnachweis
  flat("feed_in", "2026-09-30T22:00:00.000Z", "2026-12-31T23:00:00.000Z", 0.01), // Mindestvergütungsprämie
];
const OCT_1_MIDDAY = "2026-10-01T10:00:00.000Z";
const dynamicAt = (ts: string, rate: number): ResolvedRate => ({
  kind: "feed_in",
  startTs: ts,
  endTs: ts,
  rateChfPerKwh: rate,
});

describe("makeRateResolver — surcharges on top of the feed-in price", () => {
  it("adds every matching surcharge to a dynamic base rate", () => {
    const resolve = makeRateResolver([FLAT_Q3], [dynamicAt(OCT_1_MIDDAY, 0.179)], SURCHARGES);
    expect(resolve("feed_in", OCT_1_MIDDAY)).toBeCloseTo(0.179 + 0.02 + 0.01, 10);
  });

  it("adds them to a flat base rate too, so the rule doesn't depend on the source", () => {
    const beforeCutover = "2026-09-15T10:00:00.000Z";
    const alwaysOn = [flat("feed_in", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z", 0.02)];
    const resolve = makeRateResolver([FLAT_Q3], [], alwaysOn);
    expect(resolve("feed_in", beforeCutover)).toBeCloseTo(0.085 + 0.02, 10);
  });

  it("prefers the dynamic rate over the flat one where both cover the instant", () => {
    const inQ3 = "2026-09-15T10:00:00.000Z";
    const resolve = makeRateResolver([FLAT_Q3], [dynamicAt(inQ3, 0.2)], []);
    expect(resolve("feed_in", inQ3)).toBeCloseTo(0.2, 10);
  });

  it("does not apply the surcharges before they start", () => {
    const lastQ3Interval = "2026-09-30T21:45:00.000Z";
    const resolve = makeRateResolver([FLAT_Q3], [], SURCHARGES);
    expect(resolve("feed_in", lastQ3Interval)).toBeCloseTo(0.085, 10);
  });

  it("keeps surcharges off other tariff kinds — they are a feed-in top-up only", () => {
    const purchase = flat("purchase", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z", 0.248);
    const neighbour = flat("neighbor_sell", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z", 0.14);
    const resolve = makeRateResolver([purchase, neighbour], [], SURCHARGES);
    expect(resolve("purchase", OCT_1_MIDDAY)).toBeCloseTo(0.248, 10);
    expect(resolve("neighbor_sell", OCT_1_MIDDAY)).toBeCloseTo(0.14, 10);
  });

  it("returns null when no base rate covers the instant, even though surcharges do", () => {
    // After the flat periods run out, an interval with no dynamic rate has no
    // price at all — a surcharge alone is an addition to a price, not a price.
    const resolve = makeRateResolver([FLAT_Q3], [], SURCHARGES);
    expect(resolve("feed_in", OCT_1_MIDDAY)).toBeNull();
  });

  it("matches a dynamic rate only on an exact interval start", () => {
    const resolve = makeRateResolver([], [dynamicAt(OCT_1_MIDDAY, 0.179)], []);
    expect(resolve("feed_in", OCT_1_MIDDAY)).toBeCloseTo(0.179, 10);
    expect(resolve("feed_in", "2026-10-01T10:07:00.000Z")).toBeNull();
  });
});
