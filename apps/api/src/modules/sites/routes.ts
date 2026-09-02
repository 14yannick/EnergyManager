import type { FastifyInstance } from "fastify";
import type { Site } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { sites } from "../../db/schema/index.js";

export async function siteRoutes(app: FastifyInstance) {
  app.get("/api/sites", async (): Promise<Site[]> => {
    const rows = await db.select().from(sites);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  });
}
