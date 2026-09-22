import type { FastifyInstance } from "fastify";
import type { CfAccessStatus } from "@energy-manager/shared";
import { cfAccessSyncConfigured } from "../../config/env.js";
import { syncCloudflareAccess } from "./service.js";

export async function cfAccessRoutes(app: FastifyInstance) {
  app.get("/api/cloudflare-access/status", async (): Promise<CfAccessStatus> => ({
    configured: cfAccessSyncConfigured,
  }));

  // The escape hatch for whenever the automatic push (fired from
  // parties/routes.ts after every save) failed — a bad token, Cloudflare
  // being briefly unreachable — without making the admin re-save every
  // party to retry it.
  app.post("/api/cloudflare-access/sync", async () => syncCloudflareAccess());
}
