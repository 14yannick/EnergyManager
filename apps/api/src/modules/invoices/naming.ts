import { periodShapeOf } from "@energy-manager/shared";

/**
 * Pure filename/folder-name logic — no DB, no network (same split as
 * billing/engine.ts vs billing/service.ts), so it can be tested directly.
 */

/**
 * The period as a short, filesystem-safe label — "Q1.2027" for a calendar
 * quarter, "2027" for a whole year, "2027-01" for a whole month, or the raw
 * dates for anything else (a custom range, say). The shape comes from
 * `periodShapeOf` (shared with the Account page's own period label, so a
 * generated invoice's Drive folder and its on-screen period read as the same
 * period) — only the formatting into a filesystem-safe string is this
 * module's own.
 */
export function periodLabelFor(from: string, to: string): string {
  const shape = periodShapeOf(from, to);
  if (shape.kind === "year") return String(shape.year);
  if (shape.kind === "quarter") return `Q${shape.quarter}.${shape.year}`;
  if (shape.kind === "month") return `${shape.year}-${String(shape.month1).padStart(2, "0")}`;
  return `${from}_${to}`;
}

/** A file name safe across filesystems: the period, then the party's own reference where it has one. */
export function filenameFor(
  invoice: { partyReference: string | null; partyName: string },
  periodLabel: string,
): string {
  const base = (invoice.partyReference || invoice.partyName).replace(/[^\w.-]+/g, "_");
  return `${periodLabel}_${base}.pdf`;
}
