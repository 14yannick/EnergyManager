import { useEffect, useMemo, useRef, useState } from "react";
import type { InvoicePayee, IssuedInvoice } from "@energy-manager/shared";
import { QR_LANGUAGE, buildReference, creditorOf, debtorOf, swissDate } from "@energy-manager/shared";
import { SwissQRBill } from "swissqrbill/svg";
import type { Data } from "swissqrbill/types";
import { useI18n } from "../i18n/context";

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
      <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-200 print:hidden">
        {t("qr.noBill")}
      </p>
    );
  }

  return (
    <section className="print-payment rounded-lg border bg-white p-4 print:border-0 print:p-0">
      {error && (
        <p className="mb-2 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200">
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
