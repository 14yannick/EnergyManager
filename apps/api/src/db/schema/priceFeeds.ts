import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tariffKindEnum } from "./tariffPeriods.js";

/**
 * A published price series the installation can read, named by a key —
 * "public_bkw_dynamic_feed_in", say — and the Home Assistant entity that
 * carries it.
 *
 * The installation's, not a site's: a price is not measured behind anyone's
 * meter, it is published, and every site buying from or selling to the same
 * provider is priced by the same series. It used to be an entity id typed
 * into each site (`sites.dynamic_tariff_entity_id`); now it is defined once,
 * under Integrations, and a site chooses which feed prices its feed-in.
 *
 * The key is what the rest of the system knows the series by. It is stamped
 * on every rate the sync writes from the feed (`dynamic_tariff_rates.source`),
 * so a stored rate says which published series it came from rather than
 * which sensor happened to relay it.
 */
export const priceFeeds = pgTable(
  "price_feeds",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Lower-case letters, digits and underscores; unique across the installation. */
    key: text("key").notNull(),
    /** What the feed is, for the person choosing between several. Optional. */
    label: text("label"),
    /** What it prices. Only feed-in is published dynamically today. */
    kind: tariffKindEnum("kind").notNull().default("feed_in"),
    /** The Home Assistant price-forecast entity that carries the series. */
    entityId: text("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("price_feeds_key_idx").on(table.key)],
);
