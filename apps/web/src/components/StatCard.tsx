import type { Tone } from "../lib/palette";
import { InfoTip } from "./InfoTip";
import { formatChf } from "../lib/format";

/**
 * Written out in full rather than built from the tone name: Tailwind only
 * emits classes it can see as literal strings in the source, so a
 * `bg-${tone}-soft` template would compile to nothing.
 */
const TONE_CLASS: Record<Tone, { card: string; ink: string }> = {
  sun: { card: "border-sun/40 bg-sun-soft", ink: "text-sun-ink" },
  grid: { card: "border-grid/40 bg-grid-soft", ink: "text-grid-ink" },
  local: { card: "border-local/40 bg-local-soft", ink: "text-local-ink" },
  battery: { card: "border-battery/40 bg-battery-soft", ink: "text-battery-ink" },
  vzev: { card: "border-vzev/40 bg-vzev-soft", ink: "text-vzev-ink" },
};

export function StatCard({
  label,
  value,
  sub,
  hint,
  format = (v) => `CHF ${formatChf(v)}`,
  emphasis,
  tone,
  size,
}: {
  label: string;
  value?: number | null;
  /** How the figure is written; money by default. */
  format?: (value: number) => string;
  /** The headline figure: bolder, and green when it is good news. */
  emphasis?: "strong" | "positive";
  sub?: string;
  /** What the figure actually measures, behind a ⓘ beside the label — for the
   * cards whose names alone don't separate them (battery savings vs battery
   * revenue), or whose name is a term rather than a description. */
  hint?: string;
  /**
   * Which entity the figure belongs to — the same vocabulary the charts use
   * (see src/lib/palette.ts). Tints the card and sets its text in that hue's
   * ink, so a sun-coloured number here and a sun-coloured bar in the chart
   * below read as the same thing. Untoned cards stay white: neutral figures
   * (a price, a balance) belong to no flow.
   */
  tone?: Tone;
  /** A hero card: the page's answer, twice the size of the figures around it. */
  size?: "hero";
}) {
  const toned = tone ? TONE_CLASS[tone] : null;
  const hero = size === "hero";
  const valueClass = toned
    ? `${toned.ink} ${hero || emphasis ? "font-bold" : "font-semibold"}`
    : emphasis === "positive"
      ? "font-bold text-emerald-700 dark:text-emerald-400"
      : emphasis === "strong"
        ? "font-bold text-slate-900"
        : "font-semibold text-slate-900";
  return (
    <div className={`rounded-lg border ${toned?.card ?? "bg-white"} ${hero ? "p-4 sm:p-5" : "p-3 sm:p-4"}`}>
      <p className={`text-xs font-medium ${toned ? toned.ink : "text-slate-500"}`}>
        {label}
        {hint && <InfoTip text={hint} />}
      </p>
      <p className={`mt-1 tabular-nums ${hero ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"} ${valueClass}`}>
        {value != null ? format(value) : "—"}
      </p>
      {sub && <p className={`mt-1 text-xs ${toned ? `${toned.ink} opacity-80` : "text-slate-500"}`}>{sub}</p>}
    </div>
  );
}
