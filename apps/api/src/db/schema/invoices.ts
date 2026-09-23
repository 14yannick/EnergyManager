import { pgTable, pgEnum, uuid, text, date, timestamp, numeric, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { IssuedInvoice } from "@energy-manager/shared";
import { sites } from "./sites.js";
import { parties } from "./parties.js";

export const invoiceStatusEnum = pgEnum("invoice_status", ["issued", "paid", "cancelled"]);

/**
 * A generated invoice, dated and persisted — the Account tab's own record,
 * distinct from the live figures `billing/service.ts`'s `runInvoices`
 * computes on demand every time the Billing page is opened. Once issued this
 * must keep showing what was actually billed even if positions or a party's
 * address change afterwards, which is why `detail` snapshots the whole
 * computed invoice rather than only the headline figures.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Every invoice one Generate call produced shares this — see cancelBatch. */
    batchId: uuid("batch_id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    // Restrict, not cascade: an invoice is a financial record and must not
    // vanish because the party it was billed to gets deleted later.
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    // Snapshotted alongside partyId — a party later renamed, or given a new
    // reference number, must not rewrite what this invoice actually said.
    partyReference: text("party_reference"),
    partyName: text("party_name").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    /** When this was generated — "invoice date", not the period it covers. */
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    gridKwh: numeric("grid_kwh", { precision: 14, scale: 4 }).notNull(),
    localKwh: numeric("local_kwh", { precision: 14, scale: 4 }).notNull(),
    selfDirectKwh: numeric("self_direct_kwh", { precision: 14, scale: 4 }).notNull().default("0"),
    selfBatteryKwh: numeric("self_battery_kwh", { precision: 14, scale: 4 }).notNull().default("0"),
    totalChf: numeric("total_chf", { precision: 12, scale: 2 }).notNull(),
    /** The vZEV advantage shown on the Account tab: comparison.savingChf. */
    savingChf: numeric("saving_chf", { precision: 12, scale: 2 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("issued"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** The full computed invoice this row and its PDF were built from. */
    detail: jsonb("detail").$type<IssuedInvoice>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One active invoice per party per period — the DB-level half of the
    // "regeneration is blocked" rule; generateInvoices' own pre-check is the
    // other half. Same pattern as parties_one_admin_idx.
    uniqueIndex("invoices_active_period_idx")
      .on(table.partyId, table.periodFrom, table.periodTo)
      .where(sql`${table.status} != 'cancelled'`),
    index("invoices_batch_idx").on(table.batchId),
    index("invoices_site_status_idx").on(table.siteId, table.status),
  ],
);
