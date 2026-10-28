import { describe, expect, it } from "vitest";
import {
  CLEAR_FROM_KW,
  CLEAR_FROM_SHARE,
  CLOUDY_FROM_KW,
  LONG_DAY_HOURS,
  MIN_REFERENCE_W,
  PARTLY_FROM_KW,
  PARTLY_FROM_SHARE,
  RAMP_BELOW_LONG_DAY,
  RAMP_BELOW_SHORT_DAY,
  SHORT_DAY_HOURS,
  rampShareFor,
  skyFor,
} from "./sky.js";

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

  describe("on a short day, sunrise and sunset are shorter", () => {
    it("narrows the ramp's share from half the peak on a long day to a fifth on a short one", () => {
      expect(rampShareFor(LONG_DAY_HOURS)).toBe(RAMP_BELOW_LONG_DAY);
      expect(rampShareFor(15)).toBe(RAMP_BELOW_LONG_DAY);
      expect(rampShareFor(SHORT_DAY_HOURS)).toBe(RAMP_BELOW_SHORT_DAY);
      expect(rampShareFor(6)).toBe(RAMP_BELOW_SHORT_DAY);
      expect(rampShareFor(10)).toBeCloseTo(0.35, 10);
    });

    // 28 October's forecast: ten productive hours, peak 5.25 at 13:00.
    const october = (
      [
        [8, 0.23], [9, 1.15], [10, 2.59], [11, 4.12], [12, 5.05], [13, 5.25],
        [14, 4.95], [15, 4.03], [16, 2.68], [17, 1.49],
      ] as const
    ).map(([hour, kwh]) => ({ hour, kwh }));
    const at = (hour: number) =>
      skyFor({ sun: { elevation: 15, rising: hour < 13 }, pvW: null, hour, forecast: october });

    it("keeps the horizon for the first two hours and the last, not four", () => {
      expect(at(8)).toBe("dawn");
      expect(at(9)).toBe("dawn");
      // 49% of the peak: under the old half it was still sunrise at 10:00.
      expect(at(10)).toBe("clear");
      expect(at(16)).toBe("clear");
      expect(at(17)).toBe("dusk");
    });

    it("leaves a trace of output before the day starts out of the day's length", () => {
      const withTrace = [{ hour: 7, kwh: 0.05 }, ...october];
      expect(skyFor({ sun: { elevation: 15, rising: true }, pvW: null, hour: 10, forecast: withTrace })).toBe("clear");
    });
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

  describe("against the roof's best recent output at this hour", () => {
    const at = (pvW: number, pvReferenceW: number) => skyFor({ sun: high, pvW, pvReferenceW, ...noon });

    it("grades by the share of it, at the stated thresholds", () => {
      expect(at(CLEAR_FROM_SHARE * 4000, 4000)).toBe("clear");
      expect(at(CLEAR_FROM_SHARE * 4000 - 1, 4000)).toBe("partly");
      expect(at(PARTLY_FROM_SHARE * 4000, 4000)).toBe("partly");
      expect(at(PARTLY_FROM_SHARE * 4000 - 1, 4000)).toBe("cloudy");
    });

    it("calls a clear winter noon clear, though it is far below a summer one", () => {
      // 4.2 kW of a 5 kW December best: the fixed thresholds said "cloudy".
      expect(at(4200, 5000)).toBe("clear");
      expect(skyFor({ sun: high, pvW: 4200, ...noon })).toBe("cloudy");
    });

    it("calls a dull summer noon cloudy, though it beats a winter one", () => {
      expect(at(4200, 11000)).toBe("cloudy");
    });

    it("never guesses snow: a sky with nothing coming through is a cloud", () => {
      expect(at(0, 8000)).toBe("cloudy");
    });

    it("says nothing worse than the sun when the reference is too small to grade against", () => {
      expect(at(50, MIN_REFERENCE_W - 1)).toBe("clear");
    });

    it("puts a cloud in front of a sunrise or sunset the panels barely notice", () => {
      const ramp = (rising: boolean, pvW: number, pvReferenceW: number | null) =>
        skyFor({ sun: { elevation: 5, rising }, pvW, pvReferenceW, hour: rising ? 8 : 17 });
      // 0.3 kW of a 1.5 kW best: a dull sunrise.
      expect(ramp(true, 300, 1500)).toBe("dawnCloudy");
      expect(ramp(false, 300, 1500)).toBe("duskCloudy");
      // At the partly-cloudy share or above, the plain horizon.
      expect(ramp(true, PARTLY_FROM_SHARE * 1500, 1500)).toBe("dawn");
      // No reference, or one too small to grade against: the plain horizon.
      expect(ramp(true, 0, null)).toBe("dawn");
      expect(ramp(false, 0, MIN_REFERENCE_W - 1)).toBe("dusk");
    });

    it("leaves night, dawn and dusk to the sun and the forecast", () => {
      expect(skyFor({ sun: { elevation: -10, rising: false }, pvW: 0, pvReferenceW: 8000, hour: 22 })).toBe("night");
      expect(skyFor({ sun: { elevation: 5, rising: true }, pvW: 6000, pvReferenceW: 8000, hour: 7 })).toBe("dawn");
    });
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
