import type { FastifyInstance } from "fastify";
import { partySensorInputSchema } from "@energy-manager/shared";
import {
  PartyNotFoundError,
  SensorKindNotAllowedError,
  deleteSensor,
  listSiteSensors,
  upsertSensor,
} from "./service.js";

/**
 * A participant's Home Assistant sensors. Listed per site, since that is
 * what the administration page shows; set and removed per participant.
 */
export async function partySensorRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/party-sensors", async (req) => {
    return listSiteSensors(req.params.siteId);
  });

  app.put<{ Params: { partyId: string } }>("/api/parties/:partyId/sensors", async (req, reply) => {
    const parsed = partySensorInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      return await upsertSensor(req.params.partyId, parsed.data);
    } catch (err) {
      if (err instanceof PartyNotFoundError) return reply.status(404).send({ error: "not_found" });
      if (err instanceof SensorKindNotAllowedError) {
        return reply.status(409).send({ error: "kind_not_allowed", message: err.message });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/party-sensors/:id", async (req, reply) => {
    const deleted = await deleteSensor(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
