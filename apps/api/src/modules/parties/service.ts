import { eq } from "drizzle-orm";
import type { Party, PartyInput } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { parties } from "../../db/schema/index.js";

type Row = typeof parties.$inferSelect;

function toDomain(row: Row): Party {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listParties(siteId: string): Promise<Party[]> {
  const rows = await db.select().from(parties).where(eq(parties.siteId, siteId)).orderBy(parties.name);
  return rows.map(toDomain);
}

export async function createParty(siteId: string, input: PartyInput): Promise<Party> {
  const [row] = await db.insert(parties).values({ siteId, name: input.name }).returning();
  return toDomain(row!);
}

export async function deleteParty(id: string): Promise<boolean> {
  const rows = await db.delete(parties).where(eq(parties.id, id)).returning({ id: parties.id });
  return rows.length > 0;
}
