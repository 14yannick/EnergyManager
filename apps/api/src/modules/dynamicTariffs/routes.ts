import type { FastifyInstance } from "fastify";
import { dynamicTariffQuerySchema } from "@energy-manager/shared";
import { listDynamicTariffRates } from "./service.js";

export async function dynamicTariffRoutes(app: FastifyInstance) {
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
