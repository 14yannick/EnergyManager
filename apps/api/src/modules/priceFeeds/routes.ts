import type { FastifyInstance } from "fastify";
import { priceFeedInputSchema } from "@energy-manager/shared";
import { isUniqueViolation } from "../../lib/pgErrors.js";
import { createPriceFeed, deletePriceFeed, listPriceFeeds, updatePriceFeed } from "./service.js";

const KEY_TAKEN = { error: "key_taken", message: "Another price feed already uses this key." };

/**
 * The installation's price feeds — defined under Integrations, chosen per
 * site under Site administration. Not scoped to a site: a published price
 * is the same series for everyone it prices.
 */
export async function priceFeedRoutes(app: FastifyInstance) {
  app.get("/api/price-feeds", async () => listPriceFeeds());

  app.post("/api/price-feeds", async (req, reply) => {
    const parsed = priceFeedInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      return reply.status(201).send(await createPriceFeed(parsed.data));
    } catch (err) {
      if (isUniqueViolation(err)) return reply.status(409).send(KEY_TAKEN);
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>("/api/price-feeds/:id", async (req, reply) => {
    const parsed = priceFeedInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      const updated = await updatePriceFeed(req.params.id, parsed.data);
      if (!updated) return reply.status(404).send({ error: "not_found" });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) return reply.status(409).send(KEY_TAKEN);
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/price-feeds/:id", async (req, reply) => {
    const deleted = await deletePriceFeed(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
