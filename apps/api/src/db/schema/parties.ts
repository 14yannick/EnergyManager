import { boolean, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
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
    /**
     * Postal address, for the "Payable by" half of the QR-bill. Nullable
     * throughout: a party created on the fly by a CSV import has only a name,
     * and an invoice without an address is still a valid QR-bill — it just
     * prints an empty box for the payer to complete.
     */
    address: text("address"),
    buildingNumber: text("building_number"),
    zip: text("zip"),
    city: text("city"),
    country: text("country").notNull().default("CH"),
    /**
     * Marks the party that operates the RCP — the owner, who bills everyone
     * else. They are a party like any other because they consume from the
     * same connection; the flag only says who is on the creditor side of an
     * invoice.
     *
     * At most one per site, enforced by a partial unique index below rather
     * than by application code, so two operators can't exist even briefly.
     */
    isOperator: boolean("is_operator").notNull().default(false),
    /**
     * Account the QR-bill is payable to. Only meaningful on the operator; a
     * participant's own IBAN is none of this app's business.
     */
    iban: text("iban"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("parties_site_name_idx").on(table.siteId, table.name),
    uniqueIndex("parties_one_operator_idx")
      .on(table.siteId)
      .where(sql`${table.isOperator}`),
  ],
);
