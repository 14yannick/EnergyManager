import type { SavingsQuery } from "@energy-manager/shared";
import type { MessageKey } from "../i18n/context";

/*
 * Date ranges and the periods they are viewed in, shared by the dashboards.
 */

export type Granularity = NonNullable<SavingsQuery["granularity"]>;

/**
 * Axis ticks scaled to the range. A fixed 0 decimals reads "-0 0 0 1 1" on an
 * hourly chart where the whole range is under a franc.
 */
/**
 * Ticks stepped from zero outwards, so zero is always one of them.
 *
 * Recharts' own choice is driven by the domain ends and happily skips zero —
 * on a charging day it produced -0.41, -0.06, 0.29, 0.96, leaving the axis with
 * no mark at the line the bars are measured from.
 */
export function ticksThroughZero(domain: [number, number] | undefined): number[] | undefined {
  if (!domain) return undefined;
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return undefined;
  const raw = (max - min) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  // Walk out from zero in both directions, so zero is a tick by construction.
  for (let v = 0; v >= min - step / 2; v -= step) out.unshift(Number(v.toPrecision(12)));
  for (let v = step; v <= max + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export const axisTick = (v: number) => {
  // Plain "0", not "0.00": it is the baseline, not a measured value.
  if (v === 0) return "0";
  const m = Math.abs(v);
  return m >= 100 ? v.toFixed(0) : m >= 10 ? v.toFixed(1) : v.toFixed(2);
};

export const PERIOD_UNIT: Record<Granularity, MessageKey> = {
  hourly: "dash.unit.hour",
  daily: "dash.unit.day",
  monthly: "dash.unit.month",
  quarterly: "dash.unit.quarter",
  yearly: "dash.unit.year",
  overall: "dash.unit.period",
};

/** The same words in the plural, for "annualised at 12 months a year". */
export const PERIOD_UNITS: Record<Granularity, MessageKey> = {
  hourly: "dash.units.hour",
  daily: "dash.units.day",
  monthly: "dash.units.month",
  quarterly: "dash.units.quarter",
  yearly: "dash.units.year",
  overall: "dash.units.period",
};

export const GRANULARITY_LABEL: Record<Granularity, MessageKey> = {
  hourly: "dash.g.hourly",
  daily: "dash.g.daily",
  monthly: "dash.g.monthly",
  quarterly: "dash.g.quarterly",
  yearly: "dash.g.yearly",
  overall: "dash.g.overall",
};

/** How many of each period fall in a year — what payback is annualised by. */
/**
 * What the dashboard opens on: the current quarter, viewed by month. Shared by
 * the initial range and the preset dropdown so the two always agree — a range
 * that silently reads "Custom…" on first load is just confusing.
 */
export const INITIAL_MODE: StepUnit = "quarter";
export const INITIAL_GRANULARITY: Granularity = "monthly";

export const PERIODS_PER_YEAR: Record<Granularity, number> = {
  hourly: 8760,
  daily: 365,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
  overall: 1,
};

/** The single period the "overall" view collapses the whole range into. */
export const OVERALL_KEY = "overall";

export const inclusiveDays = (from: string, to: string) =>
  Math.max(
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000,
    ) + 1,
    1,
  );

/* ---------------------------------------------------------------- range ---
 * Dates are handled as plain YYYY-MM-DD strings and stepped in UTC, so a DST
 * boundary can never shift a month or year edge by a day.
 */
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => iso(new Date());
export const startOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
export const endOfMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return iso(new Date(Date.UTC(y!, m!, 0))); // day 0 of the next month
};
export const quarterOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
export const quarterKeyOf = (d: string) => `${d.slice(0, 4)}-Q${quarterOf(d)}`;
export const startOfQuarter = (d: string) => `${d.slice(0, 4)}-${String((quarterOf(d) - 1) * 3 + 1).padStart(2, "0")}-01`;
export const endOfQuarter = (d: string) => endOfMonth(`${d.slice(0, 4)}-${String(quarterOf(d) * 3).padStart(2, "0")}-01`);
/** "2026-Q1" -> the first day of that quarter. */
export const quarterKeyToDate = (key: string) =>
  `${key.slice(0, 4)}-${String((Number(key.slice(6)) - 1) * 3 + 1).padStart(2, "0")}-01`;
export const startOfYear = (d: string) => `${d.slice(0, 4)}-01-01`;
export const endOfYear = (d: string) => `${d.slice(0, 4)}-12-31`;
export const addMonths = (d: string, n: number) => {
  const [y, m] = d.split("-").map(Number);
  return iso(new Date(Date.UTC(y!, m! - 1 + n, 1)));
};

/**
 * A monthly or yearly view can only really answer for whole periods — a range
 * ending mid-month shows a short bar that reads as a collapse in output rather
 * than as a partial period. Snapping the range to whole periods when the view
 * changes removes that trap.
 */
/** At most this many days of hourly detail — 7 days is already 168 bars. */
export const MAX_HOURLY_DAYS = 7;

/**
 * `anchor` is the edge the user just set, which must not move. Switching *to*
 * hourly anchors the end, zooming into the recent part of the range. Typing a
 * start date anchors the start, so the window slides to where you asked rather
 * than snapping back — which made the field look broken.
 */
export function snapRange(
  range: { from: string; to: string },
  granularity: Granularity,
  anchor: "from" | "to" = "to",
) {
  if (granularity === "hourly") {
    const span = (a: string, b: string) =>
      (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000 + 1;
    if (span(range.from, range.to) <= MAX_HOURLY_DAYS) return range;
    const shift = (d: string, days: number) => {
      const t = new Date(`${d}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() + days);
      return t.toISOString().slice(0, 10);
    };
    return anchor === "from"
      ? { from: range.from, to: shift(range.from, MAX_HOURLY_DAYS - 1) }
      : { from: shift(range.to, -(MAX_HOURLY_DAYS - 1)), to: range.to };
  }
  if (granularity === "monthly") {
    return { from: startOfMonth(range.from), to: endOfMonth(range.to) };
  }
  if (granularity === "quarterly") {
    return { from: startOfQuarter(range.from), to: endOfQuarter(range.to) };
  }
  if (granularity === "yearly") {
    return { from: startOfYear(range.from), to: endOfYear(range.to) };
  }
  return range; // daily and overall take the range exactly as given
}

export interface DataRange {
  from: string | null;
  to: string | null;
  /** First day with recorded production; the fallback production start date. */
  firstProduction?: string | null;
}

/**
 * Payback divides investment cost by average savings per period, so the range
 * it is measured over has to be a range the system was actually running in.
 * Days before production started contribute nothing but still count as
 * periods, dragging the average down and overstating payback; days in the
 * future contribute nothing and do the same.
 *
 * Clamping here, where from/to are set, rather than on each input means no
 * path can bypass it — presets, the custom date fields and the granularity
 * snapping all funnel through this.
 */
export function clampRange(
  r: { from: string; to: string },
  bounds: { min: string | null; max: string },
): { from: string; to: string } {
  const from = bounds.min && r.from < bounds.min ? bounds.min : r.from;
  const to = r.to > bounds.max ? bounds.max : r.to;
  // A range clamped from both ends can invert (e.g. a preset entirely in the
  // future); collapse it to a single day rather than emit from > to.
  return from > to ? { from: to, to } : { from, to };
}

/**
 * A requested range made valid for the view: clamped to the bounds, snapped to
 * whole periods, clamped again.
 *
 * Clamp *before* snapping, then again after. Snapping first lets a preset that
 * runs into the future — "This month" on the 15th — anchor the hourly window
 * to a month end that is then clamped back, inverting the range and collapsing
 * it to one day. Snapping can also push past the bound (month ends), hence the
 * second.
 *
 * The bound may lie beyond today when there are readings dated ahead, but a
 * range that stopped at today keeps stopping there: snapping "This year" to
 * whole months must not quietly add the rest of September, whose empty days
 * would dilute every average. Only a range asked for past today goes past it.
 */
export function fitRange(
  r: { from: string; to: string },
  granularity: Granularity,
  bounds: { min: string | null; max: string },
  anchor?: "from" | "to",
): { from: string; to: string } {
  const c = clampRange(snapRange(clampRange(r, bounds), granularity, anchor), bounds);
  const t = today();
  if (r.to <= t && c.to > t) return { from: c.from > t ? t : c.from, to: t };
  return c;
}

/**
 * The latest day a range may reach: today, or the last day with readings when
 * that is later. Readings dated ahead of the clock — test data, or an import
 * of a forecast — would otherwise be impossible to look at.
 */
export function latestDay(lastData: string | null | undefined): string {
  const t = today();
  return lastData && lastData > t ? lastData : t;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Every period in [from, to], whether or not it has data, so the axis stays a
 * continuous timeline — a day with no readings should read as a gap in the
 * series, not close the gap by butting its neighbours together.
 */
export function periodKeys(from: string, to: string, granularity: Granularity): string[] {
  const keys: string[] = [];
  if (granularity === "overall") return [OVERALL_KEY];
  if (granularity === "yearly") {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) keys.push(String(y));
    return keys;
  }
  if (granularity === "quarterly") {
    for (let d = startOfQuarter(from); d <= to; d = addMonths(d, 3)) keys.push(quarterKeyOf(d));
    return keys;
  }
  if (granularity === "monthly") {
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    for (let y = fy!, m = fm!; y < ty! || (y === ty! && m <= tm!); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
      keys.push(`${y}-${pad2(m)}`);
    }
    return keys;
  }
  if (granularity === "hourly") {
    // 00..23 per local day. On the two DST days this is imperfect and
    // deliberately so: the spring-forward 02h key simply has no data and
    // renders empty, and the autumn 02h key holds both passes summed, which is
    // what the hour key means once the clock repeats.
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      for (let h = 0; h < 24; h++) keys.push(`${day}T${pad2(h)}`);
    }
    return keys;
  }
  // Plain YYYY-MM-DD, so stepping in UTC can't be shifted by a DST boundary.
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

export function periodLabel(
  key: string,
  granularity: Granularity,
  totalLabel: string,
  /** True when every bar in the chart is already known to be the same day —
   * the date would only repeat, so the label drops it and reads as a plain
   * time of day instead. */
  singleDay = false,
): string {
  if (granularity === "overall") return totalLabel;
  if (granularity === "quarterly") return `${key.slice(5)} ${key.slice(0, 4)}`;
  if (granularity === "hourly") {
    // "YYYY-MM-DDTHH" -> "08:00" for a single day, "14.09 08h" otherwise.
    if (singleDay) return `${key.slice(11, 13)}:00`;
    return `${key.slice(8, 10)}.${key.slice(5, 7)} ${key.slice(11, 13)}h`;
  }
  const [y, m, d] = key.split("-");
  if (granularity === "yearly") return y!;
  return granularity === "monthly" ? `${m}.${y}` : `${d}.${m}`;
}

/* -------------------------------------------------------------- periods ---
 * What the period selector offers. Each fixed mode is one calendar unit,
 * stepped through with the previous/next buttons; "all" is every reading, and
 * "custom" any range typed in.
 */
export type PeriodMode = "day" | "week" | "month" | "quarter" | "year" | "all" | "custom";
export type StepUnit = Exclude<PeriodMode, "all" | "custom">;

export const PERIOD_MODES: PeriodMode[] = ["day", "week", "month", "quarter", "year", "all", "custom"];

/**
 * Which views make sense for each period, finest first. Nothing coarser than
 * the period itself — a month viewed yearly is one bar — and no hourly view
 * beyond a week, which is where its cap sits.
 */
export const VIEWS_FOR: Record<PeriodMode, Granularity[]> = {
  day: ["hourly"],
  week: ["hourly", "daily", "overall"],
  month: ["daily", "overall"],
  quarter: ["daily", "monthly", "overall"],
  year: ["daily", "monthly", "quarterly", "overall"],
  all: ["daily", "monthly", "quarterly", "yearly", "overall"],
  custom: ["hourly", "daily", "monthly", "quarterly", "yearly", "overall"],
};

/** The view each period opens on — not necessarily the first offered. */
export const DEFAULT_VIEW: Record<Exclude<PeriodMode, "custom">, Granularity> = {
  day: "hourly",
  week: "daily",
  month: "daily",
  quarter: "monthly",
  year: "monthly",
  all: "monthly",
};

export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return iso(t);
};

/** The Monday of the day's week — weeks here run Monday to Sunday. */
export const startOfWeek = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The whole calendar unit containing `day`. */
export function periodRange(unit: StepUnit, day: string): { from: string; to: string } {
  switch (unit) {
    case "day":
      return { from: day, to: day };
    case "week":
      return { from: startOfWeek(day), to: addDays(startOfWeek(day), 6) };
    case "month":
      return { from: startOfMonth(day), to: endOfMonth(day) };
    case "quarter":
      return { from: startOfQuarter(day), to: endOfQuarter(day) };
    case "year":
      return { from: startOfYear(day), to: endOfYear(day) };
  }
}

/**
 * The unit before or after the one containing `from`. Taken from the unit's
 * own start, so a range clamped to start mid-period — the month production
 * began — still steps to whole neighbours.
 */
export function stepRange(from: string, unit: StepUnit, direction: -1 | 1): { from: string; to: string } {
  const start = periodRange(unit, from).from;
  const shifted =
    unit === "day"
      ? addDays(start, direction)
      : unit === "week"
        ? addDays(start, 7 * direction)
        : addMonths(start, direction * (unit === "month" ? 1 : unit === "quarter" ? 3 : 12));
  return periodRange(unit, shifted);
}

/**
 * The period under way stops at today, like every other range that reaches
 * it; only a period that starts after today (readings dated ahead) runs on.
 */
export function cutAtToday(r: { from: string; to: string }): { from: string; to: string } {
  const t = today();
  return r.from <= t && r.to > t ? { from: r.from, to: t } : r;
}

/** What a dashboard opens on: the quarter so far, viewed by month. */
export const initialRange = () => cutAtToday(periodRange(INITIAL_MODE, today()));
