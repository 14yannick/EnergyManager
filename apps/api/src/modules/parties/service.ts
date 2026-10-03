import { eq, ne, sql } from "drizzle-orm";
import { effectiveSensorProfile, type Party, type PartyInput } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { parties } from "../../db/schema/index.js";

type Row = typeof parties.$inferSelect;

function toDomain(row: Row): Party {
  return {
    id: row.id,
    siteId: row.siteId,
    reference: row.reference,
    name: row.name,
    emails: row.emails,
    address: row.address,
    buildingNumber: row.buildingNumber,
    zip: row.zip,
    city: row.city,
    country: row.country,
    role: row.role,
    iban: row.iban,
    startDate: row.startDate,
    endDate: row.endDate,
    feedIn: row.feedIn,
    detailedRevenue: row.detailedRevenue,
    detailedLiveView: row.detailedLiveView,
    // drizzle's `date` column is already "YYYY-MM-DD".
    productionStartDate: row.productionStartDate,
    batteryConversionLoss: row.batteryConversionLoss == null ? null : Number(row.batteryConversionLoss),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * An address already on another party. Sign-in resolves a person to exactly
 * one party, so the same address on two of them has no answer — and the
 * person only finds that out as a 403. Refused here, when it is being typed.
 */
export class DuplicateEmailError extends Error {
  constructor(
    readonly email: string,
    readonly partyName: string,
  ) {
    super(`${email} is already on the party "${partyName}".`);
    this.name = "DuplicateEmailError";
  }
}

/**
 * The address the identity lookup will compare against: it lower-cases the
 * verified sign-in and compares `lower(e)`, so a party's own list is matched
 * the same way here — across every site, since sign-in knows no site yet.
 */
async function assertEmailsUnclaimed(emails: string[], exceptPartyId: string | null): Promise<void> {
  for (const email of emails) {
    const wanted = email.trim().toLowerCase();
    if (!wanted) continue;
    const taken = await db
      .select({ name: parties.name })
      .from(parties)
      .where(
        exceptPartyId == null
          ? sql`exists (select 1 from unnest(${parties.emails}) as e where lower(e) = ${wanted})`
          : sql`${ne(parties.id, exceptPartyId)} and exists (select 1 from unnest(${parties.emails}) as e where lower(e) = ${wanted})`,
      )
      .limit(1);
    if (taken[0]) throw new DuplicateEmailError(email, taken[0].name);
  }
}

export async function listParties(siteId: string): Promise<Party[]> {
  const rows = await db.select().from(parties).where(eq(parties.siteId, siteId)).orderBy(parties.name);
  return rows.map(toDomain);
}

/**
 * The three options as they can hold for this role (see
 * effectiveSensorProfile): saved that way, so a role changed to "viewer"
 * does not leave a feed-in flag standing that the form no longer shows.
 */
function optionsFor(
  input: PartyInput,
  current: Pick<Row, "role" | "feedIn" | "detailedRevenue" | "detailedLiveView"> | null,
) {
  const { feedIn, detailedRevenue, detailedLiveView } = effectiveSensorProfile({
    role: input.role ?? current?.role ?? "rcp_party",
    feedIn: input.feedIn ?? current?.feedIn ?? false,
    detailedRevenue: input.detailedRevenue ?? current?.detailedRevenue ?? false,
    detailedLiveView: input.detailedLiveView ?? current?.detailedLiveView ?? false,
  });
  return { feedIn, detailedRevenue, detailedLiveView };
}

/**
 * The plant's two figures, only where the request carried them: the main
 * form does not, and saving a name must not blank a date. Null clears.
 */
function plantFiguresFor(input: PartyInput) {
  return {
    ...(input.productionStartDate !== undefined ? { productionStartDate: input.productionStartDate } : {}),
    ...(input.batteryConversionLoss !== undefined
      ? { batteryConversionLoss: input.batteryConversionLoss == null ? null : input.batteryConversionLoss.toString() }
      : {}),
  };
}

export async function createParty(siteId: string, input: PartyInput): Promise<Party> {
  await assertEmailsUnclaimed(input.emails ?? [], null);
  const [row] = await db
    .insert(parties)
    .values({
      siteId,
      name: input.name,
      reference: input.reference ?? null,
      emails: input.emails ?? [],
      address: input.address ?? null,
      buildingNumber: input.buildingNumber ?? null,
      zip: input.zip ?? null,
      city: input.city ?? null,
      ...(input.country ? { country: input.country } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      iban: input.iban ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      ...optionsFor(input, null),
      ...plantFiguresFor(input),
    })
    .returning();
  return toDomain(row!);
}

export async function updateParty(id: string, input: PartyInput): Promise<Party | null> {
  await assertEmailsUnclaimed(input.emails ?? [], id);
  const [current] = await db.select().from(parties).where(eq(parties.id, id));
  if (!current) return null;
  const [row] = await db
    .update(parties)
    .set({
      name: input.name,
      reference: input.reference ?? null,
      emails: input.emails ?? [],
      address: input.address ?? null,
      buildingNumber: input.buildingNumber ?? null,
      zip: input.zip ?? null,
      city: input.city ?? null,
      ...(input.country ? { country: input.country } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      iban: input.iban ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      ...optionsFor(input, current),
      ...plantFiguresFor(input),
      updatedAt: new Date(),
    })
    .where(eq(parties.id, id))
    .returning();
  return row ? toDomain(row) : null;
}

export async function deleteParty(id: string): Promise<boolean> {
  const rows = await db.delete(parties).where(eq(parties.id, id)).returning({ id: parties.id });
  return rows.length > 0;
}
