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
import { api } from "../api/client";
import { useT, type Translate } from "../i18n/context";
import { useDefaultSite } from "../lib/useDefaultSite";
import { PeriodControls } from "../components/PeriodControls";
import { StatCard } from "../components/StatCard";
import { NeighbourSalesChart } from "../components/NeighbourSalesChart";
import {
  INITIAL_GRANULARITY,
  MAX_HOURLY_DAYS,
  PERIODS_PER_YEAR,
  PERIOD_UNIT,
  PERIOD_UNITS,
  initialRange,
  axisTick,
  clampRange,
  inclusiveDays,
  periodKeys,
  periodLabel,
  ticksThroughZero,
  latestDay,
  type DataRange,
  type Granularity,
} from "../lib/periods";

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

const formatRevenue = (value: number, unit: RevenueUnit) =>
  barUnit(unit) === "chf" ? `CHF ${value.toFixed(2)}` : `${value.toFixed(1)} kWh`;

// Two of the four series are named for the money they earn, which reads wrong
// once the bars are energy: the same segment is a revenue in one unit and a
// flow of kWh in the other.
const seriesNames = (unit: RevenueUnit, t: Translate) => ({
  consumption: t("dash.flow.consumption"),
  direct: t("dash.flow.direct"),
  // Deliberately not "Battery revenue": this segment is the gross value of what
  // the battery delivered, while the KPI of that name is net of charging. Two
  // different numbers under one label was the confusion.
  battery: t("dash.flow.battery"),
  neighbor: barUnit(unit) === "chf" ? t("dash.flow.neighborSale") : t("dash.flow.neighborSupply"),
});

export function DashboardPage() {
  const { site } = useDefaultSite();
  const t = useT();
  const initial = useMemo(initialRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [granularity, setGranularity] = useState<Granularity>(INITIAL_GRANULARITY);
  const unit = t(PERIOD_UNIT[granularity]);
  const avgSuffix =
    granularity === "overall"
      ? t("dash.overallAvg", { days: inclusiveDays(from, to) })
      : null;
  /** "CHF 1.23/day avg", or the overall view's "over N days". */
  /** CHF per kWh written in cents, as the provider's own bill does. */
  const ct = (chfPerKwh: number) => `${(chfPerKwh * 100).toFixed(1)} ${t("billing.centsPerKwh")}`;
  const avgOf = (value: number | undefined) =>
    value == null ? undefined : (avgSuffix ?? t("dash.avgSuffix", { value: value.toFixed(2), unit }));

  const rangeQuery = useQuery({
    queryKey: ["readings-range", site?.id],
    queryFn: () => api.readings.range(site!.id),
    enabled: !!site,
  });
  const dataRange: DataRange = rangeQuery.data ?? { from: null, to: null, firstProduction: null };
  // Stated start date wins; otherwise the first day production was recorded.
  const productionStart = site?.productionStartDate ?? dataRange.firstProduction ?? null;
  const bounds = { min: productionStart, max: latestDay(dataRange.to) };

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

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t("dash.title")}</h1>
          <p className="max-w-2xl text-sm text-slate-500">{t("dash.intro")}</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3 text-sm">
          <PeriodControls
            range={{ from, to }}
            granularity={granularity}
            onChange={(r, g) => {
              setGranularity(g);
              setFrom(r.from);
              setTo(r.to);
            }}
            dataRange={dataRange}
            bounds={bounds}
          />
        </div>
      </div>

      {granularity === "hourly" && (
        <p className="text-xs text-slate-500">{t("dash.hourlyCap", { days: MAX_HOURLY_DAYS })}</p>
      )}

      {granularity !== "daily" && granularity !== "hourly" && (
        <p className="text-xs text-slate-500">
          {granularity === "overall"
            ? t("dash.overallNote", { days: inclusiveDays(from, to) })
            : t("dash.periodNote", { unit, periods: PERIODS_PER_YEAR[granularity] })}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-700">{t("dash.kpi")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("dash.withBatteryTotal")}
          value={summary?.totals.withBatteryChf}
          sub={avgOf(summary?.avgDaily.withBatteryChf)}
        />
        <StatCard
          label={t("dash.noBatteryTotal")}
          value={summary?.totals.withoutBatteryChf}
          sub={avgOf(summary?.avgDaily.withoutBatteryChf)}
        />
        <StatCard
          label={t("dash.soldPrice")}
          hint={t("dash.soldPriceHint")}
          value={summary?.soldPricePerKwhChf}
          format={(v) => ct(v)}
          sub={
            summary
              ? t("dash.soldPriceSub", {
                  kwh: (summary.sold.gridKwh + summary.sold.neighbourKwh + summary.sold.unpricedKwh).toFixed(0),
                  grid: summary.sold.gridKwh > 0 ? ct(summary.sold.gridChf / summary.sold.gridKwh) : "—",
                  local:
                    summary.sold.neighbourKwh > 0 ? ct(summary.sold.neighbourChf / summary.sold.neighbourKwh) : "—",
                }) +
                (summary.sold.unpricedKwh >= 0.5
                  ? ` · ${t("dash.soldUnpriced", { kwh: summary.sold.unpricedKwh.toFixed(0) })}`
                  : "")
              : undefined
          }
        />
        <StatCard
          label={t("dash.batteryRevenue")}
          hint={t("dash.batteryRevenueHint")}
          value={summary?.totals.batteryRevenueChf}
          sub={avgOf(summary?.avgDaily.batteryRevenueChf)}
        />
        </div>
      </section>

      <RevenueBreakdownChart siteId={site.id} from={from} to={to} granularity={granularity} />

      <NeighbourSalesChart siteId={site.id} from={from} to={to} />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">{t("dash.payback")}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {t("dash.paybackNote", {
              unit,
              annualised:
                granularity === "overall"
                  ? t("dash.annualisedOverall", { days: inclusiveDays(from, to) })
                  : granularity === "yearly"
                    ? t("dash.annualisedYearly")
                    : t("dash.annualisedOther", {
                        periods: PERIODS_PER_YEAR[granularity],
                        units: t(PERIOD_UNITS[granularity]),
                      }),
            })}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PaybackCard
            label={t("dash.withBattery")}
            years={summary?.payback.withBatteryYears}
            breakeven={summary?.breakeven.withBatteryDate}
          />
          <PaybackCard
            label={t("dash.noBattery")}
            years={summary?.payback.withoutBatteryYears}
            breakeven={summary?.breakeven.withoutBatteryDate}
          />
          <PaybackCard
            label={t("dash.batteryOnlyShort")}
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
  const t = useT();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  const [y, m, d] = row.key.split("-");
  const heading =
    granularity === "overall"
      ? t("dash.wholePeriod")
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
    { key: "consumption", name: t("dash.flow.consumption"), chf: row.consumptionChf, kwh: row.consumptionKwh },
    { key: "direct", name: t("dash.flow.direct"), chf: row.directChf, kwh: row.directKwh },
    { key: "battery", name: t("dash.flow.battery"), chf: row.batteryChf, kwh: row.batteryKwh },
    { key: "neighbor", name: t("dash.flow.neighbor"), chf: row.neighborChf, kwh: row.neighborKwh },
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
            <td className="border-t pt-1 text-slate-600">{t("common.total")}</td>
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
              <span className="text-slate-600">{t("dash.chargingForgone")}</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {row.batteryChargingCostChf > 0 ? "−" : row.batteryChargingCostChf < 0 ? "+" : ""}
                {formatRevenue(Math.abs(row.batteryChargingCostChf), "chf")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-600">{t("dash.batteryNet")}</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatRevenue(row.batteryNetChf, "chf")}
              </span>
            </div>
          </>
        )}
        {showProduction && (
          <div className="flex items-center justify-between gap-6">
            <span className="text-slate-600">{t("dash.productionPlusCharging")}</span>
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
  const t = useT();
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
        label: periodLabel(key, granularity, t("common.total")),
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
  const names = seriesNames(unit, t);
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
        <h2 className="text-sm font-medium text-slate-700">{t("dash.revenue")}</h2>
        <p className="mt-1 text-xs text-slate-500">
          {t("dash.revenueNote", { unit: t(PERIOD_UNIT[granularity]) })}
          {unit === "kwh" && t("dash.revenueKwh")}
          {unit === "both" && t("dash.revenueBoth")}.
          {barUnit(unit) === "chf" && t("dash.revenueCharging")}
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex max-w-full overflow-x-auto rounded-md border border-slate-300 text-sm">
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
                className={`shrink-0 whitespace-nowrap px-3 py-1 ${
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
            {t("dash.production")}
          </label>
          <span className="ml-auto text-sm text-slate-600">
            {barUnit(unit) === "chf" ? t("dash.totalRevenue") : t("dash.totalEnergy")}{" "}
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
                name={t("dash.chargingCostSeries")}
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
                name={t("dash.productionSeries")}
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

function PaybackCard({
  label,
  years,
  breakeven,
}: {
  label: string;
  years?: number | null;
  breakeven?: string | null;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">
        {years != null ? t("dash.years", { value: years.toFixed(1) }) : "—"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {t("dash.breakeven", { date: breakeven ?? t("dash.notReached") })}
      </p>
    </div>
  );
}
