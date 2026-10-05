import { and, eq, inArray, sql } from "drizzle-orm";
import { effectiveSensorProfile, isVzevMember, type VzevLiveView } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, parties } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { activeSensors } from "../partySensors/service.js";
import { loadVzevSettlement } from "../vzev/settlement.js";
import { fetchHaNumericStates } from "./haClient.js";
import { SITE_TZ, localDayHour } from "./forecastCurve.js";

/**
 * The vZEV right now and today so far, as a participant sees it (see
 * VzevLiveView): what the plants make and feed in, summed over the
 * producers, and what the participants draw — the viewer's own, and the
 * others' together.
 *
 * `viewerPartyId` is whose view it is. The route decides that: a
 * participant is always themselves, an admin or a viewer may name anybody
 * on the site. Nobody's consumption but the viewer's is returned on its
 * own; the rest only ever as one sum.
 *
 * Returns null when the viewer is not on this site.
 */
export async function getVzevLiveView(
  siteId: string,
  viewerPartyId: string | null,
  /** The instant "today" is read against — the present, unless a caller is checking another day. */
  now: Date = new Date(),
): Promise<VzevLiveView | null> {
  const siteParties = await db.select().from(parties).where(eq(parties.siteId, siteId));
  const viewerRow = viewerPartyId ? siteParties.find((p) => p.id === viewerPartyId) : undefined;
  if (viewerPartyId && !viewerRow) return null;

  const producers = new Set(siteParties.filter((p) => effectiveSensorProfile(p).feedIn).map((p) => p.id));
  // Who draws from the vZEV: every member with a meter in it. A producer is
  // one of them. What their plant makes and keeps is in the production
  // figures; what their meter draws — at night, or from another producer's
  // plant — is consumption like anyone's, and the vZEV's feed-in covers it
  // on the same terms.
  const consumers = siteParties.filter((p) => isVzevMember(p.role));
  const viewerConsumes = viewerRow != null && consumers.some((p) => p.id === viewerRow.id);
  const otherIds = new Set(consumers.filter((p) => p.id !== viewerRow?.id).map((p) => p.id));

  const [power, today] = await Promise.all([
    readPower(siteId, producers, viewerConsumes ? viewerRow!.id : null, otherIds),
    readToday(siteId, now, viewerConsumes ? viewerRow!.id : null, otherIds),
  ]);

  return {
    at: now.toISOString(),
    producerCount: producers.size,
    viewer: viewerRow
      ? { partyId: viewerRow.id, name: viewerRow.name, isProducer: producers.has(viewerRow.id), consumes: viewerConsumes }
      : null,
    power,
    today,
  };
}

/** The instant's watts, from the participants' live sensors. */
async function readPower(
  siteId: string,
  producers: Set<string>,
  viewerId: string | null,
  otherIds: Set<string>,
): Promise<VzevLiveView["power"]> {
  const sensors = await activeSensors(siteId, "live");
  const states = sensors.length > 0 ? await fetchHaNumericStates([...new Set(sensors.map((s) => s.entityId))]) : new Map<string, number>();

  /** One kind's readings among some participants, each turned the way its kind names. */
  const values = (kind: (typeof sensors)[number]["kind"], of: (partyId: string) => boolean): number[] =>
    sensors
      .filter((s) => s.kind === kind && of(s.partyId))
      .map((s) => {
        const value = states.get(s.entityId);
        return value == null ? null : s.inverted ? -value : value;
      })
      .filter((v): v is number => v != null);
  const sum = (list: number[]): number | null => (list.length === 0 ? null : list.reduce((a, b) => a + b, 0));

  const isProducer = (id: string) => producers.has(id);
  /**
   * What one member is drawing at their meter. Their import sensor where
   * they map one. Failing that, a producer's export sensor read the other
   * way: it is the same meter, and it reads one direction at a time. Null
   * when neither says anything.
   */
  const drawOf = (partyId: string): number | null => {
    const imported = sum(values("live_import_power", (id) => id === partyId).map((v) => Math.max(v, 0)));
    if (imported != null) return imported;
    return sum(values("live_export_power", (id) => id === partyId).map((v) => Math.max(-v, 0)));
  };
  const known = [...otherIds].map(drawOf).filter((v): v is number => v != null);

  return {
    productionW: sum(values("live_pv_power", isProducer)),
    // Each producer's own surplus, never netted against another's draw: a
    // plant importing at this moment takes nothing off what its neighbour
    // is feeding in.
    feedInW: sum(values("live_export_power", isProducer).map((v) => Math.max(v, 0))),
    ownW: viewerId ? drawOf(viewerId) : null,
    othersW: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * The day's kWh so far, from the readings — and how the participants'
 * consumption was covered, settled one interval at a time.
 *
 * The settlement cannot be done on the day's totals: what the plants feed in
 * at noon covers nobody's evening. So each stored interval is settled on
 * its own (see vzev/settlement.ts) — the feed-in of that quarter-hour
 * against what each member drew in it — and the results are summed.
 */
async function readToday(
  siteId: string,
  now: Date,
  viewerId: string | null,
  otherIds: Set<string>,
): Promise<VzevLiveView["today"]> {
  const { day } = localDayHour(now);
  // The zone as a literal — a constant of ours — as in liveView.ts.
  const zone = sql.raw(`'${SITE_TZ}'`);
  const fromBound = sql`(${day}::date at time zone ${zone})`;
  const toBoundExclusive = sql`((${day}::date + interval '1 day') at time zone ${zone})`;
  const [made, settlement] = await Promise.all([
    db
      .select({
        productionKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'production'), 0)`,
        batteryChargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
          inArray(intervalMetrics.metricKind, ["production", "battery_charge"]),
        ),
      ),
    // The same settlement the revenue is priced from: the grid provider's
    // split of a member's consumption where that is in, else what their
    // import sensor metered, shared by the vZEV's rule.
    loadVzevSettlement(siteId, fromBound, toBoundExclusive),
  ]);

  // What the plants made is their AC production plus what went into their
  // batteries, which production alone never counted — the same "made" the
  // day's curve shows.
  const producedKwh = toNumber(made[0]?.productionKwh ?? "0") + toNumber(made[0]?.batteryChargeKwh ?? "0");

  const members = new Set([...otherIds, ...(viewerId ? [viewerId] : [])]);
  const covered = new Map<string, { local: number; grid: number }>();
  let feedInKwh = 0;
  let surplusKwh = 0;
  for (const interval of settlement) {
    feedInKwh += interval.exportKwh;
    surplusKwh += interval.gridKwh;
    for (const share of interval.shares) {
      if (!members.has(share.partyId)) continue;
      const sum = covered.get(share.partyId) ?? { local: 0, grid: 0 };
      sum.local += share.local;
      sum.grid += share.grid;
      covered.set(share.partyId, sum);
    }
  }

  const own = viewerId ? covered.get(viewerId) : undefined;
  const others = [...otherIds].map((id) => covered.get(id)).filter((c): c is { local: number; grid: number } => c != null);
  const othersLocalKwh = others.length > 0 ? others.reduce((sum, c) => sum + c.local, 0) : null;
  const othersGridKwh = others.length > 0 ? others.reduce((sum, c) => sum + c.grid, 0) : null;

  return {
    producedKwh,
    feedInKwh,
    // A battery discharging to the grid can push the feed-in past what was
    // made; that is not negative own use.
    keptKwh: Math.max(producedKwh - feedInKwh, 0),
    ownKwh: own ? own.local + own.grid : null,
    othersKwh: othersLocalKwh != null && othersGridKwh != null ? othersLocalKwh + othersGridKwh : null,
    ownLocalKwh: own?.local ?? null,
    ownGridKwh: own?.grid ?? null,
    othersLocalKwh,
    othersGridKwh,
    surplusKwh,
  };
}
