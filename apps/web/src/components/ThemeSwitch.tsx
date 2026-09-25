import { useT } from "../i18n/context";
import { THEME_CHOICES, useTheme, type ThemeChoice } from "../lib/theme";

/**
 * The appearance switch — the language switch's twin, for the same
 * reason: three choices, all one tap away, the chosen one set in ink.
 */
export function ThemeSwitch({ size = "sm" }: { size?: "sm" | "md" }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const pad = size === "md" ? "px-4 py-2 text-sm" : "px-2 py-1 text-xs";
  const label: Record<ThemeChoice, string> = {
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300" aria-label={t("profile.appearance")}>
      {THEME_CHOICES.map((choice, i) => (
        <button
          key={choice}
          type="button"
          onClick={() => setTheme(choice)}
          aria-pressed={theme === choice}
          className={`${pad} font-medium ${
            theme === choice ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
          } ${i === 1 ? "border-x border-slate-300" : ""}`}
        >
          {label[choice]}
        </button>
      ))}
    </div>
  );
}
