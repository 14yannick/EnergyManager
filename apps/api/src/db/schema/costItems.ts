import { pgTable, text, date, numeric, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites.js";
import { parties } from "./parties.js";

export const costCategoryEnum = pgEnum("cost_category", ["battery", "solar"]);

export const costItems = pgTable("cost_items", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  /**
   * The participant whose plant this was spent on — one with feed-in. An
   * investment is a household's, not the site's: with two plants in a vZEV
   * each pays back on its own money. The site keeps its id here too, so a
   * site-wide total needs no join.
   */
  partyId: uuid("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
  category: costCategoryEnum("category").notNull(),
  label: text("label").notNull(),
  amountChf: numeric("amount_chf", { precision: 12, scale: 2 }).notNull(),
  incurredOn: date("incurred_on"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
