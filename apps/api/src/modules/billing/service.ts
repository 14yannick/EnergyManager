import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type {
  GridTariffPosition,
  GridTariffPositionInput,
  ParticipantInvoice,
} from "@energy-manager/shared";
import { findRateForInstant } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { gridTariffPositions, intervalMetrics, parties, tariffPeriods } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { buildParticipantInvoice, inclusiveDays, type ParticipantUsage } from "./engine.js";

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

export interface InvoiceRunResult {
  from: string;
  to: string;
  days: number;
  participantCount: number;
  localRateChf: number | null;
  invoices: ParticipantInvoice[];
  warnings: string[];
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
): Promise<InvoiceRunResult> {
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

  // Positions overlapping the period. A position that changes mid-period would
  // be two lines on the provider's own invoice, so flag it rather than
  // silently pricing the whole period at one of them.
  const periodStart = new Date(`${from}T00:00:00Z`).toISOString();
  const periodEnd = new Date(`${to}T23:59:59Z`).toISOString();
  const active = positions.filter((p) => p.validFrom <= periodEnd && p.validTo > periodStart);
  for (const p of active) {
    if (p.validFrom > periodStart || p.validTo <= periodEnd) {
      warnings.push(`"${p.label}" is only valid for part of this period — its rate changed mid-period.`);
    }
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
    findRateForInstant("neighbor_sell", periodEnd, neighbourRates)?.rateChfPerKwh !== localRateChf
  ) {
    warnings.push("The neighbour-sale rate changes during this period; the rate at its start was used.");
  }

  const usageByParty = new Map<string, { grid: number; local: number }>();
  for (const row of usageRows) {
    if (!row.partyId) continue;
    const entry = usageByParty.get(row.partyId) ?? { grid: 0, local: 0 };
    if (row.metricKind === "consumption_grid") entry.grid += toNumber(row.kwh);
    else entry.local += toNumber(row.kwh);
    usageByParty.set(row.partyId, entry);
  }

  const participantCount = participants.length + 1; // + the operator
  const invoices = participants.map((party) => {
    const usage = usageByParty.get(party.id) ?? { grid: 0, local: 0 };
    const participantUsage: ParticipantUsage = {
      partyId: party.id,
      partyReference: party.reference,
      partyName: party.name,
      gridKwh: usage.grid,
      localKwh: usage.local,
    };
    return buildParticipantInvoice({
      from,
      to,
      days,
      participantCount,
      positions: active,
      localRateChf,
      usage: participantUsage,
    });
  });

  if (participants.length === 0) {
    warnings.push("No participants defined yet — add the neighbours sharing your connection.");
  } else if (usageByParty.size === 0) {
    warnings.push("No per-participant consumption recorded for this period.");
  }

  return { from, to, days, participantCount, localRateChf, invoices, warnings };
}
