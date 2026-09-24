import { PALETTE, PRIMARY, TONES } from "./src/lib/palette";

/**
 * Colour tokens come from src/lib/palette.ts, the same module the charts
 * read their hex from — so `bg-grid-soft` on a card and the grid series in
 * the chart beside it are one definition, not two that happen to match.
 *
 * Per hue: `{tone}` is the categorical colour itself (an accent: swatches,
 * icons, borders, never text), `{tone}-soft` a tinted surface, `{tone}-ink`
 * the text colour legible on that surface.
 */
const tone = (name) => ({ DEFAULT: PALETTE[name], soft: TONES[name].soft, ink: TONES[name].ink });

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sun: tone("sun"),
        grid: tone("grid"),
        local: tone("local"),
        battery: tone("battery"),
        vzev: tone("vzev"),
        primary: { DEFAULT: PRIMARY.DEFAULT, hover: PRIMARY.hover },
      },
    },
  },
  plugins: [],
};
