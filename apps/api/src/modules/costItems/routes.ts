import type { FastifyInstance } from "fastify";
import { costItemInputSchema } from "@energy-manager/shared";
import {
  createCostItem,
  deleteCostItem,
  getCostItemsSummary,
  listCostItems,
  updateCostItem,
} from "./service.js";

export async function costItemRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/cost-items", async (req) => {
    return listCostItems(req.params.siteId);
  });

  app.get<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/cost-items/summary",
    async (req) => {
      return getCostItemsSummary(req.params.siteId);
    },
  );

  app.post<{ Params: { siteId: string } }>("/api/sites/:siteId/cost-items", async (req, reply) => {
    const parsed = costItemInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const created = await createCostItem(req.params.siteId, parsed.data);
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>("/api/cost-items/:id", async (req, reply) => {
    const parsed = costItemInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const updated = await updateCostItem(req.params.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "not_found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/cost-items/:id", async (req, reply) => {
    const deleted = await deleteCostItem(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
