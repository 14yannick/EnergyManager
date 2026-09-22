import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { useT, type MessageKey } from "./i18n/context";
import { useSession } from "./lib/useIdentity";
import { logoutHref } from "./lib/session";
import { PeriodProvider } from "./lib/usePeriod";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { DashboardPage } from "./pages/DashboardPage";
import { TariffPeriodsPage } from "./pages/TariffPeriodsPage";
import { CalculationDetailPage } from "./pages/CalculationDetailPage";
import { ReadingsImportPage } from "./pages/ReadingsImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { PartyDashboardPage } from "./pages/PartyDashboardPage";
import { ProfilePage } from "./pages/ProfilePage";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  // `shrink-0` and `whitespace-nowrap`: below `xl` the nav has its own row
  // and scrolls sideways rather than squashing eight labels into two lines
  // each.
  `shrink-0 whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
  }`;

interface NavItem {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/**
 * Where a role may go.
 *
 * A participant sees their own consumption and their own invoices, nothing
 * else: every other page reads site-wide data the API refuses them. Profile
 * follows billing for everyone — it is where the session and the language
 * live, and on a phone it is the last of the tabs that matter day to day.
 */
function navItems(participant: boolean): NavItem[] {
  return participant
    ? [
        { to: "/", label: "nav.consumption", end: true },
        { to: "/billing", label: "nav.billing" },
        { to: "/profile", label: "nav.profile" },
      ]
    : [
        // What the system did, then what it bills, then the inputs that
        // produced both — tariffs and readings — with the audit view last
        // before settings, because it is where you go to check the others.
        { to: "/", label: "nav.dashboard", end: true },
        { to: "/consumption", label: "nav.consumption" },
        { to: "/billing", label: "nav.billing" },
        { to: "/profile", label: "nav.profile" },
        { to: "/tariff-periods", label: "nav.tariffs" },
        { to: "/readings", label: "nav.readings" },
        { to: "/calculation", label: "nav.calculation" },
        { to: "/settings", label: "nav.settings" },
      ];
}

/**
 * The tabs. One row at every width: on a phone it scrolls sideways, and the
 * active tab is scrolled into view on arrival so the far end of an admin's
 * eight links is never silently off-screen.
 */
function NavBar({ items }: { items: NavItem[] }) {
  const t = useT();
  const { pathname } = useLocation();
  useEffect(() => {
    document
      .querySelector('header nav a[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav className="order-last flex w-full gap-1 overflow-x-auto xl:order-none xl:w-auto xl:overflow-x-visible">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
          {t(item.label)}
        </NavLink>
      ))}
    </nav>
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
 * nothing useful. One statement of what happened, and what to do about it —
 * with the sign-out right here, since there is no profile page to reach:
 * somebody Cloudflare let in but this app has no role for is precisely the
 * person who most needs a way out to try another account.
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={logoutHref()}
          className="inline-block rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
        >
          {t("session.signOut")}
        </a>
        <LanguageSwitch />
      </div>
    </div>
  );
}

export function App() {
  const session = useSession();
  const t = useT();
  const participant = session.kind === "active" && session.identity.role === "participant";
  const items = navItems(participant);
  // Hidden for a rejected session: none of it leads anywhere.
  const showNav = session.kind !== "rejected" && session.kind !== "expired";

  return (
    <PeriodProvider>
      <div className="min-h-screen bg-slate-50">
      {/* Sticky: these pages are long tables, and losing the nav after one
          screen means scrolling back to the top to go anywhere. Kept out of
          print: the billing page prints participant invoices, and a nav bar on
          a document that goes to a neighbour is noise. */}
      <header className="sticky top-0 z-20 border-b bg-white print:hidden">
        {/* The tabs wrap under the brand below `xl` (`order-last w-full` in
            NavBar) and sit beside it above. */}
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8 xl:flex-nowrap">
          <span className="text-lg font-semibold text-slate-900">{t("app.name")}</span>
          {showNav && <NavBar items={items} />}
        </div>
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
            <Route path="/profile" element={<ProfilePage />} />
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
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      </div>
    </PeriodProvider>
  );
}
