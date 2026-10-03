import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { PARTY_SENSOR_KINDS } from "@energy-manager/shared";
import { parties } from "./parties.js";

/** The kinds a participant can map — see `PARTY_SENSOR_SPECS` in the shared package. */
export const partySensorKindEnum = pgEnum("party_sensor_kind", PARTY_SENSOR_KINDS);

/**
 * Which Home Assistant sensor reports what, for one participant.
 *
 * It replaces two things that both hung off the site: `ha_entity_map`, the
 * energy counters the sync reads, and the `live_*` / `forecast_*` columns,
 * the readings the live view asks for on demand. Both were really the
 * producing household's — and a vZEV can hold several of those, so the
 * sensors move to the participant whose meter they sit behind.
 *
 * One table for both sorts on purpose: to the person mapping them they are
 * one list ("this participant's sensors"), and what tells a stored counter
 * from a live reading is the kind, not where the row lives.
 *
 * Entity ids are installation-specific (they encode the user's own device
 * names), so this is configuration rather than source. One sensor per kind
 * per participant; a second inverter is summed in Home Assistant.
 */
export const partySensors = pgTable(
  "party_sensors",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    kind: partySensorKindEnum("kind").notNull(),
    /** A statistic id for a stored kind, an entity id for a live one. */
    entityId: text("entity_id").notNull(),
    /**
     * The sensor reads *negative* in the direction its kind names. Inverters
     * disagree: Huawei's feed-in power follows the grid convention (negative
     * while exporting) and its battery power is positive while charging;
     * others are the other way round. A property of the sensor, so a setting
     * rather than a guess — the guess showed 0.00 kW at the moment the house
     * was exporting 4.8 kW. Only read for the two signed power sensors.
     */
    inverted: boolean("inverted").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("party_sensors_party_kind_idx").on(table.partyId, table.kind)],
);
