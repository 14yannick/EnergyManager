import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { intervalMetrics, parties } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { settleReadings, settlementPartiesOf, type SettledInterval, type SettlementReading } from "./engine.js";

/**
 * A range of the site, settled — the one place the export's split is read
 * from the database, so the revenue, the sales to participants and the
 * vZEV's own view cannot disagree about where a kWh went.
 *
 * The bounds are SQL instants (half-open), as every caller already builds
 * them from local days.
 */
export async function loadVzevSettlement(
  siteId: string,
  fromBound: SQL,
  toBoundExclusive: SQL,
): Promise<SettledInterval[]> {
  const [siteParties, rows] = await Promise.all([
    db.select().from(parties).where(eq(parties.siteId, siteId)),
    db
      .select({
        ts: intervalMetrics.ts,
        partyId: intervalMetrics.partyId,
        metricKind: intervalMetrics.metricKind,
        kwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
          inArray(intervalMetrics.metricKind, ["export", "export_grid", "consumption", "consumption_grid", "import_grid"]),
        ),
      )
      .groupBy(intervalMetrics.ts, intervalMetrics.partyId, intervalMetrics.metricKind),
  ]);

  return settleReadings(
    rows.map((r) => ({
      ts: r.ts,
      partyId: r.partyId,
      metricKind: r.metricKind as SettlementReading["metricKind"],
      kwh: toNumber(r.kwh),
    })),
    settlementPartiesOf(siteParties),
  );
}
