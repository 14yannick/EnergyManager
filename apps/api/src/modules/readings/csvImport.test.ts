import { describe, expect, it } from "vitest";
import { parseMetricsCsv } from "./csvImport.js";

const HEADER = "timestamp,metric_kind,party,value_kwh";

describe("parseMetricsCsv — delta mode", () => {
  it("parses rows as-is", () => {
    const csv = [HEADER, "2026-01-01T00:00:00Z,production,,1.5"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { ts: "2026-01-01T00:00:00.000Z", metricKind: "production", party: null, valueKwh: 1.5 },
    ]);
  });

  it("flags invalid timestamps and non-numeric values without throwing", () => {
    const csv = [HEADER, "not-a-date,production,,1", "2026-01-01T00:00:00Z,production,,abc"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("flags an unknown metric_kind", () => {
    const csv = [HEADER, "2026-01-01T00:00:00Z,solar_flux,,1"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/Invalid metric_kind/);
  });

  it("rejects a negative value", () => {
    const csv = [HEADER, "2026-01-01T00:00:00Z,production,,-0.5"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/must not be negative/);
  });

  it("requires party when metric_kind is consumption", () => {
    const csv = [HEADER, "2026-01-01T00:00:00Z,consumption,,1"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/party is required/);
  });

  it("rejects party set for a non-consumption metric_kind", () => {
    const csv = [HEADER, "2026-01-01T00:00:00Z,production,Neighbour A,1"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/party must be blank/);
  });

  it("keeps consumption rows for different parties as independent series", () => {
    const csv = [
      HEADER,
      "2026-01-01T00:00:00Z,consumption,Neighbour A,0.4",
      "2026-01-01T00:00:00Z,consumption,Neighbour B,0.6",
    ].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "delta");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.party === "Neighbour A")?.valueKwh).toBe(0.4);
    expect(rows.find((r) => r.party === "Neighbour B")?.valueKwh).toBe(0.6);
  });
});

describe("parseMetricsCsv — cumulative mode", () => {
  it("diffs consecutive rows within a series and drops the baseline row", () => {
    const csv = [HEADER, "2026-01-01T00:00:00Z,production,,100", "2026-01-01T00:15:00Z,production,,101.5"].join(
      "\n",
    );
    const { rows, errors } = parseMetricsCsv(csv, "cumulative");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts).toBe("2026-01-01T00:15:00.000Z");
    expect(rows[0]!.valueKwh).toBeCloseTo(1.5, 9);
  });

  it("skips a row where a cumulative value decreases (meter reset) and reports it", () => {
    const csv = [
      HEADER,
      "2026-01-01T00:00:00Z,production,,100",
      "2026-01-01T00:15:00Z,production,,50",
      "2026-01-01T00:30:00Z,production,,52",
    ].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "cumulative");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/meter reset/);
    // Third row's diff is computed against the row before it (index-based), not the skipped row.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts).toBe("2026-01-01T00:30:00.000Z");
    expect(rows[0]!.valueKwh).toBeCloseTo(2, 9);
  });

  it("sorts unordered rows by timestamp before diffing", () => {
    const csv = [HEADER, "2026-01-01T00:15:00Z,production,,101.5", "2026-01-01T00:00:00Z,production,,100"].join(
      "\n",
    );
    const { rows } = parseMetricsCsv(csv, "cumulative");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts).toBe("2026-01-01T00:15:00.000Z");
  });

  it("diffs each (metric_kind, party) series independently", () => {
    const csv = [
      HEADER,
      "2026-01-01T00:00:00Z,production,,100",
      "2026-01-01T00:15:00Z,production,,102",
      "2026-01-01T00:00:00Z,consumption,Neighbour A,10",
      "2026-01-01T00:15:00Z,consumption,Neighbour A,10.5",
      "2026-01-01T00:00:00Z,consumption,Neighbour B,50",
      "2026-01-01T00:15:00Z,consumption,Neighbour B,51",
    ].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "cumulative");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);

    const production = rows.find((r) => r.metricKind === "production")!;
    expect(production.valueKwh).toBeCloseTo(2, 9);
    const neighbourA = rows.find((r) => r.party === "Neighbour A")!;
    expect(neighbourA.valueKwh).toBeCloseTo(0.5, 9);
    const neighbourB = rows.find((r) => r.party === "Neighbour B")!;
    expect(neighbourB.valueKwh).toBeCloseTo(1, 9);
  });
});
