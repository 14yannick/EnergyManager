import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { api } from "./api/client";
import { DashboardPage } from "./pages/DashboardPage";
import { TariffPeriodsPage } from "./pages/TariffPeriodsPage";
import { CalculationDetailPage } from "./pages/CalculationDetailPage";
import { ReadingsImportPage } from "./pages/ReadingsImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillingPage } from "./pages/BillingPage";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
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
 * Identity, and a way out of the session — but only when there is one.
 *
 * `email` is the test rather than the role: with AUTH_ENABLED off every
 * caller is an admin with a null email, and offering to sign out of a session
 * that was never established would just 404 at the edge.
 */
function SessionBadge() {
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    // Who you are doesn't change while the tab is open; a failure here must
    // not retry in a loop behind a login redirect.
    staleTime: Infinity,
    retry: false,
  });

  if (!data?.email) return null;

  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      <span className="hidden text-slate-500 sm:inline">
        {data.email}
        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
          {data.role === "participant" && data.partyName ? data.partyName : data.role}
        </span>
      </span>
      <a
        href={logoutHref()}
        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
      >
        Sign out
      </a>
    </div>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Kept out of print: the billing page prints participant invoices,
          and a nav bar on a document that goes to a neighbour is noise. */}
      <header className="border-b bg-white print:hidden">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 lg:px-8">
          <span className="text-lg font-semibold text-slate-900">EnergyManager</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/tariff-periods" className={navLinkClass}>
              Tariff periods
            </NavLink>
            <NavLink to="/calculation" className={navLinkClass}>
              Calculation detail
            </NavLink>
            <NavLink to="/readings" className={navLinkClass}>
              Import readings
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              Settings
            </NavLink>
            <NavLink to="/billing" className={navLinkClass}>
              Facturation
            </NavLink>
          </nav>
          <SessionBadge />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
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
      </main>
    </div>
  );
}
