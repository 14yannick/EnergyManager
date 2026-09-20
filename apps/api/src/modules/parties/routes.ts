import type { FastifyInstance } from "fastify";
import { partyInputSchema } from "@energy-manager/shared";
import { DuplicateEmailError, createParty, deleteParty, listParties, updateParty } from "./service.js";
import { isUniqueViolation, violatedConstraint } from "../../lib/pgErrors.js";

export async function partyRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/parties", async (req) => {
    return listParties(req.params.siteId);
  });

  app.post<{ Params: { siteId: string } }>("/api/sites/:siteId/parties", async (req, reply) => {
    const parsed = partyInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      const created = await createParty(req.params.siteId, parsed.data);
      return reply.status(201).send(created);
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        return reply.status(409).send({ error: "duplicate_email", message: err.message });
      }
      if (violatedConstraint(err, "parties_one_admin_idx")) {
        return reply.status(409).send({
          error: "admin_exists",
          message: "Another party already administers the RCP. Change that one first.",
        });
      }
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: "duplicate_name", message: "A party with this name already exists." });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>("/api/parties/:id", async (req, reply) => {
    const parsed = partyInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      const updated = await updateParty(req.params.id, parsed.data);
      if (!updated) return reply.status(404).send({ error: "not_found" });
      return updated;
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        return reply.status(409).send({ error: "duplicate_email", message: err.message });
      }
      if (violatedConstraint(err, "parties_one_admin_idx")) {
        return reply.status(409).send({
          error: "admin_exists",
          message: "Another party already administers the RCP. Change that one first.",
        });
      }
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: "duplicate_name", message: "A party with this name already exists." });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/parties/:id", async (req, reply) => {
    const deleted = await deleteParty(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
