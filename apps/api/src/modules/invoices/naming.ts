/**
 * Pure filename/folder-name logic — no DB, no network (same split as
 * billing/engine.ts vs billing/service.ts), so it can be tested directly.
 */

const LAST_DAY_OF_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The period as a short, filesystem-safe label — "Q1.2027" for a calendar
 * quarter, "2027" for a whole year, "2027-01" for a whole month, or the raw
 * dates for anything else (a custom range, say). Pure date-shape matching
 * against `from`/`to`, not the `kind`/`offset` the Billing page's period
 * picker used to compute them — those never reach here, only the resolved
 * dates do, and re-deriving the shape from the dates themselves means this
 * works the same whether the range came from that picker or a raw API call.
 */
export function periodLabelFor(from: string, to: string): string {
  // Both are already-validated "YYYY-MM-DD" (isoDate in validation.ts), so
  // each split always has exactly three numeric parts.
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number) as [number, number, number];
  const [toYear, toMonth, toDay] = to.split("-").map(Number) as [number, number, number];
  const isLeapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = (year: number, month: number) =>
    month === 2 && isLeapYear(year) ? 29 : LAST_DAY_OF_MONTH[month - 1]!;

  if (fromYear === toYear && fromMonth === 1 && fromDay === 1 && toMonth === 12 && toDay === 31) {
    return `${fromYear}`;
  }
  if (fromYear === toYear && fromDay === 1 && toDay === lastDay(toYear, toMonth)) {
    const fromQuarter = Math.ceil(fromMonth / 3);
    const toQuarter = Math.ceil(toMonth / 3);
    if (fromQuarter === toQuarter && fromMonth === (fromQuarter - 1) * 3 + 1) {
      return `Q${fromQuarter}.${fromYear}`;
    }
    if (fromMonth === toMonth) {
      return `${fromYear}-${String(fromMonth).padStart(2, "0")}`;
    }
  }
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
