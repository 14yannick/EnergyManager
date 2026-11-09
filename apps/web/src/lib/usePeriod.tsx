import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  INITIAL_GRANULARITY,
  INITIAL_MODE,
  PERIOD_MODES,
  initialRange,
  previousYear,
  type Granularity,
  type PeriodMode,
} from "./periods";

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
  /**
   * The period the figures are compared with, or null while comparison is
   * off. Grouped like the main one — its view is the main one's — so the two
   * line up period by period.
   */
  compare: ComparePeriod | null;
  /** Turn comparison on, opening on the same interval a year earlier, or off. */
  toggleCompare: () => void;
  /** Set the comparison period by hand; from then on it no longer follows the main one. */
  setCompare: (range: { from: string; to: string }, mode: PeriodMode) => void;
}

export interface ComparePeriod {
  from: string;
  to: string;
  mode: PeriodMode;
}

const PeriodContext = createContext<SelectedPeriod | null>(null);

const STORAGE_KEY = "em.period";
type PeriodState = { from: string; to: string; granularity: Granularity; mode: PeriodMode };
const GRANULARITIES: Granularity[] = ["quarter_hourly", "hourly", "daily", "monthly", "quarterly", "yearly", "overall"];
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

/**
 * The comparison, remembered on its own key. `follow` holds while it is the
 * default — the same interval a year earlier — and moves with the main
 * period; set by hand, it stays where it was put.
 */
const COMPARE_KEY = "em.compare";
type CompareState = { enabled: boolean; follow: boolean; from: string; to: string; mode: PeriodMode };

function storedCompare(): CompareState | null {
  try {
    const raw = localStorage.getItem(COMPARE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<CompareState>;
    if (
      typeof c.enabled === "boolean" &&
      typeof c.follow === "boolean" &&
      typeof c.from === "string" &&
      typeof c.to === "string" &&
      DAY.test(c.from) &&
      DAY.test(c.to) &&
      c.from <= c.to &&
      PERIOD_MODES.includes(c.mode as PeriodMode)
    ) {
      return c as CompareState;
    }
  } catch {
    /* storage unavailable or unreadable: comparison starts off */
  }
  return null;
}

function rememberCompare(state: CompareState) {
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(state));
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

  const [compareState, setCompareState] = useState<CompareState>(
    () =>
      storedCompare() ?? { enabled: false, follow: true, ...previousYear(state), mode: state.mode },
  );
  const updateCompare = (next: CompareState) => {
    rememberCompare(next);
    setCompareState(next);
  };

  // A comparison still on its default follows the main period: a year
  // earlier, whatever the main one moves to.
  useEffect(() => {
    if (!compareState.follow) return;
    const shifted = previousYear(state);
    if (shifted.from === compareState.from && shifted.to === compareState.to && state.mode === compareState.mode) return;
    updateCompare({ ...compareState, ...shifted, mode: state.mode });
    // Follows the main period only.
  }, [state.from, state.to, state.mode, compareState.follow]);

  const value = useMemo<SelectedPeriod>(
    () => ({
      ...state,
      compare: compareState.enabled
        ? { from: compareState.from, to: compareState.to, mode: compareState.mode }
        : null,
      toggleCompare: () =>
        updateCompare(
          compareState.enabled
            ? { ...compareState, enabled: false }
            : // Turned on, it opens on its default again.
              { enabled: true, follow: true, ...previousYear(state), mode: state.mode },
        ),
      setCompare: (range, mode) => updateCompare({ enabled: true, follow: false, ...range, mode }),
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
    [state, compareState],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function useSelectedPeriod(): SelectedPeriod {
  const period = useContext(PeriodContext);
  if (!period) throw new Error("useSelectedPeriod must be used inside a PeriodProvider");
  return period;
}
