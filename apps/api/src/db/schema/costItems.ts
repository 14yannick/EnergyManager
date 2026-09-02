import { pgTable, text, date, numeric, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";

export const costCategoryEnum = pgEnum("cost_category", ["battery", "solar"]);

export const costItems = pgTable("cost_items", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  category: costCategoryEnum("category").notNull(),
  label: text("label").notNull(),
  amountChf: numeric("amount_chf", { precision: 12, scale: 2 }).notNull(),
  incurredOn: date("incurred_on"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
