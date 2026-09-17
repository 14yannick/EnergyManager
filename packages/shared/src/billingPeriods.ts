/**
 * Calendar period arithmetic for the billing page's period selector.
 *
 * Kept free of `Date.toISOString()` on purpose. That formats in UTC, so for a
 * machine in Europe/Zurich it turns local midnight on 1 January into
 * 31 December — an off-by-one that would quietly bill a day into the wrong
 * quarter. Everything here is assembled from the local calendar fields
 * instead.
 */

export type BillingPeriodKind = "yearly" | "quarterly" | "monthly" | "custom";

export interface BillingRange {
  /** Inclusive "YYYY-MM-DD". */
  from: string;
  /** Inclusive "YYYY-MM-DD". */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date to "YYYY-MM-DD", with no timezone conversion. */
export function toDateString(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

/** Day count of a month, via day 0 of the next one. */
function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/**
 * Split a signed month count into a year and a 0-based month.
 *
 * `%` in JavaScript keeps the sign of the dividend, so a negative offset
 * (stepping back from January) would otherwise produce a month of -1.
 */
function splitMonths(totalMonths: number): { year: number; month0: number } {
  const year = Math.floor(totalMonths / 12);
  return { year, month0: totalMonths - year * 12 };
}

/**
 * The range for a period `offset` steps from the one containing `now`.
 *
 * `offset` is 0 for the current period, -1 for the previous one, +1 for the
 * next. `custom` has no arithmetic of its own — the caller supplies the dates —
 * so it returns the containing month as a starting point for editing.
 */
export function billingPeriodRange(
  kind: BillingPeriodKind,
  offset: number,
  now: Date = new Date(),
): BillingRange {
  const year = now.getFullYear();
  const month0 = now.getMonth();

  if (kind === "yearly") {
    const y = year + offset;
    return { from: toDateString(y, 1, 1), to: toDateString(y, 12, 31) };
  }

  if (kind === "quarterly") {
    const quarter0 = Math.floor(month0 / 3);
    const total = year * 4 + quarter0 + offset;
    const y = Math.floor(total / 4);
    const q0 = total - y * 4;
    const firstMonth1 = q0 * 3 + 1;
    const lastMonth1 = firstMonth1 + 2;
    return {
      from: toDateString(y, firstMonth1, 1),
      to: toDateString(y, lastMonth1, daysInMonth(y, lastMonth1)),
    };
  }

  // monthly, and custom's initial value
  const { year: y, month0: m0 } = splitMonths(year * 12 + month0 + (kind === "custom" ? 0 : offset));
  const m1 = m0 + 1;
  return { from: toDateString(y, m1, 1), to: toDateString(y, m1, daysInMonth(y, m1)) };
}

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/**
 * Human label for a period, in French to match the billing page — it is the
 * one screen a participant reads.
 */
export function billingPeriodLabel(
  kind: BillingPeriodKind,
  offset: number,
  now: Date = new Date(),
): string {
  const { from } = billingPeriodRange(kind, offset, now);
  const [yearStr, monthStr] = from.split("-");
  const year = Number(yearStr);
  const month1 = Number(monthStr);

  if (kind === "yearly") return String(year);
  if (kind === "quarterly") return `T${Math.floor((month1 - 1) / 3) + 1} ${year}`;
  if (kind === "monthly") return `${MONTHS_FR[month1 - 1]} ${year}`;
  return "Personnalisé";
}
