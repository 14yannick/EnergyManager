import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema } from "@energy-manager/shared";
import { getCommunitySummary } from "./service.js";

export async function communityRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/community/summary",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return getCommunitySummary(req.params.siteId, parsed.data.from, parsed.data.to);
    },
  );
}
