import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { IntervalMetricKind } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, parties } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import type { ParsedMetricRow } from "./csvImport.js";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Finds or creates a party per name, for a site. Party names come from the
 * CSV (not ids), so every consumption row needs its name resolved first. */
async function resolvePartyIds(siteId: string, names: string[]): Promise<Map<string, string>> {
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length === 0) return new Map();

  await db
    .insert(parties)
    .values(uniqueNames.map((name) => ({ siteId, name })))
    .onConflictDoNothing();

  const rows = await db
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(and(eq(parties.siteId, siteId), inArray(parties.name, uniqueNames)));
  return new Map(rows.map((r) => [r.name, r.id]));
}

export async function upsertReadings(
  siteId: string,
  rows: ParsedMetricRow[],
): Promise<{ inserted: number; updated: number }> {
  const partyIdByName = await resolvePartyIds(
    siteId,
    rows.filter((r): r is ParsedMetricRow & { party: string } => r.party !== null).map((r) => r.party),
  );

  let inserted = 0;
  let updated = 0;

  for (const batch of chunk(rows, 500)) {
    const withoutParty = batch.filter((r) => r.party === null);
    const withParty = batch.filter((r) => r.party !== null);

    if (withoutParty.length > 0) {
      const result = await db
        .insert(intervalMetrics)
        .values(
          withoutParty.map((r) => ({
            siteId,
            ts: new Date(r.ts),
            metricKind: r.metricKind,
            partyId: null,
            valueKwh: r.valueKwh.toString(),
            source: "csv_import",
          })),
        )
        .onConflictDoUpdate({
          target: [intervalMetrics.siteId, intervalMetrics.ts, intervalMetrics.metricKind],
          targetWhere: sql`${intervalMetrics.partyId} IS NULL`,
          set: { valueKwh: sql`excluded.value_kwh` },
        })
        .returning({ wasInsert: sql<boolean>`(xmax = 0)` });
      for (const r of result) {
        if (r.wasInsert) inserted++;
        else updated++;
      }
    }

    if (withParty.length > 0) {
      const result = await db
        .insert(intervalMetrics)
        .values(
          withParty.map((r) => ({
            siteId,
            ts: new Date(r.ts),
            metricKind: r.metricKind,
            partyId: partyIdByName.get(r.party!)!,
            valueKwh: r.valueKwh.toString(),
            source: "csv_import",
          })),
        )
        .onConflictDoUpdate({
          target: [
            intervalMetrics.siteId,
            intervalMetrics.ts,
            intervalMetrics.metricKind,
            intervalMetrics.partyId,
          ],
          targetWhere: sql`${intervalMetrics.partyId} IS NOT NULL`,
          set: { valueKwh: sql`excluded.value_kwh` },
        })
        .returning({ wasInsert: sql<boolean>`(xmax = 0)` });
      for (const r of result) {
        if (r.wasInsert) inserted++;
        else updated++;
      }
    }
  }

  return { inserted, updated };
}

export async function listReadings(siteId: string, from: string, to: string) {
  return db
    .select()
    .from(intervalMetrics)
    .where(
      and(
        eq(intervalMetrics.siteId, siteId),
        gte(intervalMetrics.ts, new Date(from)),
        lte(intervalMetrics.ts, new Date(to)),
      ),
    )
    .orderBy(intervalMetrics.ts);
}

/**
 * The Europe/Zurich calendar days the site has any reading for, so a UI can
 * offer an "all data" range without guessing at an arbitrary start.
 */
export async function getReadingsRange(
  siteId: string,
): Promise<{ from: string; to: string } | null> {
  const [row] = await db
    .select({
      from: sql<string | null>`to_char(min(${intervalMetrics.ts}) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
      to: sql<string | null>`to_char(max(${intervalMetrics.ts}) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
    })
    .from(intervalMetrics)
    .where(eq(intervalMetrics.siteId, siteId));
  if (!row?.from || !row.to) return null;
  return { from: row.from, to: row.to };
}

export interface ExportedReadingRow {
  localDate: string;
  localTime: string;
  ts: Date;
  metricKind: IntervalMetricKind;
  party: string | null;
  valueKwh: number;
  source: string;
}

/**
 * Rows for the spreadsheet export. `from`/`to` are inclusive Europe/Zurich
 * calendar days converted to UTC in SQL (same convention as the savings
 * queries) — a naive UTC bound would drop a day's worth of readings stamped
 * at local midnight whenever Zurich is ahead of UTC.
 */
export async function exportReadings(
  siteId: string,
  from: string,
  to: string,
  kinds?: IntervalMetricKind[],
): Promise<ExportedReadingRow[]> {
  const rows = await db
    .select({
      localDate: sql<string>`to_char(${intervalMetrics.ts} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`,
      localTime: sql<string>`to_char(${intervalMetrics.ts} AT TIME ZONE 'Europe/Zurich', 'HH24:MI')`,
      ts: intervalMetrics.ts,
      metricKind: intervalMetrics.metricKind,
      party: parties.name,
      valueKwh: intervalMetrics.valueKwh,
      source: intervalMetrics.source,
    })
    .from(intervalMetrics)
    .leftJoin(parties, eq(intervalMetrics.partyId, parties.id))
    .where(
      and(
        eq(intervalMetrics.siteId, siteId),
        sql`${intervalMetrics.ts} >= (${from}::date AT TIME ZONE 'Europe/Zurich')`,
        sql`${intervalMetrics.ts} < ((${to}::date + interval '1 day') AT TIME ZONE 'Europe/Zurich')`,
        kinds && kinds.length > 0 ? inArray(intervalMetrics.metricKind, kinds) : undefined,
      ),
    )
    .orderBy(intervalMetrics.ts, intervalMetrics.metricKind);

  return rows.map((r) => ({ ...r, valueKwh: toNumber(r.valueKwh) }));
}

export async function deleteReadings(siteId: string, from: string, to: string): Promise<number> {
  const rows = await db
    .delete(intervalMetrics)
    .where(
      and(
        eq(intervalMetrics.siteId, siteId),
        gte(intervalMetrics.ts, new Date(from)),
        lte(intervalMetrics.ts, new Date(to)),
      ),
    )
    .returning({ ts: intervalMetrics.ts });
  return rows.length;
}
