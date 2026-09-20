import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema, gridTariffPositionInputSchema } from "@energy-manager/shared";
import {
  BillingPeriodError,
  createPosition,
  deletePosition,
  listPositions,
  runInvoices,
  updatePosition,
} from "./service.js";
import { scopedPartyId } from "../../auth/plugin.js";

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
      let result;
      try {
        result = await runInvoices(req.params.siteId, parsed.data.from, parsed.data.to);
      } catch (err) {
        // Not a failure of the run but of the question: this period cannot
        // have one invoice. Say why, and where the split would go.
        if (err instanceof BillingPeriodError) {
          return reply.status(409).send({ error: "period_spans_tariff_change", message: err.message });
        }
        throw err;
      }

      // A participant gets their own invoice and nothing else. The run is
      // computed in full first because the allocation is relative — each
      // party's local share depends on what everyone else drew at the time —
      // so there is no cheaper "just mine" query. Only the output narrows.
      //
      // `warnings` is dropped too: it names other parties when their data is
      // incomplete.
      const partyId = scopedPartyId(req);
      if (partyId) {
        return {
          ...result,
          invoices: result.invoices.filter((inv) => inv.partyId === partyId),
          warnings: [],
        };
      }
      return result;
    },
  );
}
