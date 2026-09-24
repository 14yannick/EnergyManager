/**
 * The app's colour vocabulary — one place, used by both the charts (which
 * need raw hex for SVG) and Tailwind (tailwind.config.js imports this file),
 * so a series in a chart, the KPI card beside it, and a tinted badge can
 * never disagree about what colour "grid" is.
 *
 * Colour follows the *entity*, everywhere: sun is what the panels made,
 * grid is anything crossing the grid meter (in or out), local is energy
 * that stayed inside the vZEV, battery is the battery, vzev is the shared
 * connection itself (the standing charges it splits). A series must never
 * borrow another's hue because it happened to be free.
 *
 * The five categorical hues are the palette the revenue chart was built and
 * validated on (dataviz/validate_palette.py: lightness band, chroma floor,
 * colour-blindness separation on every adjacent pair). Amber and green sit
 * below 3:1 against white — which is why neither ever carries text: they
 * are accents and tints, and text on a tinted card wears that hue's `ink`.
 */

export const PALETTE = {
  sun: "#eda100",
  grid: "#2a78d6",
  local: "#1baf7a",
  battery: "#eb6834",
  vzev: "#4a3aa7",
  /** Charging as a cost: a darker battery, hung below the axis. */
  batteryCharging: "#8c3f1d",
  /** Export forgone on local sales: a darker local, same idea. Picked to clear the CVD floor against the brown above it. */
  localForgone: "#007c64",
  /** A prediction, never a measurement: dashed neutral, never a hue. */
  forecast: "#475569",
  /** The forecast at a tenth of its strength over white, as a real colour so a legend swatch matches. */
  forecastFill: "#e4e7ec",
  /** The household as a node in the flow view: the neutral thing the flows end at, so it takes no hue of its own. */
  house: "#475569",
  gridline: "#e2e8f0",
  axis: "#64748b",
  ink: "#0f172a",
} as const;

export type Tone = "sun" | "grid" | "local" | "battery" | "vzev";

/**
 * A tinted surface and the text colour that is legible on it, per hue —
 * every ink-on-soft pair here is above 6:1 (WCAG AA for small text needs
 * 4.5). Tailwind exposes them as `bg-{tone}-soft` / `text-{tone}-ink`.
 */
export const TONES: Record<Tone, { soft: string; ink: string }> = {
  sun: { soft: "#fef3c7", ink: "#92400e" },
  grid: { soft: "#e0f2fe", ink: "#0c4a6e" },
  local: { soft: "#d1fae5", ink: "#065f46" },
  battery: { soft: "#ffedd5", ink: "#7c2d12" },
  vzev: { soft: "#ede9fe", ink: "#3b0764" },
};

/**
 * Primary *actions* — Generate, Mark paid, Sync now, Save. Warm, because
 * this is a solar app; dark enough that white text passes AA on it (5.0:1).
 * Selection state (an active tab, a pressed segment of a toggle) stays ink:
 * colour means "this does something", ink means "this is what's chosen".
 */
export const PRIMARY = { DEFAULT: "#b45309", hover: "#92400e" } as const;
