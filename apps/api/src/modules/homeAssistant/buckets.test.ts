import { describe, expect, it } from "vitest";
import { aggregateBuckets } from "./buckets.js";

const at = (iso: string, change: number | null) => ({ start: new Date(iso), change });

describe("aggregateBuckets", () => {
  it("sums the three 5-minute buckets that fall in each quarter-hour", () => {
    const { rows } = aggregateBuckets(
      [
        at("2026-09-09T10:00:00Z", 0.1),
        at("2026-09-09T10:05:00Z", 0.2),
        at("2026-09-09T10:10:00Z", 0.3),
        at("2026-09-09T10:15:00Z", 1),
      ],
      "quarter_hour",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ts.toISOString()).toBe("2026-09-09T10:00:00.000Z");
    expect(rows[0]!.valueKwh).toBeCloseTo(0.6, 6);
    expect(rows[1]!.ts.toISOString()).toBe("2026-09-09T10:15:00.000Z");
  });

  it("passes hourly buckets through one-to-one", () => {
    const { rows } = aggregateBuckets(
      [at("2026-09-09T10:00:00Z", 4), at("2026-09-09T11:00:00Z", 5)],
      "hour",
    );
    expect(rows.map((r) => r.valueKwh)).toEqual([4, 5]);
  });

  it("drops empty buckets rather than writing them as zero", () => {
    // A gap in the recorder is not the same statement as "no energy flowed":
    // writing 0 would assert a measurement that was never taken.
    const { rows } = aggregateBuckets(
      [at("2026-09-09T10:00:00Z", null), at("2026-09-09T10:30:00Z", 0.5)],
      "quarter_hour",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts.toISOString()).toBe("2026-09-09T10:30:00.000Z");
  });

  it("drops negative buckets and reports how many, so bad readings can't deflate a sum", () => {
    const { rows, negatives } = aggregateBuckets(
      [at("2026-09-09T10:00:00Z", -3), at("2026-09-09T10:05:00Z", 0.4)],
      "quarter_hour",
    );
    expect(negatives).toBe(1);
    expect(rows[0]!.valueKwh).toBeCloseTo(0.4, 6);
  });

  it("returns rows in chronological order regardless of input order", () => {
    const { rows } = aggregateBuckets(
      [at("2026-09-09T11:00:00Z", 2), at("2026-09-09T09:00:00Z", 1), at("2026-09-09T10:00:00Z", 3)],
      "hour",
    );
    expect(rows.map((r) => r.valueKwh)).toEqual([1, 3, 2]);
  });
});
