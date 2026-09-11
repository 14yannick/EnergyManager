import { eq, sql } from "drizzle-orm";
import type { TariffSurcharge, TariffSurchargeInput } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { tariffSurcharges } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";

type Row = typeof tariffSurcharges.$inferSelect;

function toDomain(row: Row): TariffSurcharge {
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

// Same "YYYY-MM-DDTHH:mm" local-time convention as tariffPeriods/service.ts.
function localTs(value: string) {
  return sql`(${value}::timestamp AT TIME ZONE 'Europe/Zurich')`;
}

export async function listTariffSurcharges(siteId: string): Promise<TariffSurcharge[]> {
  const rows = await db
    .select()
    .from(tariffSurcharges)
    .where(eq(tariffSurcharges.siteId, siteId))
    .orderBy(tariffSurcharges.kind, tariffSurcharges.startTs);
  return rows.map(toDomain);
}

export async function createTariffSurcharge(
  siteId: string,
  input: TariffSurchargeInput,
): Promise<TariffSurcharge> {
  const [row] = await db
    .insert(tariffSurcharges)
    .values({
      siteId,
      kind: input.kind,
      startTs: localTs(input.startTs),
      endTs: localTs(input.endTs),
      rateChfPerKwh: input.rateChfPerKwh.toString(),
      label: input.label,
    })
    .returning();
  return toDomain(row!);
}

export async function updateTariffSurcharge(
  id: string,
  input: TariffSurchargeInput,
): Promise<TariffSurcharge | null> {
  const [row] = await db
    .update(tariffSurcharges)
    .set({
      kind: input.kind,
      startTs: localTs(input.startTs),
      endTs: localTs(input.endTs),
      rateChfPerKwh: input.rateChfPerKwh.toString(),
      label: input.label,
      updatedAt: new Date(),
    })
    .where(eq(tariffSurcharges.id, id))
    .returning();
  return row ? toDomain(row) : null;
}

export async function deleteTariffSurcharge(id: string): Promise<boolean> {
  const rows = await db
    .delete(tariffSurcharges)
    .where(eq(tariffSurcharges.id, id))
    .returning({ id: tariffSurcharges.id });
  return rows.length > 0;
}
