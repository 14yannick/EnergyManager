import { and, eq, sql } from "drizzle-orm";
import type { PartyConsumption, SavingsQuery } from "@energy-manager/shared";
import { findRateForInstant } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, parties, tariffPeriods } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { participantCountOf } from "../billing/engine.js";
import { listPositions } from "../billing/service.js";
import { daysIn, periodKeyOf, priceConsumption, type PricingUnit } from "./engine.js";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

/**
 * One party's consumption over a range, split into what came from the site's
 * own production and what came off the grid, and priced as the invoice would.
 *
 * Returns null when the party does not exist on this site.
 */
export async function getPartyConsumption(
  siteId: string,
  partyId: string,
  from: string,
  to: string,
  granularity: Granularity,
): Promise<PartyConsumption | null> {
  // Same local-midnight bounds as billing and savings, so the three can't
  // disagree about which intervals fall inside a range.
  const fromBound = sql`(${from}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;
  const localHour = sql<string>`to_char(${intervalMetrics.ts} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD"T"HH24')`;
  const ofParty = and(
    eq(intervalMetrics.siteId, siteId),
    eq(intervalMetrics.partyId, partyId),
    sql`${intervalMetrics.metricKind} in ('consumption', 'consumption_grid')`,
  );

  const [siteParties, usageRows, spanRows, positions, flatRows] = await Promise.all([
    db.select().from(parties).where(eq(parties.siteId, siteId)),
    db
      .select({
        hour: localHour,
        // Per party, `consumption` is the part supplied from local production
        // and `consumption_grid` the part drawn from the grid — the same
        // reading the invoice run makes of them.
        localKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'consumption'), 0)`,
        gridKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'consumption_grid'), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          ofParty,
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
        ),
      )
      .groupBy(localHour),
    db
      .select({
        first: sql<string | null>`to_char(min(${intervalMetrics.ts}) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
        last: sql<string | null>`to_char(max(${intervalMetrics.ts}) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
      })
      .from(intervalMetrics)
      .where(ofParty),
    listPositions(siteId),
    db.select().from(tariffPeriods).where(eq(tariffPeriods.siteId, siteId)),
  ]);

  const party = siteParties.find((p) => p.id === partyId);
  if (!party) return null;

  const usage = new Map(
    usageRows.map((r) => [r.hour, { localKwh: toNumber(r.localKwh), gridKwh: toNumber(r.gridKwh) }]),
  );

  // Every day of the range is a unit, with or without readings: the standing
  // charges accrue on a day whether or not anything was metered on it.
  const units: PricingUnit[] = [];
  for (const day of daysIn(from, to)) {
    if (granularity === "hourly") {
      for (let h = 0; h < 24; h++) {
        const key = periodKeyOf(day, granularity, h);
        const u = usage.get(key);
        units.push({ day, key, days: 1 / 24, localKwh: u?.localKwh ?? 0, gridKwh: u?.gridKwh ?? 0 });
      }
      continue;
    }
    let localKwh = 0;
    let gridKwh = 0;
    for (let h = 0; h < 24; h++) {
      const u = usage.get(`${day}T${String(h).padStart(2, "0")}`);
      localKwh += u?.localKwh ?? 0;
      gridKwh += u?.gridKwh ?? 0;
    }
    units.push({ day, key: periodKeyOf(day, granularity), days: 1, localKwh, gridKwh });
  }

  // Validity is tested at local noon: positions and tariff periods are stored
  // from local midnights, so noon sits safely inside whichever one covers the
  // day, whatever the UTC offset.
  const noon = (day: string) => `${day}T12:00:00.000Z`;
  const neighbourRates = flatRows.map((r) => ({
    kind: r.kind,
    startTs: r.startTs.toISOString(),
    endTs: r.endTs.toISOString(),
    rateChfPerKwh: r.rateChfPerKwh == null ? null : toNumber(r.rateChfPerKwh),
  }));

  const priced = priceConsumption(units, {
    participantCount: participantCountOf(siteParties),
    positionsOn: (day) => positions.filter((p) => p.validFrom <= noon(day) && p.validTo > noon(day)),
    localRateOn: (day) =>
      findRateForInstant("neighbor_sell", noon(day), neighbourRates)?.rateChfPerKwh ?? null,
  });

  return {
    partyId: party.id,
    partyName: party.name,
    from,
    to,
    dataFrom: spanRows[0]?.first ?? null,
    dataTo: spanRows[0]?.last ?? null,
    ...priced,
  };
}
