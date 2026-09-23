import { check, date, pgEnum, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";

/**
 * `rcp_party`   — an ordinary member: consumes, is invoiced, counts towards
 *                 how the shared fixed costs divide. The default.
 * `rcp_admin`   — runs the app *and* is a member, so billed exactly like one.
 * `rcp_admin_only` — runs the app without being part of the RCP: no invoice,
 *                 and excluded from the participant count.
 * `viewer`      — read-only sight of everything, consuming nothing.
 */
export const partyRoleEnum = pgEnum("party_role", [
  "rcp_party",
  "rcp_admin",
  "rcp_admin_only",
  "viewer",
]);

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
     * What this party is to the RCP. One column rather than a flag each,
     * because the four are mutually exclusive and a row that is two of them
     * at once has no meaning.
     *
     * Administering the RCP and being billed by it are independent: the owner
     * usually consumes from the same connection, pays a share of the fixed
     * costs and imports from the grid like anyone else, so `rcp_admin` is
     * billed. `rcp_admin_only` covers the case where whoever runs the app is
     * not a member — a managing agent, say. `viewer` is a holder for an
     * address, granting read-only sight of everything and consuming nothing.
     */
    role: partyRoleEnum("role").notNull().default("rcp_party"),
    /**
     * Account the QR-bill is payable to. Only meaningful on the party that
     * administers the RCP; anyone else's IBAN is none of this app's business.
     */
    iban: text("iban"),
    /**
     * When this party's membership starts and ends — a tenant moving in or
     * out mid-period, say. Nullable throughout: most parties have neither
     * set, meaning "for as long as the vZEV has existed" / "no end in
     * sight". Not yet read by the billing engine — see the schema's own
     * history for why.
     */
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("parties_site_name_idx").on(table.siteId, table.name),
    // One administrator per site. Which of the two admin roles it is decides
    // whether they are also billed, but there is only ever one of them, and
    // they are the QR-bill's payee.
    uniqueIndex("parties_one_admin_idx")
      .on(table.siteId)
      .where(sql`${table.role} in ('rcp_admin', 'rcp_admin_only')`),
    check(
      "parties_date_range_check",
      sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} > ${table.startDate}`,
    ),
  ],
);
