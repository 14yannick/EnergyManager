import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { INITIAL_GRANULARITY, INITIAL_MODE, initialRange, type Granularity, type PeriodMode } from "./periods";

/**
 * The period the Dashboard and the Consumption page share: the range, how it
 * is grouped, and which calendar unit the selector is set to.
 *
 * They answer the same question from two sides — what the system earned, and
 * what a participant paid — so moving one to Q1 and then switching tabs to
 * find the other still on Q3 means setting the period twice to compare two
 * halves of one story.
 *
 * The mode travels with the range on purpose. It used to be the selector's
 * own state, which meant a freshly mounted selector on the other page opened
 * on its default — "Quarter" — over a range that was one month, with the
 * stepper naming a quarter and the chart showing a month.
 *
 * Held above the routes rather than in each page, so it survives navigation.
 * Deliberately not persisted: a reload is the one moment where "back to the
 * current quarter" is the helpful answer, and a range restored from a previous
 * session is a range nobody chose today.
 */
export interface SelectedPeriod {
  from: string;
  to: string;
  granularity: Granularity;
  mode: PeriodMode;
  /** The mode is kept unless one is given: a clamp or a view change is not a change of unit. */
  set: (range: { from: string; to: string }, granularity: Granularity, mode?: PeriodMode) => void;
}

const PeriodContext = createContext<SelectedPeriod | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(initialRange, []);
  const [state, setState] = useState({
    from: initial.from,
    to: initial.to,
    granularity: INITIAL_GRANULARITY,
    mode: INITIAL_MODE as PeriodMode,
  });

  const value = useMemo<SelectedPeriod>(
    () => ({
      ...state,
      set: (range, granularity, mode) =>
        setState((current) => {
          const next = { from: range.from, to: range.to, granularity, mode: mode ?? current.mode };
          // Both pages clamp the range to their own data on mount, which would
          // otherwise write an identical value and re-render every consumer.
          return next.from === current.from &&
            next.to === current.to &&
            next.granularity === current.granularity &&
            next.mode === current.mode
            ? current
            : next;
        }),
    }),
    [state],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function useSelectedPeriod(): SelectedPeriod {
  const period = useContext(PeriodContext);
  if (!period) throw new Error("useSelectedPeriod must be used inside a PeriodProvider");
  return period;
}
