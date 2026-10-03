import { and, eq } from "drizzle-orm";
import type { CostItem, CostItemInput, CostItemsSummary } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { costItems, parties } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";

type Row = typeof costItems.$inferSelect;

function toDomain(row: Row): CostItem {
  return {
    id: row.id,
    siteId: row.siteId,
    partyId: row.partyId,
    category: row.category,
    label: row.label,
    amountChf: toNumber(row.amountChf),
    incurredOn: row.incurredOn,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCostItems(siteId: string): Promise<CostItem[]> {
  const rows = await db.select().from(costItems).where(eq(costItems.siteId, siteId));
  return rows.map(toDomain);
}

/** An investment needs a plant: the item names no participant, or one without feed-in. */
export class NotAProducerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAProducerError";
  }
}

/**
 * An investment is entered for a participant with feed-in — the household
 * whose plant the money went into. The site is only where it is summed.
 */
export async function createCostItem(siteId: string, input: CostItemInput): Promise<CostItem> {
  if (!input.partyId) throw new NotAProducerError("Name the participant this investment belongs to.");
  const [party] = await db
    .select({ name: parties.name, feedIn: parties.feedIn })
    .from(parties)
    .where(and(eq(parties.id, input.partyId), eq(parties.siteId, siteId)));
  if (!party) throw new NotAProducerError("That participant is not on this site.");
  if (!party.feedIn) {
    throw new NotAProducerError(`${party.name} has no feed-in, so there is no plant to record an investment for.`);
  }
  const [row] = await db
    .insert(costItems)
    .values({
      siteId,
      partyId: input.partyId,
      category: input.category,
      label: input.label,
      amountChf: input.amountChf.toString(),
      incurredOn: input.incurredOn ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return toDomain(row!);
}

export async function updateCostItem(id: string, input: CostItemInput): Promise<CostItem | null> {
  const [row] = await db
    .update(costItems)
    .set({
      category: input.category,
      label: input.label,
      amountChf: input.amountChf.toString(),
      incurredOn: input.incurredOn ?? null,
      notes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(costItems.id, id))
    .returning();
  return row ? toDomain(row) : null;
}

export async function deleteCostItem(id: string): Promise<boolean> {
  const rows = await db.delete(costItems).where(eq(costItems.id, id)).returning({ id: costItems.id });
  return rows.length > 0;
}

export async function getCostItemsSummary(siteId: string): Promise<CostItemsSummary> {
  const rows = await listCostItems(siteId);
  const battery = rows.filter((r) => r.category === "battery").reduce((sum, r) => sum + r.amountChf, 0);
  const solar = rows.filter((r) => r.category === "solar").reduce((sum, r) => sum + r.amountChf, 0);
  return { battery, solar, total: battery + solar };
}
