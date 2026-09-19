import type { FastifyInstance } from "fastify";
import { savingsQuerySchema } from "@energy-manager/shared";
import { scopedPartyId } from "../../auth/plugin.js";
import { getPartyConsumption } from "./service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function consumptionRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string; partyId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/parties/:partyId/consumption",
    async (req, reply) => {
      // A participant may only ask about themselves. Refused outright rather
      // than answered empty: an empty answer would still confirm the id.
      const own = scopedPartyId(req);
      if (own && own !== req.params.partyId) {
        return reply.status(403).send({ error: "forbidden" });
      }
      // Not a uuid is simply not a party; without this Postgres would reject
      // the cast and it would surface as a 500.
      if (!UUID.test(req.params.partyId)) return reply.status(404).send({ error: "not_found" });
      const parsed = savingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const { from, to, granularity } = parsed.data;
      const result = await getPartyConsumption(
        req.params.siteId,
        req.params.partyId,
        from,
        to,
        granularity ?? "daily",
      );
      if (!result) return reply.status(404).send({ error: "not_found" });
      return result;
    },
  );
}
