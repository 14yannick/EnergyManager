import { eq, sql } from "drizzle-orm";
import type { PriceFeed, PriceFeedInput } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { dynamicTariffRates, priceFeeds, sites } from "../../db/schema/index.js";

type Row = typeof priceFeeds.$inferSelect;

function toDomain(row: Row, siteCount: number): PriceFeed {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    kind: row.kind,
    entityId: row.entityId,
    siteCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** How many sites each feed prices, keyed by feed id. */
async function siteCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ feedId: sites.priceFeedId, n: sql<number>`count(*)::int` })
    .from(sites)
    .groupBy(sites.priceFeedId);
  return new Map(rows.filter((r) => r.feedId != null).map((r) => [r.feedId!, r.n]));
}

export async function listPriceFeeds(): Promise<PriceFeed[]> {
  const [rows, counts] = await Promise.all([db.select().from(priceFeeds).orderBy(priceFeeds.key), siteCounts()]);
  return rows.map((row) => toDomain(row, counts.get(row.id) ?? 0));
}

export async function createPriceFeed(input: PriceFeedInput): Promise<PriceFeed> {
  const [row] = await db
    .insert(priceFeeds)
    .values({ key: input.key, label: input.label ?? null, entityId: input.entityId })
    .returning();
  return toDomain(row!, 0);
}

/**
 * A changed key is carried onto the rates already stored under the old one:
 * the key is what the series is known by, so renaming the feed renames the
 * series everywhere, in one transaction. Rates of some other origin — a
 * seed, an import — never carried the key and are left alone.
 */
export async function updatePriceFeed(id: string, input: PriceFeedInput): Promise<PriceFeed | null> {
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select({ key: priceFeeds.key }).from(priceFeeds).where(eq(priceFeeds.id, id));
    if (!before) return null;
    const [updated] = await tx
      .update(priceFeeds)
      .set({ key: input.key, label: input.label ?? null, entityId: input.entityId, updatedAt: new Date() })
      .where(eq(priceFeeds.id, id))
      .returning();
    if (before.key !== input.key) {
      await tx.update(dynamicTariffRates).set({ source: input.key }).where(eq(dynamicTariffRates.source, before.key));
    }
    return updated!;
  });
  return row ? toDomain(row, (await siteCounts()).get(row.id) ?? 0) : null;
}

/** Sites priced by the feed keep their rates and simply stop syncing (the reference is cleared). */
export async function deletePriceFeed(id: string): Promise<boolean> {
  const rows = await db.delete(priceFeeds).where(eq(priceFeeds.id, id)).returning({ id: priceFeeds.id });
  return rows.length > 0;
}
