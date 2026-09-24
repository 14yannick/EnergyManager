import PDFDocument from "pdfkit";
import { SwissQRBill, Table, type PDFTable } from "swissqrbill/pdf";
import { QR_LANGUAGE, buildReference, creditorOf, debtorOf, swissDate } from "@energy-manager/shared";
import type { BillingCategory, InvoiceLine, InvoiceLocale, InvoicePayee, IssuedInvoice } from "@energy-manager/shared";
import { pdfText } from "./pdfText.js";

const CATEGORY_ORDER: BillingCategory[] = ["energie", "netznutzung", "messung", "abgaben"];

const chf = (n: number) => n.toFixed(2);

/** DD.MM.YYYY, the Swiss form used everywhere else in this app. */
function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const HEADER_COLOR = "#0f172a";
const RULE_COLOR = "#cbd5e1";
const MUTED_COLOR = "#64748b";
// PDFKit never applies weight on its own — a fontSize/fillColor change alone
// stays visually flat. Every place that should read as bold (headers,
// subtotals, totals), matching the browser preview's font-medium/font-semibold,
// switches to this explicitly and switches back afterwards.
const FONT_REGULAR = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

function lineTable(lines: InvoiceLine[], text: ReturnType<typeof pdfText>): PDFTable {
  const headerRow = {
    header: true as const,
    backgroundColor: "#f1f5f9",
    fontName: FONT_BOLD,
    fontSize: 9,
    textColor: MUTED_COLOR,
    columns: [
      { text: text.columnPosition, align: "left" as const },
      { text: text.columnQuantity, align: "right" as const, width: 90 },
      { text: text.columnPrice, align: "right" as const, width: 90 },
      { text: text.columnAmount, align: "right" as const, width: 90 },
    ],
  };
  const rows = lines.map((l) => ({
    fontName: FONT_REGULAR,
    fontSize: 9,
    columns: [
      { text: l.kind ? text.lineLabel[l.kind] : l.label, align: "left" as const },
      {
        text: l.quantityUnit === "kWh" ? `${l.quantity.toFixed(1)} kWh` : text.days(l.quantity),
        align: "right" as const,
        width: 90,
      },
      {
        text:
          l.quantityUnit === "kWh"
            ? `${(l.unitRateChf * 100).toFixed(2)} ${text.cents}`
            : `${(l.unitRateChf * 365).toFixed(2)} ${text.perYear}`,
        align: "right" as const,
        width: 90,
      },
      { text: chf(l.amountChf), align: "right" as const, width: 90 },
    ],
  }));
  return { rows: [headerRow, ...rows], fontSize: 9, padding: [4, 6] };
}

function drawHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.font(FONT_BOLD).fillColor(HEADER_COLOR).fontSize(16).text(title, { continued: false });
  if (subtitle) doc.font(FONT_REGULAR).fillColor(MUTED_COLOR).fontSize(9).text(subtitle);
  doc.moveDown(0.5);
  doc
    .strokeColor(RULE_COLOR)
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(1);
  doc.font(FONT_REGULAR).fillColor("#0f172a").fontSize(10);
}

function drawTotalRow(doc: PDFKit.PDFDocument, label: string, value: string, strong = false) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveDown(0.3);
  doc
    .strokeColor(strong ? HEADER_COLOR : RULE_COLOR)
    .lineWidth(strong ? 1.5 : 1)
    .moveTo(doc.x, doc.y)
    .lineTo(doc.x + width, doc.y)
    .stroke();
  doc.moveDown(0.3);
  const x = doc.x;
  const y = doc.y;
  doc.font(FONT_BOLD).fontSize(strong ? 12 : 10).fillColor(HEADER_COLOR);
  // Two independent boxes at the same (x, y) — not a `continued` run.
  // PDFKit right-aligns a continued call's text within *that call's own*
  // width, not the row's full width, so `.text(value, {align:"right"})`
  // right-aligned inside `width - 100` instead of the true right margin,
  // landing every total short of where the table's own Amount CHF column
  // above it ends.
  doc.text(label, x, y, { width: width - 100 });
  doc.text(value, x, y, { width, align: "right" });
  doc.x = x;
  doc.y = y + doc.currentLineHeight(true);
  doc.font(FONT_REGULAR);
  doc.moveDown(0.5);
}

/**
 * One participant's invoice as a two-page PDF: the bill itself, then the
 * vZEV-benefit comparison, then — unless this is the administrator's own
 * invoice — the QR-bill payment slip. Every figure comes from `invoice`, as
 * already computed by `runInvoices`; nothing here is recalculated.
 */
export async function buildInvoicePdf(
  invoice: IssuedInvoice,
  payee: InvoicePayee | null,
  locale: InvoiceLocale,
): Promise<Buffer> {
  const text = pdfText(locale);
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Page 1 — the bill.
  drawHeader(
    doc,
    invoice.partyName,
    [
      invoice.partyReference ? text.participantNo(invoice.partyReference) : null,
      text.header(localDate(invoice.from), localDate(invoice.to), invoice.days, invoice.participantCount),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  // The feed-in credit leads the bill, ahead of the categorized positions —
  // it is the grid provider's own money coming back, not one more charge to
  // read down a table to find.
  const feedInLine = invoice.lines.find((l) => l.kind === "feed_in");
  if (feedInLine) {
    drawTotalRow(
      doc,
      `${text.lineLabel.feed_in} (${feedInLine.quantity.toFixed(1)} kWh)`,
      chf(feedInLine.amountChf),
    );
  }

  for (const category of CATEGORY_ORDER) {
    const lines = invoice.lines.filter((l) => l.category === category && l.kind !== "feed_in");
    if (lines.length === 0) continue;
    doc.font(FONT_BOLD).fontSize(11).fillColor(HEADER_COLOR).text(text.category[category]);
    doc.font(FONT_REGULAR);
    doc.moveDown(0.2);
    new Table(lineTable(lines, text)).attachTo(doc);
    doc.moveDown(0.1);
    drawTotalRow(doc, text.subtotal, chf(lines.reduce((s, l) => s + l.amountChf, 0)));
    doc.moveDown(0.4);
  }

  drawTotalRow(doc, text.amountDue, `CHF ${chf(invoice.totalChf)}`, true);
  doc.moveDown(0.5);
  const ownUse = invoice.selfDirectKwh + invoice.selfBatteryKwh;
  doc
    .fontSize(8)
    .fillColor(MUTED_COLOR)
    .text(
      ownUse > 0
        ? text.footnoteOwner(
            (invoice.gridKwh + invoice.localKwh + ownUse).toFixed(1),
            invoice.selfDirectKwh.toFixed(1),
            invoice.selfBatteryKwh.toFixed(1),
            invoice.gridKwh.toFixed(1),
          )
        : text.footnote(invoice.gridKwh.toFixed(1), invoice.localKwh.toFixed(1)),
    );

  // Page 2 — the vZEV-benefit comparison, mirroring the browser's own second page.
  doc.addPage();
  drawHeader(doc, text.benefitTitle(invoice.partyName), text.benefitIntro);

  doc.font(FONT_BOLD).fontSize(11).fillColor(HEADER_COLOR).text(text.directSupply);
  doc.font(FONT_REGULAR);
  doc.moveDown(0.2);
  new Table(lineTable(invoice.comparison.lines, text)).attachTo(doc);
  doc.moveDown(0.1);
  drawTotalRow(doc, text.directSupplyTotal, chf(invoice.comparison.totalChf));

  doc.moveDown(0.8);
  drawTotalRow(doc, text.directly, `CHF ${chf(invoice.comparison.totalChf)}`);
  drawTotalRow(doc, text.yourInvoice, `CHF ${chf(invoice.totalChf)}`);
  drawTotalRow(doc, text.yourBenefit, `CHF ${chf(invoice.comparison.savingChf)}`, true);

  // Only where there is something to split — the administrator's own
  // invoice, whose own production is what the benefit is mostly made of.
  if (ownUse > 0) {
    doc.fontSize(8).fillColor(MUTED_COLOR);
    doc.text(`  ${text.splitDirectUse}: CHF ${chf(invoice.comparison.savingSplit.directUseChf)}`);
    doc.text(`  ${text.splitBattery}: CHF ${chf(invoice.comparison.savingSplit.batteryChf)}`);
    doc.text(`  ${text.splitRcp}: CHF ${chf(invoice.comparison.savingSplit.rcpChf)}`);
  }

  doc.moveDown(0.5);
  doc
    .fontSize(8)
    .fillColor(MUTED_COLOR)
    .text(
      ownUse > 0
        ? text.benefitNoteOwner(ownUse.toFixed(1), invoice.participantCount)
        : text.benefitNote(invoice.participantCount, invoice.localKwh.toFixed(1)),
    );

  // The payment slip — skipped on the administrator's own invoice, exactly
  // the rule BillingPage.tsx already applies: a slip payable from and to the
  // same account is meaningless.
  const creditor = creditorOf(payee);
  if (creditor && payee?.partyId !== invoice.partyId) {
    // swissqrbill draws its own text without ever setting a fill color of
    // its own — it just uses whatever the caller's PDFKit doc is currently
    // set to. Left at MUTED_COLOR from the benefit note above, every label
    // and value on the payment slip printed grey instead of black.
    doc.fillColor(HEADER_COLOR);
    new SwissQRBill(
      {
        amount: invoice.totalChf > 0 ? Number(invoice.totalChf.toFixed(2)) : undefined,
        creditor,
        currency: "CHF",
        debtor: debtorOf(invoice),
        // Joined without spaces, same as the browser: the bill's text box
        // breaks on whitespace, and a spaced dash sends the date onto a third line.
        message: `${swissDate(invoice.from)}-${swissDate(invoice.to)}`,
        reference: buildReference(creditor.account, invoice.from, invoice.partyReference),
      },
      { language: QR_LANGUAGE[locale] },
    ).attachTo(doc);
  }

  doc.end();
  return done;
}
