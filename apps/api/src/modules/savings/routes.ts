import type { FastifyInstance } from "fastify";
import { savingsQuerySchema } from "@energy-manager/shared";
import { getDailySavings, getSavingsSummary } from "./service.js";

export async function savingsRoutes(app: FastifyInstance) {
  // `granularity=monthly` returns one row per calendar month instead of per
  // day, with `date` as "YYYY-MM" — the same rows the monthly summary is built
  // from, so a chart and the summary above it can't disagree.
  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/savings/daily",
    async (req, reply) => {
      const parsed = savingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const { from, to, granularity } = parsed.data;
      return getDailySavings(req.params.siteId, from, to, granularity);
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
