import {
  effectiveSensorProfile,
  isVzevMember,
  settleVzevExport,
  type PartySensorProfile,
  type VzevIntervalParty,
} from "@energy-manager/shared";

/** One stored reading that bears on where the export went, summed per interval, party and kind. */
export interface SettlementReading {
  ts: Date;
  partyId: string | null;
  metricKind: "export" | "export_grid" | "consumption" | "consumption_grid" | "import_grid";
  kwh: number;
}

/** What the settlement needs to know of a party: whether they have a meter in the vZEV, and whether they feed in. */
export interface SettlementParty {
  id: string;
  member: boolean;
  producer: boolean;
}

/** One party's draw in one interval, and how it was covered. */
export interface SettledShare {
  partyId: string;
  local: number;
  grid: number;
  /** The grid provider's own split, not one worked out from a sensor. */
  official: boolean;
}

/**
 * One interval of the vZEV, settled: what left the producers' meters, who
 * took it, and what reached the grid (see `settleVzevExport` for the rule,
 * and for how the grid provider's figures take precedence over it).
 *
 * `shares` is the energy view: every member's draw, a producer's own among
 * them. `sales` and `unsoldKwh` are the same interval read for money — see
 * `settleReadings`.
 */
export interface SettledInterval {
  ts: Date;
  exportKwh: number;
  gridKwh: number;
  gridOfficial: boolean;
  shares: SettledShare[];
  /** What was sold to participants, per party. */
  sales: Array<{ partyId: string; kwh: number }>;
  /** Their sum. */
  salesKwh: number;
  /** The export that was not sold to a participant, and so is paid at the feed-in rate. */
  unsoldKwh: number;
}

/**
 * Settle a range's readings, one interval at a time.
 *
 * A party arrives with the grid provider's split of their consumption
 * (`consumption` and `consumption_grid`) where that is in; otherwise a
 * member arrives with what their own meter drew (`import_grid`), still to
 * be shared.
 *
 * For money, a sale is what a participant took from the export. The
 * provider's split is a sale whoever it names — that is its settlement. A
 * share worked out here is one only for a party who does not feed in: a
 * producer drawing in the same quarter-hour they fed in has bought nothing
 * from themselves, so until the provider says otherwise that energy stays
 * with the export paid at the feed-in rate. Where the provider has stated
 * the grid export, that is the unsold part, as given.
 */
export function settleReadings(readings: ReadonlyArray<SettlementReading>, siteParties: ReadonlyArray<SettlementParty>): SettledInterval[] {
  const partyById = new Map(siteParties.map((p) => [p.id, p]));
  type Draw = { local?: number; grid?: number; metered?: number };
  const byInterval = new Map<number, { ts: Date; exportKwh: number | null; officialGridKwh: number | null; draws: Map<string, Draw> }>();

  for (const r of readings) {
    const key = r.ts.getTime();
    const interval = byInterval.get(key) ?? { ts: r.ts, exportKwh: null, officialGridKwh: null, draws: new Map<string, Draw>() };
    byInterval.set(key, interval);
    if (r.metricKind === "export") {
      interval.exportKwh = (interval.exportKwh ?? 0) + r.kwh;
      continue;
    }
    if (r.metricKind === "export_grid") {
      interval.officialGridKwh = (interval.officialGridKwh ?? 0) + r.kwh;
      continue;
    }
    if (!r.partyId) continue;
    // A sensor's draw counts for a member only; the provider's split names
    // whom it names.
    if (r.metricKind === "import_grid" && !partyById.get(r.partyId)?.member) continue;
    const draw = interval.draws.get(r.partyId) ?? {};
    interval.draws.set(r.partyId, draw);
    if (r.metricKind === "consumption") draw.local = (draw.local ?? 0) + r.kwh;
    else if (r.metricKind === "consumption_grid") draw.grid = (draw.grid ?? 0) + r.kwh;
    else draw.metered = (draw.metered ?? 0) + r.kwh;
  }

  return [...byInterval.values()]
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((interval) => {
      const settled = settleVzevExport({
        exportKwh: interval.exportKwh,
        officialGridKwh: interval.officialGridKwh,
        parties: [...interval.draws].map(
          ([id, d]): VzevIntervalParty =>
            d.local != null || d.grid != null ? { id, official: { local: d.local ?? 0, grid: d.grid ?? 0 } } : { id, demand: d.metered },
        ),
      });
      const sales = settled.shares
        .filter((s) => s.local > 0 && (s.official || !partyById.get(s.id)?.producer))
        .map((s) => ({ partyId: s.id, kwh: s.local }));
      const salesKwh = sales.reduce((sum, s) => sum + s.kwh, 0);
      return {
        ts: interval.ts,
        exportKwh: settled.exportKwh,
        gridKwh: settled.gridKwh,
        gridOfficial: settled.gridOfficial,
        shares: settled.shares.map((s) => ({ partyId: s.id, local: s.local, grid: s.grid, official: s.official })),
        sales,
        salesKwh,
        unsoldKwh: settled.gridOfficial ? settled.gridKwh : Math.max(settled.exportKwh - salesKwh, 0),
      };
    });
}

/** Who is in the vZEV, as the settlement needs it. */
export function settlementPartiesOf(
  siteParties: ReadonlyArray<PartySensorProfile & { id: string }>,
): SettlementParty[] {
  return siteParties.map((p) => ({ id: p.id, member: isVzevMember(p.role), producer: effectiveSensorProfile(p).feedIn }));
}
