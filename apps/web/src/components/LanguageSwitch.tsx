import { useI18n } from "../i18n/context";

/**
 * The language switch. Buttons rather than a dropdown: with three choices a
 * select hides the alternatives behind a click, and the whole point of this
 * control is that the other languages are one tap away.
 */
export function LanguageSwitch({ size = "sm" }: { size?: "sm" | "md" }) {
  const { locale, setLocale, t } = useI18n();
  const pad = size === "md" ? "px-4 py-2 text-sm" : "px-2 py-1 text-xs";
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-slate-300"
      aria-label={t("session.language")}
    >
      {(["fr", "de", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          className={`${pad} font-medium uppercase ${
            locale === code
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-500 hover:bg-slate-50"
          } ${code === "de" ? "border-x border-slate-300" : ""}`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
