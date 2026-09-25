import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Light, dark, or whatever the device says — kept in this browser, like
 * the language, since a theme is a property of the screen in front of you
 * rather than of your account. The mode itself is one class on <html>
 * (`dark`), which every colour token in tailwind.config.js reads; nothing
 * else in the app needs to know. index.html applies the stored choice
 * before the first paint from the same key.
 */

export type ThemeChoice = "light" | "dark" | "system";
export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"] as const;

const STORAGE_KEY = "em.theme";
const QUERY = "(prefers-color-scheme: dark)";

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Unreadable storage is not an error worth surfacing.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

/** The mode a choice resolves to right now. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

function apply(choice: ThemeChoice) {
  document.documentElement.classList.toggle("dark", resolveTheme(choice) === "dark");
}

interface ThemeValue {
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readStored);

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Same as above: a choice that cannot be kept still applies for the session.
    }
    if (theme !== "system") return;
    // Following the device means following it while the page is open, too:
    // a laptop that goes dark at sunset takes the app with it.
    const query = window.matchMedia(QUERY);
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((choice: ThemeChoice) => setThemeState(choice), []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
