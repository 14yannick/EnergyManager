import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useI18n, useT, type MessageKey } from "./i18n/context";
import { useSession, type SessionState } from "./lib/useIdentity";
import { PeriodProvider } from "./lib/usePeriod";
import { DashboardPage } from "./pages/DashboardPage";
import { TariffPeriodsPage } from "./pages/TariffPeriodsPage";
import { CalculationDetailPage } from "./pages/CalculationDetailPage";
import { ReadingsImportPage } from "./pages/ReadingsImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { PartyDashboardPage } from "./pages/PartyDashboardPage";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  // `shrink-0` and `whitespace-nowrap`: between `sm` and `xl` the nav has its
  // own row and scrolls sideways rather than squashing seven labels into two
  // lines each. Below `sm` it is not this bar at all — see `MenuLinks`.
  `shrink-0 whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
  }`;

/** The same links stacked, where a row would have to be swiped to be read. */
const menuLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
  }`;

interface NavItem {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/**
 * Where a role may go. One list, rendered twice — as the bar and as the phone
 * menu — so the two can never drift apart.
 *
 * A participant sees their own consumption and their own invoices, nothing
 * else: every other page reads site-wide data the API refuses them.
 */
function navItems(participant: boolean): NavItem[] {
  return participant
    ? [
        { to: "/", label: "nav.consumption", end: true },
        { to: "/billing", label: "nav.billing" },
      ]
    : [
        // What the system did, then what it bills, then the inputs that
        // produced both — tariffs and readings — with the audit view last
        // before settings, because it is where you go to check the others.
        { to: "/", label: "nav.dashboard", end: true },
        { to: "/consumption", label: "nav.consumption" },
        { to: "/billing", label: "nav.billing" },
        { to: "/tariff-periods", label: "nav.tariffs" },
        { to: "/readings", label: "nav.readings" },
        { to: "/calculation", label: "nav.calculation" },
        { to: "/settings", label: "nav.settings" },
      ];
}

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
  if (session.kind === "loading" || session.kind === "none" || session.kind === "expired") return null;

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
      {session.kind === "active" && session.identity.simulated ? (
        // AUTH_DEV_AS: no Cloudflare session exists to leave, and the logout
        // path would only 404 locally. Say what this is instead.
        <span className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
          {t("session.preview")}
        </span>
      ) : (
        <a
          href={logoutHref()}
          className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
        >
          {t("session.signOut")}
        </a>
      )}
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
 * The session ended under the app — signed out in another tab, or a cookie
 * that expired while a page sat open. Cloudflare turned `/api/me` away, and
 * the only way back is a full navigation so Access can show its login.
 *
 * A fresh URL rather than `reload()`, so no cached copy of the shell can
 * answer it: the whole point is to reach the edge. And once only, guarded in
 * `sessionStorage` — if the page that comes back still cannot reach the API,
 * Access is letting the UI through but not `/api/`, and looping on it would
 * hide exactly the misconfiguration the README warns about.
 */
const RELOGIN_KEY = "energymanager.relogin";

function SessionExpired() {
  const t = useT();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let previous: string | null = null;
    try {
      previous = sessionStorage.getItem(RELOGIN_KEY);
    } catch {
      /* storage unavailable: fall through and try once */
    }
    if (previous && Date.now() - Number(previous) < 60_000) {
      setStuck(true);
      return;
    }
    try {
      sessionStorage.setItem(RELOGIN_KEY, String(Date.now()));
    } catch {
      /* same */
    }
    window.location.assign(`/?signin=${Date.now()}`);
  }, []);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <p>{stuck ? t("session.expiredStuck") : t("session.expired")}</p>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const participant = session.kind === "active" && session.identity.role === "participant";
  const items = navItems(participant);

  return (
    <PeriodProvider>
      <div className="min-h-screen bg-slate-50">
      {/* Kept out of print: the billing page prints participant invoices,
          and a nav bar on a document that goes to a neighbour is noise. */}
      {/* Sticky: these pages are long tables, and losing the nav after one
          screen means scrolling back to the top to go anywhere. Kept out of
          print: the billing page prints participant invoices, and a nav bar on
          a document that goes to a neighbour is noise. */}
      <header className="sticky top-0 z-20 border-b bg-white print:hidden">
        {/* Wraps below `xl`: the seven links plus the language switch and the
            session badge need about 1260px, so letting them try on anything
            narrower pushed the sign-out button off the side of the screen and
            gave every page a horizontal scrollbar. */}
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8 xl:flex-nowrap">
          <span className="text-lg font-semibold text-slate-900">{t("app.name")}</span>
          {/* Hidden for a rejected session: none of it leads anywhere, and it
              crowds out the one control that does.

              `order-last w-full` puts it on its own line under the brand until
              there is room beside it; `overflow-x-auto` keeps the overflow
              inside the bar instead of widening the page. Below `sm` even
              swiping could not reach the far links, and nothing said they were
              there, so the menu button takes over. */}
          <nav
            className={`order-last hidden w-full gap-1 overflow-x-auto sm:flex xl:order-none xl:w-auto xl:overflow-x-visible ${
              session.kind === "rejected" || session.kind === "expired" ? "sm:hidden" : ""
            }`}
          >
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {t(item.label)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <LanguageSwitch />
            <SessionBadge session={session} />
            {session.kind !== "rejected" && session.kind !== "expired" && (
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls="nav-menu"
                aria-label={t("nav.menu")}
                className="shrink-0 rounded-md border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-100 sm:hidden"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  {menuOpen ? (
                    <>
                      <line x1="5" y1="5" x2="15" y2="15" />
                      <line x1="15" y1="5" x2="5" y2="15" />
                    </>
                  ) : (
                    <>
                      <line x1="3" y1="6" x2="17" y2="6" />
                      <line x1="3" y1="10" x2="17" y2="10" />
                      <line x1="3" y1="14" x2="17" y2="14" />
                    </>
                  )}
                </svg>
              </button>
            )}
          </div>
        </div>
        {menuOpen && session.kind !== "rejected" && session.kind !== "expired" && (
          <nav id="nav-menu" className="border-t px-4 pb-3 pt-2 sm:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                // Closing on the way out: leaving the sheet open over the page
                // it just navigated to would hide the thing it was opened for.
                onClick={() => setMenuOpen(false)}
                className={menuLinkClass}
              >
                {t(item.label)}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
        {session.kind === "loading" ? (
          // Nothing until the role is known: rendering the admin routes in the
          // meantime had a participant's browser request the site list, which
          // the API refuses them.
          <p className="text-slate-500">{t("common.loading")}</p>
        ) : session.kind === "expired" ? (
          <SessionExpired />
        ) : session.kind === "rejected" ? (
          <NoAccess email={session.email} status={session.status} />
        ) : participant ? (
          <Routes>
            <Route path="/" element={<PartyDashboardPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/consumption" element={<PartyDashboardPage />} />
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
    </PeriodProvider>
  );
}
