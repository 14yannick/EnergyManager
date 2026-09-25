import plugin from "tailwindcss/plugin";
import { PRIMARY, cssVariables } from "./src/lib/palette";

/**
 * Colour tokens come from src/lib/palette.ts, the same module the charts
 * read from — so `bg-grid-soft` on a card and the grid series in the chart
 * beside it are one definition, not two that happen to match.
 *
 * Every token is a CSS variable, emitted below under `:root` for light and
 * `.dark` for dark, and each Tailwind colour here refers to its variable.
 * That is what makes dark mode a class on <html> rather than a `dark:`
 * twin on every one of the app's five hundred slate classes: the classes
 * stay as written, the variables behind them turn round. See palette.ts
 * for what each shade becomes.
 *
 * Per hue: `{tone}` is the categorical colour itself (an accent: swatches,
 * icons, borders, never text), `{tone}-soft` a tinted surface, `{tone}-ink`
 * the text colour legible on that surface.
 */
const ref = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const tone = (name) => ({ DEFAULT: ref(name), soft: ref(`${name}-soft`), ink: ref(`${name}-ink`) });
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        white: ref("surface"),
        slate: Object.fromEntries(SHADES.map((s) => [s, ref(`slate-${s}`)])),
        sun: tone("sun"),
        grid: tone("grid"),
        local: tone("local"),
        battery: tone("battery"),
        vzev: tone("vzev"),
        primary: { DEFAULT: PRIMARY.DEFAULT, hover: PRIMARY.hover },
      },
      borderColor: {
        DEFAULT: ref("border"),
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      const light = cssVariables("light");
      const dark = cssVariables("dark");
      addBase({
        ":root": { ...light, colorScheme: "light" },
        ".dark": { ...dark, colorScheme: "dark" },
        // Paper is white whatever the screen was: an invoice printed from a
        // dark session must not come out as a dark sheet.
        "@media print": { ".dark": { ...light, colorScheme: "light" } },
      });
    }),
  ],
};
