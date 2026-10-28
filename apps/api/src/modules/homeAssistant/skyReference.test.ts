import { describe, expect, it } from "vitest";
import { bestByHour, localHourMinute, referenceAt } from "./skyReference.js";

/** An instant at a Europe/Zurich wall-clock time in late October (CET, UTC+1). */
const zurich = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+01:00`);

describe("bestByHour", () => {
  it("keeps each local hour's best mean across the days", () => {
    const profile = bestByHour([
      { start: zurich("2026-10-26", "12:00"), mean: 6000 },
      { start: zurich("2026-10-27", "12:00"), mean: 8000 },
      { start: zurich("2026-10-28", "12:00"), mean: 2000 },
      { start: zurich("2026-10-27", "09:00"), mean: 1500 },
    ]);
    expect(profile[12]).toBe(8000);
    expect(profile[9]).toBe(1500);
    expect(profile[3]).toBe(0);
  });

  it("files a bucket under the site's local hour, not UTC's", () => {
    const profile = bestByHour([{ start: new Date("2026-10-28T11:00:00Z"), mean: 5000 }]);
    expect(profile[12]).toBe(5000);
    expect(profile[11]).toBe(0);
  });
});

describe("referenceAt", () => {
  const profile = Array.from({ length: 24 }, (_, h) => (h === 9 ? 2000 : h === 10 ? 4000 : h === 11 ? 6000 : 0));

  it("reads an hour's mean at its middle", () => {
    expect(referenceAt(profile, zurich("2026-10-28", "10:30"))).toBe(4000);
  });

  it("runs straight between neighbouring hours' middles, so it never steps on the hour", () => {
    expect(referenceAt(profile, zurich("2026-10-28", "10:00"))).toBeCloseTo(3000, 6);
    expect(referenceAt(profile, zurich("2026-10-28", "10:15"))).toBeCloseTo(3500, 6);
    expect(referenceAt(profile, zurich("2026-10-28", "11:00"))).toBeCloseTo(5000, 6);
    // Continuous across the hour: a minute before and on it agree closely.
    const before = referenceAt(profile, zurich("2026-10-28", "10:59"));
    expect(Math.abs(before - 5000)).toBeLessThan(40);
  });

  it("reads the local clock across midnight", () => {
    expect(localHourMinute(zurich("2026-10-28", "00:10"))).toEqual({ hour: 0, minute: 10 });
    expect(referenceAt(profile, zurich("2026-10-28", "00:10"))).toBe(0);
  });
});
