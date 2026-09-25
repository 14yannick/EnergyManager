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

  // Today's own curve, as the forecast gave it: peak 7.99 at noon.
  const curve = (
    [
      [7, 0], [8, 0.47], [9, 2.75], [10, 5.13], [11, 7.0], [12, 7.99], [13, 6.97],
      [14, 4.92], [15, 4.61], [16, 4.65], [17, 3.48], [18, 1.93], [19, 0.77],
    ] as const
  ).map(([hour, kwh]) => ({ hour, kwh }));

  it("with a forecast, reads dawn and dusk off the roof's own ramp, not the sun's height", () => {
    // 17:00 is 43% of the peak with the sun still 20° up: the evening ramp.
    expect(skyFor({ sun: { elevation: 20, rising: false }, pvW: 2900, hour: 17, forecast: curve })).toBe("dusk");
    expect(skyFor({ sun: { elevation: 12, rising: false }, pvW: 1500, hour: 18, forecast: curve })).toBe("dusk");
    // 09:00 is 34% and climbing; by 10:00 (64%) the day is graded by the panels.
    expect(skyFor({ sun: { elevation: 15, rising: true }, pvW: 2000, hour: 9, forecast: curve })).toBe("dawn");
    expect(skyFor({ sun: { elevation: 25, rising: true }, pvW: 5500, hour: 10, forecast: curve })).toBe("partly");
    expect(skyFor({ sun: high, pvW: 7500, hour: 12, forecast: curve })).toBe("clear");
  });

  it("with a forecast but no sun sensor, takes the side of the peak from the clock", () => {
    expect(skyFor({ sun: null, pvW: 0, hour: 8, forecast: curve })).toBe("dawn");
    expect(skyFor({ sun: null, pvW: 0, hour: 18, forecast: curve })).toBe("dusk");
  });

  it("still calls night night whatever the forecast, and falls back to elevation without one", () => {
    expect(skyFor({ sun: { elevation: -10, rising: false }, pvW: 0, hour: 21, forecast: curve })).toBe("night");
    expect(skyFor({ sun: { elevation: 20, rising: false }, pvW: 2900, hour: 17, forecast: [] })).toBe("cloudy");
    expect(skyFor({ sun: { elevation: 20, rising: false }, pvW: 2900, hour: 17, forecast: null })).toBe("cloudy");
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
