import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FeedInRatePoint, LiveDayCurve, TomorrowForecast } from "@energy-manager/shared";
import { formatKwh, formatNumber } from "../lib/format";
import { api } from "../api/client";
import { PALETTE } from "../lib/palette";
import { useT } from "../i18n/context";
import { InfoTip } from "./InfoTip";
import { LiveCards, hasLiveCards, useLiveView } from "./LiveCards";
import { LiveFlow, hasLiveFlow } from "./LiveFlow";

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

/** A slot's ISO instant to its Europe/Zurich local hour (0–23). */
function zurichHour(iso: string): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return h === "24" ? 0 : Number(h);
}

/**
 * The feed-in rate averaged into the same local hours as the chart's bars.
 *
 * Metering-interval points are finer than an hour; a dynamic rate can change
 * within one, so the average is what actually applies across that hour, not
 * a single sample of it. A point nothing could price (no period covers it,
 * or a dynamic period with nothing from the feed yet) is left out of the
 * average rather than counted as zero.
 */
function hourlyFeedInRate(points: FeedInRatePoint[] | undefined): Map<number, number> | undefined {
  if (!points) return undefined;
  const sums = new Map<number, { total: number; count: number }>();
  for (const point of points) {
    if (point.rateChfPerKwh == null) continue;
    const hour = zurichHour(point.ts);
    const acc = sums.get(hour) ?? { total: 0, count: 0 };
    acc.total += point.rateChfPerKwh;
    acc.count += 1;
    sums.set(hour, acc);
  }
  const out = new Map<number, number>();
  for (const [hour, { total, count }] of sums) out.set(hour, total / count);
  return out;
}

export function LiveSection({
  siteId,
  owner,
}: {
  siteId: string | null | undefined;
  /**
   * The producer's own view: the feed-in rate on the day's curve, and the
   * house's live flow. A participant sees the cards and the curve alone —
   * what the house draws and how full its battery is are the owner's.
   */
  owner: boolean;
}) {
  const showFeedInRate = owner;
  const t = useT();
  const [dayView, setDayView] = useState<"today" | "tomorrow">("today");
  const query = useLiveView(siteId);
  const live = query.data;
  // Both the forecast and the day-ahead rate usually publish only from the
  // evening before, so there is often nothing to switch to yet.
  const showTomorrow = (live?.tomorrow?.hourly.some((h) => h.kwh > 0)) ?? false;

  // Resolved by the same rate resolver the invoice and dashboard price
  // every kWh against, so it can never drift out of step with what the rest
  // of the app shows — and, unlike a reading, covers the whole day: a rate
  // known ahead of time (the day-ahead feed, or a flat period) needs nothing
  // to have been metered yet to be known now.
  const dayRateQuery = useQuery({
    queryKey: ["feed-in-rate", siteId, live?.today?.day],
    queryFn: () => api.savings.feedInRate(siteId!, live!.today!.day),
    enabled: showFeedInRate && !!siteId && !!live?.today,
  });
  // Fetched lazily — only once someone actually switches to it — rather
  // than on every load alongside today's, since most visits never look.
  const tomorrowRateQuery = useQuery({
    queryKey: ["feed-in-rate", siteId, live?.tomorrow?.day],
    queryFn: () => api.savings.feedInRate(siteId!, live!.tomorrow!.day),
    enabled: showFeedInRate && !!siteId && !!live?.tomorrow && dayView === "tomorrow",
  });

  if (!live) return null;
  const feedInRateByHour = showFeedInRate ? hourlyFeedInRate(dayRateQuery.data) : undefined;
  const tomorrowFeedInRateByHour = showFeedInRate ? hourlyFeedInRate(tomorrowRateQuery.data) : undefined;

  // The cards need a live entity each; the day's curve needs none — it
  // reads production from the store and the forecast from Home Assistant's
  // own energy setup. Show whichever the site has, and nothing when it has
  // neither: an unset-up view is not a failure worth shouting about.
  if (!hasLiveCards(live) && !live.today) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">
          {t("party.live")}
          <InfoTip text={t("party.liveNote")} />
        </h2>
      </div>
      <LiveCards live={live} />
      {/* Side by side once there is room: the flow is square, the curve is
          wide, and a full-width square below a full-width chart is a
          screen of scrolling for two things that belong together. */}
      <div className={owner && hasLiveFlow(live) ? "grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : undefined}>
        {owner && hasLiveFlow(live) && <LiveFlow siteId={siteId} live={live} />}
        {live.today && (
          <DayCurveChart
            today={live.today}
            tomorrow={live.tomorrow}
            feedInRateByHour={feedInRateByHour}
            tomorrowFeedInRateByHour={tomorrowFeedInRateByHour}
            showTomorrow={showTomorrow}
            dayView={dayView}
            onDayViewChange={setDayView}
          />
        )}
      </div>
    </section>
  );
}

// The same yellow/blue pair the admin dashboard's revenue chart stacks, with
// the roles the whole app now agrees on (src/lib/palette.ts): what stayed —
// self-consumed plus whatever charged the battery — is the sun's, and what
// left the house crossed the grid meter, so it is grid blue. This used to be
// the other way round, which made blue mean "kept at home" here and "sent to
// the grid" one page over. The forecast is a dashed neutral: a measurement
// and a prediction must not be told apart by hue alone, and a dash reads as
// "expected" without a legend. The still-to-come area is the same neutral,
// faint, so it sits under the line.
const EXPORTED_COLOR = PALETTE.grid;
const KEPT_COLOR = PALETTE.sun;
const FORECAST_COLOR = PALETTE.forecast;
// The forecast colour as it looks over white at a tenth of its strength —
// a real colour rather than the dark one with opacity, because the legend
// swatch is drawn from `fill` alone and would otherwise promise a dark block
// where the chart shows a faint one.
const REMAINING_FILL = PALETTE.forecastFill;
// The app's established green — already validated as adjacent-safe against
// this chart's own orange and blue elsewhere on this page (the "Consumption
// by source" chart below uses the same three), so no need to revalidate it.
const FEED_IN_RATE_COLOR = PALETTE.local;

interface CurvePoint {
  hour: number;
  label: string;
  /** production_hour + batteryCharge_hour — everything the panels made that hour. */
  made: number | null;
  /** What left the house that hour, capped at `made` — see the doc comment below. */
  exported: number | null;
  /** made − exported: self-consumed directly, plus whatever charged the battery. */
  kept: number | null;
  forecast: number | null;
  /** The forecast again, but only from the current hour on — what is still to come. */
  remaining: number | null;
  /** CHF/kWh, averaged from the metering-interval slots inside the hour. */
  feedInRate: number | null;
  partial: boolean;
}

/** One of the small labelled totals beside the chart's own title. */
function DayStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="text-right" title={hint}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/** The Today/Tomorrow segmented toggle, shown only once tomorrow has anything. */
function DayViewToggle({
  view,
  onChange,
}: {
  view: "today" | "tomorrow";
  onChange: (view: "today" | "tomorrow") => void;
}) {
  const t = useT();
  const option = (value: "today" | "tomorrow", label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={view === value}
      className={`px-2 py-1 text-xs font-medium ${
        view === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {option("today", t("party.live.viewToday"))}
      <div className="w-px bg-slate-300" />
      {option("tomorrow", t("party.live.viewTomorrow"))}
    </div>
  );
}

/**
 * Today, hour by hour — bars for what the panels made, a dashed line for
 * what was expected, and the part of the line still ahead shaded in — or,
 * toggled to tomorrow, just the forecast and the feed-in rate already known
 * for it, both usually published from the evening before.
 *
 * Every hour from the first with anything to the last is on the axis, so
 * a gap in the readings shows as a gap and not as time skipped. The hour in
 * progress is drawn with what it has and named as partial in the tooltip:
 * production is only derived once the hour's PV figure arrives, so it will
 * usually look short until the hour ends, and must not read as a cloud.
 */
function DayCurveChart({
  today,
  tomorrow,
  feedInRateByHour,
  tomorrowFeedInRateByHour,
  showTomorrow,
  dayView,
  onDayViewChange,
}: {
  today: LiveDayCurve;
  tomorrow: TomorrowForecast | null;
  /** Undefined for a participant: see LiveSection's `showFeedInRate`. */
  feedInRateByHour?: Map<number, number>;
  tomorrowFeedInRateByHour?: Map<number, number>;
  showTomorrow: boolean;
  dayView: "today" | "tomorrow";
  onDayViewChange: (view: "today" | "tomorrow") => void;
}) {
  const t = useT();
  // Falls back to "today" even if the toggle's own state is still
  // "tomorrow" from an earlier, richer refresh — the toggle only offers
  // "tomorrow" while `showTomorrow` holds, so this never fights the user,
  // only a state that outlived the data behind it.
  const view = showTomorrow ? dayView : "today";
  const rateByHour = view === "today" ? feedInRateByHour : tomorrowFeedInRateByHour;
  const hasRate = (rateByHour?.size ?? 0) > 0;
  const points = useMemo<CurvePoint[]>(() => {
    if (view === "tomorrow") {
      if (!tomorrow) return [];
      const forecast = new Map(tomorrow.hourly.map((h) => [h.hour, h.kwh]));
      const hours = [...forecast.entries()].filter(([, kwh]) => kwh > 0).map(([hour]) => hour);
      if (hours.length === 0) return [];
      const first = Math.min(...hours);
      const last = Math.max(...hours);
      const out: CurvePoint[] = [];
      for (let hour = first; hour <= last; hour++) {
        const f = forecast.get(hour) ?? null;
        out.push({
          hour,
          label: `${String(hour).padStart(2, "0")}:00`,
          made: null,
          exported: null,
          kept: null,
          forecast: f,
          // The whole day is still ahead — unlike today, there is no "so
          // far" to subtract it from.
          remaining: f,
          feedInRate: tomorrowFeedInRateByHour?.get(hour) ?? null,
          partial: false,
        });
      }
      return out;
    }
    const production = new Map(today.actual.map((h) => [h.hour, h.kwh]));
    const charge = new Map(today.batteryCharge.map((h) => [h.hour, h.kwh]));
    const exportedLocal = new Map(today.exportedLocal.map((h) => [h.hour, h.kwh]));
    const forecast = new Map(today.forecast.map((h) => [h.hour, h.kwh]));
    // The axis runs from the first hour with anything in it to the last. A
    // night hour that only reports zero — the store says so for every hour
    // since midnight — is not "anything": it would pin the axis to 00:00 and
    // squeeze the day into its right-hand half. The feed-in rate follows this
    // same window rather than stretching it: it is drawn only where it
    // overlaps production or forecast, not as a reason to widen either.
    const hours = [...production.entries(), ...charge.entries(), ...exportedLocal.entries(), ...forecast.entries()]
      .filter(([, kwh]) => kwh > 0)
      .map(([hour]) => hour);
    if (hours.length === 0) return [];
    const first = Math.min(...hours);
    const last = Math.max(...hours);
    const out: CurvePoint[] = [];
    for (let hour = first; hour <= last; hour++) {
      const prod = production.get(hour);
      const made = prod == null ? null : prod + (charge.get(hour) ?? 0);
      // Capped at `made`, not taken as-is: a heavier-cycling day could
      // export more in an hour than the panels made in it, by discharging
      // what an earlier hour charged — see LiveDayCurve.exportedLocal. The
      // cap is what keeps "kept" (made − exported) from going negative.
      const exported = made == null ? null : Math.min(exportedLocal.get(hour) ?? 0, made);
      const kept = made == null || exported == null ? null : made - exported;
      const f = forecast.get(hour) ?? null;
      out.push({
        hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        made,
        exported,
        kept,
        forecast: f,
        remaining: hour >= today.currentHour ? f : null,
        feedInRate: feedInRateByHour?.get(hour) ?? null,
        partial: hour === today.currentHour,
      });
    }
    return out;
  }, [view, today, tomorrow, feedInRateByHour, tomorrowFeedInRateByHour]);
  if (points.length === 0) return null;

  // What the panels made today, one figure: production (AC delivered) plus
  // whatever charged the battery (DC, so production alone never counted it —
  // see LiveDayCurve.batteryCharge). The same "production + charging" figure
  // the admin dashboard's own line shows, so the two never disagree.
  const producedKwh = today.actual.reduce((sum, h) => sum + h.kwh, 0);
  const batteryChargeKwh = today.batteryCharge.reduce((sum, h) => sum + h.kwh, 0);
  const exportedKwh = today.exportedLocal.reduce((sum, h) => sum + h.kwh, 0);
  const madeKwh = producedKwh + batteryChargeKwh;
  const forecastKwh = (view === "tomorrow" ? (tomorrow?.hourly ?? []) : today.forecast).reduce(
    (sum, h) => sum + h.kwh,
    0,
  );

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-slate-900">
            {t(view === "tomorrow" ? "party.live.tomorrowChart" : "party.live.chart")}
            <InfoTip text={t(view === "tomorrow" ? "party.live.tomorrowChartNote" : "party.live.chartNote")} />
          </p>
          {showTomorrow && <DayViewToggle view={view} onChange={onDayViewChange} />}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {view === "today" && (
            <>
              <DayStat label={t("party.live.madeToday")} hint={t("party.live.madeTodayHint")} value={`${formatKwh(madeKwh)} kWh`} />
              <DayStat label={t("party.live.leftHouse")} value={`${formatKwh(exportedKwh)} kWh`} />
            </>
          )}
          <DayStat label={t("party.live.forecastTotal")} value={`${formatKwh(forecastKwh)} kWh`} />
        </div>
      </div>
      <div className="mt-3 h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.gridline} vertical={false} />
            {/* "preserveStartEnd" thins by the space actually rendered, rather
                than a fixed count: a summer day's 14 hours fit at desktop
                width and ran together at 390px, where a fixed "show every
                one under 14" interval showed all of them regardless. */}
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={40} domain={[0, "auto"]} tickFormatter={(v: number) => formatKwh(v)} />
            {/* Both domains start at exactly 0, so the zero line lands on the
                same pixel row for both axes without any further alignment —
                unlike the revenue chart's, neither can go negative. */}
            {hasRate && (
              <YAxis
                yAxisId="rate"
                orientation="right"
                tick={{ fontSize: 11, fill: PALETTE.axis }}
                width={48}
                domain={[0, "auto"]}
                tickFormatter={(v: number) => formatNumber(v, 2)}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as CurvePoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium text-slate-900">
                      {p.label}
                      {p.partial ? ` · ${t("party.live.partial")}` : ""}
                    </p>
                    {view === "today" && (
                      <>
                        <p className="text-slate-600">
                          {t("party.live.madeToday")}:{" "}
                          <span className="font-semibold text-slate-900">
                            {p.made == null ? "—" : `${formatKwh(p.made, 2)} kWh`}
                          </span>
                        </p>
                        <p className="pl-2 text-slate-500">
                          {t("party.live.leftHouse")}: {p.exported == null ? "—" : `${formatKwh(p.exported, 2)} kWh`}
                        </p>
                        <p className="pl-2 text-slate-500">
                          {t("party.live.keptAtHome")}: {p.kept == null ? "—" : `${formatKwh(p.kept, 2)} kWh`}
                        </p>
                      </>
                    )}
                    <p className="mt-1 text-slate-600">
                      {t("party.live.forecast")}:{" "}
                      <span className="font-semibold text-slate-900">
                        {p.forecast == null ? "—" : `${formatKwh(p.forecast, 2)} kWh`}
                      </span>
                    </p>
                    {hasRate && (
                      <p className="mt-1 text-slate-600">
                        {t("calc.col.feedInRate")}:{" "}
                        <span className="font-semibold text-slate-900">
                          {p.feedInRate == null ? "—" : `${formatNumber(p.feedInRate, 3)} CHF/kWh`}
                        </span>
                      </p>
                    )}
                  </div>
                );
              }}
            />
            {/* Labels in ink, not in the series colour recharts defaults to:
                the faint "still expected" tint is unreadable as text, and
                identity is the swatch's job. */}
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) => <span className="text-slate-600">{value}</span>}
            />
            <Area
              type="monotone"
              dataKey="remaining"
              name={t("party.live.stillExpected")}
              stroke="none"
              fill={REMAINING_FILL}
              // A square, not the line-and-dot recharts gives an area, which
              // would be the forecast's own icon twice over.
              legendType="rect"
              isAnimationActive={false}
              connectNulls={false}
            />
            {/* Stacked to the height of "Made": what left the house at the
                foot, the same colour and position the single bar used to
                have, and what stayed — self-consumed plus whatever charged
                the battery — on top of it. Only the top segment is rounded,
                as one bar rather than two independently-cornered blocks.
                Tomorrow has no bars at all: nothing has happened yet. */}
            {view === "today" && (
              <>
                <Bar
                  dataKey="exported"
                  name={t("party.live.leftHouse")}
                  stackId="made"
                  fill={EXPORTED_COLOR}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="kept"
                  name={t("party.live.keptAtHome")}
                  stackId="made"
                  fill={KEPT_COLOR}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </>
            )}
            <Line
              type="monotone"
              dataKey="forecast"
              name={t("party.live.forecast")}
              stroke={FORECAST_COLOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            {hasRate && (
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="feedInRate"
                name={t("calc.col.feedInRate")}
                stroke={FEED_IN_RATE_COLOR}
                strokeWidth={2}
                // Often covers only part of the window — early in the day, or
                // early in the evening for tomorrow — which can be a single
                // point, which a bare line (no dot) would draw as nothing at
                // all.
                dot={{ r: 2, fill: FEED_IN_RATE_COLOR, strokeWidth: 0 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
