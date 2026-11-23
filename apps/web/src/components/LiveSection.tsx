import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
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
import { rateBand, rateGradientStops, type FeedInRatePoint, type HourKwh, type LiveDayCurve, type PowerSample, type RateBand, type TomorrowForecast } from "@energy-manager/shared";
import { formatKwh, formatNumber } from "../lib/format";
import { api } from "../api/client";
import { PALETTE } from "../lib/palette";
import { useT } from "../i18n/context";
import { InfoTip } from "./InfoTip";
import { LiveCards, hasLiveCards, ownDrawOf, useLiveView, type DayMoney } from "./LiveCards";
import { LiveFlow, hasLiveFlow } from "./LiveFlow";
import { VzevFlow, useVzevLive } from "./VzevFlow";
import { rateAxisTicks } from "../lib/rateAxis";

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
function hourlyRate(
  points: FeedInRatePoint[] | undefined,
  key: "rateChfPerKwh" | "purchaseRateChfPerKwh",
): Map<number, number> | undefined {
  if (!points) return undefined;
  const sums = new Map<number, { total: number; count: number }>();
  for (const point of points) {
    const rate = point[key];
    if (rate == null) continue;
    const hour = zurichHour(point.ts);
    const acc = sums.get(hour) ?? { total: 0, count: 0 };
    acc.total += rate;
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
  flow,
  partyId,
  switchable = false,
  dayPartyId,
  earnings = false,
}: {
  siteId: string | null | undefined;
  /**
   * Whether the viewer may see what is the producer's alone: the feed-in
   * rate on the day's curve. A participant sees the cards and the curve
   * without it.
   */
  owner: boolean;
  /**
   * Which picture of the instant to draw beside the day's curve: the
   * plant's own (panels, battery, house — the Dashboard's), or the vZEV's
   * (what was fed in and who took it — a participant's).
   */
  flow: "plant" | "vzev";
  /**
   * For the vZEV's picture, whose it is — an admin looking at one
   * participant's page. A participant passes none: the API shows them
   * their own.
   */
  partyId?: string | null;
  /**
   * Whether the viewer may switch between the two pictures — a producer
   * with the plant's live sensors mapped, who is in both. `flow` is then
   * only where it starts.
   */
  switchable?: boolean;
  /**
   * Whose day in money to show beside the live figures: the member whose
   * page this is. A participant passes their own; the API allows nothing
   * else.
   */
  dayPartyId?: string | null;
  /**
   * Whether that member's day is told as a producer's earnings (the
   * plant's, which only the owner and the admins may see) rather than as
   * the vZEV's advantage on their bill.
   */
  earnings?: boolean;
}) {
  const showFeedInRate = owner;
  const t = useT();
  const [dayView, setDayView] = useState<"today" | "tomorrow">("today");
  const [flowView, setFlowView] = useState(flow);
  // Back to the given picture when the page moves on to another party.
  useEffect(() => setFlowView(flow), [flow, siteId, partyId]);
  const query = useLiveView(siteId);
  const live = query.data;
  // The viewed member's own draw, from the same request the vZEV's picture
  // makes — whichever picture is shown.
  const own = ownDrawOf(useVzevLive(siteId, partyId).data);

  // Today in money. "Today" is the site's day, as the curve below has it;
  // before the curve has loaded, the same day read in the site's zone.
  const day =
    live?.today?.day ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Both refresh every five minutes: they move with the metering sync, not
  // by the second like the power figures.
  const dayConsumption = useQuery({
    queryKey: ["party-consumption", siteId, dayPartyId, day, day, "overall"],
    queryFn: () => api.parties.consumption(siteId!, dayPartyId!, day, day, "overall"),
    enabled: !!siteId && !!dayPartyId,
    refetchInterval: 5 * 60 * 1000,
  });
  const dayEarnings = useQuery({
    queryKey: ["savings-summary", siteId, day, day, "daily"],
    queryFn: () => api.savings.summary(siteId!, day, day, "daily"),
    enabled: !!siteId && earnings,
    refetchInterval: 5 * 60 * 1000,
  });
  const costs = dayConsumption.data?.totals;
  const money: DayMoney | null =
    !dayPartyId || (!costs && !dayEarnings.data)
      ? null
      : {
          kind: earnings ? "earning" : "advantage",
          valueChf: earnings ? (dayEarnings.data?.totals.withBatteryChf ?? null) : (costs?.savedChf ?? null),
          costChf: costs?.rcpCostChf ?? null,
        };
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
  const feedInRateByHour = showFeedInRate ? hourlyRate(dayRateQuery.data, "rateChfPerKwh") : undefined;
  const purchaseRateByHour = showFeedInRate ? hourlyRate(dayRateQuery.data, "purchaseRateChfPerKwh") : undefined;

  // The cards need a live entity each; the day's curve needs none — it
  // reads production from the store and the forecast from Home Assistant's
  // own energy setup. Show whichever the site has, and nothing when it has
  // neither: an unset-up view is not a failure worth shouting about.
  if (!hasLiveCards(live) && !own && !money && !live.today) return null;
  // The plant's picture needs its live sensors; without them there is only
  // the vZEV's, and nothing to switch between.
  const canSwitch = switchable && hasLiveFlow(live);
  const shown = canSwitch ? flowView : flow;
  const hasFlow = shown === "vzev" || hasLiveFlow(live);
  const flowToggle = canSwitch ? (
    <SegmentedToggle
      value={shown}
      onChange={setFlowView}
      options={[
        { value: "plant", label: t("party.live.viewPlant") },
        { value: "vzev", label: t("party.live.viewVzev") },
      ]}
    />
  ) : null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">
          {t("party.live")}
          <InfoTip text={t("party.liveNote")} />
        </h2>
      </div>
      <LiveCards live={live} own={own} money={money} />
      {/* Side by side once there is room: the flow is square, the curve is
          wide, and a full-width square below a full-width chart is a
          screen of scrolling for two things that belong together. */}
      <div className={hasFlow ? "grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : undefined}>
        {/* Two pictures of the same instant. The plant's — panels, battery,
            house — is the producer's, on the Dashboard. The vZEV's — what
            was fed in and who took it — is every participant's. */}
        {shown === "plant" && hasLiveFlow(live) && <LiveFlow siteId={siteId} live={live} tools={flowToggle} />}
        {shown === "vzev" && <VzevFlow siteId={siteId} partyId={partyId} tools={flowToggle} />}
        {live.today && (
          <DayCurveChart
            today={live.today}
            tomorrow={live.tomorrow}
            feedInRateByHour={feedInRateByHour}
            purchaseRateByHour={purchaseRateByHour}
            ratePoints={showFeedInRate ? dayRateQuery.data : undefined}
            tomorrowRatePoints={showFeedInRate ? tomorrowRateQuery.data : undefined}
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
/**
 * The feed-in rate line is painted by how good the rate is at each height
 * (shared/feedInBands.ts): a loss, poor, fair, good, and better than
 * buying. The fair grey is the chart's neutral; the good green is the
 * app's established local green.
 */
const RATE_COLORS: Record<RateBand, string> = {
  loss: PALETTE.rateLoss,
  poor: PALETTE.ratePoor,
  fair: PALETTE.rateFair,
  good: PALETTE.rateGood,
  best: PALETTE.rateBest,
};

interface CurvePoint {
  hour: number;
  label: string;
  /** production_hour + batteryCharge_hour — everything the panels made that hour. */
  made: number | null;
  /** What left the house that hour — from the panels or out of the battery, see the doc comment below. */
  exported: number | null;
  /** made − exported, floored at zero: self-consumed directly, plus whatever charged the battery. */
  kept: number | null;
  forecast: number | null;
  /** The forecast again, but only from the current hour on — what is still to come. */
  remaining: number | null;
  /** CHF/kWh, averaged from the metering-interval slots inside the hour. */
  feedInRate: number | null;
  /** What buying a kWh costs that hour — the bar the feed-in rate's colour is set against. */
  purchaseRate: number | null;
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

/** A row of exclusive choices, the chosen one filled in. */
function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {options.map((o, i) => (
        <span key={o.value} className="inline-flex">
          {i > 0 && <span className="w-px bg-slate-300" />}
          <button
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`px-2 py-1 text-xs font-medium ${
              value === o.value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {o.label}
          </button>
        </span>
      ))}
    </div>
  );
}

/** The Today/Tomorrow toggle, shown only once tomorrow has anything. */
function DayViewToggle({
  view,
  onChange,
}: {
  view: "today" | "tomorrow";
  onChange: (view: "today" | "tomorrow") => void;
}) {
  const t = useT();
  return (
    <SegmentedToggle
      value={view}
      onChange={onChange}
      options={[
        { value: "today", label: t("party.live.viewToday") },
        { value: "tomorrow", label: t("party.live.viewTomorrow") },
      ]}
    />
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
interface LegendEntry {
  value?: string;
  color?: string;
  type?: string;
  dataKey?: string | number;
}

/**
 * The chart's own legend, for one reason: the rate line is painted by band,
 * and a swatch drawn from its `stroke` — a gradient defined inside the
 * chart's SVG — resolves to nothing in the legend's own. So the rate's
 * swatch is the gradient again, drawn here, and reads as what the line
 * is: the bands from best down to loss. Labels in ink, not the series
 * colour, as everywhere.
 */
function DayLegend({ payload }: { payload?: readonly LegendEntry[] }) {
  const id = useId().replace(/:/g, "");
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-2 pt-3 text-xs text-slate-600">
      {(payload ?? []).map((entry) => {
        const key = String(entry.dataKey ?? entry.value);
        const isRate = entry.dataKey === "feedInRate";
        return (
          <li key={key} className="flex items-center gap-1.5">
            <svg width={16} height={10} aria-hidden="true" className="shrink-0">
              {isRate ? (
                <>
                  <defs>
                    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                      {/* The bands the line can wear, best to loss, whether or
                          not today's line reaches them — so the swatch is a
                          key, not a copy of today. */}
                      {(["best", "good", "fair", "poor", "loss"] as const).map((band, i) => (
                        <stop key={band} offset={`${i * 25}%`} stopColor={RATE_COLORS[band]} />
                      ))}
                    </linearGradient>
                  </defs>
                  {/* A thin rect, not a line: a gradient is mapped onto its
                      shape's own box, and a horizontal line's box has no
                      height, which SVG treats as nothing to paint. */}
                  <rect x={0} y={3.5} width={16} height={3} rx={1.5} fill={`url(#${id})`} />
                </>
              ) : entry.type === "line" ? (
                <line x1={0} y1={5} x2={16} y2={5} stroke={entry.color} strokeWidth={2} strokeDasharray="4 2" />
              ) : (
                <rect x={2} y={0} width={12} height={10} rx={2} fill={entry.color} />
              )}
            </svg>
            {entry.value}
          </li>
        );
      })}
    </ul>
  );
}

interface RateDotProps {
  key?: string;
  cx?: number;
  cy?: number;
  value?: number;
}

function DayCurveChart({
  today,
  tomorrow,
  feedInRateByHour,
  purchaseRateByHour,
  ratePoints,
  tomorrowRatePoints,
  showTomorrow,
  dayView,
  onDayViewChange,
}: {
  today: LiveDayCurve;
  /** Today's feed-in rate at its own grain, for the 5-minute view. Undefined for a participant. */
  ratePoints?: FeedInRatePoint[];
  /** Tomorrow's, likewise. */
  tomorrowRatePoints?: FeedInRatePoint[];
  tomorrow: TomorrowForecast | null;
  /** Undefined for a participant: see LiveSection's `showFeedInRate`. */
  feedInRateByHour?: Map<number, number>;
  purchaseRateByHour?: Map<number, number>;
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
  // The finer picture whenever Home Assistant has it: today's needs the live
  // sensors' readings, and the hours stay as its fallback without them.
  // Tomorrow's needs none — a forecast and the rate, both already known.
  const fine =
    view === "tomorrow" ? !!tomorrow : today.power.some((s) => (s.pvW ?? 0) > 0 || (s.exportW ?? 0) > 0);
  // The hours below are today's fallback only: tomorrow is always drawn finer.
  const hasRate = (feedInRateByHour?.size ?? 0) > 0;
  const points = useMemo<CurvePoint[]>(() => {
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
      // Taken as-is, not capped at `made`: an hour can export more than the
      // panels made in it when the battery discharges what an earlier hour
      // charged — see LiveDayCurve.exportedLocal. That energy is available
      // to the vZEV all the same, so it belongs in the bar; the bar then
      // stands taller than the hour's own production, which is the point.
      // What it cannot do is pull "kept" below zero.
      const exported = made == null ? null : (exportedLocal.get(hour) ?? 0);
      const kept = made == null || exported == null ? null : Math.max(made - exported, 0);
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
        purchaseRate: purchaseRateByHour?.get(hour) ?? null,
        partial: hour === today.currentHour,
      });
    }
    return out;
  }, [today, feedInRateByHour, purchaseRateByHour]);

  // The gradient that paints the rate line by band. Against the day's
  // purchase price (constant within a day: periods change at midnight),
  // over the line's own vertical extent — see rateGradientStops.
  const gradientId = useId().replace(/:/g, "");
  const rates = points.map((p) => p.feedInRate).filter((r): r is number => r != null);
  const purchase = points.find((p) => p.purchaseRate != null)?.purchaseRate ?? null;
  const rateStops = rates.length > 0 ? rateGradientStops(Math.min(...rates), Math.max(...rates), purchase) : [];
  // A flat line has no box to paint a gradient over; its one band is a plain colour.
  const flat = rates.length > 0 && Math.max(...rates) - Math.min(...rates) <= 0;
  const rateStroke = flat ? RATE_COLORS[rateStops[0]!.band] : `url(#${gradientId})`;
  const rateColorOf = (rate: number | null) => (rate == null ? undefined : RATE_COLORS[rateBand(rate, purchase)]);
  const rateTicks = rateAxisTicks(rates);
  if (points.length === 0) return null;

  // What the panels made and what was available today are in the
  // "Made today" tile above (LiveCards); the header keeps the forecast.
  const forecastKwh = (view === "tomorrow" ? (tomorrow?.hourly ?? []) : today.forecast).reduce(
    (sum, h) => sum + h.kwh,
    0,
  );

  return (
    // As tall as the row it sits in: beside the flow picture, which is often
    // the taller of the two, the chart takes the height that is there rather
    // than leaving it empty under a fixed one.
    <div className="flex h-full flex-col rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-slate-900">
            {t(view === "tomorrow" ? "party.live.tomorrowChart" : fine ? "party.live.chartFine" : "party.live.chart")}
            <InfoTip
              text={t(
                view === "tomorrow" ? "party.live.tomorrowChartNote" : fine ? "party.live.chartFineNote" : "party.live.chartNote",
              )}
            />
          </p>
          {showTomorrow && <DayViewToggle view={view} onChange={onDayViewChange} />}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <DayStat label={t("party.live.forecastTotal")} value={`${formatKwh(forecastKwh)} kWh`} />
        </div>
      </div>
      {/* Grows into the card's spare height; never shorter than it was on its own. */}
      <div className="mt-3 h-56 min-h-56 flex-1 sm:h-64 sm:min-h-64 xl:h-auto">
        {fine ? (
          view === "tomorrow" ? (
            <PowerDayChart day={tomorrow!.day} forecast={tomorrow!.hourly} power={[]} ratePoints={tomorrowRatePoints} />
          ) : (
            <PowerDayChart day={today.day} forecast={today.forecast} power={today.power} ratePoints={ratePoints} />
          )
        ) : (
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
                  // A fixed window in 5 ct. steps, so the same rate reads at the
                  // same height day after day; only a rate outside it moves an
                  // end, to the next step.
                  domain={[rateTicks[0]!, rateTicks[rateTicks.length - 1]!]}
                  ticks={rateTicks}
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
                          <span className="font-semibold text-slate-900" style={{ color: rateColorOf(p.feedInRate) }}>
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
              <Legend content={<DayLegend />} />
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
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    {rateStops.map((s, i) => (
                      <stop key={i} offset={`${(s.offset * 100).toFixed(3)}%`} stopColor={RATE_COLORS[s.band]} />
                    ))}
                  </linearGradient>
                </defs>
              )}
              {hasRate && (
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="feedInRate"
                  name={t("calc.col.feedInRate")}
                  stroke={rateStroke}
                  strokeWidth={2}
                  // Often covers only part of the window — early in the day, or
                  // early in the evening for tomorrow — which can be a single
                  // point, which a bare line (no dot) would draw as nothing at
                  // all. Each dot wears its own hour's band: a gradient over a
                  // dot's own tiny box would not.
                  dot={(props: unknown) => {
                    const p = props as RateDotProps;
                    return <circle key={p.key} cx={p.cx} cy={p.cy} r={2.5} fill={rateColorOf(p.value ?? null)} />;
                  }}
                  activeDot={(props: unknown) => {
                    const p = props as RateDotProps;
                    return <circle key={p.key} cx={p.cx} cy={p.cy} r={4} fill={rateColorOf(p.value ?? null)} />;
                  }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/** An instant in the site's zone to "HH:MM". */
function zurichClock(t: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
}

/**
 * The instant a local wall-clock time on `day` falls on, in the site's zone.
 * Read as UTC first, then moved by the zone's offset at that instant — twice,
 * so an hour beside a DST switch still lands on the right side of it.
 */
function zurichInstant(day: string, hour: number, minute = 0): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const seen = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    t += wall - seen;
  }
  return t;
}

interface PowerRow {
  t: number;
  /** kW: the panels' output — a 5-minute mean, or the live reading for the last row. */
  pv: number | null;
  /** kW: leaving the house, floored at zero. */
  exp: number | null;
  /** kW: pv − exp, floored at zero — stacked on `exp`, so the stack's top is production. */
  kept: number | null;
  /** True for a reading's own row; pv/exp elsewhere are interpolated, so the stack has no holes. */
  sampled: boolean;
  /** kW: the hour's forecast as its mean power, at the hour's middle only. */
  forecast: number | null;
  /** The forecast again, from the hour in progress on. */
  remaining: number | null;
  /** CHF/kWh, at each rate point's own instant only; the line steps between them. */
  feedInRate: number | null;
}

/** Below this the panels are taken as dark: a sensor's idle noise is not a sunrise. */
const PV_ON_KW = 0.02;

/**
 * Today at the grain Home Assistant keeps — 5-minute means of the panels'
 * power and of what leaves the house — in place of the hourly bars, when
 * the live sensors are there. The forecast is hourly energy, which over an
 * hour is that hour's mean power: the same number, drawn at the hour's
 * middle on the same kW axis. The feed-in rate steps at each of its own
 * points (a quarter-hour with the dynamic feed), not averaged into hours.
 */
function PowerDayChart({
  day,
  forecast,
  power,
  ratePoints,
}: {
  /** YYYY-MM-DD, the site's local day drawn. */
  day: string;
  forecast: HourKwh[];
  /** The readings so far — none for tomorrow, which is all still ahead. */
  power: PowerSample[];
  /** Undefined for a participant: see LiveSection's `showFeedInRate`. */
  ratePoints?: FeedInRatePoint[];
}) {
  const t = useT();
  const gradientId = useId().replace(/:/g, "");

  const model = useMemo(() => {
    const forecastByHour = new Map(forecast.map((h) => [h.hour, h.kwh]));
    const samples = power.map((s) => ({
      t: Date.parse(s.ts),
      pv: s.pvW == null ? null : s.pvW / 1000,
      exp: s.exportW == null ? null : s.exportW / 1000,
    }));
    // The window: from the first instant with anything in it — sun, or a
    // forecast hour — to the last, on whole hours, so a night of zeros does
    // not squeeze the day into a corner (as the hourly chart does).
    const lit = samples.filter((s) => (s.pv ?? 0) > PV_ON_KW || (s.exp ?? 0) > PV_ON_KW).map((s) => s.t);
    const forecastHours = [...forecastByHour.entries()].filter(([, kwh]) => kwh > 0).map(([h]) => h);
    const starts = [...lit, ...forecastHours.map((h) => zurichInstant(day, h))];
    const ends = [...lit, ...forecastHours.map((h) => zurichInstant(day, h + 1))];
    if (starts.length === 0) return null;
    const hourMs = 60 * 60 * 1000;
    const start = Math.floor(Math.min(...starts) / hourMs) * hourMs;
    const end = Math.ceil(Math.max(...ends) / hourMs) * hourMs;

    const rows = new Map<number, PowerRow>();
    const row = (at: number): PowerRow => {
      let r = rows.get(at);
      if (!r) {
        r = { t: at, pv: null, exp: null, kept: null, sampled: false, forecast: null, remaining: null, feedInRate: null };
        rows.set(at, r);
      }
      return r;
    };
    for (const s of samples) {
      if (s.t < start || s.t > end) continue;
      const r = row(s.t);
      r.pv = s.pv;
      r.exp = s.exp;
      r.sampled = true;
    }
    // What is still to come starts at the last reading — "now" — not at the
    // next hour's middle: the forecast's straight line between the two
    // middles around it gives its height there.
    const lastRead = samples.length > 0 ? samples[samples.length - 1]!.t : null;
    const middles = [...forecastByHour.entries()]
      .map(([hour, kwh]) => ({ at: zurichInstant(day, hour, 30), kwh }))
      .sort((x, y) => x.at - y.at);
    for (const { at, kwh } of middles) {
      if (at < start || at > end) continue;
      const r = row(at);
      r.forecast = kwh;
      r.remaining = lastRead == null || at >= lastRead ? kwh : null;
    }
    const after = middles.findIndex((m) => lastRead != null && m.at > lastRead);
    if (lastRead != null && after > 0) {
      const x = middles[after - 1]!;
      const y = middles[after]!;
      row(lastRead).remaining = x.kwh + ((y.kwh - x.kwh) * (lastRead - x.at)) / (y.at - x.at);
    }
    const rates = (ratePoints ?? [])
      .map((p) => ({ t: Date.parse(p.ts), rate: p.rateChfPerKwh, purchase: p.purchaseRateChfPerKwh }))
      .filter((p): p is { t: number; rate: number; purchase: number | null } => p.rate != null && p.t >= start && p.t < end)
      .sort((a, b) => a.t - b.t);
    for (const p of rates) row(p.t).feedInRate = p.rate;
    // The last rate holds to the window's end, so its step is drawn too.
    if (rates.length > 0) row(end).feedInRate = rates[rates.length - 1]!.rate;

    // A stacked area takes a missing value for zero, so a forecast or rate
    // row between two readings would cut a notch to the axis: give it the
    // readings' straight line instead. After the last reading there is none.
    const sorted = [...rows.values()].sort((a, b) => a.t - b.t);
    const read = sorted.filter((r) => r.sampled);
    for (let i = 0, j = 0; i < sorted.length; i++) {
      const r = sorted[i]!;
      while (j < read.length && read[j]!.t < r.t) j++;
      if (!r.sampled && j > 0 && j < read.length) {
        const a = read[j - 1]!;
        const b = read[j]!;
        const w = (r.t - a.t) / (b.t - a.t);
        const lerp = (x: number | null, y: number | null) => (x == null || y == null ? null : x + (y - x) * w);
        r.pv = lerp(a.pv, b.pv);
        r.exp = lerp(a.exp, b.exp);
      }
      r.kept = r.pv == null ? null : Math.max(r.pv - (r.exp ?? 0), 0);
    }

    const span = (end - start) / hourMs;
    const step = span > 10 ? 2 : 1;
    const ticks: number[] = [];
    for (let at = start; at <= end; at += step * hourMs) ticks.push(at);
    return {
      rows: sorted,
      start,
      end,
      ticks,
      forecastByHour,
      rates,
      purchase: rates.find((p) => p.purchase != null)?.purchase ?? null,
      lastT: samples.length > 0 ? samples[samples.length - 1]!.t : null,
      hasSamples: samples.length > 0,
    };
  }, [day, forecast, power, ratePoints]);

  if (!model) return null;
  const { rows, start, end, ticks, forecastByHour, rates, purchase, lastT, hasSamples } = model;
  const rateValues = rates.map((p) => p.rate);
  const hasRate = rateValues.length > 0;
  const rateStops = hasRate ? rateGradientStops(Math.min(...rateValues), Math.max(...rateValues), purchase) : [];
  const flat = hasRate && Math.max(...rateValues) - Math.min(...rateValues) <= 0;
  const rateStroke = flat ? RATE_COLORS[rateStops[0]!.band] : `url(#${gradientId})`;
  const rateColorOf = (rate: number | null) => (rate == null ? undefined : RATE_COLORS[rateBand(rate, purchase)]);
  const rateTicks = rateAxisTicks(rateValues);
  /** The hour's forecast and the rate in force at an instant, wherever the pointer is. */
  const forecastAt = (at: number) => forecastByHour.get(zurichHour(new Date(at).toISOString())) ?? null;
  const rateAt = (at: number) => {
    let found: number | null = null;
    for (const p of rates) {
      if (p.t > at) break;
      found = p.rate;
    }
    return found;
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.gridline} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[start, end]}
          ticks={ticks}
          tickFormatter={zurichClock}
          tick={{ fontSize: 11 }}
          allowDataOverflow
        />
        <YAxis
          tick={{ fontSize: 11 }}
          width={40}
          domain={[0, "auto"]}
          // One decimal unless the tick needs two: recharts' steps can land on
          // 0.45, which one decimal would round into uneven-looking labels.
          tickFormatter={(v: number) => formatNumber(v, Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2)}
        />
        {hasRate && (
          <YAxis
            yAxisId="rate"
            orientation="right"
            tick={{ fontSize: 11, fill: PALETTE.axis }}
            width={48}
            domain={[rateTicks[0]!, rateTicks[rateTicks.length - 1]!]}
            ticks={rateTicks}
            tickFormatter={(v: number) => formatNumber(v, 2)}
          />
        )}
        <Tooltip
          content={({ active, payload }) => {
            const r = payload?.[0]?.payload as PowerRow | undefined;
            if (!active || !r) return null;
            // A forecast or rate row has no reading of its own: show the
            // nearest sample's, so the tooltip never reads "—" mid-day.
            let sample: PowerRow | undefined;
            if (!r.sampled) {
              let best = Infinity;
              for (const c of rows) {
                if (!c.sampled) continue;
                const d = Math.abs(c.t - r.t);
                if (d < best) {
                  best = d;
                  sample = c;
                }
              }
              if (best > 10 * 60 * 1000) sample = undefined;
            } else sample = r;
            const at = sample?.t ?? r.t;
            const forecast = forecastAt(at);
            const rate = rateAt(at);
            return (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                <p className="mb-1 font-medium text-slate-900">
                  {zurichClock(at)}
                  {sample && sample.t === lastT ? ` · ${t("party.live.now")}` : ""}
                </p>
                {hasSamples && (
                  <>
                    <p className="text-slate-600">
                      {t("party.live.pvPower")}:{" "}
                      <span className="font-semibold text-slate-900">
                        {sample?.pv == null ? "—" : `${formatNumber(sample.pv, 2)} kW`}
                      </span>
                    </p>
                    <p className="pl-2 text-slate-500">
                      {t("party.live.leftHouse")}: {sample?.exp == null ? "—" : `${formatNumber(sample.exp, 2)} kW`}
                    </p>
                    <p className="pl-2 text-slate-500">
                      {t("party.live.keptAtHome")}: {sample?.kept == null ? "—" : `${formatNumber(sample.kept, 2)} kW`}
                    </p>
                  </>
                )}
                <p className="mt-1 text-slate-600">
                  {t("party.live.forecast")}:{" "}
                  <span className="font-semibold text-slate-900">
                    {forecast == null ? "—" : `${formatNumber(forecast, 2)} kW`}
                  </span>
                </p>
                {hasRate && (
                  <p className="mt-1 text-slate-600">
                    {t("calc.col.feedInRate")}:{" "}
                    <span className="font-semibold text-slate-900" style={{ color: rateColorOf(rate) }}>
                      {rate == null ? "—" : `${formatNumber(rate, 3)} CHF/kWh`}
                    </span>
                  </p>
                )}
              </div>
            );
          }}
        />
        <Legend content={<DayLegend />} />
        <Area
          type="monotone"
          dataKey="remaining"
          name={t("party.live.stillExpected")}
          stroke="none"
          fill={REMAINING_FILL}
          legendType="rect"
          isAnimationActive={false}
          connectNulls
        />
        {/* Stacked as the hourly bars are: what left the house at the foot,
            in grid blue, and what stayed — used at home or put in the
            battery — on top of it in the sun's yellow, so the stack's top
            edge is what the panels deliver. Where the battery sends out
            more than the panels make, the blue alone sets the height. */}
        {hasSamples && (
          <>
            <Area
              type="linear"
              dataKey="exp"
              name={t("party.live.leftHouse")}
              stackId="power"
              stroke={EXPORTED_COLOR}
              strokeWidth={1.5}
              fill={EXPORTED_COLOR}
              fillOpacity={0.35}
              legendType="rect"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="kept"
              name={t("party.live.keptAtHome")}
              stackId="power"
              stroke={KEPT_COLOR}
              strokeWidth={2}
              fill={KEPT_COLOR}
              fillOpacity={0.3}
              legendType="rect"
              dot={false}
              activeDot={false}
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
          activeDot={false}
          isAnimationActive={false}
          connectNulls
        />
        {hasRate && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              {rateStops.map((s, i) => (
                <stop key={i} offset={`${(s.offset * 100).toFixed(3)}%`} stopColor={RATE_COLORS[s.band]} />
              ))}
            </linearGradient>
          </defs>
        )}
        {hasRate && (
          <Line
            yAxisId="rate"
            type="stepAfter"
            dataKey="feedInRate"
            name={t("calc.col.feedInRate")}
            stroke={rateStroke}
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
