import type { FastifyInstance } from "fastify";
import type { AuthIdentity } from "@energy-manager/shared";

export async function meRoutes(app: FastifyInstance) {
  /**
   * Who the caller is, as the server sees them.
   *
   * This is also how a participant learns their `siteId`: `/api/sites` is
   * closed to them because a site row carries the owner's investment figures,
   * so they get the one id they're entitled to from here instead.
   */
  app.get("/api/me", async (req): Promise<AuthIdentity> => req.identity);
}
