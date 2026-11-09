import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PartyConsumption, SavingsQuery } from "@energy-manager/shared";
import { effectiveSensorProfile, findRateForInstant } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, parties, tariffPeriods } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { participantCountOn, partyValidForPeriod, positionsValidOn } from "../billing/engine.js";
import { listPositions } from "../billing/service.js";
import { localQuarterKey } from "../savings/service.js";
import { loadVzevSettlement } from "../vzev/settlement.js";
import {
  daysIn,
  periodKeyOf,
  priceConsumption,
  type PricingContext,
  type PricingUnit,
} from "./engine.js";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

/** Local midnight bounds, the same ones billing and savings use. */
const rangeBounds = (from: string, to: string) => ({
  fromBound: sql`(${from}::date AT TIME ZONE 'Europe/Zurich')`,
  toBoundExclusive: sql`((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`,
});

/**
 * How a party's consumption is priced on any day of the range: the positions
 * in force, the agreed neighbour rate, and how many share the fixed costs.
 *
 * One loader for both views, so a participant's own page and the owner's
 * per-participant table can never price the same day differently.
 */
async function loadPricingContext(
  siteId: string,
): Promise<{ ctx: PricingContext; memberOn: (partyId: string, day: string) => boolean }> {
  const [siteParties, positions, flatRows] = await Promise.all([
    db
      .select({ id: parties.id, role: parties.role, startDate: parties.startDate, endDate: parties.endDate })
      .from(parties)
      .where(eq(parties.siteId, siteId)),
    listPositions(siteId),
    db.select().from(tariffPeriods).where(eq(tariffPeriods.siteId, siteId)),
  ]);
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
  const byId = new Map(siteParties.map((p) => [p.id, p]));
  return {
    ctx: {
      participantCountOn: (day) => participantCountOn(siteParties, day),
      positionsOn: (day) => positionsValidOn(positions, day),
      localRateOn: (day) =>
        findRateForInstant("neighbor_sell", noon(day), neighbourRates)?.rateChfPerKwh ?? null,
    },
    // A party unknown to the site was never a member.
    memberOn: (partyId, day) => {
      const party = byId.get(partyId);
      return party != null && partyValidForPeriod(party, day, day);
    },
  };
}

/** One party's draw in one local quarter-hour, split by where it came from. */
interface HourDraw {
  localKwh: number;
  gridKwh: number;
}

/**
 * Every party's draw over the range, by local quarter-hour
 * ("YYYY-MM-DDTHH:MM"; an hour's readings land on its :00), from
 * the same settlement the revenue and the vZEV view read: the grid
 * provider's split where it is in, else the party's own import sensor,
 * shared by the vZEV's rule (see vzev/settlement.ts).
 *
 * A producer's share worked out from their sensor is all grid here: in the
 * same quarter-hour they fed in, their draw bought nothing from the vZEV —
 * the revenue side counts that energy as exported, and this side, to agree
 * with it, counts the draw as imported. The provider's own split, when it
 * comes, is taken as given for them like for anyone.
 */
async function loadPartyDraws(
  siteId: string,
  fromBound: SQL,
  toBoundExclusive: SQL,
): Promise<Map<string, Map<string, HourDraw>>> {
  const [settlement, siteParties] = await Promise.all([
    loadVzevSettlement(siteId, fromBound, toBoundExclusive),
    db.select().from(parties).where(eq(parties.siteId, siteId)),
  ]);
  const producers = new Set(siteParties.filter((p) => effectiveSensorProfile(p).feedIn).map((p) => p.id));
  const draws = new Map<string, Map<string, HourDraw>>();
  for (const interval of settlement) {
    const key = localQuarterKey(interval.ts);
    for (const share of interval.shares) {
      const ownFeedIn = !share.official && producers.has(share.partyId);
      const hours = draws.get(share.partyId) ?? new Map<string, HourDraw>();
      const sum = hours.get(key) ?? { localKwh: 0, gridKwh: 0 };
      sum.localKwh += ownFeedIn ? 0 : share.local;
      sum.gridKwh += ownFeedIn ? share.local + share.grid : share.grid;
      hours.set(key, sum);
      draws.set(share.partyId, hours);
    }
  }
  return draws;
}

/**
 * What each party saved against being supplied directly, keyed by party id —
 * the figure their own Consumption page leads with. Priced through the same
 * context and the same engine, so the two always agree.
 */
export async function savedByParty(siteId: string, from: string, to: string): Promise<Map<string, number>> {
  const { fromBound, toBoundExclusive } = rangeBounds(from, to);
  const [draws, { ctx, memberOn }] = await Promise.all([
    loadPartyDraws(siteId, fromBound, toBoundExclusive),
    loadPricingContext(siteId),
  ]);

  const byParty = new Map<string, Map<string, HourDraw>>();
  for (const [partyId, hours] of draws) {
    const days = new Map<string, HourDraw>();
    for (const [hour, draw] of hours) {
      const day = hour.slice(0, 10);
      const sum = days.get(day) ?? { localKwh: 0, gridKwh: 0 };
      sum.localKwh += draw.localKwh;
      sum.gridKwh += draw.gridKwh;
      days.set(day, sum);
    }
    byParty.set(partyId, days);
  }

  const saved = new Map<string, number>();
  const rangeDays = daysIn(from, to);
  for (const [partyId, days] of byParty) {
    // Every day of the range, with or without readings: the standing charges
    // accrue either way, exactly as on the party's own page.
    const units: PricingUnit[] = rangeDays.map((day) => ({
      day,
      key: day,
      days: 1,
      localKwh: days.get(day)?.localKwh ?? 0,
      gridKwh: days.get(day)?.gridKwh ?? 0,
      member: memberOn(partyId, day),
    }));
    saved.set(partyId, priceConsumption(units, ctx).totals.savedChf);
  }
  return saved;
}

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
  const { fromBound, toBoundExclusive } = rangeBounds(from, to);
  // What this party has ever had metered: the provider's split, or their own
  // import sensor — the span the period picker may reach over.
  const ofParty = and(
    eq(intervalMetrics.siteId, siteId),
    eq(intervalMetrics.partyId, partyId),
    sql`${intervalMetrics.metricKind} in ('consumption', 'consumption_grid', 'import_grid')`,
  );

  const [siteParties, draws, spanRows, { ctx, memberOn }] = await Promise.all([
    db.select().from(parties).where(eq(parties.siteId, siteId)),
    loadPartyDraws(siteId, fromBound, toBoundExclusive),
    db
      .select({
        first: sql<string | null>`to_char(min(${intervalMetrics.ts}) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
        last: sql<string | null>`to_char(max(${intervalMetrics.ts}) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
      })
      .from(intervalMetrics)
      .where(ofParty),
    loadPricingContext(siteId),
  ]);

  const party = siteParties.find((p) => p.id === partyId);
  if (!party) return null;

  const usage = draws.get(partyId) ?? new Map<string, HourDraw>();

  // Every day of the range is a unit, with or without readings: the standing
  // charges accrue on a day whether or not anything was metered on it.
  const units: PricingUnit[] = [];
  // The draws summed into whatever unit the view prices in: a quarter-hour
  // as stored, its hour ("YYYY-MM-DDTHH"), or its day — each total built in
  // one pass, so a year of days does not rescan every quarter-hour per day.
  const totals = new Map<string, HourDraw>();
  const addTo = (key: string, draw: HourDraw) => {
    const sum = totals.get(key) ?? { localKwh: 0, gridKwh: 0 };
    sum.localKwh += draw.localKwh;
    sum.gridKwh += draw.gridKwh;
    totals.set(key, sum);
  };
  for (const [key, draw] of usage) {
    addTo(key.slice(0, 13), draw);
    addTo(key.slice(0, 10), draw);
  }
  const sumOver = (key: string): HourDraw => totals.get(key) ?? { localKwh: 0, gridKwh: 0 };
  for (const day of daysIn(from, to)) {
    const member = memberOn(partyId, day);
    if (granularity === "quarter_hourly") {
      for (let q = 0; q < 96; q++) {
        const key = periodKeyOf(day, granularity, Math.floor(q / 4), (q % 4) * 15);
        const u = usage.get(key);
        units.push({ day, key, days: 1 / 96, localKwh: u?.localKwh ?? 0, gridKwh: u?.gridKwh ?? 0, member });
      }
      continue;
    }
    if (granularity === "hourly") {
      for (let h = 0; h < 24; h++) {
        const key = periodKeyOf(day, granularity, h);
        units.push({ day, key, days: 1 / 24, ...sumOver(key), member });
      }
      continue;
    }
    units.push({ day, key: periodKeyOf(day, granularity), days: 1, ...sumOver(day), member });
  }

  const priced = priceConsumption(units, ctx);

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
