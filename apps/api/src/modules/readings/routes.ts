import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import {
  dateRangeQuerySchema,
  readingImportModeSchema,
  readingsExportQuerySchema,
} from "@energy-manager/shared";
import { parseMetricsCsv } from "./csvImport.js";
import {
  deleteReadings,
  exportReadings,
  getFirstProductionDate,
  getReadingsRange,
  listReadings,
  upsertReadings,
} from "./service.js";

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

  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/readings/range", async (req) => {
    const [range, firstProduction] = await Promise.all([
      getReadingsRange(req.params.siteId),
      getFirstProductionDate(req.params.siteId),
    ]);
    return { ...(range ?? { from: null, to: null }), firstProduction };
  });

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

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/readings/export.xlsx",
    async (req, reply) => {
      const parsed = readingsExportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      const { from, to, kinds } = parsed.data;
      const rows = await exportReadings(req.params.siteId, from, to, kinds);

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Readings");
      sheet.columns = [
        { header: "Date", key: "localDate", width: 12 },
        { header: "Time", key: "localTime", width: 8 },
        { header: "Metric", key: "metricKind", width: 20 },
        { header: "Party", key: "party", width: 16 },
        { header: "kWh", key: "valueKwh", width: 12, style: { numFmt: "0.0000" } },
        { header: "Source", key: "source", width: 14 },
        { header: "Timestamp (UTC)", key: "tsUtc", width: 26 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      for (const r of rows) {
        sheet.addRow({
          localDate: r.localDate,
          localTime: r.localTime,
          metricKind: r.metricKind,
          party: r.party ?? "",
          valueKwh: r.valueKwh,
          source: r.source,
          tsUtc: r.ts.toISOString(),
        });
      }
      sheet.autoFilter = { from: "A1", to: "G1" };

      const buffer = await workbook.xlsx.writeBuffer();
      // `from`/`to` are zod-validated YYYY-MM-DD, so they can't break out of
      // the quoted filename.
      return reply
        .header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header("Content-Disposition", `attachment; filename="readings_${from}_${to}.xlsx"`)
        .send(Buffer.from(buffer));
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
