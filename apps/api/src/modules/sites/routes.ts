import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Site } from "@energy-manager/shared";
import { siteUpdateInputSchema } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { sites } from "../../db/schema/index.js";

type Row = typeof sites.$inferSelect;

function toDomain(row: Row): Site {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    // drizzle's `date` column is already "YYYY-MM-DD".
    productionStartDate: row.productionStartDate,
    batteryConversionLoss: Number(row.batteryConversionLoss),
    dynamicTariffEntityId: row.dynamicTariffEntityId,
    liveExportPowerEntityId: row.liveExportPowerEntityId,
    livePvPowerEntityId: row.livePvPowerEntityId,
    forecastTodayEntityId: row.forecastTodayEntityId,
    forecastRemainingEntityId: row.forecastRemainingEntityId,
    forecastTomorrowEntityId: row.forecastTomorrowEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function siteRoutes(app: FastifyInstance) {
  app.get("/api/sites", async (): Promise<Site[]> => {
    const rows = await db.select().from(sites);
    return rows.map(toDomain);
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
        ...set("livePvPowerEntityId", d.livePvPowerEntityId),
        ...set("forecastTodayEntityId", d.forecastTodayEntityId),
        ...set("forecastRemainingEntityId", d.forecastRemainingEntityId),
        ...set("forecastTomorrowEntityId", d.forecastTomorrowEntityId),
        updatedAt: new Date(),
      })
      .where(eq(sites.id, req.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "not_found" });
    return toDomain(row);
  });
}
