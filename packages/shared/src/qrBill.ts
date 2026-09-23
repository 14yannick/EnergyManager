import type { Data } from "swissqrbill/types";
import { calculateQRReferenceChecksum, calculateSCORReferenceChecksum, isQRIBAN } from "swissqrbill/utils";
import type { InvoicePayee, IssuedInvoice } from "./types.js";

/**
 * QR-bill payment-reference and address logic — shared by the browser's SVG
 * render (`swissqrbill/svg`, in apps/web) and the server's PDF generation
 * (`swissqrbill/pdf`, in apps/api), so the two can never compute a different
 * reference or address for the same invoice.
 */

/** "2026-04-01" to "01.04.2026", the form a Swiss payer expects. */
export const swissDate = (iso: string) => iso.split("-").reverse().join(".");

/** Digits only, for the numeric-only QR-reference. */
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * The slip's own four languages; ours are a subset. Shared so the browser's
 * SVG render and the server's PDF generation pick the same one for a given
 * app locale — the slip's headings ("Payable to", "Reference", …) follow it.
 */
export const QR_LANGUAGE = { fr: "FR", de: "DE", en: "EN" } as const;

/**
 * A payment reference that is stable for a given participant and period, so
 * reprinting an invoice never produces a second reference for the same debt.
 *
 * Which scheme applies is decided by the IBAN, not by configuration: a
 * QR-IBAN (institution 30000-31999) *requires* a QR-reference, and a normal
 * IBAN cannot carry one. Getting that backwards produces a bill banks reject,
 * so it is derived rather than asked.
 */
export function buildReference(iban: string, from: string, partyReference: string | null): string {
  // 8 digits of participant number + the period's start date, both fixed
  // width so the two never run together ambiguously.
  const participant = digits(partyReference).slice(-8).padStart(8, "0");
  const period = from.replace(/-/g, "");

  if (isQRIBAN(iban)) {
    // QRR: exactly 27 characters — 26 digits plus a modulo-10 recursive
    // check digit.
    const body = (participant + period).padEnd(26, "0").slice(0, 26);
    return body + calculateQRReferenceChecksum(body);
  }

  // SCOR (ISO 11649): "RF", two check digits, then up to 21 alphanumerics.
  const body = (period + participant).slice(0, 21);
  return `RF${calculateSCORReferenceChecksum(body)}${body}`;
}

/**
 * Everything the creditor half needs, taken from the party administering the
 * RCP. Anything missing means no bill: a payment slip with half an address
 * cannot be paid, so printing nothing is the honest outcome.
 */
export function creditorOf(payee: InvoicePayee | null): Data["creditor"] | null {
  if (!payee?.iban || !payee.address || !payee.zip || !payee.city) return null;
  return {
    account: payee.iban,
    address: payee.address,
    buildingNumber: payee.buildingNumber ?? undefined,
    city: payee.city,
    country: payee.country || "CH",
    name: payee.name,
    zip: payee.zip,
  };
}

/**
 * The debtor half, or undefined to leave the "payable by" box empty — a
 * legitimate variant of the bill, and the right one when we don't know where
 * somebody lives.
 */
export function debtorOf(invoice: IssuedInvoice): Data["debtor"] | undefined {
  const payer = invoice.payer;
  if (!payer.address || !payer.zip || !payer.city) return undefined;
  return {
    address: payer.address,
    buildingNumber: payer.buildingNumber ?? undefined,
    city: payer.city,
    country: payer.country || "CH",
    name: invoice.partyName,
    zip: payer.zip,
  };
}
