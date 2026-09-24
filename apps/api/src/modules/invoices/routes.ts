import type { FastifyInstance } from "fastify";
import { dateRangeQuerySchema, generateInvoicesSchema, markInvoicePaidSchema } from "@energy-manager/shared";
import { BillingPeriodError } from "../billing/service.js";
import { scopedPartyId } from "../../auth/plugin.js";
import { DrivePdfNotFoundError, downloadPdf } from "../googleDrive/service.js";
import {
  InvoicePeriodLockedError,
  InvoiceStateError,
  NothingToInvoiceError,
  cancelBatch,
  findInvoicePdf,
  findLocks,
  generateInvoices,
  listInvoices,
  markPaid,
  markUnpaid,
} from "./service.js";

export async function invoiceRoutes(app: FastifyInstance) {
  // Filtered to the caller's own party for `participant`, same pattern as
  // billing/routes.ts's own invoice list — narrow, never reject.
  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/invoices", async (req) => {
    return listInvoices(req.params.siteId, scopedPartyId(req));
  });

  app.get<{ Params: { siteId: string }; Querystring: Record<string, string> }>(
    "/api/sites/:siteId/invoices/locks",
    async (req, reply) => {
      const parsed = dateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_query", issues: parsed.error.issues });
      }
      return findLocks(req.params.siteId, parsed.data.from, parsed.data.to);
    },
  );

  app.post<{ Params: { siteId: string } }>("/api/sites/:siteId/invoices/generate", async (req, reply) => {
    const parsed = generateInvoicesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const { from, to, locale, partyIds } = parsed.data;
    try {
      const { zip } = await generateInvoices(req.params.siteId, from, to, locale, partyIds, req.log);
      return reply
        .status(201)
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="invoices_${from}_${to}.zip"`)
        .send(zip);
    } catch (err) {
      if (err instanceof InvoicePeriodLockedError) {
        return reply.status(409).send({ error: "period_locked", message: err.message, locks: err.locks });
      }
      if (err instanceof NothingToInvoiceError) {
        return reply.status(422).send({ error: "nothing_to_invoice", message: err.message });
      }
      // Same period-spans-a-tariff-change refusal the live Billing view
      // already gives — Generate refuses for exactly the reason it would.
      if (err instanceof BillingPeriodError) {
        return reply.status(409).send({ error: "period_spans_tariff_change", message: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>("/api/invoices/:id/paid", async (req, reply) => {
    const parsed = markInvoicePaidSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    try {
      return await markPaid(req.params.id, parsed.data.paidAt);
    } catch (err) {
      if (err instanceof InvoiceStateError) {
        return reply.status(409).send({ error: "invalid_state", message: err.message });
      }
      throw err;
    }
  });

  // Proxied through the app rather than a direct Drive link: the file
  // carries no sharing of its own (see googleDrive/service.ts's uploadPdf),
  // so this is the only way to read it back, and it is what lets a
  // participant download without a Google account of their own while still
  // checking, on every request, that the invoice is theirs.
  app.get<{ Params: { id: string } }>("/api/invoices/:id/pdf", async (req, reply) => {
    const found = await findInvoicePdf(req.params.id);
    // A participant asking for someone else's invoice gets the same 404 as
    // one that doesn't exist at all — this never confirms which is true.
    const owned = scopedPartyId(req) == null || found?.partyId === scopedPartyId(req);
    if (!found || !owned) return reply.status(404).send({ error: "not_found" });
    if (!found.driveFileId) {
      return reply.status(404).send({ error: "not_archived", message: "No PDF was archived for this invoice." });
    }
    let stream;
    try {
      stream = await downloadPdf(found.driveFileId);
    } catch (err) {
      if (err instanceof DrivePdfNotFoundError) {
        req.log.warn({ err: err.message, invoiceId: req.params.id }, "invoice pdf missing from drive");
        return reply.status(404).send({ error: "not_found" });
      }
      throw err;
    }
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${found.filename}"`)
      .send(stream);
  });

  app.patch<{ Params: { id: string } }>("/api/invoices/:id/unpaid", async (req, reply) => {
    try {
      return await markUnpaid(req.params.id);
    } catch (err) {
      if (err instanceof InvoiceStateError) {
        return reply.status(409).send({ error: "invalid_state", message: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { batchId: string } }>("/api/invoices/batches/:batchId/cancel", async (req, reply) => {
    try {
      const cancelled = await cancelBatch(req.params.batchId);
      return { cancelled };
    } catch (err) {
      if (err instanceof InvoiceStateError) {
        return reply.status(409).send({ error: "invalid_state", message: err.message });
      }
      throw err;
    }
  });
}
