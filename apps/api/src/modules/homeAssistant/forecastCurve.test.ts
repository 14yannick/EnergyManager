import { describe, expect, it } from "vitest";
import { forecastForDay, localDayHour, mergeForecastSources } from "./forecastCurve.js";

describe("localDayHour", () => {
  it("shifts a UTC instant onto the Zurich clock, summer and winter alike", () => {
    // CEST: UTC+2. 05:15Z is 07:15 local, still the same day.
    expect(localDayHour(new Date("2026-09-21T05:15:08Z"))).toEqual({ day: "2026-09-21", hour: 7 });
    // CET: UTC+1. 23:30Z on the 20th is 00:30 on the 21st.
    expect(localDayHour(new Date("2026-01-20T23:30:00Z"))).toEqual({ day: "2026-01-21", hour: 0 });
  });
});

describe("forecastForDay", () => {
  // The shape Home Assistant returns: whole hours, plus a sunrise stub and a
  // sunset stub that do not start on the hour.
  const feed = {
    "2026-09-21T05:15:08+00:00": 0, // sunrise stub, 07:15 local
    "2026-09-21T06:00:00+00:00": 342, // 08:00
    "2026-09-21T07:00:00+00:00": 1286, // 09:00
    "2026-09-21T15:00:00+00:00": 552, // 17:00
    "2026-09-21T15:31:33+00:00": 99, // sunset stub, 17:31 — same local hour as above
    "2026-09-22T06:00:00+00:00": 400, // tomorrow: not ours
  };

  it("keeps only the asked day, on local hours, in kWh, sorted", () => {
    expect(forecastForDay(feed, "2026-09-21")).toEqual([
      { hour: 7, kwh: 0 },
      { hour: 8, kwh: 0.342 },
      { hour: 9, kwh: 1.286 },
      { hour: 17, kwh: 0.651 },
    ]);
  });

  it("folds a stub into the whole hour it starts in rather than adding an hour", () => {
    const hours = forecastForDay(feed, "2026-09-21").map((h) => h.hour);
    expect(hours.filter((h) => h === 17)).toHaveLength(1);
  });

  it("is empty for a day the feed does not cover", () => {
    expect(forecastForDay(feed, "2026-09-25")).toEqual([]);
  });

  it("ignores a value it cannot read rather than poisoning the sum", () => {
    expect(forecastForDay({ "not a date": 100, "2026-09-21T06:00:00+00:00": 500 }, "2026-09-21")).toEqual([
      { hour: 8, kwh: 0.5 },
    ]);
  });
});

describe("mergeForecastSources", () => {
  it("adds two roofs together, period by period", () => {
    const a = { "2026-09-21T06:00:00+00:00": 300, "2026-09-21T07:00:00+00:00": 700 };
    const b = { "2026-09-21T07:00:00+00:00": 100 };
    expect(mergeForecastSources([a, b])).toEqual({
      "2026-09-21T06:00:00+00:00": 300,
      "2026-09-21T07:00:00+00:00": 800,
    });
  });

  it("is empty with no sources", () => {
    expect(mergeForecastSources([])).toEqual({});
  });
});
