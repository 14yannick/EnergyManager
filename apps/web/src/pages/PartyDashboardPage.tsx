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
import { useSelectedPeriod } from "../lib/usePeriod";
import { useT, type MessageKey } from "../i18n/context";
import { useIdentity } from "../lib/useIdentity";
import { useDefaultSite } from "../lib/useDefaultSite";
import { PeriodControls } from "../components/PeriodControls";
import { StatCard } from "../components/StatCard";
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

// Categorical slots of the dashboard's palette: orange for the standing
// charges, green for what came from the site's own panels, blue for the grid.
// Validated as a stack in that order, bottom to top.
const COLORS = { local: "#1baf7a", grid: "#2a78d6", fixed: "#eb6834" };

const WARNING_TEXT: Record<PartyConsumptionWarning, MessageKey> = {
  no_positions: "party.warn.noPositions",
  no_local_rate: "party.warn.noLocalRate",
};

/** Share of consumption supplied locally, in percent; null when nothing was consumed. */
const localShare = (p: Pick<PartyConsumptionPeriod, "localKwh" | "gridKwh">) => {
  const total = p.localKwh + p.gridKwh;
  return total > 0 ? (p.localKwh / total) * 100 : null;
};

const kwh = (v: number) => `${v.toFixed(v >= 100 ? 0 : 1)} kWh`;

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

  const { from, to, granularity, set: setPeriod } = useSelectedPeriod();

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

  return (
    <div className="space-y-6">
      {/* Above the title on purpose: it is the one thing on this page that is
          true only right now, so it should not need scrolling past to reach. */}
      <LiveSection siteId={siteId} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t("party.title")}</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            {t("party.intro", { name: data?.partyName ?? identity.data?.partyName ?? "…" })}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3 text-sm">
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
            onChange={setPeriod}
            dataRange={dataRange}
            bounds={bounds}
          />
        </div>
      </div>


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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t("party.kpi.saved")}
            // The figure the page exists to answer, so it leads and stands out.
            // Green only while it is a saving: a negative one is not good news.
            emphasis={totals != null && totals.savedChf > 0 ? "positive" : "strong"}
            hint={t("party.kpi.savedHint")}
            value={totals?.savedChf}
            sub={totals ? t("party.kpi.savedSub", { direct: totals.directCostChf.toFixed(2) }) : undefined}
          />
          <StatCard
            label={t("party.kpi.total")}
            value={totals ? totalKwh : undefined}
            format={kwh}
            sub={
              totals
                ? t("party.kpi.totalSub", { local: totals.localKwh.toFixed(1), grid: totals.gridKwh.toFixed(1) })
                : undefined
            }
          />
          <StatCard
            label={t("party.kpi.localShare")}
            value={share}
            format={(v) => `${v.toFixed(0)} %`}
            sub={totals ? t("party.kpi.localShareSub", { kwh: totals.localKwh.toFixed(1) }) : undefined}
          />
          <StatCard
            label={t("party.kpi.cost")}
            value={totals?.rcpCostChf}
            sub={
              totals && totalKwh > 0
                ? t("party.kpi.costSub", {
                    rate: ((totals.rcpCostChf / totalKwh) * 100).toFixed(1),
                    cents: t("billing.cents"),
                  })
                : undefined
            }
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

/**
 * What the site is doing right now, and what the day still holds — the
 * question a participant actually acts on: is there cheap local energy
 * about, now or later today.
 *
 * Read live from Home Assistant on each poll and never stored; the history
 * below it is what the metering already records. Figures are shown only
 * where their sensor is configured and readable, so a partial setup shows
 * what it has rather than a row of dashes.
 */
/**
 * Below this, feed-in is meter noise rather than something a participant could
 * actually use — a few tens of watts drift across zero all night. Calling that
 * "surplus available" would send somebody to start a machine on nothing.
 */
const SURPLUS_FLOOR_W = 100;

function LiveSection({ siteId }: { siteId: string | null | undefined }) {
  const t = useT();
  const query = useQuery({
    queryKey: ["ha-live", siteId],
    queryFn: () => api.homeAssistant.live(siteId!),
    enabled: !!siteId,
    // Inverter readings move by the second; a minute is close enough to
    // "now" for deciding whether to put the washing on, and gentle on both
    // Home Assistant and the browser.
    refetchInterval: 60 * 1000,
  });

  const live = query.data;
  // Nothing configured is not a failure worth shouting about — the view just
  // isn't set up, and the admin is told where to do it.
  if (!live || !live.configured) return null;

  const hasAny =
    live.exportW != null ||
    live.pvW != null ||
    live.forecastTodayKwh != null ||
    live.forecastRemainingKwh != null ||
    live.forecastTomorrowKwh != null;
  if (!hasAny) return null;

  const kw = (w: number) => `${(w / 1000).toFixed(2)} kW`;
  const kwh = (v: number) => `${v.toFixed(1)} kWh`;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t("party.live")}</h2>
        <p className="text-xs text-slate-500">{t("party.liveNote")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {live.exportW != null && (
          <LiveCard
            label={t("party.live.exporting")}
            // The feed-in sensor swings negative when the house is drawing from
            // the grid, but a card titled "exporting" cannot show a negative:
            // nothing is leaving, so nothing is what it says.
            value={kw(Math.max(live.exportW, 0))}
            sub={
              live.exportW >= SURPLUS_FLOOR_W
                ? t("party.live.exportingSub")
                : t("party.live.exportingNone")
            }
            highlight={live.exportW >= SURPLUS_FLOOR_W}
          />
        )}
        {live.pvW != null && <LiveCard label={t("party.live.pv")} value={kw(live.pvW)} />}
        {live.forecastRemainingKwh != null && (
          <LiveCard
            label={t("party.live.remaining")}
            value={kwh(live.forecastRemainingKwh)}
            sub={
              live.forecastTodayKwh != null
                ? t("party.live.ofToday", { total: live.forecastTodayKwh.toFixed(1) })
                : undefined
            }
          />
        )}
        {live.forecastTomorrowKwh != null && (
          <LiveCard label={t("party.live.tomorrow")} value={kwh(live.forecastTomorrowKwh)} />
        )}
      </div>
    </section>
  );
}

function LiveCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${highlight ? "text-emerald-700" : "text-slate-900"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
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
        label: periodLabel(key, granularity, t("common.total")),
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
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("party.chart.title")}</h2>
        <p className="mt-1 text-xs text-slate-500">
          {unit === "kwh"
            ? t("party.chart.noteKwh", { unit: periodUnit })
            : t("party.chart.noteChf", { unit: periodUnit })}
          {showDirect && ` ${t("party.chart.noteDirect")}`}
        </p>
      </div>

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
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
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

  const chf = (v: number) => `CHF ${v.toFixed(2)}`;
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
