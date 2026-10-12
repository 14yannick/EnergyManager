import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PartyConsumption, PartyConsumptionPeriod, PartyConsumptionWarning } from "@energy-manager/shared";
import { api } from "../api/client";
import { formatChf, formatKwh, formatKwhAuto } from "../lib/format";
import { PALETTE } from "../lib/palette";
import { useSelectedPeriod } from "../lib/usePeriod";
import { useT, type MessageKey } from "../i18n/context";
import { PeriodControls } from "../components/PeriodControls";
import { PeriodHeader } from "../components/PeriodHeader";
import { InfoTip } from "../components/InfoTip";
import { StatCard } from "../components/StatCard";
import { LiveSection } from "../components/LiveSection";
import {
  MAX_HOURLY_DAYS,
  PERIOD_UNIT,
  axisTick,
  clampRange,
  periodKeys,
  periodLabel,
  latestDay,
  type DataRange,
  type Granularity,
} from "../lib/periods";

/**
 * One party's consumption: how much came from the vZEV's own production
 * rather than the grid, and what being in the vZEV saved them.
 *
 * The dashboard of a member who does not feed in, and the lower half of a
 * producer's (see DashboardPage, which picks). `embedded` is the second
 * case: the live picture and the period controls are already on the page
 * above, so only the figures and the chart are drawn, under a heading that
 * names whose consumption this is.
 */

type ChartUnit = "kwh" | "chf";

// The app's colour vocabulary (src/lib/palette.ts): violet for the shared
// connection's standing charges, green for what came from the site's own
// panels, blue for the grid. Validated as a stack in that order, bottom to top.
const COLORS = { local: PALETTE.local, grid: PALETTE.grid, fixed: PALETTE.vzev, own: PALETTE.sun };

/** A producer's own consumption in one chart period: what their plant supplied the house, and what buying it would have cost. */
interface OwnUse {
  kwh: number;
  valueChf: number;
}

const WARNING_TEXT: Record<PartyConsumptionWarning, MessageKey> = {
  no_positions: "party.warn.noPositions",
  no_local_rate: "party.warn.noLocalRate",
};

/** Share of consumption supplied locally, in percent; null when nothing was consumed. */
const localShare = (p: Pick<PartyConsumptionPeriod, "localKwh" | "gridKwh">) => {
  const total = p.localKwh + p.gridKwh;
  return total > 0 ? (p.localKwh / total) * 100 : null;
};

// Fixed at one decimal (not the auto threshold formatKwhAuto uses
// elsewhere): the tooltip below shows local and grid side by side, and a
// figure crossing 100 kWh dropping to zero decimals while the other kept
// one broke their decimal-point alignment.
const kwh = (v: number) => `${formatKwh(v)} kWh`;

/**
 * One party's consumption over the range, priced. The same query key from
 * the plant dashboard, which shows the party's consumer figures among its
 * own, so the two never fetch twice for one page.
 */
export function usePartyConsumption(siteId: string, partyId: string, from: string, to: string, granularity: Granularity) {
  return useQuery({
    queryKey: ["party-consumption", siteId, partyId, from, to, granularity],
    queryFn: () => api.parties.consumption(siteId, partyId, from, to, granularity),
    // Keeps the page steady while a new range loads, instead of blanking it.
    placeholderData: (previous) => previous,
  });
}

/**
 * The four figures of a party as a consumer: what the vZEV saved them, what
 * they used, how much of it was local, what it cost. On their own dashboard
 * these are the KPI block; on a producer's they join the plant's KPIs.
 */
export function ConsumptionKpis({ totals }: { totals: PartyConsumption["totals"] | undefined }) {
  const t = useT();
  const totalKwh = totals ? totals.localKwh + totals.gridKwh : 0;
  const share = totals ? localShare(totals) : null;
  return (
    <>
      <StatCard
        label={t("party.kpi.saved")}
        // The figure the page exists to answer, so it leads and stands out.
        // Green only while it is a saving: a negative one is not good news.
        emphasis={totals != null && totals.savedChf > 0 ? "positive" : "strong"}
        hint={t("party.kpi.savedHint")}
        value={totals?.savedChf}
      />
      <StatCard
        label={t("party.kpi.total")}
        value={totals ? totalKwh : undefined}
        format={kwh}
        sub={
          totals
            ? t("party.kpi.totalSub", { local: formatKwhAuto(totals.localKwh), grid: formatKwhAuto(totals.gridKwh) })
            : undefined
        }
      />
      {/* No kWh under it: the consumption card beside it already gives
          the local kWh, and the share is the one thing this adds. */}
      <StatCard label={t("party.kpi.localShare")} value={share} format={(v) => `${v.toFixed(0)} %`} />
      <StatCard
        label={t("party.kpi.cost")}
        value={totals?.rcpCostChf}
        // The direct-supply figure sits under the cost it is compared
        // with, leaving the benefit to stand alone as the headline.
        sub={totals ? t("party.kpi.savedSub", { direct: formatChf(totals.directCostChf) }) : undefined}
      />
    </>
  );
}

export function ConsumptionDashboard({
  siteId,
  partyId,
  partyName,
  ownerView,
  embedded = false,
  ownProduction = false,
}: {
  siteId: string;
  partyId: string;
  /** Shown until the figures, which carry the name too, have loaded. */
  partyName: string;
  /** An admin's or viewer's eyes: the feed-in rate may be drawn, and the vZEV's view is asked for this party by id. */
  ownerView: boolean;
  embedded?: boolean;
  /**
   * The party feeds in: their own production — used as it was made, or
   * from the battery — joins the chart, so the whole of what the house used
   * is in view, not only what came through the meter.
   */
  ownProduction?: boolean;
}) {
  const t = useT();
  const { from, to, granularity, mode, set: setPeriod } = useSelectedPeriod();

  const query = usePartyConsumption(siteId, partyId, from, to, granularity);
  const data = query.data;
  // The plant's own-use figures, from the same rows the revenue chart draws:
  // site-wide, which is the producer's plant while the site has one.
  const ownQuery = useQuery({
    queryKey: ["savings-revenue", siteId, from, to, granularity],
    queryFn: () => api.savings.daily(siteId, from, to, granularity),
    enabled: ownProduction === true,
    placeholderData: (previous) => previous,
  });
  const ownUse = useMemo(() => {
    if (!ownProduction) return undefined;
    const map = new Map<string, OwnUse>();
    for (const r of ownQuery.data ?? []) {
      map.set(r.date, { kwh: r.directUseKwh + r.batteryDischargeConsumedKwh, valueChf: r.selfConsumptionValueChf });
    }
    return map;
  }, [ownProduction, ownQuery.data]);

  // No lower bound: unlike payback, nothing here is averaged over the range, so
  // days before the first reading do no harm — they still carry standing
  // charges, which is honest. The future is cut off, except where there are
  // readings in it.
  const bounds = { min: null, max: latestDay(data?.dataTo) };
  const dataRange: DataRange = { from: data?.dataFrom ?? null, to: data?.dataTo ?? null };
  useEffect(() => {
    // See the dashboard's copy: until this party's own range has loaded,
    // `bounds.max` is only today, and clamping against it would throw away a
    // period carried over from the other page.
    if (!data) return;
    const c = clampRange({ from, to }, bounds);
    if (c.from !== from || c.to !== to) setPeriod(c, granularity);
  }, [data, bounds.max, from, to, granularity]);

  const totals = data?.totals;
  const totalKwh = totals ? totals.localKwh + totals.gridKwh : 0;
  const name = data?.partyName ?? partyName;

  return (
    <div className="space-y-6">
      {/* Embedded in a producer's dashboard, the chart below carries the
          heading; the live picture and the period controls are above. */}
      {!embedded && (
        <>
          {/* Straight under the title: the one thing on this page that is
              true only right now, so it should not need scrolling past to
              reach. The feed-in rate would reveal the owner's revenue, so it
              is drawn only for admin/viewer — same boundary as the
              dynamic-tariffs and neighbours routes (see policy.ts). The
              vZEV's picture is asked for the party in view: a participant's
              own (the API knows who they are), or the one an admin picked. */}
          <LiveSection siteId={siteId} owner={ownerView} flow="vzev" partyId={ownerView ? partyId : null} />

          {/* Nothing above this line answers to the period selector, so it
              sits here. */}
          <PeriodHeader title={t("party.periodTitle")} intro={t("party.periodIntro", { name })}>
            <PeriodControls
              range={{ from, to }}
              granularity={granularity}
              mode={mode}
              onChange={setPeriod}
              dataRange={dataRange}
              bounds={bounds}
            />
          </PeriodHeader>

          {granularity === "hourly" && (
            <p className="text-xs text-slate-500">{t("dash.hourlyCap", { days: MAX_HOURLY_DAYS })}</p>
          )}
        </>
      )}

      {data?.warnings.map((w) => (
        <p key={w} className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {t(WARNING_TEXT[w])}
        </p>
      ))}

      {/* Embedded under a producer's plant figures, these four already sit
          in the plant's KPI block above. */}
      {!embedded && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700">{t("dash.kpi")}</h2>
          {/* Two abreast even on a phone: four figures in a column is a screen
              of scrolling for what fits in two rows. */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <ConsumptionKpis totals={totals} />
          </div>
        </section>
      )}

      <ConsumptionChart
        periods={data?.periods ?? []}
        ownUse={ownUse}
        from={from}
        to={to}
        granularity={granularity}
        empty={!!data && totalKwh === 0 && !(ownUse && [...ownUse.values()].some((o) => o.kwh > 0))}
      />
    </div>
  );
}


interface ChartRow extends PartyConsumptionPeriod {
  label: string;
  /** The RCP bill's per-kWh grid part: grid energy, network use and levies. */
  gridEnergyChf: number;
  /** Direct supply's per-kWh part: every kWh bought from the provider. */
  directEnergyChf: number;
  /** A producer's own production used at home; zero for anyone else. */
  ownKwh: number;
  /** The same at the purchase price: what it would have cost from the grid. Never paid. */
  ownValueChf: number;
}

/** Hatched fills for what was not paid: the direct-supply bar, and own production valued. */
const hatchId = (key: "grid" | "fixed" | "own") => `directHatch-${key}`;

function ConsumptionChart({
  periods,
  ownUse,
  from,
  to,
  granularity,
  empty,
}: {
  periods: PartyConsumptionPeriod[];
  /** Per chart period, for a producer; undefined for a party without a plant. */
  ownUse?: Map<string, OwnUse>;
  from: string;
  to: string;
  granularity: Granularity;
  empty: boolean;
}) {
  const t = useT();
  const [unit, setUnit] = useState<ChartUnit>("chf");
  const [compare, setCompare] = useState(false);

  // Every period in the range, with or without data, so a gap reads as a gap.
  const rows: ChartRow[] = useMemo(() => {
    const byKey = new Map(periods.map((p) => [p.date, p]));
    return periodKeys(from, to, granularity).map((key) => {
      const p = byKey.get(key) ?? {
        date: key,
        localKwh: 0,
        gridKwh: 0,
        rcpCostChf: 0,
        localEnergyChf: 0,
        rcpFixedChf: 0,
        directCostChf: 0,
        directFixedChf: 0,
        savedChf: 0,
      };
      const own = ownUse?.get(key);
      return {
        ...p,
        label: periodLabel(key, granularity, t("common.total"), granularity === "hourly" && from === to),
        gridEnergyChf: p.rcpCostChf - p.localEnergyChf - p.rcpFixedChf,
        directEnergyChf: p.directCostChf - p.directFixedChf,
        ownKwh: own?.kwh ?? 0,
        ownValueChf: own?.valueChf ?? 0,
      };
    });
  }, [periods, ownUse, from, to, granularity, t]);

  const showOwn = ownUse != null;
  const showDirect = unit === "chf" && compare;
  // Two bars share each period when comparing, so each gets half the room.
  const barSize =
    (granularity === "overall" ? 90 : Math.max(10, Math.min(72, Math.round(880 / Math.max(rows.length, 1))))) /
    (showDirect ? 2 : 1);
  // A maximum width centres each bar in its own half of the period's slot,
  // which with few periods left the pair a hand's width apart. An exact width
  // packs them side by side — safe while there are few enough periods to fit
  // on a phone; beyond that the maximum takes over again.
  const sizing = showDirect && rows.length <= 12 ? { barSize } : { maxBarSize: barSize };
  const tickInterval =
    granularity === "hourly"
      ? 2
      : granularity === "daily"
        ? Math.max(Math.ceil(rows.length / 12) - 1, 0)
        : 0;
  const periodUnit = t(PERIOD_UNIT[granularity]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-slate-700">
        {t("party.chart.title")}
        <InfoTip
          text={
            (unit === "kwh"
              ? t("party.chart.noteKwh", { unit: periodUnit })
              : t("party.chart.noteChf", { unit: periodUnit })) +
            (showOwn ? ` ${t("party.chart.noteOwn")}` : "") +
            (showDirect ? ` ${t("party.chart.noteDirect")}` : "")
          }
        />
      </h2>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex rounded-md border border-slate-300 text-sm">
            {(["chf", "kwh"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`shrink-0 whitespace-nowrap px-3 py-1 ${
                  unit === u ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {u === "kwh" ? "kWh" : "CHF"}
              </button>
            ))}
          </div>
          {unit === "chf" && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              {t("party.compareDirect")}
            </label>
          )}
        </div>

        {/* Only the energy view can be empty: standing charges accrue on a
            day nothing was metered, so the money view always has something. */}
        {empty && unit === "kwh" ? (
          <p className="mt-6 pb-6 text-center text-sm text-slate-500">{t("party.noData")}</p>
        ) : (
          <div className="mt-3 h-72 xl:h-[26rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} barCategoryGap="20%" barGap={4}>
                <defs>
                  {(["grid", "fixed", "own"] as const).map((key) => (
                    <pattern key={key} id={hatchId(key)} patternUnits="userSpaceOnUse" width={5} height={5}
                      patternTransform="rotate(45)">
                      <rect width={5} height={5} fill={PALETTE.surface} />
                      <line x1={0} y1={0} x2={0} y2={5} stroke={COLORS[key]} strokeWidth={3} />
                    </pattern>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.gridline} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={tickInterval} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={axisTick} width={56} />
                <Tooltip content={<ConsumptionTooltip granularity={granularity} />} />
                {/* Ink-coloured names: the swatch carries the series colour. */}
                <Legend formatter={(value: string) => <span className="text-slate-700">{value}</span>} />
                {/* The 2px white stroke is the gap between stacked segments. */}
                {unit === "kwh" ? (
                  <>
                    {/* The plant's own share at the foot: what the house ran
                        on before anything came through the meter. */}
                    {showOwn && (
                      <Bar dataKey="ownKwh" name={t("party.series.own")} stackId="s"
                        fill={COLORS.own} stroke={PALETTE.surface} strokeWidth={2} {...sizing} />
                    )}
                    <Bar dataKey="localKwh" name={t("party.series.local")} stackId="s"
                      fill={COLORS.local} stroke={PALETTE.surface} strokeWidth={2} {...sizing} />
                    <Bar dataKey="gridKwh" name={t("party.series.grid")} stackId="s"
                      fill={COLORS.grid} stroke={PALETTE.surface} strokeWidth={2} {...sizing}
                      radius={[4, 4, 0, 0]} />
                  </>
                ) : (
                  <>
                    {/* Fixed charges at the bottom: the floor the bill starts
                        from before a single kWh is used — the invoice's per-day
                        positions, pro rata to the days each bar covers. */}
                    <Bar dataKey="rcpFixedChf" name={t("party.series.fixed")} stackId="rcp"
                      fill={COLORS.fixed} stroke={PALETTE.surface} strokeWidth={2} {...sizing} />
                    <Bar dataKey="localEnergyChf" name={t("party.series.localEnergy")} stackId="rcp"
                      fill={COLORS.local} stroke={PALETTE.surface} strokeWidth={2} {...sizing} />
                    <Bar dataKey="gridEnergyChf" name={t("party.series.gridPerKwh")} stackId="rcp"
                      fill={COLORS.grid} stroke={PALETTE.surface} strokeWidth={2} {...sizing}
                      radius={showOwn ? undefined : [4, 4, 0, 0]} />
                    {/* Own production on top, hatched: never on the bill, but
                        at the purchase price it is what the plant spared the
                        house, and with it the bar is the whole consumption. */}
                    {showOwn && (
                      <Bar dataKey="ownValueChf" name={t("party.series.ownValue")} stackId="rcp"
                        fill={`url(#${hatchId("own")})`} stroke={COLORS.own} strokeWidth={1} {...sizing}
                        radius={[4, 4, 0, 0]} />
                    )}
                    {showDirect && (
                      <>
                        <Bar dataKey="directFixedChf" name={t("party.series.directFixed")} stackId="direct"
                          fill={`url(#${hatchId("fixed")})`} stroke={COLORS.fixed} strokeWidth={1}
                          {...sizing} />
                        <Bar dataKey="directEnergyChf" name={t("party.series.directPerKwh")} stackId="direct"
                          fill={`url(#${hatchId("grid")})`} stroke={COLORS.grid} strokeWidth={1}
                          {...sizing} radius={showOwn ? undefined : [4, 4, 0, 0]} />
                        {/* The same own production, so the two bars compare like for like. */}
                        {showOwn && (
                          <Bar dataKey="ownValueChf" name={t("party.series.ownValue")} stackId="direct"
                            legendType="none" fill={`url(#${hatchId("own")})`} stroke={COLORS.own} strokeWidth={1}
                            {...sizing} radius={[4, 4, 0, 0]} />
                        )}
                      </>
                    )}
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}

// Both units, and both bills, in one tooltip whichever the chart shows, so
// switching is never needed just to read a figure.
function ConsumptionTooltip({
  active,
  payload,
  granularity,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  granularity: Granularity;
}) {
  const t = useT();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  const share = localShare(row);
  const heading = granularity === "overall" ? t("dash.wholePeriod") : row.label;

  const chf = (v: number) => `CHF ${formatChf(v)}`;
  const line = (label: string, value: string, swatch?: string, strong = false) => (
    <div className={`flex items-center justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <span className="min-w-0 text-slate-600">
        {swatch && (
          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: swatch }} />
        )}
        {label}
      </span>
      <span className="whitespace-nowrap tabular-nums text-slate-900">{value}</span>
    </div>
  );

  // Capped to the screen: eleven rows of long German labels outgrew a phone
  // and pushed the page sideways. Labels wrap instead.
  return (
    <div className="w-72 max-w-[calc(100vw-3rem)] space-y-0.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md sm:text-sm">
      <p className="mb-1 font-medium text-slate-900">{heading}</p>
      {row.ownKwh > 0 && line(t("party.series.own"), kwh(row.ownKwh), COLORS.own)}
      {line(t("party.series.local"), kwh(row.localKwh), COLORS.local)}
      {line(t("party.series.grid"), kwh(row.gridKwh), COLORS.grid)}
      {row.ownKwh > 0 && line(t("party.totalKwh"), kwh(row.ownKwh + row.localKwh + row.gridKwh), undefined, true)}
      {line(t("party.localShare"), share == null ? "—" : `${share.toFixed(0)} %`)}
      <div className="my-1 border-t" />
      {line(t("party.series.fixed"), chf(row.rcpFixedChf), COLORS.fixed)}
      {line(t("party.series.localEnergy"), chf(row.localEnergyChf), COLORS.local)}
      {line(t("party.series.gridPerKwh"), chf(row.gridEnergyChf), COLORS.grid)}
      {line(t("party.paid"), chf(row.rcpCostChf), undefined, true)}
      {row.ownKwh > 0 && line(t("party.series.ownValue"), chf(row.ownValueChf), COLORS.own)}
      <div className="my-1 border-t" />
      {line(t("party.series.directFixed"), chf(row.directFixedChf))}
      {line(t("party.series.directPerKwh"), chf(row.directEnergyChf))}
      {line(t("party.series.direct"), chf(row.directCostChf), undefined, true)}
      <div className="my-1 border-t" />
      {line(t("party.saved"), chf(row.savedChf), undefined, true)}
      {/* For a producer: the saving once their own production counts, at
          the purchase price it spared, on top of what the vZEV saved. */}
      {row.ownKwh > 0 && line(t("party.savedWithOwn"), chf(row.savedChf + row.ownValueChf), undefined, true)}
    </div>
  );
}
