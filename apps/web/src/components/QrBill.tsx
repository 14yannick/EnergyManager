import { useEffect, useMemo, useRef, useState } from "react";
import type { InvoicePayee, IssuedInvoice } from "@energy-manager/shared";
import { SwissQRBill } from "swissqrbill/svg";
import type { Data } from "swissqrbill/types";
import { calculateQRReferenceChecksum, calculateSCORReferenceChecksum, isQRIBAN } from "swissqrbill/utils";
import { useI18n } from "../i18n/context";

/** "2026-04-01" to "01.04.2026", the form a Swiss payer expects. */
const swissDate = (iso: string) => iso.split("-").reverse().join(".");

/** Digits only, for the numeric-only QR-reference. */
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

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
function creditorOf(payee: InvoicePayee | null): Data["creditor"] | null {
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
function debtorOf(invoice: IssuedInvoice): Data["debtor"] | undefined {
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

/** The slip's own four languages; ours are a subset. */
const QR_LANGUAGE = { fr: "FR", de: "DE", en: "EN" } as const;

export interface QrBillProps {
  /** Whoever administers the RCP — the payee. */
  payee: InvoicePayee | null;
  /** The invoice, carrying its payer's address for the "payable by" half. */
  invoice: IssuedInvoice;
}

export function QrBill({ payee, invoice }: QrBillProps) {
  const { t, locale } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo<Data | null>(() => {
    const creditor = creditorOf(payee);
    if (!creditor) return null;
    // An amount of zero is not a valid QR-bill amount. Omitting it prints an
    // empty amount box, which is the correct way to say "nothing due" without
    // producing an unscannable code.
    const amount = invoice.totalChf > 0 ? Number(invoice.totalChf.toFixed(2)) : undefined;
    return {
      amount,
      creditor,
      currency: "CHF",
      debtor: debtorOf(invoice),
      // Joined without spaces: the bill's text box breaks on whitespace, and
      // a spaced dash sends the closing date onto a third line.
      message: t("qr.message", { from: swissDate(invoice.from), to: swissDate(invoice.to) }),
      reference: buildReference(creditor.account, invoice.from, invoice.partyReference),
    };
  }, [payee, invoice, t]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.replaceChildren();
    if (!data) return;
    try {
      // appendChild of the library's own DOM node rather than setting
      // innerHTML: the bill embeds names and addresses as SVG text, and this
      // way they are never parsed as markup.
      // The slip's own headings ("Payable to", "Reference", …) come from the
      // library, so it follows the app's language rather than being fixed to
      // French — the bill and the invoice around it stay in one language.
      node.appendChild(
        new SwissQRBill(data, { language: QR_LANGUAGE[locale] }).element,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("qr.error"));
    }
  }, [data, locale, t]);

  if (!data) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
        {t("qr.noBill")}
      </p>
    );
  }

  return (
    <section className="print-payment rounded-lg border bg-white p-4 print:border-0 print:p-0">
      {error && (
        <p className="mb-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {t("qr.failed", { message: error })}
        </p>
      )}
      {/* Fixed 210 × 105 mm by specification, so never scaled — a resized QR
          code risks not scanning. Narrow screens scroll instead; print gets a
          zero page margin so it lands at true size. */}
      <div ref={host} className="overflow-x-auto" />
    </section>
  );
}
