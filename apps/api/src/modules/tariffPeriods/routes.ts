import type { FastifyInstance } from "fastify";
import { tariffPeriodInputSchema } from "@energy-manager/shared";
import {
  createTariffPeriod,
  deleteTariffPeriod,
  listTariffPeriods,
  updateTariffPeriod,
} from "./service.js";
import { isExclusionViolation } from "../../lib/pgErrors.js";

export async function tariffPeriodRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/tariff-periods", async (req) => {
    return listTariffPeriods(req.params.siteId);
  });

  app.post<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/tariff-periods",
    async (req, reply) => {
      const parsed = tariffPeriodInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
      }
      try {
        const created = await createTariffPeriod(req.params.siteId, parsed.data);
        return reply.status(201).send(created);
      } catch (err) {
        if (isExclusionViolation(err)) {
          return reply
            .status(409)
            .send({ error: "overlapping_period", message: "This period overlaps an existing tariff period." });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string } }>("/api/tariff-periods/:id", async (req, reply) => {
    const parsed = tariffPeriodInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      const updated = await updateTariffPeriod(req.params.id, parsed.data);
      if (!updated) return reply.status(404).send({ error: "not_found" });
      return updated;
    } catch (err) {
      if (isExclusionViolation(err)) {
        return reply
          .status(409)
          .send({ error: "overlapping_period", message: "This period overlaps an existing tariff period." });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/tariff-periods/:id", async (req, reply) => {
    const deleted = await deleteTariffPeriod(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
