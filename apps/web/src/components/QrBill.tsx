import { useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantInvoice, Party } from "@energy-manager/shared";
import { SwissQRBill } from "swissqrbill/svg";
import type { Data } from "swissqrbill/types";
import { calculateQRReferenceChecksum, calculateSCORReferenceChecksum, isQRIBAN } from "swissqrbill/utils";

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
 * Everything the creditor half needs, taken from the party flagged as RCP
 * operator. Anything missing means no bill: a payment slip with half an
 * address cannot be paid, so printing nothing is the honest outcome.
 */
function creditorOf(operator: Party | undefined): Data["creditor"] | null {
  if (!operator?.iban || !operator.address || !operator.zip || !operator.city) return null;
  return {
    account: operator.iban,
    address: operator.address,
    buildingNumber: operator.buildingNumber ?? undefined,
    city: operator.city,
    country: operator.country || "CH",
    name: operator.name,
    zip: operator.zip,
  };
}

/**
 * The debtor half, or undefined to leave the "payable by" box empty — a
 * legitimate variant of the bill, and the right one when we don't know where
 * somebody lives.
 */
function debtorOf(invoice: ParticipantInvoice, party?: Party): Data["debtor"] | undefined {
  if (!party?.address || !party.zip || !party.city) return undefined;
  return {
    address: party.address,
    buildingNumber: party.buildingNumber ?? undefined,
    city: party.city,
    country: party.country || "CH",
    name: invoice.partyName,
    zip: party.zip,
  };
}

export interface QrBillProps {
  /** The party flagged as RCP operator — the payee. */
  operator?: Party;
  invoice: ParticipantInvoice;
  /** The invoiced party, for the payer half. Undefined leaves that box empty. */
  party?: Party;
}

export function QrBill({ operator, invoice, party }: QrBillProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo<Data | null>(() => {
    const creditor = creditorOf(operator);
    if (!creditor) return null;
    // An amount of zero is not a valid QR-bill amount. Omitting it prints an
    // empty amount box, which is the correct way to say "nothing due" without
    // producing an unscannable code.
    const amount = invoice.totalChf > 0 ? Number(invoice.totalChf.toFixed(2)) : undefined;
    return {
      amount,
      creditor,
      currency: "CHF",
      debtor: debtorOf(invoice, party),
      // Joined without spaces: the bill's text box breaks on whitespace, and
      // a spaced dash sends the closing date onto a third line.
      message: `Facture RCP ${swissDate(invoice.from)}-${swissDate(invoice.to)}`,
      reference: buildReference(creditor.account, invoice.from, invoice.partyReference),
    };
  }, [operator, invoice, party]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.replaceChildren();
    if (!data) return;
    try {
      // appendChild of the library's own DOM node rather than setting
      // innerHTML: the bill embeds names and addresses as SVG text, and this
      // way they are never parsed as markup.
      node.appendChild(new SwissQRBill(data, { language: "FR" }).element);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "QR-bill could not be generated");
    }
  }, [data]);

  if (!data) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
        Aucun bulletin de versement : marquez un participant comme gestionnaire du RCP et
        complétez son IBAN et son adresse sous &laquo;&nbsp;Import readings&nbsp;&raquo; →
        Participants.
      </p>
    );
  }

  return (
    <section className="print-payment rounded-lg border bg-white p-4 print:border-0 print:p-0">
      {error && (
        <p className="mb-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Bulletin de versement impossible : {error}
        </p>
      )}
      {/* Fixed 210 × 105 mm by specification, so never scaled — a resized QR
          code risks not scanning. Narrow screens scroll instead; print gets a
          zero page margin so it lands at true size. */}
      <div ref={host} className="overflow-x-auto" />
    </section>
  );
}
