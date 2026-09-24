import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import JSZip from "jszip";
import type { Invoice, InvoiceLock, InvoiceLocale } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { invoices, sites } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { runInvoices } from "../billing/service.js";
import { googleDriveConfigured, uploadPdf } from "../googleDrive/service.js";
import { buildInvoicePdf } from "./pdf.js";

type Row = typeof invoices.$inferSelect;

function toDomain(row: Row): Invoice {
  return {
    id: row.id,
    batchId: row.batchId,
    siteId: row.siteId,
    partyId: row.partyId,
    partyReference: row.partyReference,
    partyName: row.partyName,
    from: row.periodFrom,
    to: row.periodTo,
    issuedAt: row.issuedAt.toISOString(),
    gridKwh: toNumber(row.gridKwh),
    localKwh: toNumber(row.localKwh),
    selfDirectKwh: toNumber(row.selfDirectKwh),
    selfBatteryKwh: toNumber(row.selfBatteryKwh),
    totalChf: toNumber(row.totalChf),
    savingChf: toNumber(row.savingChf),
    status: row.status,
    paidAt: row.paidAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    drivePdfFileId: row.drivePdfFileId,
  };
}

/** One or more of the requested parties already has an active invoice for this period. */
export class InvoicePeriodLockedError extends Error {
  constructor(readonly locks: InvoiceLock[]) {
    super(`${locks.length} of the requested parties already have an active invoice for this period.`);
    this.name = "InvoicePeriodLockedError";
  }
}

/** A state transition that doesn't make sense for the row(s) as they stand. */
export class InvoiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceStateError";
  }
}

/** The period run priced nobody — nothing to record and nothing to zip. */
export class NothingToInvoiceError extends Error {
  constructor() {
    super("No participants to invoice for this period.");
    this.name = "NothingToInvoiceError";
  }
}

export async function listInvoices(siteId: string, partyId: string | null): Promise<Invoice[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(partyId ? and(eq(invoices.siteId, siteId), eq(invoices.partyId, partyId)) : eq(invoices.siteId, siteId))
    .orderBy(desc(invoices.periodFrom), desc(invoices.issuedAt));
  return rows.map(toDomain);
}

/**
 * Every party already locked for a period — one row per party with an
 * active (non-cancelled) invoice, the partial unique index guaranteeing at
 * most one such row per party. Generating is per-party now, so this can name
 * some parties of a period while leaving others free.
 */
export async function findLocks(siteId: string, from: string, to: string): Promise<InvoiceLock[]> {
  const rows = await db
    .select({
      partyId: invoices.partyId,
      batchId: invoices.batchId,
      issuedAt: invoices.issuedAt,
      status: invoices.status,
    })
    .from(invoices)
    .where(
      and(eq(invoices.siteId, siteId), eq(invoices.periodFrom, from), eq(invoices.periodTo, to), ne(invoices.status, "cancelled")),
    );
  return rows.map((r) => ({ ...r, issuedAt: r.issuedAt.toISOString() }));
}

/** A zip entry name safe across filesystems: the party's own reference where it has one. */
function filenameFor(invoice: { partyReference: string | null; partyName: string }): string {
  const base = (invoice.partyReference || invoice.partyName).replace(/[^\w.-]+/g, "_");
  return `${base}.pdf`;
}

/**
 * Turns a period's live computation into a dated, persisted batch: one row
 * per selected participant plus the PDF it was built from, zipped for
 * download.
 *
 * Refuses outright if any of `partyIds` is already locked for this period —
 * regeneration requires cancelling the batch that locked them first, not a
 * silent duplicate. Everyone else requested is still invoiced normally; the
 * caller is expected to have already excluded locked parties from the
 * request (the Billing page disables their checkbox), so reaching this
 * refusal at all means the two disagreed about who's locked. `runInvoices`
 * is the same engine the live Billing page already shows, so a generated
 * invoice can never disagree with what an admin saw right before generating
 * it; its `BillingPeriodError` (a period spanning a tariff change) is left
 * to propagate unchanged.
 */
/** The one piece of Fastify's request logger this needs — kept minimal so tests can stub it trivially. */
export interface MinimalLogger {
  error: (obj: unknown, msg?: string) => void;
}

export async function generateInvoices(
  siteId: string,
  from: string,
  to: string,
  locale: InvoiceLocale,
  partyIds: string[],
  log?: MinimalLogger,
): Promise<{ batchId: string; zip: Buffer }> {
  const locks = await findLocks(siteId, from, to);
  const requested = new Set(partyIds);
  const blocking = locks.filter((l) => requested.has(l.partyId));
  if (blocking.length > 0) throw new InvoicePeriodLockedError(blocking);

  const run = await runInvoices(siteId, from, to);
  const selected = run.invoices.filter((invoice) => invoice.partyId != null && requested.has(invoice.partyId));
  if (selected.length === 0) throw new NothingToInvoiceError();

  // Only read once per batch, not once per invoice — and only at all if
  // there is any point, i.e. the server has a service account configured.
  let driveFolderId: string | null = null;
  if (googleDriveConfigured) {
    const [site] = await db.select({ driveFolderId: sites.driveFolderId }).from(sites).where(eq(sites.id, siteId));
    driveFolderId = site?.driveFolderId ?? null;
  }

  const batchId = randomUUID();
  const zip = new JSZip();
  const rows = await Promise.all(
    selected.map(async (invoice) => {
      const pdf = await buildInvoicePdf(invoice, run.payee, locale);
      zip.file(filenameFor(invoice), pdf);
      // Best-effort: a Drive hiccup must never lose an invoice that has
      // already been decided and priced. The zip download is never at risk
      // either way — it's built from `pdf` above, not from this.
      let drivePdfFileId: string | null = null;
      if (driveFolderId) {
        try {
          drivePdfFileId = await uploadPdf(driveFolderId, filenameFor(invoice), pdf);
        } catch (err) {
          log?.error({ err, batchId, partyName: invoice.partyName }, "Drive upload failed for a generated invoice");
        }
      }
      return {
        batchId,
        siteId,
        partyId: invoice.partyId!,
        partyReference: invoice.partyReference,
        partyName: invoice.partyName,
        periodFrom: from,
        periodTo: to,
        gridKwh: String(invoice.gridKwh),
        localKwh: String(invoice.localKwh),
        selfDirectKwh: String(invoice.selfDirectKwh),
        selfBatteryKwh: String(invoice.selfBatteryKwh),
        totalChf: String(invoice.totalChf),
        savingChf: String(invoice.comparison.savingChf),
        detail: invoice,
        drivePdfFileId,
      };
    }),
  );

  // The PDFs are built before the DB write starts — nothing here needs to be
  // rolled back if a later one fails, so building them outside the
  // transaction keeps it short.
  await db.insert(invoices).values(rows);

  return { batchId, zip: await zip.generateAsync({ type: "nodebuffer" }) };
}

export async function markPaid(id: string, paidAt: string): Promise<Invoice> {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) throw new InvoiceStateError("No such invoice.");
  if (row.status !== "issued") {
    throw new InvoiceStateError(`Invoice is ${row.status}, not issued — nothing to mark paid.`);
  }
  const [updated] = await db
    .update(invoices)
    .set({ status: "paid", paidAt: new Date(paidAt), updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning();
  return toDomain(updated!);
}

/**
 * Cancels every invoice in a batch, freeing its period for regeneration.
 *
 * Refuses outright if any invoice in the batch is already paid — voiding
 * settled debt is a bookkeeping error waiting to happen, not something a
 * single click should be able to do. The admin has to deal with a paid
 * invoice deliberately (there is no "force cancel" — this app has no use
 * for one yet).
 */
export async function cancelBatch(batchId: string): Promise<number> {
  const rows = await db.select().from(invoices).where(eq(invoices.batchId, batchId));
  if (rows.length === 0) throw new InvoiceStateError("No such batch.");
  const paid = rows.filter((r) => r.status === "paid");
  if (paid.length > 0) {
    throw new InvoiceStateError(
      `${paid.length} invoice(s) in this batch are already paid (${paid.map((r) => r.partyName).join(", ")}) — cancel is refused.`,
    );
  }
  const result = await db
    .update(invoices)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.batchId, batchId), ne(invoices.status, "cancelled")))
    .returning({ id: invoices.id });
  return result.length;
}
