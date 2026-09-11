import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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
type RevenueUnit = "chf" | "kwh";

const formatRevenue = (value: number, unit: RevenueUnit) =>
  unit === "chf" ? `CHF ${value.toFixed(2)}` : `${value.toFixed(1)} kWh`;

// Two of the four series are named for the money they earn, which reads wrong
// once the bars are energy: the same segment is a revenue in one unit and a
// flow of kWh in the other.
const seriesNames = (unit: RevenueUnit) => ({
  consumption: "Direct consumption",
  direct: "Direct export",
  battery: unit === "chf" ? "Battery revenue" : "Battery discharge",
  neighbor: unit === "chf" ? "Neighbour sale" : "Neighbour supply",
});

const PERIOD_UNIT: Record<Granularity, string> = {
  daily: "day",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
  overall: "period",
};

/** How many of each period fall in a year — what payback is annualised by. */
const PERIODS_PER_YEAR: Record<Granularity, number> = {
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
function snapRange(range: { from: string; to: string }, granularity: Granularity) {
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
}

const RANGE_PRESETS: Array<{
  id: string;
  label: string;
  resolve: (data: DataRange) => { from: string; to: string };
}> = [
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

function defaultFrom() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { site } = useDefaultSite();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(today());
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const unit = PERIOD_UNIT[granularity];
  const avgSuffix =
    granularity === "overall" ? `over ${inclusiveDays(from, to)} days` : `/${unit} avg`;

  const rangeQuery = useQuery({
    queryKey: ["readings-range", site?.id],
    queryFn: () => api.readings.range(site!.id),
    enabled: !!site,
  });
  const dataRange: DataRange = rangeQuery.data ?? { from: null, to: null };

  const summaryQuery = useQuery({
    queryKey: ["savings-summary", site?.id, from, to, granularity],
    queryFn: () => api.savings.summary(site!.id, from, to, granularity),
    enabled: !!site,
  });
  // "Overall" is a single period, and a cumulative chart of one point shows
  // nothing — this chart is about progression, so it stays on a monthly series.
  const cumulativeGranularity = granularity === "overall" ? "monthly" : granularity;
  const cumulativeQuery = useQuery({
    queryKey: ["savings-cumulative", site?.id, from, to, cumulativeGranularity],
    queryFn: () => api.savings.cumulative(site!.id, from, to, cumulativeGranularity),
    enabled: !!site,
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Savings & payback</h1>
          <p className="text-sm text-slate-500">Mirrors the old spreadsheet's Summary sheet.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <RangeControls
            range={{ from, to }}
            onRange={(r) => {
              setFrom(r.from);
              setTo(r.to);
            }}
            granularity={granularity}
            dataRange={dataRange}
          />
          <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            View
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {(["daily", "monthly", "quarterly", "yearly", "overall"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    setGranularity(g);
                    const snapped = snapRange({ from, to }, g);
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

      {granularity !== "daily" && (
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
          value={summary?.totals.batteryOnlyChf}
          sub={summary ? granularity === "overall" ? avgSuffix : `CHF ${summary.avgDaily.batteryOnlyChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Battery revenue"
          value={summary?.totals.batteryRevenueChf}
          sub={
            summary
              ? granularity === "overall"
                ? `${avgSuffix} — discharge value minus charging cost`
                : `CHF ${summary.avgDaily.batteryRevenueChf.toFixed(2)}/${unit} avg — discharge value minus charging cost`
              : undefined
          }
        />
      </div>

      <RevenueBreakdownChart siteId={site.id} from={from} to={to} granularity={granularity} />

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-700">Cumulative savings vs. cost</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeQuery.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="cumulativeWithBatteryChf"
                name="With battery"
                stroke="#0f172a"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeWithoutBatteryChf"
                name="No battery"
                stroke="#3b82f6"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeBatteryOnlyChf"
                name="Battery only"
                stroke="#f59e0b"
                dot={false}
              />
              {summary && summary.costs.total > 0 && (
                <ReferenceLine
                  y={summary.costs.total}
                  stroke="#0f172a"
                  strokeDasharray="4 4"
                  label={{ value: "Total cost", fontSize: 11, position: "insideTopLeft" }}
                />
              )}
              {summary && summary.costs.solar > 0 && (
                <ReferenceLine
                  y={summary.costs.solar}
                  stroke="#3b82f6"
                  strokeDasharray="4 4"
                  label={{ value: "Solar cost", fontSize: 11, position: "insideTopLeft" }}
                />
              )}
              {summary && summary.costs.battery > 0 && (
                <ReferenceLine
                  y={summary.costs.battery}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: "Battery cost", fontSize: 11, position: "insideTopLeft" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PaybackCard
          label="Payback — with battery"
          years={summary?.payback.withBatteryYears}
          breakeven={summary?.breakeven.withBatteryDate}
        />
        <PaybackCard
          label="Payback — no battery"
          years={summary?.payback.withoutBatteryYears}
          breakeven={summary?.breakeven.withoutBatteryDate}
        />
        <PaybackCard
          label="Payback — battery only"
          years={summary?.payback.batteryOnlyYears}
          breakeven={summary?.breakeven.batteryOnlyDate}
        />
      </div>
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

interface RevenuePeriod {
  /** "YYYY-MM-DD", "YYYY-MM" or "YYYY" depending on granularity — matches the API's `date`. */
  key: string;
  label: string;
  consumption: number;
  direct: number;
  battery: number;
  neighbor: number;
  /** Same period with no battery: charged PV exported instead, nothing discharged. */
  simConsumption: number;
  simDirect: number;
  simNeighbor: number;
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
  // Plain YYYY-MM-DD, so stepping in UTC can't be shifted by a DST boundary.
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function periodLabel(key: string, granularity: Granularity): string {
  if (granularity === "overall") return "Total";
  if (granularity === "quarterly") return `${key.slice(5)} ${key.slice(0, 4)}`;
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
  simulate,
  unit,
}: {
  active?: boolean;
  payload?: RevenueTooltipEntry[];
  granularity: Granularity;
  simulate?: boolean;
  unit: RevenueUnit;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  const actualEntries = payload.filter((e) => !e.dataKey.startsWith("sim"));
  const simTotal = row.simConsumption + row.simDirect + row.simNeighbor;
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
          : `${d}.${m}.${y}`;
  const total = row.consumption + row.direct + row.battery + row.neighbor;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="mb-1.5 font-medium text-slate-900">{heading}</p>
      <div className="space-y-1">
        {actualEntries.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-semibold tabular-nums text-slate-900">
              {formatRevenue(entry.value, unit)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-6 border-t pt-1">
          <span className="text-slate-600">Total</span>
          <span className="font-semibold tabular-nums text-slate-900">
            {formatRevenue(total, unit)}
          </span>
        </div>
        {simulate && (
          <>
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-600">Without battery</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatRevenue(simTotal, unit)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-600">Battery's net contribution</span>
              <span
                className={`font-semibold tabular-nums ${total - simTotal >= 0 ? "text-slate-900" : "text-red-600"}`}
              >
                {total - simTotal >= 0 ? "+" : ""}
                {formatRevenue(total - simTotal, unit)}
              </span>
            </div>
          </>
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
  const [simulate, setSimulate] = useState(false);
  const [unit, setUnit] = useState<RevenueUnit>("chf");

  const query = useQuery({
    queryKey: ["savings-revenue", siteId, from, to, granularity],
    queryFn: () => api.savings.daily(siteId, from, to, granularity),
  });

  const chartData: RevenuePeriod[] = useMemo(() => {
    const byKey = new Map((query.data ?? []).map((r) => [r.date, r]));
    return periodKeys(from, to, granularity).map((key) => {
      const row = byKey.get(key);
      // The kWh view shows the energy behind each money figure, segment for
      // segment, so switching unit re-reads the same bars rather than
      // rearranging them.
      const batteryExportedKwh = row?.batteryDischargeExportedKwh ?? 0;
      const money = unit === "chf";
      return {
        key,
        label: periodLabel(key, granularity),
        consumption: money ? row?.directConsumptionRevenueChf ?? 0 : row?.directUseKwh ?? 0,
        // Gross discharge value, *not* `batteryRevenueChf`: that one already
        // nets off the charging opportunity cost, and the no-battery bar
        // re-adds that same charged energy as export. Keeping the segment
        // gross means the gap between the two bars is the battery's net
        // contribution exactly once — and equals the Battery revenue card.
        direct: money
          ? row?.directExportRevenueChf ?? 0
          : (row?.exportedKwh ?? 0) - batteryExportedKwh,
        battery: money
          ? (row?.batteryDischargeConsumedValueChf ?? 0) + (row?.batteryDischargeExportedValueChf ?? 0)
          : (row?.batteryDischargeConsumedKwh ?? 0) + batteryExportedKwh,
        neighbor: money ? row?.neighborSellRevenueChf ?? 0 : row?.neighborConsumptionKwh ?? 0,
        // Direct consumption and neighbour sales don't involve the battery, so
        // they carry over into the counterfactual unchanged.
        simConsumption: money ? row?.directConsumptionRevenueChf ?? 0 : row?.directUseKwh ?? 0,
        simDirect: money
          ? row?.noBatteryDirectExportRevenueChf ?? 0
          : (row?.exportedKwh ?? 0) - batteryExportedKwh + (row?.batteryChargeKwh ?? 0),
        simNeighbor: money ? row?.neighborSellRevenueChf ?? 0 : row?.neighborConsumptionKwh ?? 0,
      };
    });
  }, [query.data, from, to, granularity, unit]);

  const total = chartData.reduce(
    (sum, d) => sum + d.consumption + d.direct + d.battery + d.neighbor,
    0,
  );

  const simTotal = chartData.reduce(
    (sum, d) => sum + d.simConsumption + d.simDirect + d.simNeighbor,
    0,
  );

  // A year of daily bars is ~365 labels in the width of a dozen: thin them to
  // roughly a dozen ticks so they stay readable, and label every month.
  const names = seriesNames(unit);
  // One bar across a whole chart looks like a rendering fault; give the
  // overall view a wider but still bounded bar.
  const barSize = granularity === "overall" ? 90 : 20;

  const tickInterval =
    granularity === "daily" ? Math.max(Math.ceil(chartData.length / 12) - 1, 0) : 0;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Revenue</h2>
          <p className="mt-1 text-xs text-slate-500">
            Direct consumption (avoided import), direct export, battery and neighbour sales, by{" "}
            {PERIOD_UNIT[granularity]}
            {unit === "kwh" && " — the energy behind each revenue figure"}.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
            {(
              [
                ["chf", "CHF"],
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
            <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
            Simulate without battery
          </label>
          <span className="text-sm text-slate-600">
            {unit === "chf" ? "Total revenue" : "Total energy"}{" "}
            <span className="font-semibold text-slate-900">{formatRevenue(total, unit)}</span>
            {simulate && (
              <span className="text-slate-500"> vs. {formatRevenue(simTotal, unit)} without</span>
            )}
          </span>
        </div>
      </div>

      {simulate && (
        <p className="mt-2 text-xs text-slate-500">
          The pale bar is the same period with no battery at all: the PV that charged it is
          exported instead, nothing is discharged, and direct consumption and neighbour sales carry
          over unchanged since neither involves the battery. The gap between the bars is what the
          battery {unit === "chf" ? "contributed" : "shifted"} —{" "}
          <span className="font-medium text-slate-700">
            {formatRevenue(total - simTotal, unit)}
          </span>{" "}
          over this range, which is the Battery revenue figure above.
        </p>
      )}

      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={tickInterval} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0)} width={unit === "kwh" ? 52 : 40} />
            <Tooltip content={<RevenueTooltip granularity={granularity} simulate={simulate} unit={unit} />} />
            <Legend />
            <Bar
              dataKey="consumption"
              name={names.consumption}
              stackId="revenue"
              fill={REVENUE_COLORS.consumption}
              maxBarSize={barSize}
            />
            <Bar dataKey="direct" name={names.direct} stackId="revenue" fill={REVENUE_COLORS.direct} maxBarSize={barSize} />
            <Bar dataKey="battery" name={names.battery} stackId="revenue" fill={REVENUE_COLORS.battery} maxBarSize={barSize} />
            <Bar
              dataKey="neighbor"
              name={names.neighbor}
              stackId="revenue"
              fill={REVENUE_COLORS.neighbor}
              maxBarSize={barSize}
              radius={[4, 4, 0, 0]}
            />
            {simulate && (
              <>
                <Bar
                  dataKey="simConsumption"
                  name={`${names.consumption} (no battery)`}
                  stackId="sim"
                  fill={REVENUE_COLORS.consumption}
                  fillOpacity={0.4}
                  maxBarSize={barSize}
                  legendType="none"
                />
                <Bar
                  dataKey="simDirect"
                  name={`${names.direct} (no battery)`}
                  stackId="sim"
                  fill={REVENUE_COLORS.direct}
                  fillOpacity={0.4}
                  maxBarSize={barSize}
                  legendType="none"
                />
                <Bar
                  dataKey="simNeighbor"
                  name={`${names.neighbor} (no battery)`}
                  stackId="sim"
                  fill={REVENUE_COLORS.neighbor}
                  fillOpacity={0.4}
                  maxBarSize={barSize}
                  legendType="none"
                  radius={[4, 4, 0, 0]}
                />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
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
}: {
  range: { from: string; to: string };
  onRange: (r: { from: string; to: string }) => void;
  granularity: Granularity;
  dataRange: DataRange;
}) {
  const [preset, setPreset] = useState("custom");

  const applyPreset = (id: string) => {
    setPreset(id);
    const found = RANGE_PRESETS.find((p) => p.id === id);
    if (found) onRange(snapRange(found.resolve(dataRange), granularity));
  };
  const setCustom = (next: { from: string; to: string }) => {
    setPreset("custom");
    onRange(next);
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
        <select className="input" value={preset} onChange={(e) => applyPreset(e.target.value)}>
          {RANGE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>

      {(granularity === "daily" || granularity === "overall") && (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <input
              type="date"
              className="input"
              value={range.from}
              max={range.to}
              onChange={(e) => setCustom({ ...range, from: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <input
              type="date"
              className="input"
              value={range.to}
              min={range.from}
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
              className="input"
              value={range.from.slice(0, 7)}
              onChange={(e) => setCustom({ ...range, from: `${e.target.value}-01` })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <input
              type="month"
              className="input"
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
              className="input"
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
              className="input"
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
              className="input"
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
              className="input"
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

function StatCard({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">
        {value != null ? `CHF ${value.toFixed(2)}` : "—"}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
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
