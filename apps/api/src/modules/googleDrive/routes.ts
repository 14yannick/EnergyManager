import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { sites } from "../../db/schema/index.js";
import { DriveFolderAccessError, googleDriveConfigured, serviceAccountEmail, verifyFolderAccess } from "./service.js";

const verifyFolderSchema = z.object({ folderId: z.string().trim().min(1).max(200) });

export async function googleDriveRoutes(app: FastifyInstance) {
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/drive/status", async (req, reply) => {
    const [site] = await db
      .select({ driveFolderId: sites.driveFolderId, driveFolderName: sites.driveFolderName })
      .from(sites)
      .where(eq(sites.id, req.params.siteId));
    if (!site) return reply.status(404).send({ error: "not_found" });
    return {
      configured: googleDriveConfigured,
      serviceAccountEmail: await serviceAccountEmail(),
      folderId: site.driveFolderId,
      folderName: site.driveFolderName,
    };
  });

  // Checks access and — only once that succeeds — saves the folder id on the
  // site, so a half-verified id can never sit there looking connected. There
  // is no separate "save" action for this field; see validation.ts.
  app.post<{ Params: { siteId: string } }>("/api/sites/:siteId/drive/verify-folder", async (req, reply) => {
    if (!googleDriveConfigured) {
      return reply
        .status(503)
        .send({ error: "not_configured", message: "Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY_FILE on the server." });
    }
    const parsed = verifyFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    let name: string;
    try {
      ({ name } = await verifyFolderAccess(parsed.data.folderId));
    } catch (err) {
      if (err instanceof DriveFolderAccessError) {
        return reply.status(422).send({ error: "folder_not_accessible", message: err.message });
      }
      throw err;
    }
    const [row] = await db
      .update(sites)
      .set({ driveFolderId: parsed.data.folderId, driveFolderName: name, updatedAt: new Date() })
      .where(eq(sites.id, req.params.siteId))
      .returning({ id: sites.id });
    if (!row) return reply.status(404).send({ error: "not_found" });
    return { folderId: parsed.data.folderId, folderName: name };
  });

  // Disconnects without touching whether the folder itself still exists or
  // is still shared — just this site's record of using it.
  app.delete<{ Params: { siteId: string } }>("/api/sites/:siteId/drive/folder", async (req, reply) => {
    const [row] = await db
      .update(sites)
      .set({ driveFolderId: null, driveFolderName: null, updatedAt: new Date() })
      .where(eq(sites.id, req.params.siteId))
      .returning({ id: sites.id });
    if (!row) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });
}
