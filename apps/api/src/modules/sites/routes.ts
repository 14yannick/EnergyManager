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
    const [row] = await db
      .update(sites)
      .set({
        productionStartDate: parsed.data.productionStartDate ?? null,
        ...(parsed.data.batteryConversionLoss !== undefined
          ? { batteryConversionLoss: String(parsed.data.batteryConversionLoss) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(sites.id, req.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "not_found" });
    return toDomain(row);
  });
}
