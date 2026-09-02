import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema, savingsQuerySchema } from "@energy-manager/shared";
import { getDailySavings, getSavingsSummary } from "./service.js";

export async function savingsRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string }; Querystring: { from: string; to: string } }>(
    "/api/sites/:siteId/savings/daily",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return getDailySavings(req.params.siteId, parsed.data.from, parsed.data.to);
    },
  );

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/savings/summary",
    async (req, reply) => {
      const parsed = savingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const { from, to, granularity } = parsed.data;
      const { summary } = await getSavingsSummary(req.params.siteId, from, to, granularity);
      return summary;
    },
  );

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/savings/cumulative",
    async (req, reply) => {
      const parsed = savingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const { from, to, granularity } = parsed.data;
      const { cumulative } = await getSavingsSummary(req.params.siteId, from, to, granularity);
      return cumulative;
    },
  );
}
