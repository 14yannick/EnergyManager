/**
 * The app's colour vocabulary — one place, read by both the charts (which
 * need a colour string for SVG) and Tailwind (tailwind.config.js imports
 * this file), so a series in a chart, the KPI card beside it, and a tinted
 * badge can never disagree about what colour "grid" is.
 *
 * Colour follows the *entity*, everywhere: sun is what the panels made,
 * grid is anything crossing the grid meter (in or out), local is energy
 * that stayed inside the vZEV, battery is the battery, vzev is the shared
 * connection itself (the standing charges it splits). A series must never
 * borrow another's hue because it happened to be free.
 *
 * Every colour exists in two modes. Light is the palette the revenue chart
 * was built and validated on (dataviz/validate_palette.py: lightness band,
 * chroma floor, colour-blindness separation on every adjacent pair); dark
 * keeps the same hues on a dark card surface — only vZEV changes, its light
 * violet reading 1.7:1 against the dark surface, the lifted one 4.4:1 —
 * and turns every neutral round. The mode is a class on <html> (see
 * lib/theme.tsx); nothing here is read at runtime by mode. Instead the
 * Tailwind config emits each token as a CSS variable under `:root` and
 * `.dark`, and both Tailwind's classes and the charts' `PALETTE` refer to
 * the variable, so a chart and a card switch together, at once.
 */

export type Mode = "light" | "dark";
export type Tone = "sun" | "grid" | "local" | "battery" | "vzev";

/** Tailwind's own slate scale — the ten shades the app's classes use. */
export type SlateShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

export const HUES: Record<Mode, Record<Tone, string>> = {
  light: { sun: "#eda100", grid: "#2a78d6", local: "#1baf7a", battery: "#eb6834", vzev: "#4a3aa7" },
  dark: { sun: "#eda100", grid: "#2a78d6", local: "#1baf7a", battery: "#eb6834", vzev: "#8b7cf0" },
};

/**
 * Everything that is not an entity's hue. Each dark value is the light
 * one's role, not its colour: the surface is what cards sit on, ink is
 * what reads on it, gridlines recede from it.
 *
 * The slate scale is inverted rather than replaced, because the app's
 * classes use it by role already — slate-900 is primary text, slate-500
 * secondary, slate-200 a divider, slate-50 the page — and that reading
 * holds if each shade swaps for its counterpart. Two exceptions to a pure
 * inversion: slate-100 and slate-200 both land on slate-700, not 800,
 * because 800 is the dark card surface itself and a hover or a divider in
 * the surface's own colour disappears. `white` is the card surface, so
 * `bg-white` cards go dark with the mode — and `text-white` on a
 * slate-900 pill goes dark with them, which keeps the pill legible when
 * slate-900 turns light. The primary button keeps a literal white (see
 * .btn-primary in index.css): 2.9:1 for surface-coloured text on it, 5.0:1
 * for white.
 */
export const NEUTRALS: Record<
  Mode,
  {
    surface: string;
    border: string;
    forecast: string;
    forecastFill: string;
    house: string;
    gridline: string;
    baseline: string;
    hoverBand: string;
    axis: string;
    ink: string;
    batteryCharging: string;
    localForgone: string;
    slate: Record<SlateShade, string>;
  }
> = {
  light: {
    surface: "#ffffff",
    /** Tailwind's default `border` colour (gray-200), kept as it was. */
    border: "#e5e7eb",
    /** A prediction, never a measurement: dashed neutral, never a hue. */
    forecast: "#475569",
    /** The forecast at a tenth of its strength over the surface, as a real colour so a legend swatch matches. */
    forecastFill: "#e4e7ec",
    /** The household as a node in the flow view: the neutral thing the flows end at, so it takes no hue of its own. */
    house: "#475569",
    gridline: "#e2e8f0",
    /** The zero line the revenue bars are measured from. */
    baseline: "#cbd5e1",
    /** The band a bar chart shades under the pointer. */
    hoverBand: "#f1f5f9",
    axis: "#64748b",
    ink: "#0f172a",
    /** Charging as a cost: a darker battery, hung below the axis. */
    batteryCharging: "#8c3f1d",
    /** Export forgone on local sales: a darker local, same idea. Picked to clear the CVD floor against the brown above it. */
    localForgone: "#007c64",
    slate: {
      50: "#f8fafc",
      100: "#f1f5f9",
      200: "#e2e8f0",
      300: "#cbd5e1",
      400: "#94a3b8",
      500: "#64748b",
      600: "#475569",
      700: "#334155",
      800: "#1e293b",
      900: "#0f172a",
      950: "#020617",
    },
  },
  dark: {
    surface: "#1e293b",
    border: "#334155",
    forecast: "#94a3b8",
    forecastFill: "#2a3649",
    house: "#94a3b8",
    gridline: "#334155",
    baseline: "#475569",
    hoverBand: "#334155",
    axis: "#94a3b8",
    ink: "#f1f5f9",
    // On a dark surface the "cost" shade of a hue reads lighter, not
    // darker — the direction that stands out from the surface — and each
    // stays clearly apart from the hue it belongs to.
    batteryCharging: "#ffb385",
    localForgone: "#7ee8c9",
    slate: {
      50: "#0f172a",
      100: "#334155",
      200: "#334155",
      300: "#475569",
      400: "#64748b",
      500: "#94a3b8",
      600: "#cbd5e1",
      700: "#e2e8f0",
      800: "#e2e8f0",
      900: "#f1f5f9",
      950: "#f8fafc",
    },
  },
};

/** `t` of the way from `from` to `to`, per channel. */
function mix(from: string, to: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const f = from.slice(1);
  const o = to.slice(1);
  return (
    "#" +
    [0, 2, 4]
      .map((i) => Math.round(ch(f, i) + t * (ch(o, i) - ch(f, i))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * A tinted surface and the text colour that is legible on it, per hue —
 * every ink-on-soft pair is above 5.9:1 in both modes (WCAG AA for small
 * text needs 4.5). Tailwind exposes them as `bg-{tone}-soft` /
 * `text-{tone}-ink`. The dark softs are the hue at a fifth of its strength
 * over the dark surface, computed rather than picked, so they sit at one
 * consistent depth; the dark inks are the hue's light tint.
 */
export const TONES: Record<Mode, Record<Tone, { soft: string; ink: string }>> = {
  light: {
    sun: { soft: "#fef3c7", ink: "#92400e" },
    grid: { soft: "#e0f2fe", ink: "#0c4a6e" },
    local: { soft: "#d1fae5", ink: "#065f46" },
    battery: { soft: "#ffedd5", ink: "#7c2d12" },
    vzev: { soft: "#ede9fe", ink: "#3b0764" },
  },
  dark: {
    sun: { soft: mix(NEUTRALS.dark.surface, HUES.dark.sun, 0.2), ink: "#fbbf24" },
    grid: { soft: mix(NEUTRALS.dark.surface, HUES.dark.grid, 0.2), ink: "#7dd3fc" },
    local: { soft: mix(NEUTRALS.dark.surface, HUES.dark.local, 0.2), ink: "#6ee7b7" },
    battery: { soft: mix(NEUTRALS.dark.surface, HUES.dark.battery, 0.2), ink: "#fdba74" },
    vzev: { soft: mix(NEUTRALS.dark.surface, HUES.dark.vzev, 0.2), ink: "#c4b5fd" },
  },
};

/**
 * Primary *actions* — Generate, Mark paid, Sync now, Save. Warm, because
 * this is a solar app; dark enough that white text passes AA on it (5.0:1),
 * in either mode. Selection state (an active tab, a pressed segment of a
 * toggle) stays ink: colour means "this does something", ink means "this
 * is what's chosen".
 */
export const PRIMARY = { DEFAULT: "#b45309", hover: "#92400e" } as const;

/** "#rrggbb" as the "r g b" triplet Tailwind's `rgb(var(--x) / <alpha-value>)` needs. */
export function rgbTriplet(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

/**
 * Every token of one mode as CSS variables, for the Tailwind plugin to
 * emit under `:root` (light) and `.dark`. Triplets, not hex, so the classes
 * built on them keep their opacity modifiers (`border-sun/40`).
 */
export function cssVariables(mode: Mode): Record<string, string> {
  const n = NEUTRALS[mode];
  const out: Record<string, string> = {
    "--c-surface": rgbTriplet(n.surface),
    "--c-border": rgbTriplet(n.border),
    "--c-forecast": rgbTriplet(n.forecast),
    "--c-forecast-fill": rgbTriplet(n.forecastFill),
    "--c-house": rgbTriplet(n.house),
    "--c-gridline": rgbTriplet(n.gridline),
    "--c-baseline": rgbTriplet(n.baseline),
    "--c-hover-band": rgbTriplet(n.hoverBand),
    "--c-axis": rgbTriplet(n.axis),
    "--c-ink": rgbTriplet(n.ink),
    "--c-battery-charging": rgbTriplet(n.batteryCharging),
    "--c-local-forgone": rgbTriplet(n.localForgone),
  };
  for (const [shade, hex] of Object.entries(n.slate)) out[`--c-slate-${shade}`] = rgbTriplet(hex);
  for (const tone of Object.keys(HUES[mode]) as Tone[]) {
    out[`--c-${tone}`] = rgbTriplet(HUES[mode][tone]);
    out[`--c-${tone}-soft`] = rgbTriplet(TONES[mode][tone].soft);
    out[`--c-${tone}-ink`] = rgbTriplet(TONES[mode][tone].ink);
  }
  return out;
}

const v = (name: string) => `rgb(var(--c-${name}))`;

/**
 * What the charts draw with. Each is a reference to the mode's variable,
 * so an SVG painted with `PALETTE.sun` follows the switch like a Tailwind
 * class does — no chart re-renders on a theme change, the browser repaints.
 */
export const PALETTE = {
  sun: v("sun"),
  grid: v("grid"),
  local: v("local"),
  battery: v("battery"),
  vzev: v("vzev"),
  batteryCharging: v("battery-charging"),
  localForgone: v("local-forgone"),
  forecast: v("forecast"),
  forecastFill: v("forecast-fill"),
  house: v("house"),
  gridline: v("gridline"),
  baseline: v("baseline"),
  hoverBand: v("hover-band"),
  axis: v("axis"),
  ink: v("ink"),
  /** The card surface: what a hatch pattern's ground, a ribbon's halo and a ring's fill are painted in. */
  surface: v("surface"),
} as const;
