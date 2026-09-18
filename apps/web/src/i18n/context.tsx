import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { de } from "./de";
import { en } from "./en";
import { fr } from "./fr";

export type Locale = "en" | "fr" | "de";
export type MessageKey = keyof typeof en;

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, fr, de };

/**
 * Regional tag for `Intl`. Swiss in both cases: thousands separators, the
 * 24-hour clock and DD.MM.YYYY dates are what a bill printed here has to
 * look like, whichever language it is written in.
 */
const INTL_TAG: Record<Locale, string> = { en: "en-CH", fr: "fr-CH", de: "de-CH" };

const STORAGE_KEY = "em.locale";

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "fr" || v === "de";
}

/**
 * The language to start in.
 *
 * A stored choice wins. Otherwise the browser's own, when we speak it —
 * falling back to French rather than English, because this app is read by a
 * French-speaking community and a browser asking for something we don't have
 * is more likely to be theirs than a visitor's.
 *
 * Storage can throw (private windows, blocked site data), so every access is
 * guarded and a failure just means falling back to detection.
 */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Unreadable storage is not an error worth surfacing.
  }
  const preferred = (typeof navigator === "undefined" ? "" : navigator.language).toLowerCase();
  if (preferred.startsWith("en")) return "en";
  if (preferred.startsWith("de")) return "de";
  return "fr";
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** BCP-47 tag for `Intl` and `toLocaleString`. */
  tag: string;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    // Screen readers and the browser's own translation prompt both read this.
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies to this tab; it just won't be remembered.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      // English is the fallback catalogue rather than the key itself: a
      // missing French string should read as English, not as `billing.total`.
      const template = CATALOGUES[locale][key] ?? en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, tag: INTL_TAG[locale], t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside an I18nProvider");
  return value;
}

/** The common case: just the translate function. */
export function useT(): Translate {
  return useI18n().t;
}
