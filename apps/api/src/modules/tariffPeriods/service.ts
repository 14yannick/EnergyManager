import { eq, sql } from "drizzle-orm";
import type { TariffPeriod } from "@energy-manager/shared";
import type { TariffPeriodInput } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { tariffPeriods } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";

type Row = typeof tariffPeriods.$inferSelect;

function toDomain(row: Row): TariffPeriod {
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    startTs: row.startTs.toISOString(),
    endTs: row.endTs.toISOString(),
    rateChfPerKwh: toNumber(row.rateChfPerKwh),
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Input timestamps are "YYYY-MM-DDTHH:mm" with no timezone (what
 * <input type="datetime-local"> submits) — interpret as Europe/Zurich local
 * time, matching the Europe/Zurich assumption already hardcoded in
 * daily_energy_agg. Done in SQL (AT TIME ZONE) rather than a JS date library
 * so DST is handled correctly without adding a dependency.
 */
function localTs(value: string) {
  return sql`(${value}::timestamp AT TIME ZONE 'Europe/Zurich')`;
}

export async function listTariffPeriods(siteId: string): Promise<TariffPeriod[]> {
  const rows = await db
    .select()
    .from(tariffPeriods)
    .where(eq(tariffPeriods.siteId, siteId))
    .orderBy(tariffPeriods.kind, tariffPeriods.startTs);
  return rows.map(toDomain);
}

export async function createTariffPeriod(
  siteId: string,
  input: TariffPeriodInput,
): Promise<TariffPeriod> {
  const [row] = await db
    .insert(tariffPeriods)
    .values({
      siteId,
      kind: input.kind,
      startTs: localTs(input.startTs),
      endTs: localTs(input.endTs),
      rateChfPerKwh: input.rateChfPerKwh.toString(),
      label: input.label ?? null,
    })
    .returning();
  return toDomain(row!);
}

export async function updateTariffPeriod(
  id: string,
  input: TariffPeriodInput,
): Promise<TariffPeriod | null> {
  const [row] = await db
    .update(tariffPeriods)
    .set({
      kind: input.kind,
      startTs: localTs(input.startTs),
      endTs: localTs(input.endTs),
      rateChfPerKwh: input.rateChfPerKwh.toString(),
      label: input.label ?? null,
      updatedAt: new Date(),
    })
    .where(eq(tariffPeriods.id, id))
    .returning();
  return row ? toDomain(row) : null;
}

export async function deleteTariffPeriod(id: string): Promise<boolean> {
  const rows = await db.delete(tariffPeriods).where(eq(tariffPeriods.id, id)).returning({ id: tariffPeriods.id });
  return rows.length > 0;
}
