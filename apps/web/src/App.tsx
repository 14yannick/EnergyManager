import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useI18n, useT } from "./i18n/context";
import { useSession, type SessionState } from "./lib/useIdentity";
import { DashboardPage } from "./pages/DashboardPage";
import { TariffPeriodsPage } from "./pages/TariffPeriodsPage";
import { CalculationDetailPage } from "./pages/CalculationDetailPage";
import { ReadingsImportPage } from "./pages/ReadingsImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillingPage } from "./pages/BillingPage";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  // `shrink-0` and `whitespace-nowrap`: the nav scrolls sideways on a phone
  // rather than squashing six labels into two lines each.
  `shrink-0 whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
  }`;

/**
 * Cloudflare Access ends a session by clearing its cookie at this path. It is
 * handled at the edge, so it never reaches our nginx or the API — and for the
 * same reason it only exists when the app is actually being served through
 * Cloudflare.
 *
 * `returnTo` sends the browser back to this app rather than leaving the user
 * on Cloudflare's own logout page. It is read from `location.origin` instead
 * of being written down, so the same build works on whatever hostname it is
 * served from — a second domain, a staging tunnel, or a LAN port.
 */
function logoutHref(): string {
  const returnTo = `${window.location.origin}/`;
  return `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * Identity, and a way out of the session — whenever there is one to leave.
 *
 * Deliberately not driven by a successful `/api/me`: somebody Cloudflare let
 * in but this app has no role for gets a 403 from every call, and keying the
 * button on the response would hide it from precisely the person who most
 * needs it — signed in, unable to use the app, unable to sign out and try
 * another account. With authentication off there is no session at all, and
 * the link would only 404 at the edge, so nothing is shown.
 */
function SessionBadge({ session }: { session: SessionState }) {
  const t = useT();
  if (session.kind === "loading" || session.kind === "none") return null;

  const email = session.kind === "active" ? session.identity.email : session.email;
  const label =
    session.kind === "active"
      ? session.identity.role === "participant" && session.identity.partyName
        ? session.identity.partyName
        : t(`role.${session.identity.role}`)
      : t("session.noAccess");

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
      {/* The address only appears where there is genuinely room for it beside
          the nav; below that the role chip alone says who you are. Both
          truncate, so neither a long address nor a long party name can push
          the sign-out button off the screen. */}
      <span className="hidden max-w-64 truncate align-middle text-slate-500 2xl:inline-block">
        {email}
      </span>
      <span
        className={`hidden max-w-40 shrink truncate rounded px-1.5 py-0.5 text-xs sm:inline-block ${
          session.kind === "active"
            ? "bg-slate-100 text-slate-600"
            : "bg-amber-100 text-amber-900"
        }`}
      >
        {label}
      </span>
      <a
        href={logoutHref()}
        className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
      >
        {t("session.signOut")}
      </a>
    </div>
  );
}

/**
 * The language switch. Buttons rather than a dropdown: with three choices a
 * select hides the alternatives behind a click, and the whole point of this
 * control is that the other languages are one tap away.
 */
function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      className="flex overflow-hidden rounded-md border border-slate-300 text-xs"
      aria-label={t("session.language")}
    >
      {(["fr", "de", "en"] as const).map((code) => (
        <button
          key={code}
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          className={`px-2 py-1 font-medium uppercase ${
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

/**
 * What a rejected session sees instead of the app.
 *
 * Every page would otherwise render a wall of failed requests, which says
 * nothing useful and buries the sign-out button. One statement of what
 * happened, and what to do about it.
 */
function NoAccess({ email, status }: { email: string | null; status: number }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <h1 className="text-base font-semibold">{t("noAccess.title")}</h1>
      {status === 403 ? (
        <>
          <p className="mt-2">
            {email ? t("noAccess.knownAs", { email }) : t("noAccess.unknown")}
          </p>
          <p className="mt-2">{t("noAccess.askAdmin")}</p>
        </>
      ) : (
        <p className="mt-2">{t("noAccess.unrecognised")}</p>
      )}
      <a
        href={logoutHref()}
        className="mt-4 inline-block rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
      >
        {t("session.signOut")}
      </a>
    </div>
  );
}

export function App() {
  const session = useSession();
  const t = useT();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Kept out of print: the billing page prints participant invoices,
          and a nav bar on a document that goes to a neighbour is noise. */}
      <header className="border-b bg-white print:hidden">
        {/* Wraps below `xl`: the six links plus the language switch and the
            session badge need about 1100px, so letting them try on anything
            narrower pushed the sign-out button off the side of the screen and
            gave every page a horizontal scrollbar. */}
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8 xl:flex-nowrap">
          <span className="text-lg font-semibold text-slate-900">{t("app.name")}</span>
          {/* Hidden for a rejected session: none of it leads anywhere, and it
              crowds out the one control that does.

              `order-last w-full` puts it on its own line under the brand until
              there is room beside it; `overflow-x-auto` keeps the overflow
              inside the bar instead of widening the page. */}
          <nav
            className={`order-last flex w-full gap-1 overflow-x-auto xl:order-none xl:w-auto xl:overflow-x-visible ${
              session.kind === "rejected" ? "hidden" : ""
            }`}
          >
            <NavLink to="/" end className={navLinkClass}>
              {t("nav.dashboard")}
            </NavLink>
            <NavLink to="/tariff-periods" className={navLinkClass}>
              {t("nav.tariffs")}
            </NavLink>
            <NavLink to="/calculation" className={navLinkClass}>
              {t("nav.calculation")}
            </NavLink>
            <NavLink to="/readings" className={navLinkClass}>
              {t("nav.readings")}
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              {t("nav.settings")}
            </NavLink>
            <NavLink to="/billing" className={navLinkClass}>
              {t("nav.billing")}
            </NavLink>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <LanguageSwitch />
            <SessionBadge session={session} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
        {session.kind === "rejected" ? (
          <NoAccess email={session.email} status={session.status} />
        ) : (
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tariff-periods" element={<TariffPeriodsPage />} />
            <Route path="/calculation" element={<CalculationDetailPage />} />
            {/* Investment costs moved into Settings; keep old links working. */}
            <Route path="/cost-items" element={<Navigate to="/settings" replace />} />
            <Route path="/readings" element={<ReadingsImportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
