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
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("parties_site_name_idx").on(table.siteId, table.name)],
);
