import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema, savingsDayQuerySchema, savingsQuerySchema } from "@energy-manager/shared";
import {
  getDailySavings,
  getFeedInRateCurve,
  getNeighbourSales,
  getSavingsDay,
  getSavingsSummary,
} from "./service.js";

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

  // One day at metering-interval resolution: the totals plus the intervals
  // they were summed from, so an average rate on the day view can be expanded
  // into the slots that produced it.
  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/savings/day",
    async (req, reply) => {
      const parsed = savingsDayQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return getSavingsDay(req.params.siteId, parsed.data.date);
    },
  );

  // The live view's chart: a full day's feed-in rate, known ahead for
  // whatever the day-ahead feed or a flat period already covers.
  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/savings/feed-in-rate",
    async (req, reply) => {
      const parsed = savingsDayQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return getFeedInRateCurve(req.params.siteId, parsed.data.date);
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

  // Per participant: what selling to them earned against exporting instead.
  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/savings/neighbours",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return getNeighbourSales(req.params.siteId, parsed.data.from, parsed.data.to);
    },
  );
}
