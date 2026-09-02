import type { FastifyInstance } from "fastify";
import { dynamicTariffQuerySchema } from "@energy-manager/shared";
import { listDynamicTariffRates, syncDynamicTariffs } from "./service.js";

export async function dynamicTariffRoutes(app: FastifyInstance) {
  // Syncs against every site, not just :siteId (see service.ts) — the param
  // is kept in the URL for consistency with the rest of the site-scoped API.
  app.post("/api/sites/:siteId/dynamic-tariffs/sync", async () => {
    return syncDynamicTariffs();
  });

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/dynamic-tariffs",
    async (req, reply) => {
      const parsed = dynamicTariffQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const { kind, from, to } = parsed.data;
      return listDynamicTariffRates(req.params.siteId, kind, from, to);
    },
  );
}
