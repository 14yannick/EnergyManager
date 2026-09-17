import { and, eq, sql } from "drizzle-orm";
import type { CommunitySummary } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, parties } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";

/**
 * Site-level totals a participant is allowed to see.
 *
 * Deliberately narrow: how much PV the site generated and how much of it was
 * shared locally, so a participant can see the pool their own local share came
 * out of. No per-party breakdown (that would expose the neighbours to each
 * other), no battery, no export to grid, no money.
 */
export async function getCommunitySummary(
  siteId: string,
  from: string,
  to: string,
): Promise<CommunitySummary> {
  // Same local-midnight bounds the billing engine uses, so the two can't
  // disagree about which intervals fall inside a range.
  const fromBound = sql`(${from}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;

  const [totals, participantRows] = await Promise.all([
    db
      .select({
        productionKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'production'), 0)`,
        localPoolKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'export_local'), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
        ),
      ),
    db.select({ id: parties.id }).from(parties).where(eq(parties.siteId, siteId)),
  ]);

  return {
    from,
    to,
    productionKwh: toNumber(totals[0]?.productionKwh ?? "0"),
    localPoolKwh: toNumber(totals[0]?.localPoolKwh ?? "0"),
    participantCount: participantRows.length,
  };
}
