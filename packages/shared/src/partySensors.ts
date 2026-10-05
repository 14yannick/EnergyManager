import type { IntervalMetricKind, PartyRole } from "./types.js";
import { BILLED_PARTY_ROLES } from "./types.js";

/**
 * The sensors a participant can have, and when.
 *
 * A sensor belongs to a participant, not to the site: the house that
 * exports is somebody's house, and a vZEV can hold several. What a
 * participant may map follows from what they are —
 *
 *   every member of the vZEV      their grid import, as energy and as power now
 *   a member with feed-in         their export, as energy and as power now
 *   … with detailed revenue       what the revenue split needs: the
 *                                 inverter, the panels, the battery, the load
 *   … with the detailed live view the plant's other live readings and the
 *                                 forecast
 *
 * — so the catalogue below is the single statement of that, read by the
 * form that offers the kinds, by the API that refuses the others, and by
 * the sync and the live view that use them.
 */
export const PARTY_SENSOR_KINDS = [
  "import",
  "live_import_power",
  "export",
  "live_export_power",
  "inverter_ac",
  "pv_dc",
  "battery_charge",
  "battery_discharge",
  "consumption_own",
  "live_pv_power",
  "live_battery_power",
  "live_battery_soc",
  "live_load_power",
  "forecast_today",
  "forecast_remaining",
  "forecast_tomorrow",
] as const;
export type PartySensorKind = (typeof PARTY_SENSOR_KINDS)[number];

/** What entitles a participant to a kind. */
export type PartySensorGroup = "member" | "feedIn" | "detailedRevenue" | "detailedLiveView";

/**
 * Where Home Assistant lists candidates for a kind: its long-term
 * statistics (a counter the sync can read history from), or the live
 * sensors of one device class.
 */
export type PartySensorSource = "statistic" | "power" | "battery" | "energy";

export interface PartySensorSpec {
  group: PartySensorGroup;
  source: PartySensorSource;
  /**
   * The interval metrics the sync writes from it; empty for a live sensor,
   * which is read on demand and never stored. The export counter says what
   * left the meter and nothing more: how much of it reached the grid and
   * how much the participants took is the grid provider's to say, and is
   * worked out until it does (see `settleVzevExport`).
   */
  metricKinds: readonly IntervalMetricKind[];
  /** A signed reading: which way is positive is the sensor's own, so it carries a flag. */
  signed: boolean;
}

export const PARTY_SENSOR_SPECS: Record<PartySensorKind, PartySensorSpec> = {
  import: { group: "member", source: "statistic", metricKinds: ["import_grid"], signed: false },
  // Signed like the export: many meters report the grid as one sensor that
  // changes sign with the direction, and which way is "drawing" differs.
  live_import_power: { group: "member", source: "power", metricKinds: [], signed: true },
  export: { group: "feedIn", source: "statistic", metricKinds: ["export"], signed: false },
  live_export_power: { group: "feedIn", source: "power", metricKinds: [], signed: true },
  inverter_ac: { group: "detailedRevenue", source: "statistic", metricKinds: ["inverter_ac"], signed: false },
  pv_dc: { group: "detailedRevenue", source: "statistic", metricKinds: ["pv_dc"], signed: false },
  battery_charge: { group: "detailedRevenue", source: "statistic", metricKinds: ["battery_charge"], signed: false },
  battery_discharge: { group: "detailedRevenue", source: "statistic", metricKinds: ["battery_discharge"], signed: false },
  consumption_own: { group: "detailedRevenue", source: "statistic", metricKinds: ["consumption_own"], signed: false },
  live_pv_power: { group: "detailedLiveView", source: "power", metricKinds: [], signed: false },
  live_battery_power: { group: "detailedLiveView", source: "power", metricKinds: [], signed: true },
  live_battery_soc: { group: "detailedLiveView", source: "battery", metricKinds: [], signed: false },
  live_load_power: { group: "detailedLiveView", source: "power", metricKinds: [], signed: false },
  forecast_today: { group: "detailedLiveView", source: "energy", metricKinds: [], signed: false },
  forecast_remaining: { group: "detailedLiveView", source: "energy", metricKinds: [], signed: false },
  forecast_tomorrow: { group: "detailedLiveView", source: "energy", metricKinds: [], signed: false },
};

/** What decides a participant's sensors: their role and their three options. */
export interface PartySensorProfile {
  role: PartyRole;
  feedIn: boolean;
  detailedRevenue: boolean;
  detailedLiveView: boolean;
}

/** Whether a role is a member of the vZEV — somebody with a meter in it. */
export function isVzevMember(role: PartyRole): boolean {
  return BILLED_PARTY_ROLES.includes(role);
}

/**
 * The options as they can actually hold. Feed-in needs a meter in the vZEV,
 * and the two detailed options describe a plant, so each only stands on the
 * one before it. Applied wherever a party is saved or read, so a role
 * changed to "viewer" cannot leave a feed-in flag behind that still counts.
 */
export function effectiveSensorProfile(p: PartySensorProfile): PartySensorProfile {
  const feedIn = p.feedIn && isVzevMember(p.role);
  return {
    role: p.role,
    feedIn,
    detailedRevenue: feedIn && p.detailedRevenue,
    detailedLiveView: feedIn && p.detailedLiveView,
  };
}

function groupOpen(group: PartySensorGroup, p: PartySensorProfile): boolean {
  switch (group) {
    case "member":
      return isVzevMember(p.role);
    case "feedIn":
      return p.feedIn;
    case "detailedRevenue":
      return p.detailedRevenue;
    case "detailedLiveView":
      return p.detailedLiveView;
  }
}

/** Whether this participant may have a sensor of this kind. */
export function sensorKindAllowed(kind: PartySensorKind, party: PartySensorProfile): boolean {
  return groupOpen(PARTY_SENSOR_SPECS[kind].group, effectiveSensorProfile(party));
}

/** Every kind this participant may map, in the catalogue's order. */
export function sensorKindsFor(party: PartySensorProfile): PartySensorKind[] {
  return PARTY_SENSOR_KINDS.filter((kind) => sensorKindAllowed(kind, party));
}

/** Whether the sync stores this kind's readings (a live sensor's are never kept). */
export function isStoredSensor(kind: PartySensorKind): boolean {
  return PARTY_SENSOR_SPECS[kind].metricKinds.length > 0;
}

/**
 * Whether a stored reading came from a sensor rather than from the grid
 * provider.
 *
 * A sensor's figure is provisional: it is what the household's own meter
 * says, and it is the one that counts until the provider's data for the
 * same interval arrives. From then on the provider's takes precedence — it
 * is what the bill is settled on. Precedence, not erasure: the sensor's
 * reading is kept beside the official one and goes on being recorded, so
 * the two can be compared. So the sync only ever changes the value in force
 * where that value is itself a sensor's, and an import puts its own in
 * force and marks the row as such.
 *
 * The sources a sensor leaves: the sync's own, the per-entity backfills
 * ("ha:…") and what was derived from those ("derived:…"). Everything else —
 * an imported file today, a provider feed later — outranks them.
 */
export function isSensorSource(source: string): boolean {
  return source === SENSOR_SOURCE || source.startsWith("ha:") || source.startsWith("derived:");
}

/** The source the Home Assistant sync stamps on what it writes. */
export const SENSOR_SOURCE = "home_assistant";
