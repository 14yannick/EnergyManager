import { describe, expect, it } from "vitest";
import { CLEAR_FROM_KW, CLOUDY_FROM_KW, PARTLY_FROM_KW, skyFor } from "./sky.js";

const noon = { hour: 12 };
const high = { elevation: 40, rising: false };

describe("skyFor", () => {
  it("is night below civil twilight whatever the panels report", () => {
    expect(skyFor({ sun: { elevation: -10, rising: true }, pvW: 8000, ...noon })).toBe("night");
  });

  it("keeps the sun on the horizon from civil twilight up to 10°, rising or setting", () => {
    expect(skyFor({ sun: { elevation: -3, rising: true }, pvW: 0, ...noon })).toBe("dawn");
    expect(skyFor({ sun: { elevation: 9.9, rising: true }, pvW: 3000, ...noon })).toBe("dawn");
    expect(skyFor({ sun: { elevation: 9.9, rising: false }, pvW: 3000, ...noon })).toBe("dusk");
    // From 10° the day is graded by the panels, not by the sun's height.
    expect(skyFor({ sun: { elevation: 10, rising: true }, pvW: 3000, ...noon })).toBe("cloudy");
  });

  it("grades the day by what the panels make, at the stated thresholds", () => {
    const at = (kw: number) => skyFor({ sun: high, pvW: kw * 1000, ...noon });
    expect(at(CLEAR_FROM_KW)).toBe("clear");
    expect(at(CLEAR_FROM_KW - 0.01)).toBe("partly");
    expect(at(PARTLY_FROM_KW)).toBe("partly");
    expect(at(PARTLY_FROM_KW - 0.01)).toBe("cloudy");
    expect(at(CLOUDY_FROM_KW)).toBe("cloudy");
    expect(at(CLOUDY_FROM_KW - 0.01)).toBe("snow");
    expect(at(0)).toBe("snow");
  });

  it("shows a plain sun by day when there is no PV figure to grade by", () => {
    expect(skyFor({ sun: high, pvW: null, ...noon })).toBe("clear");
  });

  it("falls back to the clock without a sun sensor", () => {
    expect(skyFor({ sun: null, pvW: 8000, hour: 2 })).toBe("night");
    expect(skyFor({ sun: null, pvW: 8000, hour: 23 })).toBe("night");
    expect(skyFor({ sun: null, pvW: 0, hour: 6 })).toBe("dawn");
    expect(skyFor({ sun: null, pvW: 0, hour: 20 })).toBe("dusk");
    expect(skyFor({ sun: null, pvW: 8000, hour: 12 })).toBe("clear");
  });
});
