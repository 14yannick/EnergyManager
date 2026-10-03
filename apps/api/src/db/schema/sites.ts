import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { priceFeeds } from "./priceFeeds.js";

export const sites = pgTable(
  "sites",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    /**
     * What the site is called outside this app — on the grid operator's
     * paperwork, in the Drive folder its invoices are filed under (see
     * modules/invoices). Kept apart from `id`, which only this database
     * knows, and from `name`, which is free to change without moving a
     * folder. Text rather than a uuid column: for now it simply carries the
     * site's name, until there is a real external identifier to put here.
     * Unique, because two sites sharing it would share a folder.
     */
    externalUuid: text("external_uuid").notNull(),
    /**
     * Leave this site out of the scheduled Home Assistant pull — both the
     * energy statistics and the dynamic feed-in rates. Its mapping and its
     * price sensor stay as configured, so resuming is clearing the flag. A
     * sync asked for by hand on the site still runs: the pause is of the
     * timer, not of the site.
     */
    syncPaused: boolean("sync_paused").notNull().default(false),
    timezone: text("timezone").notNull().default("Europe/Zurich"),
    /**
     * Which published price series prices this site's feed-in — one of the
     * installation's price feeds (see price_feeds), chosen under Site
     * administration. Null means this site syncs no dynamic rates at all.
     * A feed that is deleted leaves its sites without one rather than
     * taking them with it.
     */
    priceFeedId: uuid("price_feed_id").references(() => priceFeeds.id, { onDelete: "set null" }),
    /**
     * The Drive folder generated invoice PDFs are archived to (see
     * modules/googleDrive) — a folder this site's admin created themselves and
     * shared with the service account's email. Null means nothing is archived;
     * the feature is also off entirely if the server has no service account
     * key configured, regardless of this.
     */
    driveFolderId: text("drive_folder_id"),
    /** The folder's own name at the moment it was connected — shown in Settings so a raw id isn't the only thing there. Not kept in sync if renamed in Drive afterward; cosmetic only. */
    driveFolderName: text("drive_folder_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sites_external_uuid_idx").on(table.externalUuid)],
);
