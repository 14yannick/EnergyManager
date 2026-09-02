import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DynamicTariffRate, TariffKind } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { dynamicTariffRates, sites } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { fetchBkwFeedIn } from "./bkwClient.js";

const BKW_SOURCE = "bkw_dyntariffs";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Row = typeof dynamicTariffRates.$inferSelect;

function toDomain(row: Row): DynamicTariffRate {
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    startTs: row.startTs.toISOString(),
    endTs: row.endTs.toISOString(),
    rateChfPerKwh: toNumber(row.rateChfPerKwh),
    source: row.source,
    publicationTimestamp: row.publicationTimestamp.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface SyncResult {
  inserted: number;
  updated: number;
  source: string;
  publicationTimestamp: string | null;
}

/**
 * Fetches the current BKW feed-in window and upserts it against every site
 * (the feed isn't site-specific, and there's currently exactly one seeded
 * site — see the plan doc for the simplifying assumption). Re-running this
 * naturally picks up revised prices via onConflictDoUpdate, same pattern as
 * upsertReadings in modules/readings/service.ts.
 */
export async function syncDynamicTariffs(): Promise<SyncResult> {
  const rows = await fetchBkwFeedIn();
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, source: BKW_SOURCE, publicationTimestamp: null };
  }

  const allSites = await db.select({ id: sites.id }).from(sites);
  let inserted = 0;
  let updated = 0;

  for (const site of allSites) {
    for (const batch of chunk(rows, 500)) {
      const result = await db
        .insert(dynamicTariffRates)
        .values(
          batch.map((r) => ({
            siteId: site.id,
            kind: r.kind,
            startTs: new Date(r.startTs),
            endTs: new Date(r.endTs),
            rateChfPerKwh: r.rateChfPerKwh.toString(),
            source: BKW_SOURCE,
            publicationTimestamp: new Date(r.publicationTimestamp),
          })),
        )
        .onConflictDoUpdate({
          target: [dynamicTariffRates.siteId, dynamicTariffRates.kind, dynamicTariffRates.startTs],
          set: {
            endTs: sql`excluded.end_ts`,
            rateChfPerKwh: sql`excluded.rate_chf_per_kwh`,
            publicationTimestamp: sql`excluded.publication_timestamp`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ wasInsert: sql<boolean>`(xmax = 0)` });

      for (const r of result) {
        if (r.wasInsert) inserted++;
        else updated++;
      }
    }
  }

  return { inserted, updated, source: BKW_SOURCE, publicationTimestamp: rows[0]!.publicationTimestamp };
}

export async function listDynamicTariffRates(
  siteId: string,
  kind: TariffKind | undefined,
  from: string,
  to: string,
): Promise<DynamicTariffRate[]> {
  const conditions = [
    eq(dynamicTariffRates.siteId, siteId),
    gte(dynamicTariffRates.startTs, new Date(`${from}T00:00:00Z`)),
    lte(dynamicTariffRates.startTs, new Date(`${to}T23:59:59Z`)),
  ];
  if (kind) conditions.push(eq(dynamicTariffRates.kind, kind));

  const rows = await db
    .select()
    .from(dynamicTariffRates)
    .where(and(...conditions))
    .orderBy(dynamicTariffRates.startTs);
  return rows.map(toDomain);
}
