import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema, gridTariffPositionInputSchema } from "@energy-manager/shared";
import { createPosition, deletePosition, listPositions, runInvoices, updatePosition } from "./service.js";

export async function billingRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/billing/positions", async (req) => {
    return listPositions(req.params.siteId);
  });

  app.post<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/billing/positions",
    async (req, reply) => {
      const parsed = gridTariffPositionInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
      }
      return reply.status(201).send(await createPosition(req.params.siteId, parsed.data));
    },
  );

  app.patch<{ Params: { id: string } }>("/api/billing/positions/:id", async (req, reply) => {
    const parsed = gridTariffPositionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const updated = await updatePosition(req.params.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "not_found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/billing/positions/:id", async (req, reply) => {
    const deleted = await deletePosition(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/billing/invoices",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return runInvoices(req.params.siteId, parsed.data.from, parsed.data.to);
    },
  );
}
