import { InfoTip } from "./InfoTip";

export function StatCard({
  label,
  value,
  sub,
  hint,
  format = (v) => `CHF ${v.toFixed(2)}`,
  emphasis,
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
}) {
  return (
    <div className="rounded-lg border bg-white p-3 sm:p-4">
      <p className="text-xs font-medium text-slate-500">
        {label}
        {hint && <InfoTip text={hint} />}
      </p>
      <p
        className={`mt-1 text-xl sm:text-2xl ${
          emphasis === "positive"
            ? "font-bold text-emerald-700"
            : emphasis === "strong"
              ? "font-bold text-slate-900"
              : "font-semibold text-slate-900"
        }`}
      >
        {value != null ? format(value) : "—"}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
