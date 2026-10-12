import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { INITIAL_GRANULARITY, INITIAL_MODE, PERIOD_MODES, initialRange, type Granularity, type PeriodMode } from "./periods";

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
 * Held above the routes rather than in each page, so it survives navigation,
 * and remembered in this browser so it survives a reload too: the period
 * somebody set is the period they want back, whatever the day. Only a
 * browser that has never set one opens on the current quarter.
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

const STORAGE_KEY = "em.period";
type PeriodState = { from: string; to: string; granularity: Granularity; mode: PeriodMode };
const GRANULARITIES: Granularity[] = ["hourly", "daily", "monthly", "quarterly", "yearly", "overall"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The remembered period, if the browser has one and it still makes sense. */
function storedPeriod(): PeriodState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PeriodState>;
    if (
      typeof p.from === "string" &&
      typeof p.to === "string" &&
      DAY.test(p.from) &&
      DAY.test(p.to) &&
      p.from <= p.to &&
      GRANULARITIES.includes(p.granularity as Granularity) &&
      PERIOD_MODES.includes(p.mode as PeriodMode)
    ) {
      return { from: p.from, to: p.to, granularity: p.granularity as Granularity, mode: p.mode as PeriodMode };
    }
  } catch {
    /* storage unavailable or unreadable: start on the current quarter */
  }
  return null;
}

function remember(state: PeriodState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* same */
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PeriodState>(() => {
    const stored = storedPeriod();
    if (stored) return stored;
    const initial = initialRange();
    return { from: initial.from, to: initial.to, granularity: INITIAL_GRANULARITY, mode: INITIAL_MODE as PeriodMode };
  });

  const value = useMemo<SelectedPeriod>(
    () => ({
      ...state,
      set: (range, granularity, mode) =>
        setState((current) => {
          const next = { from: range.from, to: range.to, granularity, mode: mode ?? current.mode };
          // Both pages clamp the range to their own data on mount, which would
          // otherwise write an identical value and re-render every consumer.
          if (
            next.from === current.from &&
            next.to === current.to &&
            next.granularity === current.granularity &&
            next.mode === current.mode
          ) {
            return current;
          }
          remember(next);
          return next;
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
