import { and, eq, sql } from "drizzle-orm";
import {
  effectiveSensorProfile,
  isStoredSensor,
  sensorKindAllowed,
  type PartySensor,
  type PartySensorInput,
  type PartySensorKind,
} from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { parties, partySensors } from "../../db/schema/index.js";

type Row = typeof partySensors.$inferSelect;

function toDomain(row: Row): PartySensor {
  return {
    id: row.id,
    partyId: row.partyId,
    kind: row.kind,
    entityId: row.entityId,
    inverted: row.inverted,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every sensor mapped on the site, whoever's it is — the form sorts them by participant. */
export async function listSiteSensors(siteId: string): Promise<PartySensor[]> {
  const rows = await db
    .select({ sensor: partySensors })
    .from(partySensors)
    .innerJoin(parties, eq(parties.id, partySensors.partyId))
    .where(eq(parties.siteId, siteId))
    .orderBy(partySensors.partyId, partySensors.kind);
  return rows.map((r) => toDomain(r.sensor));
}

export class PartyNotFoundError extends Error {}

/** The participant's role and options do not open this kind (see sensorKindAllowed). */
export class SensorKindNotAllowedError extends Error {
  constructor(
    readonly kind: PartySensorKind,
    readonly partyName: string,
  ) {
    super(`${partyName} cannot have a "${kind}" sensor: their role or options do not include it.`);
    this.name = "SensorKindNotAllowedError";
  }
}

/** One sensor per (participant, kind) — setting a kind again replaces the entity behind it. */
export async function upsertSensor(partyId: string, input: PartySensorInput): Promise<PartySensor> {
  const [party] = await db.select().from(parties).where(eq(parties.id, partyId));
  if (!party) throw new PartyNotFoundError();
  if (!sensorKindAllowed(input.kind, party)) throw new SensorKindNotAllowedError(input.kind, party.name);

  const [row] = await db
    .insert(partySensors)
    .values({
      partyId,
      kind: input.kind,
      entityId: input.entityId,
      inverted: input.inverted ?? false,
      enabled: input.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: [partySensors.partyId, partySensors.kind],
      set: {
        entityId: sql`excluded.entity_id`,
        inverted: sql`excluded.inverted`,
        enabled: sql`excluded.enabled`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return toDomain(row!);
}

export async function deleteSensor(id: string): Promise<boolean> {
  const rows = await db.delete(partySensors).where(eq(partySensors.id, id)).returning({ id: partySensors.id });
  return rows.length > 0;
}

/** A sensor with the participant it belongs to, as the sync and the live view need it. */
export interface ActiveSensor {
  partyId: string;
  partyName: string;
  /** Whether that participant has a plant — what makes their meter part of the site's energy balance. */
  feedIn: boolean;
  kind: PartySensorKind;
  entityId: string;
  inverted: boolean;
}

/**
 * The site's sensors that count right now: switched on, and of a kind their
 * participant's role and options still open. A sensor whose option was
 * switched off stays in the table — switching it back on brings the mapping
 * back — but is not read while it is off.
 *
 * `stored` picks the sort: the energy counters the sync writes history
 * from, or the live readings asked for on demand.
 */
export async function activeSensors(siteId: string, sort: "stored" | "live"): Promise<ActiveSensor[]> {
  const rows = await db
    .select({ sensor: partySensors, party: parties })
    .from(partySensors)
    .innerJoin(parties, eq(parties.id, partySensors.partyId))
    .where(and(eq(parties.siteId, siteId), eq(partySensors.enabled, true)))
    .orderBy(parties.name, partySensors.kind);
  return rows
    .filter((r) => sensorKindAllowed(r.sensor.kind, r.party))
    .filter((r) => isStoredSensor(r.sensor.kind) === (sort === "stored"))
    .map((r) => ({
      partyId: r.party.id,
      partyName: r.party.name,
      feedIn: effectiveSensorProfile(r.party).feedIn,
      kind: r.sensor.kind,
      entityId: r.sensor.entityId,
      inverted: r.sensor.inverted,
    }));
}
