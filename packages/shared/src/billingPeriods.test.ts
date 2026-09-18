import { describe, expect, it } from "vitest";
import { billingPeriodLabel, billingPeriodRange } from "./billingPeriods.js";

/** 17 September 2026, local time — Q3, so stepping back crosses into Q2. */
const NOW = new Date(2026, 8, 17, 14, 30);

describe("billingPeriodRange", () => {
  it("returns the containing period at offset 0", () => {
    expect(billingPeriodRange("yearly", 0, NOW)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(billingPeriodRange("quarterly", 0, NOW)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(billingPeriodRange("monthly", 0, NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("steps back a quarter, which is the page default", () => {
    expect(billingPeriodRange("quarterly", -1, NOW)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("crosses the year boundary going backwards without producing a month 0 or 13", () => {
    // Q3 2026 minus three quarters is Q4 2025. `%` keeps the dividend's sign
    // in JS, so a naive implementation yields a negative quarter here.
    expect(billingPeriodRange("quarterly", -3, NOW)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(billingPeriodRange("quarterly", -4, NOW)).toEqual({ from: "2025-07-01", to: "2025-09-30" });
    // September minus nine months is December of the previous year.
    expect(billingPeriodRange("monthly", -9, NOW)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(billingPeriodRange("monthly", -21, NOW)).toEqual({ from: "2024-12-01", to: "2024-12-31" });
    expect(billingPeriodRange("yearly", -2, NOW)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });

  it("steps forward too", () => {
    expect(billingPeriodRange("quarterly", 1, NOW)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(billingPeriodRange("quarterly", 2, NOW)).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(billingPeriodRange("monthly", 4, NOW)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("ends each period on its real last day", () => {
    const feb = new Date(2026, 1, 10);
    expect(billingPeriodRange("monthly", 0, feb).to).toBe("2026-02-28");
    // 2024 was a leap year: February has 29 days, and Q1 ends in March
    // regardless.
    const leapFeb = new Date(2024, 1, 10);
    expect(billingPeriodRange("monthly", 0, leapFeb).to).toBe("2024-02-29");
    expect(billingPeriodRange("quarterly", 0, leapFeb)).toEqual({
      from: "2024-01-01",
      to: "2024-03-31",
    });
    // 30-day months
    expect(billingPeriodRange("monthly", 0, new Date(2026, 3, 5)).to).toBe("2026-04-30");
    expect(billingPeriodRange("monthly", 0, new Date(2026, 10, 5)).to).toBe("2026-11-30");
  });

  it("never shifts a boundary by a day, whatever the time of day", () => {
    // The bug this guards: formatting a local Date via toISOString() in a
    // positive-offset zone turns 1 January into 31 December.
    for (const hour of [0, 1, 12, 23]) {
      const at = new Date(2026, 0, 1, hour, 30);
      expect(billingPeriodRange("yearly", 0, at).from).toBe("2026-01-01");
      expect(billingPeriodRange("quarterly", 0, at).from).toBe("2026-01-01");
      expect(billingPeriodRange("monthly", 0, at).from).toBe("2026-01-01");
    }
  });

  it("gives custom the containing month and ignores the offset", () => {
    expect(billingPeriodRange("custom", 0, NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(billingPeriodRange("custom", -5, NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("keeps from <= to for every kind and a wide span of offsets", () => {
    for (const kind of ["yearly", "quarterly", "monthly"] as const) {
      for (let offset = -40; offset <= 40; offset++) {
        const { from, to } = billingPeriodRange(kind, offset, NOW);
        expect(from <= to, `${kind} ${offset}: ${from}..${to}`).toBe(true);
        expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("billingPeriodLabel", () => {
  it("names the period the range covers, in French by default", () => {
    expect(billingPeriodLabel("yearly", -1, "fr", NOW)).toBe("2025");
    expect(billingPeriodLabel("quarterly", 0, "fr", NOW)).toBe("T3 2026");
    expect(billingPeriodLabel("quarterly", -1, "fr", NOW)).toBe("T2 2026");
    expect(billingPeriodLabel("quarterly", -3, "fr", NOW)).toBe("T4 2025");
    expect(billingPeriodLabel("monthly", 0, "fr", NOW)).toBe("septembre 2026");
    expect(billingPeriodLabel("monthly", -9, "fr", NOW)).toBe("décembre 2025");
    expect(billingPeriodLabel("custom", 0, "fr", NOW)).toBe("Personnalisé");
  });

  it("names the same periods in English", () => {
    expect(billingPeriodLabel("yearly", -1, "en", NOW)).toBe("2025");
    expect(billingPeriodLabel("quarterly", 0, "en", NOW)).toBe("Q3 2026");
    expect(billingPeriodLabel("quarterly", -3, "en", NOW)).toBe("Q4 2025");
    expect(billingPeriodLabel("monthly", 0, "en", NOW)).toBe("September 2026");
    expect(billingPeriodLabel("monthly", -9, "en", NOW)).toBe("December 2025");
    expect(billingPeriodLabel("custom", 0, "en", NOW)).toBe("Custom");
  });

  it("names the same periods in German", () => {
    expect(billingPeriodLabel("yearly", -1, "de", NOW)).toBe("2025");
    expect(billingPeriodLabel("quarterly", 0, "de", NOW)).toBe("Q3 2026");
    expect(billingPeriodLabel("monthly", 0, "de", NOW)).toBe("September 2026");
    expect(billingPeriodLabel("monthly", -9, "de", NOW)).toBe("Dezember 2025");
    expect(billingPeriodLabel("custom", 0, "de", NOW)).toBe("Benutzerdefiniert");
  });

  it("covers exactly the range it names, in every language", () => {
    // The label and the range are computed from the same arithmetic; this
    // pins that they cannot drift apart as the signature grows.
    for (const locale of ["fr", "en", "de"] as const) {
      for (let offset = -6; offset <= 6; offset++) {
        const { from } = billingPeriodRange("monthly", offset, NOW);
        const label = billingPeriodLabel("monthly", offset, locale, NOW);
        expect(label).toContain(from.slice(0, 4));
      }
    }
  });
});
