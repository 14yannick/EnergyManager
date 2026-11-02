import { useI18n, type MessageKey } from "../i18n/context";
import { useSelectedPeriod } from "../lib/usePeriod";
import {
  GRANULARITY_LABEL,
  PERIOD_MODES,
  DEFAULT_VIEW,
  VIEWS_FOR,
  addMonths,
  cutAtToday,
  endOfMonth,
  endOfQuarter,
  fitRange,
  periodRange,
  quarterKeyOf,
  quarterKeyToDate,
  startOfQuarter,
  stepRange,
  todayIso,
  type DataRange,
  type Granularity,
  type PeriodMode,
  type StepUnit,
} from "../lib/periods";

type Range = { from: string; to: string };

const MODE_LABEL: Record<PeriodMode, MessageKey> = {
  day: "period.day",
  week: "period.week",
  month: "period.month",
  quarter: "period.quarter",
  year: "period.year",
  all: "period.all",
  custom: "period.custom",
};

const STEP_LABEL: Record<StepUnit, { prev: MessageKey; next: MessageKey }> = {
  day: { prev: "dash.step.prevDay", next: "dash.step.nextDay" },
  week: { prev: "dash.step.prevWeek", next: "dash.step.nextWeek" },
  month: { prev: "dash.step.prevMonth", next: "dash.step.nextMonth" },
  quarter: { prev: "dash.step.prevQuarter", next: "dash.step.nextQuarter" },
  year: { prev: "dash.step.prevYear", next: "dash.step.nextYear" },
};

const INTL_TAG = { fr: "fr-CH", de: "de-CH", en: "en-CH" } as const;
const QUARTER_PREFIX = { fr: "T", de: "Q", en: "Q" } as const;

/** Swiss DD.MM.YYYY in every language, as everywhere else in the app. */
const swiss = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** The period being looked at, in words — same conventions as the billing page. */
export function periodName(mode: PeriodMode, range: Range, locale: keyof typeof INTL_TAG): string {
  const [y, m] = range.from.split("-").map(Number);
  switch (mode) {
    case "day":
      return swiss(range.from);
    case "week": {
      const week = periodRange("week", range.from);
      return week.from.slice(0, 4) === week.to.slice(0, 4)
        ? `${week.from.slice(8, 10)}.${week.from.slice(5, 7)} – ${swiss(week.to)}`
        : `${swiss(week.from)} – ${swiss(week.to)}`;
    }
    case "month":
      return new Date(y!, m! - 1, 1).toLocaleDateString(INTL_TAG[locale], { month: "long", year: "numeric" });
    case "quarter":
      return `${QUARTER_PREFIX[locale]}${Math.floor((m! - 1) / 3) + 1} ${y}`;
    case "year":
      return String(y);
    default:
      return `${swiss(range.from)} – ${swiss(range.to)}`;
  }
}

/**
 * Which stretch of time a dashboard shows, and how it is grouped.
 *
 * A calendar unit is picked and then walked through with the arrows — the
 * question is nearly always "this month, or the one before", not two dates.
 * "All" covers every reading, and "Custom" keeps the free range, its inputs
 * matching the view so a monthly range is picked in months rather than by
 * hunting for the 1st and the 31st.
 *
 * Every range goes through `fitRange`, so the bounds and snapping rules are
 * the same whichever control produced it.
 *
 * The mode is the caller's, not this component's: it belongs with the range
 * it describes, and the two pages share both. Kept here as local state, a
 * selector mounted on the other page opened on its default unit over a range
 * chosen in another — "Quarter" in the dropdown, one month on the chart.
 */
export function PeriodControls({
  range,
  granularity,
  mode,
  onChange,
  dataRange,
  bounds,
  variant = "main",
}: {
  range: Range;
  granularity: Granularity;
  mode: PeriodMode;
  onChange: (range: Range, granularity: Granularity, mode: PeriodMode) => void;
  dataRange: DataRange;
  bounds: { min: string | null; max: string };
  /**
   * "compare" draws the same controls for the comparison period: no view of
   * its own — it is grouped like the main period, so the two line up — and
   * no comparison of its own.
   */
  variant?: "main" | "compare";
}) {
  const { t, locale } = useI18n();
  const period = useSelectedPeriod();
  const views = variant === "compare" ? [] : VIEWS_FOR[mode];

  const apply = (r: Range, g: Granularity, anchor?: "from" | "to", m: PeriodMode = mode) =>
    onChange(fitRange(r, g, bounds, anchor), g, m);

  const selectMode = (next: PeriodMode) => {
    // Each period opens on its own default view; Custom keeps the current one,
    // since it starts from the range already shown.
    if (next === "custom") return apply(range, granularity, undefined, next);
    const g = DEFAULT_VIEW[next];
    if (next === "all") {
      return apply({ from: dataRange.from ?? bounds.min ?? range.from, to: dataRange.to ?? bounds.max }, g, undefined, next);
    }
    // Stay where the reader is: the unit containing the day the range ends on.
    apply(cutAtToday(periodRange(next, range.to)), g, undefined, next);
  };
  const setCustom = (next: Range, anchor: "from" | "to" = "to") => apply(next, granularity, anchor);

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

  const stepper = (unit: StepUnit) => {
    const prev = stepRange(range.from, unit, -1);
    const next = stepRange(range.from, unit, 1);
    const arrow = (target: Range, disabled: boolean, label: string, glyph: string) => (
      <button
        onClick={() => apply(cutAtToday(target), granularity, "from")}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="h-9 rounded-md border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {glyph}
      </button>
    );
    // Disabled rather than clamped past the bounds: clamping would only land
    // back on the period already shown.
    return (
      <div className="flex items-center gap-1">
        {arrow(prev, bounds.min != null && prev.to < bounds.min, t(STEP_LABEL[unit].prev), "‹")}
        <span className="min-w-36 px-1 text-center font-medium text-slate-900">
          {periodName(unit, range, locale)}
        </span>
        {arrow(next, next.from > bounds.max, t(STEP_LABEL[unit].next), "›")}
      </div>
    );
  };

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        {t(variant === "compare" ? "period.comparedTo" : "common.period")}
        <select
          className="input h-9 w-36"
          value={mode}
          onChange={(e) => selectMode(e.target.value as PeriodMode)}
        >
          {PERIOD_MODES.map((m) => (
            <option key={m} value={m}>
              {t(MODE_LABEL[m])}
            </option>
          ))}
        </select>
      </label>

      {mode === "custom" ? (
        <>
          {(granularity === "hourly" || granularity === "daily" || granularity === "overall") && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t("common.from")}
                <input
                  type="date"
                  className="input h-9 w-36"
                  value={range.from}
                  min={bounds.min ?? undefined}
                  max={range.to}
                  onChange={(e) => setCustom({ ...range, from: e.target.value }, "from")}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t("common.to")}
                <input
                  type="date"
                  className="input h-9 w-36"
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
                {t("common.from")}
                <input
                  type="month"
                  className="input h-9 w-36"
                  value={range.from.slice(0, 7)}
                  onChange={(e) => setCustom({ ...range, from: `${e.target.value}-01` })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t("common.to")}
                <input
                  type="month"
                  className="input h-9 w-36"
                  value={range.to.slice(0, 7)}
                  onChange={(e) => setCustom({ ...range, to: endOfMonth(`${e.target.value}-01`) })}
                />
              </label>
            </>
          )}

          {granularity === "quarterly" && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t("common.from")}
                <select
                  className="input h-9 w-36"
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
                {t("common.to")}
                <select
                  className="input h-9 w-36"
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
                {t("common.from")}
                <select
                  className="input h-9 w-36"
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
                {t("common.to")}
                <select
                  className="input h-9 w-36"
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
        </>
      ) : mode === "all" ? (
        <span className="py-1.5 font-medium text-slate-900">{periodName("all", range, locale)}</span>
      ) : (
        stepper(mode)
      )}

      {views.length > 1 && (
        <Segmented
          label={t("dash.view")}
          options={views.map((g) => ({ value: g, label: t(GRANULARITY_LABEL[g]) }))}
          value={granularity}
          onChange={(g) => apply(range, g)}
        />
      )}

      {/* Compare: a second period beside the first, opening on the same
          interval a year earlier and changed with the same controls. */}
      {variant === "main" && (
        <button
          type="button"
          onClick={period.toggleCompare}
          aria-pressed={period.compare != null}
          className={`h-9 rounded-md border px-3 text-sm font-medium ${
            period.compare
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {t("period.compare")}
        </button>
      )}
      {variant === "main" && period.compare && (
        // Beside the button that turned it on, on the same line while there
        // is room; on a narrow screen it wraps under, like the rest.
        <div className="flex min-w-0 max-w-full">
          <PeriodControls
            variant="compare"
            range={{ from: period.compare.from, to: period.compare.to }}
            granularity={granularity}
            mode={period.compare.mode}
            onChange={(r, _g, m) => period.setCompare(r, m)}
            dataRange={dataRange}
            // Any time with readings, the future excepted: a comparison
            // reaches back before the main period's own lower bound.
            bounds={{ min: dataRange.from, max: bounds.max }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A row of mutually exclusive buttons. Scrolls rather than widening the page:
 * six views do not fit across a phone.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      {/* As tall as the inputs beside it (h-9), so every control in the row
          — and so every label above one — sits at the same height. */}
      <div className="flex h-9 max-w-full overflow-x-auto rounded-md border border-slate-300" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`shrink-0 whitespace-nowrap px-3 text-sm capitalize ${
              value === o.value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The comparison period, if one is chosen, with its name as the period
 * selector writes it — what every figure compared against it is labelled
 * with.
 */
export function useComparison(): { from: string; to: string; label: string } | null {
  const { locale } = useI18n();
  const { compare } = useSelectedPeriod();
  if (!compare) return null;
  return { from: compare.from, to: compare.to, label: periodName(compare.mode, compare, locale) };
}
