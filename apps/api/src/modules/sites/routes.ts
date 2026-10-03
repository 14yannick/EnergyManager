import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Site } from "@energy-manager/shared";
import { siteCreateInputSchema, siteUpdateInputSchema } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { sites } from "../../db/schema/index.js";

type Row = typeof sites.$inferSelect;

function toDomain(row: Row): Site {
  return {
    id: row.id,
    name: row.name,
    externalUuid: row.externalUuid,
    syncPaused: row.syncPaused,
    timezone: row.timezone,
    // drizzle's `date` column is already "YYYY-MM-DD".
    productionStartDate: row.productionStartDate,
    batteryConversionLoss: Number(row.batteryConversionLoss),
    dynamicTariffEntityId: row.dynamicTariffEntityId,
    liveExportPowerEntityId: row.liveExportPowerEntityId,
    liveExportNegative: row.liveExportNegative,
    livePvPowerEntityId: row.livePvPowerEntityId,
    liveBatteryPowerEntityId: row.liveBatteryPowerEntityId,
    liveBatteryChargeNegative: row.liveBatteryChargeNegative,
    liveBatterySocEntityId: row.liveBatterySocEntityId,
    liveLoadPowerEntityId: row.liveLoadPowerEntityId,
    forecastTodayEntityId: row.forecastTodayEntityId,
    forecastRemainingEntityId: row.forecastRemainingEntityId,
    forecastTomorrowEntityId: row.forecastTomorrowEntityId,
    driveFolderId: row.driveFolderId,
    driveFolderName: row.driveFolderName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function siteRoutes(app: FastifyInstance) {
  app.get("/api/sites", async (): Promise<Site[]> => {
    const rows = await db.select().from(sites);
    return rows.map(toDomain);
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
    return reply.status(201).send(toDomain(row!));
  });

  app.patch<{ Params: { id: string } }>("/api/sites/:id", async (req, reply) => {
    const parsed = siteUpdateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    // Only fields the request actually carried are written, so the Settings
    // page can save one section without blanking another. `productionStartDate`
    // keeps its old behaviour of being cleared by an absent value, because its
    // input sends an empty string to mean "not stated".
    const d = parsed.data;
    const set = <K extends string, V>(key: K, value: V | undefined) =>
      value === undefined ? {} : ({ [key]: value } as Record<K, V>);

    const [row] = await db
      .update(sites)
      .set({
        productionStartDate: d.productionStartDate ?? null,
        ...set("batteryConversionLoss", d.batteryConversionLoss?.toString()),
        ...set("dynamicTariffEntityId", d.dynamicTariffEntityId),
        ...set("liveExportPowerEntityId", d.liveExportPowerEntityId),
        ...set("liveExportNegative", d.liveExportNegative),
        ...set("livePvPowerEntityId", d.livePvPowerEntityId),
        ...set("liveBatteryPowerEntityId", d.liveBatteryPowerEntityId),
        ...set("liveBatteryChargeNegative", d.liveBatteryChargeNegative),
        ...set("liveBatterySocEntityId", d.liveBatterySocEntityId),
        ...set("liveLoadPowerEntityId", d.liveLoadPowerEntityId),
        ...set("forecastTodayEntityId", d.forecastTodayEntityId),
        ...set("forecastRemainingEntityId", d.forecastRemainingEntityId),
        ...set("forecastTomorrowEntityId", d.forecastTomorrowEntityId),
        ...set("syncPaused", d.syncPaused),
        updatedAt: new Date(),
      })
      .where(eq(sites.id, req.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "not_found" });
    return toDomain(row);
  });
}
