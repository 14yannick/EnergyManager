import { describe, expect, it } from "vitest";
import {
  PARTY_SENSOR_KINDS,
  isSensorSource,
  PARTY_SENSOR_SPECS,
  effectiveSensorProfile,
  isStoredSensor,
  sensorKindAllowed,
  sensorKindsFor,
  type PartySensorProfile,
} from "./partySensors.js";

const party = (over: Partial<PartySensorProfile> = {}): PartySensorProfile => ({
  role: "rcp_party",
  feedIn: false,
  detailedRevenue: false,
  detailedLiveView: false,
  ...over,
});

describe("sensorKindsFor", () => {
  it("gives every member of the vZEV their grid import, as energy and as power, and nothing else", () => {
    expect(sensorKindsFor(party())).toEqual(["import", "live_import_power"]);
    expect(sensorKindsFor(party({ role: "rcp_admin" }))).toEqual(["import", "live_import_power"]);
  });

  it("gives nobody outside the vZEV a sensor", () => {
    expect(sensorKindsFor(party({ role: "viewer" }))).toEqual([]);
    expect(sensorKindsFor(party({ role: "rcp_admin_only" }))).toEqual([]);
  });

  it("adds the export, as energy and as power now, with feed-in", () => {
    expect(sensorKindsFor(party({ feedIn: true }))).toEqual(["import", "live_import_power", "export", "live_export_power"]);
  });

  it("adds what the revenue split needs with detailed revenue", () => {
    const kinds = sensorKindsFor(party({ feedIn: true, detailedRevenue: true }));
    expect(kinds).toEqual([
      "import",
      "live_import_power",
      "export",
      "live_export_power",
      "inverter_ac",
      "pv_dc",
      "battery_charge",
      "battery_discharge",
      "consumption_own",
    ]);
  });

  it("adds the plant's live readings and the forecast with the detailed live view", () => {
    const kinds = sensorKindsFor(party({ feedIn: true, detailedLiveView: true }));
    expect(kinds).toEqual([
      "import",
      "live_import_power",
      "export",
      "live_export_power",
      "live_pv_power",
      "live_battery_power",
      "live_battery_soc",
      "live_load_power",
      "forecast_today",
      "forecast_remaining",
      "forecast_tomorrow",
    ]);
  });

  it("offers every kind once both options are on", () => {
    expect(sensorKindsFor(party({ role: "rcp_admin", feedIn: true, detailedRevenue: true, detailedLiveView: true }))).toEqual([
      ...PARTY_SENSOR_KINDS,
    ]);
  });
});

describe("effectiveSensorProfile", () => {
  it("drops the detailed options when there is no feed-in for them to describe", () => {
    expect(effectiveSensorProfile(party({ detailedRevenue: true, detailedLiveView: true }))).toEqual(party());
    expect(sensorKindAllowed("pv_dc", party({ detailedRevenue: true }))).toBe(false);
  });

  it("drops feed-in from a role with no meter in the vZEV", () => {
    const viewer = party({ role: "viewer", feedIn: true, detailedRevenue: true, detailedLiveView: true });
    expect(effectiveSensorProfile(viewer)).toEqual(party({ role: "viewer" }));
    expect(sensorKindsFor(viewer)).toEqual([]);
  });
});

describe("the catalogue", () => {
  it("stores the energy counters and never a live reading", () => {
    for (const kind of PARTY_SENSOR_KINDS) {
      const spec = PARTY_SENSOR_SPECS[kind];
      expect(isStoredSensor(kind), kind).toBe(spec.source === "statistic");
    }
  });

  it("writes one export counter as both what left the house and what reached the grid", () => {
    expect(PARTY_SENSOR_SPECS.export.metricKinds).toEqual(["export_local", "export_grid"]);
  });

  it("writes no metric from two different sensors", () => {
    const all = PARTY_SENSOR_KINDS.flatMap((k) => PARTY_SENSOR_SPECS[k].metricKinds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("flags exactly the signed power sensors: the grid's two directions and the battery", () => {
    expect(PARTY_SENSOR_KINDS.filter((k) => PARTY_SENSOR_SPECS[k].signed)).toEqual([
      "live_import_power",
      "live_export_power",
      "live_battery_power",
    ]);
  });
});

describe("isSensorSource", () => {
  it("knows what the sync and its backfills wrote", () => {
    for (const source of ["home_assistant", "ha:emma_total_pv_energy_yield", "ha:x:5min", "derived:split", "derived:estimated"]) {
      expect(isSensorSource(source), source).toBe(true);
    }
  });

  it("ranks an import, a provider feed and anything unknown above a sensor", () => {
    for (const source of ["csv_import", "grid_provider", "test_seed", ""]) {
      expect(isSensorSource(source), source).toBe(false);
    }
  });
});
