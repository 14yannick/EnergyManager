import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";

// An external consumption-tracked entity (a neighbour in a VZEV-style
// setup). The homeowner's own consumption stays derived (produced -
// batteryCharge - exportedTotal), so there's no "owner" party row.
export const parties = pgTable(
  "parties",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /**
     * The participant number as it appears on paperwork (the grid provider's
     * Bezugsstelle number, or one the operator assigns). Optional, since a
     * party created on the fly by a CSV import only has a name to go on.
     */
    reference: text("reference"),
    name: text("name").notNull(),
    /**
     * Contact addresses for this participant — a household often has more than
     * one person who should receive the invoice, so this is a list rather than
     * a single field.
     */
    emails: text("emails").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("parties_site_name_idx").on(table.siteId, table.name)],
);
