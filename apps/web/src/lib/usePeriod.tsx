import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { INITIAL_GRANULARITY, initialRange, type Granularity } from "./periods";

/**
 * The range and granularity the Dashboard and the Consumption page share.
 *
 * They answer the same question from two sides — what the system earned, and
 * what a participant paid — so moving one to Q1 and then switching tabs to
 * find the other still on Q3 means setting the period twice to compare two
 * halves of one story.
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
  set: (range: { from: string; to: string }, granularity: Granularity) => void;
}

const PeriodContext = createContext<SelectedPeriod | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(initialRange, []);
  const [state, setState] = useState({
    from: initial.from,
    to: initial.to,
    granularity: INITIAL_GRANULARITY,
  });

  const value = useMemo<SelectedPeriod>(
    () => ({
      ...state,
      set: (range, granularity) =>
        setState((current) =>
          // Both pages clamp the range to their own data on mount, which would
          // otherwise write an identical value and re-render every consumer.
          current.from === range.from &&
          current.to === range.to &&
          current.granularity === granularity
            ? current
            : { from: range.from, to: range.to, granularity },
        ),
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
