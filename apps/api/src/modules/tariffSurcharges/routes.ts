import type { FastifyInstance } from "fastify";
import { tariffSurchargeInputSchema } from "@energy-manager/shared";
import {
  createTariffSurcharge,
  deleteTariffSurcharge,
  listTariffSurcharges,
  updateTariffSurcharge,
} from "./service.js";

export async function tariffSurchargeRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/tariff-surcharges", async (req) => {
    return listTariffSurcharges(req.params.siteId);
  });

  app.post<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/tariff-surcharges",
    async (req, reply) => {
      const parsed = tariffSurchargeInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
      }
      const created = await createTariffSurcharge(req.params.siteId, parsed.data);
      return reply.status(201).send(created);
    },
  );

  app.patch<{ Params: { id: string } }>("/api/tariff-surcharges/:id", async (req, reply) => {
    const parsed = tariffSurchargeInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const updated = await updateTariffSurcharge(req.params.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "not_found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/tariff-surcharges/:id", async (req, reply) => {
    const deleted = await deleteTariffSurcharge(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
