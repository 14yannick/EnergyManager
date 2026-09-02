import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema, readingImportModeSchema } from "@energy-manager/shared";
import { parseMetricsCsv } from "./csvImport.js";
import { deleteReadings, listReadings, upsertReadings } from "./service.js";

export async function readingsRoutes(app: FastifyInstance) {
  app.post<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/readings/import",
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.status(400).send({ error: "missing_file" });

      const modeField = file.fields.mode;
      const modeRaw = modeField && "value" in modeField ? modeField.value : "delta";
      const modeParsed = readingImportModeSchema.safeParse(modeRaw);
      if (!modeParsed.success) {
        return reply.status(400).send({ error: "invalid_mode", message: "mode must be 'delta' or 'cumulative'" });
      }

      const buffer = await file.toBuffer();
      const { rows, errors } = parseMetricsCsv(buffer.toString("utf-8"), modeParsed.data);
      const { inserted, updated } = await upsertReadings(req.params.siteId, rows);

      return { inserted, updated, skipped: errors.length, errors };
    },
  );

  app.get<{ Params: { siteId: string }; Querystring: { from: string; to: string } }>(
    "/api/sites/:siteId/readings",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return listReadings(req.params.siteId, parsed.data.from, parsed.data.to);
    },
  );

  app.delete<{ Params: { siteId: string }; Querystring: { from: string; to: string } }>(
    "/api/sites/:siteId/readings",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const deleted = await deleteReadings(req.params.siteId, parsed.data.from, parsed.data.to);
      return { deleted };
    },
  );
}
