import type { ReactNode } from "react";

/**
 * The line where a page turns from "right now" to "over a period": a
 * heading and a sentence for the period-bound half, with the controls that
 * scope it — the period selector, and whatever else — at the right.
 *
 * It sits under the live section rather than beside the page title, so the
 * selector stands next to the figures it changes and not above ones it
 * does not: a reader who moved the period and saw the live cards not move
 * was right to be puzzled.
 */
export function PeriodHeader({ title, intro, children }: { title: string; intro: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="max-w-2xl text-sm text-slate-500">{intro}</p>
      </div>
      {children && <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3 text-sm">{children}</div>}
    </div>
  );
}
