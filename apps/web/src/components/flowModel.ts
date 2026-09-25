import type { CSSProperties } from "react";
import type { DailySavings } from "@energy-manager/shared";
import { PALETTE } from "../lib/palette";
import type { MessageKey } from "../i18n/context";
import { formatKwhAuto } from "../lib/format";

/**
 * The energy-flow views' shared vocabulary: the six entities, the seven
 * flows between them, and how a range's rows become those flows. The Sankey
 * and the radial view both draw exactly this, so they can never disagree
 * with each other — or with the revenue chart, whose split this mirrors.
 */

export type NodeId = "gridImport" | "sun" | "battery" | "house" | "gridExport" | "vzev";

export const NODE_COLOR: Record<NodeId, string> = {
  gridImport: PALETTE.grid,
  sun: PALETTE.sun,
  battery: PALETTE.battery,
  house: PALETTE.house,
  gridExport: PALETTE.grid,
  vzev: PALETTE.local,
};

export const NAME_KEY: Record<NodeId, MessageKey> = {
  gridImport: "flow.gridImport",
  sun: "flow.sun",
  battery: "flow.battery",
  house: "flow.house",
  gridExport: "flow.gridExport",
  vzev: "flow.vzev",
};

/** Below this a flow is absent, and a node nothing reaches disappears with it. */
export const MIN_KWH = 0.05;

export interface FlowTotals {
  directUse: number;
  charge: number;
  dischargeConsumed: number;
  dischargeExported: number;
  exported: number;
  neighbour: number;
  imported: number;
}

/** The range's energy, summed from the rows the revenue chart draws. */
export function totalsOf(rows: DailySavings[]): FlowTotals {
  const t: FlowTotals = { directUse: 0, charge: 0, dischargeConsumed: 0, dischargeExported: 0, exported: 0, neighbour: 0, imported: 0 };
  for (const r of rows) {
    t.directUse += r.directUseKwh;
    t.charge += r.batteryChargeKwh;
    t.dischargeConsumed += r.batteryDischargeConsumedKwh;
    t.dischargeExported += r.batteryDischargeExportedKwh;
    t.exported += r.exportedKwh;
    t.neighbour += r.neighborConsumptionKwh;
    t.imported += r.importedKwh;
  }
  return t;
}

export interface FlowLink {
  source: NodeId;
  target: NodeId;
  kwh: number;
  /**
   * The colour the rest of the app gives this energy: direct use is the
   * sun's, export is the grid's, anything through the battery is the
   * battery's, participant supply is local. A flow here and a bar in the
   * revenue chart read as one thing.
   */
  color: string;
}

/**
 * The flows, split the same way the revenue chart splits them (grid export
 * less the battery's share of it, and so on), so the two agree to the kWh.
 *
 * The order is the Sankey's layout: ribbons stack down each side of a node
 * in the order they appear here. Battery→grid comes before sun→grid on
 * purpose — the battery sits above the sun's export ribbon, so its own must
 * land above it on the grid node or the two would cross.
 */
export function linksOf(x: FlowTotals): FlowLink[] {
  const raw: FlowLink[] = [
    { source: "gridImport", target: "house", kwh: x.imported, color: PALETTE.grid },
    { source: "sun", target: "house", kwh: x.directUse, color: PALETTE.sun },
    { source: "sun", target: "battery", kwh: x.charge, color: PALETTE.battery },
    { source: "battery", target: "house", kwh: x.dischargeConsumed, color: PALETTE.battery },
    { source: "battery", target: "gridExport", kwh: x.dischargeExported, color: PALETTE.battery },
    { source: "sun", target: "gridExport", kwh: x.exported - x.dischargeExported, color: PALETTE.grid },
    { source: "sun", target: "vzev", kwh: x.neighbour, color: PALETTE.local },
  ];
  // Direct use is unclamped per interval (meter-timing noise cancels over a
  // range, see the engine); a range that still sums below zero means none.
  return raw.map((l) => ({ ...l, kwh: Math.max(l.kwh, 0) })).filter((l) => l.kwh >= MIN_KWH);
}

/** What each node takes in and gives out, from the flows that survived. */
export function nodeTotals(links: FlowLink[]): Map<NodeId, { inKwh: number; outKwh: number }> {
  const totals = new Map<NodeId, { inKwh: number; outKwh: number }>();
  const of = (id: NodeId) => {
    let t = totals.get(id);
    if (!t) {
      t = { inKwh: 0, outKwh: 0 };
      totals.set(id, t);
    }
    return t;
  };
  for (const l of links) {
    of(l.source).outKwh += l.kwh;
    of(l.target).inKwh += l.kwh;
  }
  return totals;
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Text over a drawing: a white edge keeps it legible on any of the tints. */
export const HALO: CSSProperties = { paintOrder: "stroke", stroke: PALETTE.surface, strokeWidth: 3, strokeLinejoin: "round" };

/**
 * kWh as every figure in the app is now written: whole above a hundred, to
 * a tenth below (so "8.0" sits beside "32.2" rather than a bare "8"),
 * grouped, period decimal — fixed rather than following the interface
 * language (see lib/format.ts), so a flow's figure never reformats under a
 * reader switching languages.
 */
export function kwhFormatter(): (kwh: number) => string {
  return formatKwhAuto;
}

/** Which flow the pointer is over, and where, relative to the drawing's wrapper. */
export interface Hover {
  index: number;
  x: number;
  y: number;
}
