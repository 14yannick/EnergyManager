import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Site } from "@energy-manager/shared";
import { siteCreateInputSchema, siteUpdateInputSchema } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { sites } from "../../db/schema/index.js";
import { DEFAULT_BATTERY_CONVERSION_LOSS } from "../savings/engine.js";
import { plantSettingsBySite, type PlantSettings } from "./plant.js";

type Row = typeof sites.$inferSelect;

/**
 * A site with its two plant figures. They are no longer the site's own
 * columns — they are entered per producer and combined for the site (see
 * plant.ts) — but the site-wide views still read them here.
 */
function toDomain(row: Row, plant: PlantSettings | undefined): Site {
  return {
    id: row.id,
    name: row.name,
    externalUuid: row.externalUuid,
    syncPaused: row.syncPaused,
    timezone: row.timezone,
    productionStartDate: plant?.productionStartDate ?? null,
    batteryConversionLoss: plant?.batteryConversionLoss ?? DEFAULT_BATTERY_CONVERSION_LOSS,
    priceFeedId: row.priceFeedId,
    driveFolderId: row.driveFolderId,
    driveFolderName: row.driveFolderName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function siteRoutes(app: FastifyInstance) {
  app.get("/api/sites", async (): Promise<Site[]> => {
    const [rows, plants] = await Promise.all([db.select().from(sites), plantSettingsBySite()]);
    return rows.map((row) => toDomain(row, plants.get(row.id)));
  });

  /**
   * A further site beside the one the first migration seeded. It starts
   * empty — no parties, no tariffs, no sensors — and is filled in from Site
   * administration once somebody switches to it.
   *
   * The name is checked here rather than by a constraint: two sites that
   * read the same in the switcher cannot be told apart by the person
   * choosing between them, whatever their ids. Case and surrounding space
   * are not a difference worth keeping.
   */
  app.post("/api/sites", async (req, reply) => {
    const parsed = siteCreateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const { name } = parsed.data;
    const [taken] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(sql`lower(${sites.name}) = lower(${name}) or lower(${sites.externalUuid}) = lower(${name})`)
      .limit(1);
    if (taken) {
      return reply.status(409).send({ error: "name_taken", message: `A site named "${name}" already exists.` });
    }
    // The external identifier starts as the name (see the schema): the two
    // are checked unique together above, since the name is what it is.
    const [row] = await db.insert(sites).values({ name, externalUuid: name }).returning();
    // Brand new: no participant yet, so no plant to speak of.
    return reply.status(201).send(toDomain(row!, undefined));
  });

  app.patch<{ Params: { id: string } }>("/api/sites/:id", async (req, reply) => {
    const parsed = siteUpdateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    // Only fields the request actually carried are written, so the page can
    // save one section without blanking another.
    const d = parsed.data;
    const set = <K extends string, V>(key: K, value: V | undefined) =>
      value === undefined ? {} : ({ [key]: value } as Record<K, V>);

    const [row] = await db
      .update(sites)
      .set({
        ...set("priceFeedId", d.priceFeedId),
        ...set("syncPaused", d.syncPaused),
        updatedAt: new Date(),
      })
      .where(eq(sites.id, req.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "not_found" });
    return toDomain(row, (await plantSettingsBySite(row.id)).get(row.id));
  });
}
