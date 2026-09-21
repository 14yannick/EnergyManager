import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type {
  GridTariffPosition,
  GridTariffPositionInput,
  InvoiceRun,
  PostalAddress,
} from "@energy-manager/shared";
import { findRateForInstant } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { gridTariffPositions, intervalMetrics, parties, tariffPeriods } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import {
  buildParticipantInvoice,
  inclusiveDays,
  isBilledParty,
  ownerFixedCosts,
  ownerIsMember,
  participantCountOf,
  periodBounds,
  positionsChangingWithin,
  positionsOverlapping,
  positionsValidOn,
  usageLooksHalfImported,
  type OwnerFixedCosts,
  type ParticipantUsage,
} from "./engine.js";

/**
 * The period straddles a tariff change, so no single invoice can be right
 * for it. Carries what changed, so the caller can say where to split.
 */
export class BillingPeriodError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
    this.name = "BillingPeriodError";
  }
}

type Row = typeof gridTariffPositions.$inferSelect;

function toDomain(row: Row): GridTariffPosition {
  return {
    id: row.id,
    siteId: row.siteId,
    category: row.category,
    label: row.label,
    allocation: row.allocation,
    rateChf: toNumber(row.rateChf),
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    countsInDirectBilling: row.countsInDirectBilling,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Same Europe/Zurich local-time convention as tariffPeriods/service.ts.
function localTs(value: string) {
  return sql`(${value}::timestamp AT TIME ZONE 'Europe/Zurich')`;
}

export async function listPositions(siteId: string): Promise<GridTariffPosition[]> {
  const rows = await db
    .select()
    .from(gridTariffPositions)
    .where(eq(gridTariffPositions.siteId, siteId))
    .orderBy(asc(gridTariffPositions.sortOrder), asc(gridTariffPositions.label));
  return rows.map(toDomain);
}

export async function createPosition(
  siteId: string,
  input: GridTariffPositionInput,
): Promise<GridTariffPosition> {
  const [row] = await db
    .insert(gridTariffPositions)
    .values({
      siteId,
      category: input.category,
      label: input.label,
      allocation: input.allocation,
      rateChf: input.rateChf.toString(),
      validFrom: localTs(input.validFrom),
      validTo: localTs(input.validTo),
      countsInDirectBilling: input.countsInDirectBilling ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return toDomain(row!);
}

export async function updatePosition(
  id: string,
  input: GridTariffPositionInput,
): Promise<GridTariffPosition | null> {
  const [row] = await db
    .update(gridTariffPositions)
    .set({
      category: input.category,
      label: input.label,
      allocation: input.allocation,
      rateChf: input.rateChf.toString(),
      validFrom: localTs(input.validFrom),
      validTo: localTs(input.validTo),
      countsInDirectBilling: input.countsInDirectBilling ?? true,
      sortOrder: input.sortOrder ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(gridTariffPositions.id, id))
    .returning();
  return row ? toDomain(row) : null;
}

export async function deletePosition(id: string): Promise<boolean> {
  const rows = await db
    .delete(gridTariffPositions)
    .where(eq(gridTariffPositions.id, id))
    .returning({ id: gridTariffPositions.id });
  return rows.length > 0;
}

function postalAddressOf(party: typeof parties.$inferSelect): PostalAddress {
  return {
    name: party.name,
    address: party.address,
    buildingNumber: party.buildingNumber,
    zip: party.zip,
    city: party.city,
    country: party.country,
  };
}

/**
 * Builds one invoice per participant for the period.
 *
 * Pool size counts the operator too: the standing charges are divided across
 * everyone behind the connection, and the operator is one of them — with two
 * neighbours the divisor is three. Only the neighbours are invoiced, though;
 * the operator's share is simply the part nobody bills them for.
 */
export async function runInvoices(
  siteId: string,
  from: string,
  to: string,
): Promise<InvoiceRun> {
  const days = inclusiveDays(from, to);
  const warnings: string[] = [];
  const fromBound = sql`(${from}::date AT TIME ZONE 'Europe/Zurich')`;
  const toBoundExclusive = sql`((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`;

  const [positions, participants, usageRows, flatRows] = await Promise.all([
    listPositions(siteId),
    db.select().from(parties).where(eq(parties.siteId, siteId)).orderBy(asc(parties.name)),
    db
      .select({
        partyId: intervalMetrics.partyId,
        metricKind: intervalMetrics.metricKind,
        kwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}), 0)`,
      })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          isNotNull(intervalMetrics.partyId),
          sql`${intervalMetrics.ts} >= ${fromBound}`,
          sql`${intervalMetrics.ts} < ${toBoundExclusive}`,
          sql`${intervalMetrics.metricKind} in ('consumption', 'consumption_grid')`,
        ),
      )
      .groupBy(intervalMetrics.partyId, intervalMetrics.metricKind),
    db.select().from(tariffPeriods).where(eq(tariffPeriods.siteId, siteId)),
  ]);

  // Positions overlapping the period. Every one handed to the engine is
  // billed for the whole period, so a position that changes inside it must
  // stop the run, not decorate it with a warning: both versions would print
  // at full length and the participant would pay the base charge twice.
  // Local midnights, as positions and tariff periods are stored. A UTC
  // `${to}T23:59:59Z` overshoots the period by an hour or two, which let the
  // next period's positions in and read a boundary as a mid-period change.
  const { startIso: periodStart, endExclusiveIso: periodEndExclusive } = periodBounds(from, to);
  // The last instant that is still inside the period.
  const periodLast = new Date(new Date(periodEndExclusive).getTime() - 1).toISOString();
  const active = positionsOverlapping(positions, from, to);
  const refusals: string[] = [];
  const changing = positionsChangingWithin(positions, from, to);
  if (changing.length > 0) {
    const named = [...new Set(changing.map((p) => `"${p.label}"`))].join(", ");
    // Positions start at Zurich midnight, which is 23:00 UTC the day before —
    // naming the change by its UTC face would put it on the wrong day.
    const zurichDay = (iso: string) =>
      new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
    const edges = [...new Set(changing.flatMap((p) => [p.validFrom, p.validTo]))]
      .filter((ts) => ts > periodStart && ts < periodEndExclusive)
      .map(zurichDay)
      .filter((d, i, all) => all.indexOf(d) === i)
      .sort();
    refusals.push(
      `${named} ${changing.length === 1 ? "changes" : "change"} during this period` +
        (edges.length > 0 ? ` (on ${edges.join(", ")}).` : ".") +
        " Bill the stretches on either side separately.",
    );
  }
  if (active.length === 0) {
    warnings.push("No grid tariff positions are valid for this period.");
  }

  // A period's rate is nullable now that a period can be priced from the
  // day-ahead feed instead. Billing has no use for a dynamic neighbour rate —
  // neighbour sales are negotiated, not spot-priced — so a null here flows into
  // the "not priced" warning below rather than being treated as zero.
  const neighbourRates = flatRows.map((r) => ({
    kind: r.kind,
    startTs: r.startTs.toISOString(),
    endTs: r.endTs.toISOString(),
    rateChfPerKwh: r.rateChfPerKwh == null ? null : toNumber(r.rateChfPerKwh),
  }));
  const localRateChf =
    findRateForInstant("neighbor_sell", periodStart, neighbourRates)?.rateChfPerKwh ?? null;
  if (localRateChf === null) {
    warnings.push("No neighbour-sale tariff covers this period — locally supplied energy isn't priced.");
  } else if (
    findRateForInstant("neighbor_sell", periodLast, neighbourRates)?.rateChfPerKwh !== localRateChf
  ) {
    // The same rule as the positions: an agreed price that changes inside the
    // period is two invoices, not one priced at whichever end was picked.
    refusals.push(
      "The neighbour-sale rate changes during this period. Bill the stretches on either side separately.",
    );
  }
  if (refusals.length > 0) throw new BillingPeriodError(refusals);

  const usageByParty = new Map<string, { grid: number; local: number }>();
  for (const row of usageRows) {
    if (!row.partyId) continue;
    const entry = usageByParty.get(row.partyId) ?? { grid: 0, local: 0 };
    if (row.metricKind === "consumption_grid") entry.grid += toNumber(row.kwh);
    else entry.local += toNumber(row.kwh);
    usageByParty.set(row.partyId, entry);
  }

  // An `rcp_admin` is invoiced like anyone else — running the RCP does not
  // exempt you from paying for what you consumed. Only `rcp_admin_only` and
  // `viewer` are left out, of invoices and of the count alike.
  const billable = participants.filter(isBilledParty);
  const participantCount = participantCountOf(participants);

  // The owner's own consumption that never crossed the meter — PV used as
  // made, load covered from the battery — comes from the savings engine, so
  // the invoice cannot disagree with the dashboard about it. Only the owner
  // has it; a participant's local energy is a purchase, already in `local`.
  // Imported on demand rather than at the top: savings/service imports this
  // module for the owner's fixed costs, and a static import back would be a
  // cycle that resolves to `undefined` depending on who loads first.
  const owner = participants.find((p) => p.role === "rcp_admin");
  let self = { directKwh: 0, batteryKwh: 0 };
  if (owner) {
    const { getDailySavings } = await import("../savings/service.js");
    const [overall] = await getDailySavings(siteId, from, to, "overall");
    self = {
      directKwh: Math.max(overall?.directUseKwh ?? 0, 0),
      batteryKwh: Math.max(overall?.batteryDischargeConsumedKwh ?? 0, 0),
    };
  }

  const invoices = billable.map((party) => {
    const usage = usageByParty.get(party.id) ?? { grid: 0, local: 0 };
    const participantUsage: ParticipantUsage = {
      partyId: party.id,
      partyReference: party.reference,
      partyName: party.name,
      gridKwh: usage.grid,
      localKwh: usage.local,
      ...(party.id === owner?.id ? { selfDirectKwh: self.directKwh, selfBatteryKwh: self.batteryKwh } : {}),
    };
    const invoice = buildParticipantInvoice({
      from,
      to,
      days,
      participantCount,
      positions: active,
      localRateChf,
      usage: participantUsage,
    });
    return { ...invoice, payer: postalAddressOf(party) };
  });

  // Whoever administers the RCP is the QR-bill's payee, whether or not they
  // are also billed by it. Their IBAN and address are printed on every bill,
  // so handing them to a participant discloses nothing the bill doesn't.
  const admin = participants.find((p) => p.role === "rcp_admin" || p.role === "rcp_admin_only");
  const payee = admin ? { ...postalAddressOf(admin), partyId: admin.id, iban: admin.iban } : null;

  if (billable.length === 0) {
    warnings.push("No participants defined yet — add the neighbours sharing your connection.");
  } else if (usageByParty.size === 0) {
    warnings.push("No per-participant consumption recorded for this period.");
  }
  // Per party, not only when everything is missing: a half-imported party is
  // the one the total check cannot see, and its invoice is the one that goes
  // out wrong.
  for (const party of billable) {
    const usage = usageByParty.get(party.id);
    if (usage && usageLooksHalfImported({ localKwh: usage.local, gridKwh: usage.grid })) {
      warnings.push(
        `${party.name}: local energy was imported for this period but no grid draw — every per-kWh position bills zero. Import the consumption_grid series before sending this invoice.`,
      );
    }
  }

  return { from, to, days, participantCount, localRateChf, payee, invoices, warnings };
}

/**
 * The owner's standing charges for any day, alone and inside the RCP — or null
 * when the owner is not a member (an `rcp_admin_only` administrator), who then
 * has no share in the connection to gain from.
 */
export async function loadOwnerFixedCosts(
  siteId: string,
): Promise<((day: string, days: number) => OwnerFixedCosts) | null> {
  const [positions, siteParties] = await Promise.all([
    listPositions(siteId),
    db.select({ role: parties.role }).from(parties).where(eq(parties.siteId, siteId)),
  ]);
  if (!ownerIsMember(siteParties)) return null;
  const participantCount = participantCountOf(siteParties);
  return (day, days) => ownerFixedCosts(positionsValidOn(positions, day), participantCount, days);
}
