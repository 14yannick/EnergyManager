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
import type { PartyConsumptionPeriod, PartyConsumptionWarning } from "@energy-manager/shared";
import { api } from "../api/client";
import { formatChf, formatKwh, formatKwhAuto } from "../lib/format";
import { PALETTE } from "../lib/palette";
import { useSelectedPeriod } from "../lib/usePeriod";
import { useT, type MessageKey } from "../i18n/context";
import { useIdentity } from "../lib/useIdentity";
import { useDefaultSite } from "../lib/useDefaultSite";
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
 * One party's consumption: how much came from the RCP's own production rather
 * than the grid, and what being in the RCP saved them.
 *
 * The page a participant lands on. An admin or viewer sees the same page for
 * whichever member they pick, which is how the owner can look at their own
 * household as a consumer rather than as the producer the main dashboard is
 * about.
 */

type ChartUnit = "kwh" | "chf";

// The app's colour vocabulary (src/lib/palette.ts): violet for the shared
// connection's standing charges, green for what came from the site's own
// panels, blue for the grid. Validated as a stack in that order, bottom to top.
const COLORS = { local: PALETTE.local, grid: PALETTE.grid, fixed: PALETTE.vzev };

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

export function PartyDashboardPage() {
  const t = useT();
  const identity = useIdentity();
  const isParticipant = identity.data?.role === "participant";
  // A participant is told their site and party by /api/me; everyone else
  // reads the site list and picks a party.
  const { site } = useDefaultSite({ enabled: identity.isSuccess && !isParticipant });
  const siteId = isParticipant ? identity.data?.siteId : site?.id;

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId!),
    enabled: !!siteId && !isParticipant,
  });
  // Only parties that consume: an admin-only or viewer party has nothing to show.
  const members = (partiesQuery.data ?? []).filter((p) => p.role === "rcp_party" || p.role === "rcp_admin");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const partyId = isParticipant
    ? identity.data?.partyId
    : (pickedId ?? members.find((p) => p.role === "rcp_admin")?.id ?? members[0]?.id);

  const { from, to, granularity, mode, set: setPeriod } = useSelectedPeriod();

  const query = useQuery({
    queryKey: ["party-consumption", siteId, partyId, from, to, granularity],
    queryFn: () => api.parties.consumption(siteId!, partyId!, from, to, granularity),
    enabled: !!siteId && !!partyId,
    // Keeps the page steady while a new range loads, instead of blanking it.
    placeholderData: (previous) => previous,
  });
  const data = query.data;

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

  if (identity.isLoading || (!isParticipant && !site)) {
    return <p className="text-slate-500">{t("common.loading")}</p>;
  }
  if (!isParticipant && partiesQuery.isSuccess && members.length === 0) {
    return <p className="text-sm text-slate-500">{t("party.none")}</p>;
  }

  const totals = data?.totals;
  const totalKwh = totals ? totals.localKwh + totals.gridKwh : 0;
  const share = totals ? localShare(totals) : null;
  const partyName = data?.partyName ?? identity.data?.partyName ?? "…";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("party.title")}</h1>
        <p className="max-w-2xl text-sm text-slate-500">{t("party.intro", { name: partyName })}</p>
      </div>

      {/* Straight under the title: the one thing on this page that is true
          only right now, so it should not need scrolling past to reach. */}
      {/* The feed-in rate would reveal the owner's revenue, so it is drawn
          only for admin/viewer — same boundary as the dynamic-tariffs and
          neighbours routes (see policy.ts). */}
      <LiveSection siteId={siteId} owner={!isParticipant} />

      {/* Nothing above this line answers to the period selector, so it sits
          here — with the participant picker, which scopes the same figures. */}
      <PeriodHeader title={t("party.periodTitle")} intro={t("party.periodIntro", { name: partyName })}>
        {!isParticipant && (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("party.pick")}
            <select
              className="input w-48 max-w-full"
              value={partyId ?? ""}
              onChange={(e) => setPickedId(e.target.value)}
            >
              {members.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
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

      {data?.warnings.map((w) => (
        <p key={w} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t(WARNING_TEXT[w])}
        </p>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-700">{t("dash.kpi")}</h2>
        {/* Two abreast even on a phone: four figures in a column is a screen
            of scrolling for what fits in two rows. */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
        </div>
      </section>

      <ConsumptionChart
        periods={data?.periods ?? []}
        from={from}
        to={to}
        granularity={granularity}
        empty={!!data && totalKwh === 0}
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
}

/** Hatched fills for the direct-supply bar: same meaning, clearly not the bill paid. */
const hatchId = (key: "grid" | "fixed") => `directHatch-${key}`;

function ConsumptionChart({
  periods,
  from,
  to,
  granularity,
  empty,
}: {
  periods: PartyConsumptionPeriod[];
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
      return {
        ...p,
        label: periodLabel(key, granularity, t("common.total"), granularity === "hourly" && from === to),
        gridEnergyChf: p.rcpCostChf - p.localEnergyChf - p.rcpFixedChf,
        directEnergyChf: p.directCostChf - p.directFixedChf,
      };
    });
  }, [periods, from, to, granularity, t]);

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
              : t("party.chart.noteChf", { unit: periodUnit })) + (showDirect ? ` ${t("party.chart.noteDirect")}` : "")
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
                  {(["grid", "fixed"] as const).map((key) => (
                    <pattern key={key} id={hatchId(key)} patternUnits="userSpaceOnUse" width={5} height={5}
                      patternTransform="rotate(45)">
                      <rect width={5} height={5} fill="#ffffff" />
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
                    <Bar dataKey="localKwh" name={t("party.series.local")} stackId="s"
                      fill={COLORS.local} stroke="#ffffff" strokeWidth={2} {...sizing} />
                    <Bar dataKey="gridKwh" name={t("party.series.grid")} stackId="s"
                      fill={COLORS.grid} stroke="#ffffff" strokeWidth={2} {...sizing}
                      radius={[4, 4, 0, 0]} />
                  </>
                ) : (
                  <>
                    {/* Fixed charges at the bottom: the floor the bill starts
                        from before a single kWh is used — the invoice's per-day
                        positions, pro rata to the days each bar covers. */}
                    <Bar dataKey="rcpFixedChf" name={t("party.series.fixed")} stackId="rcp"
                      fill={COLORS.fixed} stroke="#ffffff" strokeWidth={2} {...sizing} />
                    <Bar dataKey="localEnergyChf" name={t("party.series.localEnergy")} stackId="rcp"
                      fill={COLORS.local} stroke="#ffffff" strokeWidth={2} {...sizing} />
                    <Bar dataKey="gridEnergyChf" name={t("party.series.gridPerKwh")} stackId="rcp"
                      fill={COLORS.grid} stroke="#ffffff" strokeWidth={2} {...sizing}
                      radius={[4, 4, 0, 0]} />
                    {showDirect && (
                      <>
                        <Bar dataKey="directFixedChf" name={t("party.series.directFixed")} stackId="direct"
                          fill={`url(#${hatchId("fixed")})`} stroke={COLORS.fixed} strokeWidth={1}
                          {...sizing} />
                        <Bar dataKey="directEnergyChf" name={t("party.series.directPerKwh")} stackId="direct"
                          fill={`url(#${hatchId("grid")})`} stroke={COLORS.grid} strokeWidth={1}
                          {...sizing} radius={[4, 4, 0, 0]} />
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
      {line(t("party.series.local"), kwh(row.localKwh), COLORS.local)}
      {line(t("party.series.grid"), kwh(row.gridKwh), COLORS.grid)}
      {line(t("party.localShare"), share == null ? "—" : `${share.toFixed(0)} %`)}
      <div className="my-1 border-t" />
      {line(t("party.series.fixed"), chf(row.rcpFixedChf), COLORS.fixed)}
      {line(t("party.series.localEnergy"), chf(row.localEnergyChf), COLORS.local)}
      {line(t("party.series.gridPerKwh"), chf(row.gridEnergyChf), COLORS.grid)}
      {line(t("party.paid"), chf(row.rcpCostChf), undefined, true)}
      <div className="my-1 border-t" />
      {line(t("party.series.directFixed"), chf(row.directFixedChf))}
      {line(t("party.series.directPerKwh"), chf(row.directEnergyChf))}
      {line(t("party.series.direct"), chf(row.directCostChf), undefined, true)}
      <div className="my-1 border-t" />
      {line(t("party.saved"), chf(row.savedChf), undefined, true)}
    </div>
  );
}
