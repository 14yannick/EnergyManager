import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SavingsQuery } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

/** The revenue chart can be read as money or as the energy behind it. */
/**
 * What the revenue chart shows. "both" keeps the stacked bars in money and
 * adds total energy as a line on a second axis — stacking two different units
 * in one column would be meaningless, but overlaying them shows where price
 * and volume diverge, which is the whole point under a dynamic tariff.
 */
type RevenueUnit = "chf" | "both" | "kwh";
/** Which unit the stacked bars are drawn in. */
const barUnit = (u: RevenueUnit): "chf" | "kwh" => (u === "kwh" ? "kwh" : "chf");

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
function ticksThroughZero(domain: [number, number] | undefined): number[] | undefined {
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

const axisTick = (v: number) => {
  // Plain "0", not "0.00": it is the baseline, not a measured value.
  if (v === 0) return "0";
  const m = Math.abs(v);
  return m >= 100 ? v.toFixed(0) : m >= 10 ? v.toFixed(1) : v.toFixed(2);
};

const formatRevenue = (value: number, unit: RevenueUnit) =>
  barUnit(unit) === "chf" ? `CHF ${value.toFixed(2)}` : `${value.toFixed(1)} kWh`;

// Two of the four series are named for the money they earn, which reads wrong
// once the bars are energy: the same segment is a revenue in one unit and a
// flow of kWh in the other.
const seriesNames = (unit: RevenueUnit) => ({
  consumption: "Direct consumption",
  direct: "Direct export",
  // Deliberately not "Battery revenue": this segment is the gross value of what
  // the battery delivered, while the KPI of that name is net of charging. Two
  // different numbers under one label was the confusion.
  battery: barUnit(unit) === "chf" ? "Battery discharge" : "Battery discharge",
  neighbor: barUnit(unit) === "chf" ? "Neighbour sale" : "Neighbour supply",
});

const PERIOD_UNIT: Record<Granularity, string> = {
  hourly: "hour",
  daily: "day",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
  overall: "period",
};

/** How many of each period fall in a year — what payback is annualised by. */
/**
 * What the dashboard opens on: the current quarter, viewed by month. Shared by
 * the initial range and the preset dropdown so the two always agree — a range
 * that silently reads "Custom…" on first load is just confusing.
 */
const INITIAL_PRESET = "this_quarter";
const INITIAL_GRANULARITY: Granularity = "monthly";

const PERIODS_PER_YEAR: Record<Granularity, number> = {
  hourly: 8760,
  daily: 365,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
  overall: 1,
};

/** The single period the "overall" view collapses the whole range into. */
const OVERALL_KEY = "overall";

const inclusiveDays = (from: string, to: string) =>
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
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const startOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
const endOfMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return iso(new Date(Date.UTC(y!, m!, 0))); // day 0 of the next month
};
const quarterOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
const quarterKeyOf = (d: string) => `${d.slice(0, 4)}-Q${quarterOf(d)}`;
const startOfQuarter = (d: string) => `${d.slice(0, 4)}-${String((quarterOf(d) - 1) * 3 + 1).padStart(2, "0")}-01`;
const endOfQuarter = (d: string) => endOfMonth(`${d.slice(0, 4)}-${String(quarterOf(d) * 3).padStart(2, "0")}-01`);
/** "2026-Q1" -> the first day of that quarter. */
const quarterKeyToDate = (key: string) =>
  `${key.slice(0, 4)}-${String((Number(key.slice(6)) - 1) * 3 + 1).padStart(2, "0")}-01`;
const startOfYear = (d: string) => `${d.slice(0, 4)}-01-01`;
const endOfYear = (d: string) => `${d.slice(0, 4)}-12-31`;
const addMonths = (d: string, n: number) => {
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
const MAX_HOURLY_DAYS = 7;

/**
 * `anchor` is the edge the user just set, which must not move. Switching *to*
 * hourly anchors the end, zooming into the recent part of the range. Typing a
 * start date anchors the start, so the window slides to where you asked rather
 * than snapping back — which made the field look broken.
 */
function snapRange(
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

interface DataRange {
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
function clampRange(
  r: { from: string; to: string },
  bounds: { min: string | null; max: string },
): { from: string; to: string } {
  const from = bounds.min && r.from < bounds.min ? bounds.min : r.from;
  const to = r.to > bounds.max ? bounds.max : r.to;
  // A range clamped from both ends can invert (e.g. a preset entirely in the
  // future); collapse it to a single day rather than emit from > to.
  return from > to ? { from: to, to } : { from, to };
}

const RANGE_PRESETS: Array<{
  id: string;
  label: string;
  resolve: (data: DataRange) => { from: string; to: string };
  /** Switches the view too — a 24-hour range is meaningless as a single bar. */
  granularity?: Granularity;
}> = [
  { id: "last_24_hours", label: "Last 24 hours", granularity: "hourly", resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { from: iso(d), to: todayIso() };
    } },
  { id: "last_7_days", label: "Last 7 days", resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { from: iso(d), to: todayIso() };
    } },
  { id: "last_30_days", label: "Last 30 days", resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return { from: iso(d), to: todayIso() };
    } },
  { id: "this_month", label: "This month", resolve: () => ({
      from: startOfMonth(todayIso()), to: endOfMonth(todayIso()) }) },
  { id: "last_3_months", label: "Last 3 months", resolve: () => ({
      from: startOfMonth(addMonths(todayIso(), -2)), to: endOfMonth(todayIso()) }) },
  { id: "this_quarter", label: "This quarter", resolve: () => ({
      from: startOfQuarter(todayIso()), to: endOfQuarter(todayIso()) }) },
  { id: "last_quarter", label: "Last quarter", resolve: () => {
      const prev = addMonths(startOfQuarter(todayIso()), -1); // any day in the previous quarter
      return { from: startOfQuarter(prev), to: endOfQuarter(prev) };
    } },
  { id: "last_12_months", label: "Last 12 months", resolve: () => ({
      from: startOfMonth(addMonths(todayIso(), -11)), to: endOfMonth(todayIso()) }) },
  { id: "this_year", label: "This year", resolve: () => ({
      from: startOfYear(todayIso()), to: endOfYear(todayIso()) }) },
  { id: "last_year", label: "Last year", resolve: () => {
      const y = String(new Date().getFullYear() - 1);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    } },
  { id: "all", label: "All data", resolve: (data) => ({
      from: data.from ?? startOfYear(todayIso()), to: data.to ?? todayIso() }) },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { site } = useDefaultSite();
  const initial = useMemo(
    () => RANGE_PRESETS.find((p) => p.id === INITIAL_PRESET)!.resolve({ from: null, to: null }),
    [],
  );
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [granularity, setGranularity] = useState<Granularity>(INITIAL_GRANULARITY);
  const unit = PERIOD_UNIT[granularity];
  const avgSuffix =
    granularity === "overall" ? `over ${inclusiveDays(from, to)} days` : `/${unit} avg`;

  const rangeQuery = useQuery({
    queryKey: ["readings-range", site?.id],
    queryFn: () => api.readings.range(site!.id),
    enabled: !!site,
  });
  const dataRange: DataRange = rangeQuery.data ?? { from: null, to: null, firstProduction: null };
  // Stated start date wins; otherwise the first day production was recorded.
  const productionStart = site?.productionStartDate ?? dataRange.firstProduction ?? null;
  const bounds = { min: productionStart, max: today() };

  // The bounds arrive with the range query, after the initial default range is
  // already in state, so the first render can hold a range that starts before
  // production did. Pull it back once they are known; guarded on a real change
  // so this settles in one pass.
  useEffect(() => {
    const c = clampRange({ from, to }, bounds);
    if (c.from !== from) setFrom(c.from);
    if (c.to !== to) setTo(c.to);
  }, [bounds.min, bounds.max, from, to]);

  const summaryQuery = useQuery({
    queryKey: ["savings-summary", site?.id, from, to, granularity],
    queryFn: () => api.savings.summary(site!.id, from, to, granularity),
    enabled: !!site,
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Savings & payback</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            What the system earned or avoided over the selected range, and how long it takes to pay
            back its cost.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <RangeControls
            range={{ from, to }}
            onRange={(r, nextGranularity, anchor) => {
              if (nextGranularity) setGranularity(nextGranularity);
              const g = nextGranularity ?? granularity;
              // Clamp *before* snapping, then again after. Snapping first lets a
              // preset that runs into the future — "This month" on the 15th —
              // anchor the hourly window to a month end that is then clamped
              // back to today, inverting the range and collapsing it to one day.
              // Snapping can also push past today (month ends), hence the second.
              const c = clampRange(snapRange(clampRange(r, bounds), g, anchor), bounds);
              setFrom(c.from);
              setTo(c.to);
            }}
            granularity={granularity}
            dataRange={dataRange}
            bounds={bounds}
          />
          <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            View
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {(["hourly", "daily", "monthly", "quarterly", "yearly", "overall"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    setGranularity(g);
                    const snapped = clampRange(snapRange(clampRange({ from, to }, bounds), g), bounds);
                    setFrom(snapped.from);
                    setTo(snapped.to);
                  }}
                  className={`px-3 py-1.5 capitalize ${
                    granularity === g ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {granularity === "hourly" && (
        <p className="text-xs text-slate-500">
          Hourly view shows at most {MAX_HOURLY_DAYS} days at a time — a quarter would be over
          2,000 bars. Moving one end slides the other to keep the window that long.
        </p>
      )}

      {granularity !== "daily" && granularity !== "hourly" && (
        <p className="text-xs text-slate-500">
          {granularity === "overall" ? (
            <>
              Overall view: the whole range is one period of {inclusiveDays(from, to)} days. Payback
              is annualised by that actual length rather than by an assumed whole month or year, so
              a partial period can't distort it.
            </>
          ) : (
            <>
              {granularity === "monthly" ? "Monthly" : granularity === "quarterly" ? "Quarterly" : "Yearly"}{" "}
              view: every figure below is per calendar {unit} — the averages, the payback
              annualisation ({PERIODS_PER_YEAR[granularity]} period
              {PERIODS_PER_YEAR[granularity] === 1 ? "" : "s"} a year rather than 365), and one
              revenue bar per {unit}. Totals are the same either way; only the period they're
              divided into changes.
            </>
          )}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-700">KPI</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total savings — with battery"
          value={summary?.totals.withBatteryChf}
          sub={summary ? granularity === "overall" ? avgSuffix : `CHF ${summary.avgDaily.withBatteryChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Total savings — no battery"
          value={summary?.totals.withoutBatteryChf}
          sub={summary ? granularity === "overall" ? avgSuffix : `CHF ${summary.avgDaily.withoutBatteryChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Battery-only savings"
          hint="vs the same period with no battery — ignores round-trip loss"
          value={summary?.totals.batteryOnlyChf}
          sub={summary ? granularity === "overall" ? avgSuffix : `CHF ${summary.avgDaily.batteryOnlyChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Battery revenue"
          hint="discharge value less what charging cost — the truer figure"
          value={summary?.totals.batteryRevenueChf}
          sub={
            summary
              ? granularity === "overall"
                ? avgSuffix
                : `CHF ${summary.avgDaily.batteryRevenueChf.toFixed(2)}/${unit} avg`
              : undefined
          }
        />
        </div>
      </section>

      <RevenueBreakdownChart siteId={site.id} from={from} to={to} granularity={granularity} />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Payback by category</h2>
          <p className="mt-1 text-xs text-slate-500">
            Not a measurement — a projection. Investment cost is divided by the average savings per{" "}
            {unit} across the selected range
            {granularity === "overall"
              ? `, annualised by the range's actual length (${inclusiveDays(from, to)} days)`
              : granularity === "yearly"
                ? ", which is already an annual figure"
                : `, annualised at ${PERIODS_PER_YEAR[granularity]} ${unit}s a year`}
            . A range that isn't representative of a full year makes it misleading: a summer-only
            range projects a payback that never arrives, a winter-only one the reverse. Breakeven
            below is the opposite — an actual date, only reported if cumulative savings crossed the
            cost inside the range.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PaybackCard
            label="With battery"
            years={summary?.payback.withBatteryYears}
            breakeven={summary?.breakeven.withBatteryDate}
          />
          <PaybackCard
            label="No battery"
            years={summary?.payback.withoutBatteryYears}
            breakeven={summary?.breakeven.withoutBatteryDate}
          />
          <PaybackCard
            label="Battery only"
            years={summary?.payback.batteryOnlyYears}
            breakeven={summary?.breakeven.batteryOnlyDate}
          />
        </div>
      </section>
    </div>
  );
}

// Categorical slots 4, 1, 2, 3 — in the order the segments stack, so slot 4
// (yellow) never touches slot 2 (orange), the one pair that fails the
// colour-blindness floor. Validated with the palette checker in both orders.
// Categorical slots 4, 1, 2, 3 — in the order the segments stack, so slot 4
// (yellow) never touches slot 2 (orange), the one pair that fails the
// colour-blindness floor. Validated with the palette checker in both orders.
const REVENUE_COLORS = {
  consumption: "#eda100",
  direct: "#2a78d6",
  battery: "#eb6834",
  neighbor: "#1baf7a",
};

/**
 * Charging, deliberately outside the categorical palette above.
 *
 * It shared the battery colour, which left two legend entries looking
 * identical. A darker shade of the same hue keeps it tied to the battery —
 * it is the same energy, going the other way — while being told apart at a
 * glance, and reads as the cost it represents.
 */
const BATTERY_CHARGING_COLOR = "#8c3f1d";

/** The four flows, in whichever unit the field name says. */
interface RevenueFlows {
  consumption: number;
  direct: number;
  battery: number;
  neighbor: number;
}

interface RevenuePeriod extends RevenueFlows {
  /** "YYYY-MM-DD", "YYYY-MM" or "YYYY" depending on granularity — matches the API's `date`. */
  key: string;
  label: string;
  // `consumption`/`direct`/`battery`/`neighbor` above are whatever the bars are
  // drawn in. These two sets are always populated in their own unit, so the
  // second stack and the tooltip never have to care which mode is active.
  consumptionChf: number;
  directChf: number;
  batteryChf: number;
  neighborChf: number;
  /**
   * Gross PV yield plus energy into the battery, as one line when enabled.
   *
   * Note these overlap: PV that charged the battery is counted in both terms,
   * so this is not a physical total of distinct energy. It is a combined
   * "produced and stored" figure.
   */
  producedKwh: number;
  consumptionKwh: number;
  directKwh: number;
  batteryKwh: number;
  neighborKwh: number;
  /**
   * Charging priced as the export it displaced. Normally a cost, but it goes
   * negative when the feed-in rate does — charging then avoids paying to
   * export, so it becomes a gain.
   */
  batteryChargingCostChf: number;
  /**
   * Gross discharge value minus that cost: the Battery revenue KPI. The
   * `battery` bar segment stays gross so the stack still sums to total
   * savings, so the tooltip shows both and the bridge between them.
   */
  batteryNetChf: number;
  /**
   * Charging drawn as its own signed series: negative, because in that interval
   * the battery took energy that would otherwise have been exported. Positive
   * when the feed-in rate is negative, since charging then avoids paying to
   * export — no special case needed, the sign carries it.
   *
   * Stacked alongside the positive discharge value rather than subtracted from
   * it, so an hour that only charges shows a bar below the axis instead of
   * cancelling to nothing.
   */
  batteryChargingChf: number;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Every period in [from, to], whether or not it has data, so the axis stays a
 * continuous timeline — a day with no readings should read as a gap in the
 * series, not close the gap by butting its neighbours together.
 */
function periodKeys(from: string, to: string, granularity: Granularity): string[] {
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

function periodLabel(key: string, granularity: Granularity): string {
  if (granularity === "overall") return "Total";
  if (granularity === "quarterly") return `${key.slice(5)} ${key.slice(0, 4)}`;
  if (granularity === "hourly") {
    // "YYYY-MM-DDTHH" -> "14.09 08h"
    return `${key.slice(8, 10)}.${key.slice(5, 7)} ${key.slice(11, 13)}h`;
  }
  const [y, m, d] = key.split("-");
  if (granularity === "yearly") return y!;
  return granularity === "monthly" ? `${m}.${y}` : `${d}.${m}`;
}

interface RevenueTooltipEntry {
  name: string;
  dataKey: string;
  value: number;
  color: string;
  payload: RevenuePeriod;
}

// Custom content: recharts' default tooltip sets each row's text in the
// series color, but a light hue (the neighbour-sale aqua) is illegible as
// text — identity should come from a swatch beside ink-colored text, not
// from coloring the text itself.
function RevenueTooltip({
  active,
  payload,
  granularity,
  unit,
  showProduction,
}: {
  active?: boolean;
  payload?: RevenueTooltipEntry[];
  granularity: Granularity;
  unit: RevenueUnit;
  showProduction?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  const [y, m, d] = row.key.split("-");
  const heading =
    granularity === "overall"
      ? "Whole period"
      : granularity === "quarterly"
        ? `${row.key.slice(5)} ${row.key.slice(0, 4)}`
        : granularity === "yearly"
        ? y!
        : granularity === "monthly"
          ? `${m}.${y}`
          : granularity === "hourly"
            ? `${row.key.slice(8, 10)}.${m}.${y} ${row.key.slice(11, 13)}h`
            : `${d}.${m}.${y}`;

  // Built from the row rather than the chart's payload entries: the payload
  // holds whichever bars happen to be rendered, which changes with the mode
  // while the row always carries both units.
  const flows = [
    { key: "consumption", name: "Direct consumption", chf: row.consumptionChf, kwh: row.consumptionKwh },
    { key: "direct", name: "Direct export", chf: row.directChf, kwh: row.directKwh },
    { key: "battery", name: "Battery discharge", chf: row.batteryChf, kwh: row.batteryKwh },
    { key: "neighbor", name: "Neighbour", chf: row.neighborChf, kwh: row.neighborKwh },
  ] as const;
  const totalChf = flows.reduce((sum, f) => sum + f.chf, 0);
  const totalKwh = flows.reduce((sum, f) => sum + f.kwh, 0);
  // A period with no energy at all would otherwise divide by zero.
  const share = (part: number, whole: number) => (whole === 0 ? null : (part / whole) * 100);
  const total = row.consumption + row.direct + row.battery + row.neighbor;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="mb-1.5 font-medium text-slate-900">{heading}</p>
      <table className="w-full border-separate border-spacing-x-3 border-spacing-y-0.5">
        <thead>
          <tr className="text-xs text-slate-400">
            <th className="text-left font-normal" />
            <th className="text-right font-normal">CHF</th>
            <th className="text-right font-normal">kWh</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((f) => {
            const sc = share(f.chf, totalChf);
            const sk = share(f.kwh, totalKwh);
            return (
              <tr key={f.key}>
                <td className="whitespace-nowrap text-slate-600">
                  <span className="mr-1.5 inline-block h-0.5 w-3 rounded-full align-middle"
                    style={{ backgroundColor: REVENUE_COLORS[f.key] }} />
                  {f.name}
                </td>
                <td className="whitespace-nowrap text-right tabular-nums text-slate-900">
                  {f.chf.toFixed(2)}
                  <span className="ml-1 text-xs text-slate-400">
                    {sc == null ? "—" : `${sc.toFixed(0)}%`}
                  </span>
                </td>
                <td className="whitespace-nowrap text-right tabular-nums text-slate-900">
                  {f.kwh.toFixed(1)}
                  <span className="ml-1 text-xs text-slate-400">
                    {sk == null ? "—" : `${sk.toFixed(0)}%`}
                  </span>
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td className="border-t pt-1 text-slate-600">Total</td>
            <td className="border-t pt-1 text-right tabular-nums text-slate-900">
              {totalChf.toFixed(2)}
            </td>
            <td className="border-t pt-1 text-right tabular-nums text-slate-900">
              {totalKwh.toFixed(1)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-1.5 space-y-1">
        {(row.batteryChargingCostChf !== 0 || row.batteryNetChf !== 0) && (
          <>
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-600">Charging (export forgone)</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {row.batteryChargingCostChf > 0 ? "−" : row.batteryChargingCostChf < 0 ? "+" : ""}
                {formatRevenue(Math.abs(row.batteryChargingCostChf), "chf")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-600">Battery net</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatRevenue(row.batteryNetChf, "chf")}
              </span>
            </div>
          </>
        )}
        {showProduction && (
          <div className="flex items-center justify-between gap-6">
            <span className="text-slate-600">Production + charging</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {row.producedKwh.toFixed(1)} kWh
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function RevenueBreakdownChart({
  siteId,
  from,
  to,
  granularity,
}: {
  siteId: string;
  from: string;
  to: string;
  granularity: Granularity;
}) {
  const [showProduction, setShowProduction] = useState(false);
  const [unit, setUnit] = useState<RevenueUnit>("chf");

  const query = useQuery({
    queryKey: ["savings-revenue", siteId, from, to, granularity],
    queryFn: () => api.savings.daily(siteId, from, to, granularity),
  });

  const chartData: RevenuePeriod[] = useMemo(() => {
    const byKey = new Map((query.data ?? []).map((r) => [r.date, r]));
    return periodKeys(from, to, granularity).map((key) => {
      const row = byKey.get(key);
      const batteryExportedKwh = row?.batteryDischargeExportedKwh ?? 0;

      // Both units are always computed, segment for segment, so the kWh view is
      // the energy behind each money figure rather than a different breakdown.
      const chf: RevenueFlows = {
        consumption: row?.directConsumptionRevenueChf ?? 0,
        // Gross discharge value, *not* `batteryRevenueChf`: that one already
        // nets off the charging opportunity cost, and the no-battery bar
        // re-adds that same charged energy as export. Keeping the segment
        // gross means the gap between the two bars is the battery's net
        // contribution exactly once — and equals the Battery revenue card.
        direct: row?.directExportRevenueChf ?? 0,
        battery:
          (row?.batteryDischargeConsumedValueChf ?? 0) + (row?.batteryDischargeExportedValueChf ?? 0),
        neighbor: row?.neighborSellRevenueChf ?? 0,
      };
      const kwh: RevenueFlows = {
        consumption: row?.directUseKwh ?? 0,
        direct: (row?.exportedKwh ?? 0) - batteryExportedKwh,
        battery: (row?.batteryDischargeConsumedKwh ?? 0) + batteryExportedKwh,
        neighbor: row?.neighborConsumptionKwh ?? 0,
      };
      const bars = barUnit(unit) === "chf" ? chf : kwh;
      const money = barUnit(unit) === "chf";

      return {
        key,
        label: periodLabel(key, granularity),
        ...bars,
        consumptionChf: chf.consumption,
        directChf: chf.direct,
        batteryChf: chf.battery,
        neighborChf: chf.neighbor,
        batteryChargingCostChf: row?.batteryChargingCostChf ?? 0,
        batteryNetChf: row?.batteryRevenueChf ?? 0,
        producedKwh: (row?.producedKwh ?? 0) + (row?.batteryChargeKwh ?? 0),
        consumptionKwh: kwh.consumption,
        directKwh: kwh.direct,
        batteryKwh: kwh.battery,
        neighborKwh: kwh.neighbor,
        // Direct consumption and neighbour sales don't involve the battery, so
        // they carry over into the counterfactual unchanged.
        batteryChargingChf: -(row?.batteryChargingCostChf ?? 0),
      };
    });
  }, [query.data, from, to, granularity, unit]);

  const total = chartData.reduce(
    (sum, d) => sum + d.consumption + d.direct + d.battery + d.neighbor,
    0,
  );


  // A year of daily bars is ~365 labels in the width of a dozen: thin them to
  // roughly a dozen ticks so they stay readable, and label every month.
  const names = seriesNames(unit);
  // One bar across a whole chart looks like a rendering fault; give the
  // overall view a wider but still bounded bar.
  // Scale with how many periods share the width: a fixed 20px left three
  // monthly bars stranded in a 1500px chart, while 168 hourly bars need to be
  // thin. Clamped so a single period doesn't become a slab.
  const barSize =
    granularity === "overall"
      ? 90
      : Math.max(10, Math.min(72, Math.round(880 / Math.max(chartData.length, 1))));

  /**
   * Domains that put zero at the same height on both axes.
   *
   * Left the two to scale independently and the gridlines disagree: the bars'
   * zero sits above the kWh axis's zero, so a charging bar hanging below the
   * axis appears to cross a kWh line that means nothing to it. Nothing else
   * lines up either — a horizontal gridline reads as two different values
   * depending on which axis you follow.
   *
   * Fixed by giving both the same fraction of their range below zero: take
   * whichever needs the most, then extend the other down to match.
   */
  const axisDomains = useMemo(() => {
    const posOf = (d: RevenuePeriod) =>
      Math.max(d.consumption, 0) + Math.max(d.direct, 0) + Math.max(d.battery, 0) + Math.max(d.neighbor, 0);
    const maxLeft = Math.max(0, ...chartData.map(posOf));
    const minLeft = Math.min(0, ...chartData.map((d) => (barUnit(unit) === "chf" ? d.batteryChargingChf : 0)));
    const maxRight = Math.max(
      0,
      ...chartData.map((d) =>
        Math.max(
          unit === "both" ? d.consumptionKwh + d.directKwh + d.batteryKwh + d.neighborKwh : 0,
          showProduction ? d.producedKwh : 0,
        ),
      ),
    );

    // Fraction of each axis that must sit below zero.
    const share = (min: number, max: number) => (max - min === 0 ? 0 : -min / (max - min));
    const want = Math.max(share(minLeft, maxLeft), 0);
    if (want <= 0) return { left: undefined, right: undefined };

    // min such that -min/(max-min) === want  =>  min = -want*max/(1-want)
    const extend = (max: number) => (want >= 1 ? -max : -(want * max) / (1 - want));
    return {
      left: [Math.min(minLeft, extend(maxLeft)), maxLeft] as [number, number],
      right: [extend(maxRight), maxRight] as [number, number],
    };
  }, [chartData, unit, showProduction]);

  /**
   * Hatched means energy, solid means money — in every mode, not just when the
   * two appear side by side. Keeps the reading consistent when switching.
   */
  const flowFill = (flow: keyof typeof REVENUE_COLORS) =>
    barUnit(unit) === "kwh" ? `url(#kwhHatch-${flow})` : REVENUE_COLORS[flow];
  const flowStroke = (flow: keyof typeof REVENUE_COLORS) =>
    barUnit(unit) === "kwh" ? REVENUE_COLORS[flow] : undefined;

  const tickInterval =
    granularity === "hourly"
      ? 2 // every 3rd hour — 168 bars is far too many to label individually
      : granularity === "daily"
        ? Math.max(Math.ceil(chartData.length / 12) - 1, 0)
        : 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Revenue</h2>
        <p className="mt-1 text-xs text-slate-500">
          Direct consumption (avoided import), direct export, battery and neighbour sales, by{" "}
          {PERIOD_UNIT[granularity]}
          {unit === "kwh" && " — the energy behind each revenue figure"}
          {unit === "both" && " — with the same split in kWh hatched beside it, on the right axis"}.
          {barUnit(unit) === "chf" &&
            " Charging shows below the axis: in that interval the battery took energy that would otherwise have earned the feed-in rate."}
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
            {(
              [
                ["chf", "CHF"],
                ["both", "CHF + kWh"],
                ["kwh", "kWh"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setUnit(value)}
                className={`px-3 py-1 ${
                  unit === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showProduction}
              onChange={(e) => setShowProduction(e.target.checked)}
            />
            Production
          </label>
          <span className="ml-auto text-sm text-slate-600">
            {barUnit(unit) === "chf" ? "Total revenue" : "Total energy"}{" "}
            <span className="font-semibold text-slate-900">{formatRevenue(total, unit)}</span>
          </span>
        </div>

        <div className="mt-3 h-72 xl:h-[26rem]">
        <ResponsiveContainer width="100%" height="100%">
          {/* stackOffset="sign" is what puts a negative series below the axis
              in the *same* column. The default runs a plain sum, so charging
              was drawn hanging off the top of the positive stack instead. */}
          <ComposedChart data={chartData} barCategoryGap="20%" stackOffset="sign">
            <defs>
              {/* The kWh stack sits beside the CHF one in identical colours,
                  which made the pair unreadable. Hatching it keeps the colour
                  meaning while separating money from energy at a glance. */}
              {(Object.keys(REVENUE_COLORS) as Array<keyof typeof REVENUE_COLORS>).map((flow) => (
                <pattern
                  key={flow}
                  id={`kwhHatch-${flow}`}
                  patternUnits="userSpaceOnUse"
                  width={5}
                  height={5}
                  patternTransform="rotate(45)"
                >
                  <rect width={5} height={5} fill="#ffffff" />
                  <line x1={0} y1={0} x2={0} y2={5} stroke={REVENUE_COLORS[flow]} strokeWidth={3} />
                </pattern>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            {/* The line the bars are measured from. Dashed and pale so it
                marks the baseline without competing with the bars. */}
            <ReferenceLine
              yAxisId="bars"
              y={0}
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={tickInterval} />
            <YAxis
              yAxisId="bars"
              tick={{ fontSize: 11 }}
              tickFormatter={axisTick}
              domain={axisDomains.left ?? ["auto", "auto"]}
              ticks={ticksThroughZero(axisDomains.left)}
              width={barUnit(unit) === "kwh" ? 56 : 52}
            />
            {(unit === "both" || (showProduction && barUnit(unit) === "chf")) && (
              <YAxis
                yAxisId="kwh"
                orientation="right"
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickFormatter={axisTick}
                domain={axisDomains.right ?? ["auto", "auto"]}
                ticks={ticksThroughZero(axisDomains.right)}
                width={56}
              />
            )}
            <Tooltip
              content={
                <RevenueTooltip
                  granularity={granularity}
                  unit={unit}
                  showProduction={showProduction}
                />
              }
            />
            <Legend />
            <Bar
              yAxisId="bars"
              dataKey="consumption"
              name={names.consumption}
              stackId="revenue"
              fill={flowFill("consumption")}
              stroke={flowStroke("consumption")}
              strokeWidth={1}
              maxBarSize={barSize}
            />
            <Bar
              yAxisId="bars"
              dataKey="direct"
              name={names.direct}
              stackId="revenue"
              fill={flowFill("direct")}
              stroke={flowStroke("direct")}
              strokeWidth={1}
              maxBarSize={barSize}
            />
            {/* The battery's gross contribution, drawn in two parts: what it
                kept, and the slice charging cost takes back. Together they equal
                the gross value, so the stack still sums to total savings — the
                hatching just shows how much of it is not really yours. */}
            <Bar
              yAxisId="bars"
              dataKey="battery"
              name={names.battery}
              stackId="revenue"
              fill={flowFill("battery")}
              stroke={flowStroke("battery")}
              strokeWidth={1}
              maxBarSize={barSize}
            />
            {barUnit(unit) === "chf" && (
              <Bar
                yAxisId="bars"
                dataKey="batteryChargingChf"
                name="Battery charging (cost)"
                stackId="revenue"
                fill={BATTERY_CHARGING_COLOR}
                maxBarSize={barSize}
              />
            )}
            <Bar
              yAxisId="bars"
              dataKey="neighbor"
              name={names.neighbor}
              stackId="revenue"
              fill={flowFill("neighbor")}
              stroke={flowStroke("neighbor")}
              strokeWidth={1}
              maxBarSize={barSize}
              radius={[4, 4, 0, 0]}
            />
            {unit === "both" &&
              // Its own column on its own axis, split the same four ways as the
              // money bar. Same colours on purpose, so a segment can be read
              // across from one bar to the other; they are kept out of the
              // legend because the money bar already names them.
              (["consumption", "direct", "battery", "neighbor"] as const).map((flow, i) => (
                <Bar
                  key={flow}
                  yAxisId="kwh"
                  dataKey={`${flow}Kwh`}
                  name={`${names[flow]} (kWh)`}
                  stackId="energy"
                  fill={`url(#kwhHatch-${flow})`}
                  stroke={REVENUE_COLORS[flow]}
                  strokeWidth={1}
                  maxBarSize={barSize}
                  legendType="none"
                  radius={i === 3 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            {showProduction && (
              // Gross PV yield. When the bars are already kWh it shares their
              // axis — same unit, so a second scale would be misleading.
              <Line
                yAxisId={barUnit(unit) === "kwh" ? "bars" : "kwh"}
                type="monotone"
                dataKey="producedKwh"
                name="Production + charging (kWh)"
                stroke="#0f172a"
                strokeWidth={2}
                dot={false}
              />
            )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}



/**
 * Presets carry the common cases; the custom inputs match the granularity, so
 * a monthly view is picked in months rather than fighting a day calendar for
 * the 1st and the 31st.
 */
function RangeControls({
  range,
  onRange,
  granularity,
  dataRange,
  bounds,
}: {
  range: { from: string; to: string };
  onRange: (r: { from: string; to: string }, granularity?: Granularity, anchor?: "from" | "to") => void;
  granularity: Granularity;
  dataRange: DataRange;
  bounds: { min: string | null; max: string };
}) {
  const [preset, setPreset] = useState(INITIAL_PRESET);

  const applyPreset = (id: string) => {
    setPreset(id);
    const found = RANGE_PRESETS.find((p) => p.id === id);
    if (!found) return;
    // Hand over the raw range: the caller clamps it to the available data
    // before snapping, which matters for presets that run into the future.
    // Snapping here instead anchored the hourly window to a month end that was
    // then clamped back to today, collapsing the range to a single day.
    onRange(found.resolve(dataRange), found.granularity);
  };
  const setCustom = (next: { from: string; to: string }, anchor: "from" | "to" = "to") => {
    setPreset("custom");
    onRange(next, undefined, anchor);
  };

  const quarters = (() => {
    const first = startOfQuarter(dataRange.from ?? todayIso());
    const last = endOfQuarter(dataRange.to ?? todayIso());
    const keys: string[] = [];
    for (let d = first; d <= last; d = addMonths(d, 3)) keys.push(quarterKeyOf(d));
    // A preset can land outside the stored data; keep the selection listable.
    for (const k of [quarterKeyOf(range.from), quarterKeyOf(range.to)]) {
      if (!keys.includes(k)) keys.push(k);
    }
    return keys.sort();
  })();

  const years = (() => {
    const first = Number((dataRange.from ?? todayIso()).slice(0, 4));
    const last = Number((dataRange.to ?? todayIso()).slice(0, 4));
    return Array.from({ length: Math.max(last - first + 1, 1) }, (_, i) => String(first + i));
  })();

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Period
        <select className="input w-36" value={preset} onChange={(e) => applyPreset(e.target.value)}>
          {RANGE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>

      {(granularity === "hourly" || granularity === "daily" || granularity === "overall") && (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <input
              type="date"
              className="input w-36"
              value={range.from}
              min={bounds.min ?? undefined}
              max={range.to}
              onChange={(e) => setCustom({ ...range, from: e.target.value }, "from")}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <input
              type="date"
              className="input w-36"
              value={range.to}
              min={range.from}
              max={bounds.max}
              onChange={(e) => setCustom({ ...range, to: e.target.value })}
            />
          </label>
        </>
      )}

      {granularity === "monthly" && (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <input
              type="month"
              className="input w-36"
              value={range.from.slice(0, 7)}
              onChange={(e) => setCustom({ ...range, from: `${e.target.value}-01` })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <input
              type="month"
              className="input w-36"
              value={range.to.slice(0, 7)}
              onChange={(e) => setCustom({ ...range, to: endOfMonth(`${e.target.value}-01`) })}
            />
          </label>
        </>
      )}

      {granularity === "quarterly" && (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <select
              className="input w-36"
              value={quarterKeyOf(range.from)}
              onChange={(e) =>
                setCustom({ ...range, from: startOfQuarter(quarterKeyToDate(e.target.value)) })
              }
            >
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {`${q.slice(5)} ${q.slice(0, 4)}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <select
              className="input w-36"
              value={quarterKeyOf(range.to)}
              onChange={(e) =>
                setCustom({ ...range, to: endOfQuarter(quarterKeyToDate(e.target.value)) })
              }
            >
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {`${q.slice(5)} ${q.slice(0, 4)}`}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {granularity === "yearly" && (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <select
              className="input w-36"
              value={range.from.slice(0, 4)}
              onChange={(e) => setCustom({ ...range, from: `${e.target.value}-01-01` })}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <select
              className="input w-36"
              value={range.to.slice(0, 4)}
              onChange={(e) => setCustom({ ...range, to: `${e.target.value}-12-31` })}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  hint,
}: {
  label: string;
  value?: number;
  sub?: string;
  /** One line saying what the figure actually measures, for the cards whose
   * names alone don't separate them (battery savings vs battery revenue). */
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500" title={hint}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">
        {value != null ? `CHF ${value.toFixed(2)}` : "—"}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function PaybackCard({
  label,
  years,
  breakeven,
}: {
  label: string;
  years?: number | null;
  breakeven?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">
        {years != null ? `${years.toFixed(1)} years` : "—"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Breakeven: {breakeven ?? "not reached in range"}
      </p>
    </div>
  );
}
