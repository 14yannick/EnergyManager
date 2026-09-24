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

export type PeriodLocale = "fr" | "en" | "de";

/** Regional tags, so a label reads as the surrounding UI does. */
const INTL_TAG: Record<PeriodLocale, string> = { fr: "fr-CH", en: "en-CH", de: "de-CH" };

/** Quarters are written T1–T4 in French, Q1–Q4 in English and German. */
const QUARTER_PREFIX: Record<PeriodLocale, string> = { fr: "T", en: "Q", de: "Q" };

const CUSTOM: Record<PeriodLocale, string> = {
  fr: "Personnalisé",
  en: "Custom",
  de: "Benutzerdefiniert",
};

/**
 * Human label for a period.
 *
 * Month names come from `Intl` rather than a table: the two spellings already
 * exist in the platform, and a hand-written list is one more place for a
 * language to be half-added.
 */
export type PeriodShape =
  | { kind: "year"; year: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "month"; year: number; month1: number }
  | { kind: "custom" };

/**
 * Classifies an arbitrary `from`/`to` range by whether it exactly spans a
 * whole calendar year, quarter, or month — not from a `kind`/`offset` the
 * way `billingPeriodRange` is driven, but purely from the dates themselves.
 * An invoice only ever carries the resolved dates, not what period picker
 * (if any) produced them, so this is what lets a generated invoice's period
 * still read as "Q1 2027" — or, on the invoices module's own server side,
 * archive itself as "Q1.2027" — without needing to know that.
 */
export function periodShapeOf(from: string, to: string): PeriodShape {
  // Both are "YYYY-MM-DD" — dateRangeQuerySchema/isoDate elsewhere validate
  // this before it ever reaches here — so each split always has three parts.
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number) as [number, number, number];
  const [toYear, toMonth, toDay] = to.split("-").map(Number) as [number, number, number];

  if (fromYear === toYear && fromMonth === 1 && fromDay === 1 && toMonth === 12 && toDay === 31) {
    return { kind: "year", year: fromYear };
  }
  if (fromYear === toYear && fromDay === 1 && toDay === daysInMonth(toYear, toMonth)) {
    const fromQuarter = Math.ceil(fromMonth / 3);
    const toQuarter = Math.ceil(toMonth / 3);
    if (fromQuarter === toQuarter && fromMonth === (fromQuarter - 1) * 3 + 1) {
      return { kind: "quarter", year: fromYear, quarter: fromQuarter };
    }
    if (fromMonth === toMonth) {
      return { kind: "month", year: fromYear, month1: fromMonth };
    }
  }
  return { kind: "custom" };
}

/**
 * The same period, in words — "Q1 2027" ("T1 2027" in French), "2027", or a
 * full month name, matching `billingPeriodLabel`'s own formatting exactly so
 * a generated invoice's period reads the same as the picker that likely
 * produced it. Null for a range that isn't a whole calendar unit (a custom
 * period), so the caller can fall back to showing the exact dates instead.
 */
export function invoicePeriodLabel(from: string, to: string, locale: PeriodLocale = "fr"): string | null {
  const shape = periodShapeOf(from, to);
  if (shape.kind === "year") return String(shape.year);
  if (shape.kind === "quarter") return `${QUARTER_PREFIX[locale]}${shape.quarter} ${shape.year}`;
  if (shape.kind === "month") {
    return new Date(shape.year, shape.month1 - 1, 1).toLocaleDateString(INTL_TAG[locale], {
      month: "long",
      year: "numeric",
    });
  }
  return null;
}

export function billingPeriodLabel(
  kind: BillingPeriodKind,
  offset: number,
  locale: PeriodLocale = "fr",
  now: Date = new Date(),
): string {
  const { from } = billingPeriodRange(kind, offset, now);
  const [yearStr, monthStr] = from.split("-");
  const year = Number(yearStr);
  const month1 = Number(monthStr);

  if (kind === "yearly") return String(year);
  if (kind === "quarterly") {
    return `${QUARTER_PREFIX[locale]}${Math.floor((month1 - 1) / 3) + 1} ${year}`;
  }
  if (kind === "monthly") {
    return new Date(year, month1 - 1, 1).toLocaleDateString(INTL_TAG[locale], {
      month: "long",
      year: "numeric",
    });
  }
  return CUSTOM[locale];
}
