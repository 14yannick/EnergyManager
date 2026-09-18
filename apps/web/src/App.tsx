import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useSession, type SessionState } from "./lib/useIdentity";
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
  if (session.kind === "loading" || session.kind === "none") return null;

  const email = session.kind === "active" ? session.identity.email : session.email;
  const label =
    session.kind === "active"
      ? session.identity.role === "participant" && session.identity.partyName
        ? session.identity.partyName
        : session.identity.role
      : "no access";

  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      <span className="hidden text-slate-500 sm:inline">
        {email}
        <span
          className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
            session.kind === "active"
              ? "bg-slate-100 text-slate-600"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {label}
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

/**
 * What a rejected session sees instead of the app.
 *
 * Every page would otherwise render a wall of failed requests, which says
 * nothing useful and buries the sign-out button. One statement of what
 * happened, and what to do about it.
 */
function NoAccess({ email, status }: { email: string | null; status: number }) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <h1 className="text-base font-semibold">No access</h1>
      {status === 403 ? (
        <>
          <p className="mt-2">
            {email ? (
              <>
                You are signed in as <span className="font-medium">{email}</span>, but that address
                is not set up in EnergyManager.
              </>
            ) : (
              "Your address is not set up in EnergyManager."
            )}
          </p>
          <p className="mt-2">
            Ask the administrator to add it to your participant entry, then reload this page. If you
            meant to use another account, sign out first.
          </p>
        </>
      ) : (
        <p className="mt-2">Your session was not recognised. Sign out and sign in again.</p>
      )}
      <a
        href={logoutHref()}
        className="mt-4 inline-block rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
      >
        Sign out
      </a>
    </div>
  );
}

export function App() {
  const session = useSession();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Kept out of print: the billing page prints participant invoices,
          and a nav bar on a document that goes to a neighbour is noise. */}
      <header className="border-b bg-white print:hidden">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 lg:px-8">
          <span className="text-lg font-semibold text-slate-900">EnergyManager</span>
          {/* Hidden for a rejected session: none of it leads anywhere, and it
              crowds out the one control that does. */}
          <nav className={`flex gap-1 ${session.kind === "rejected" ? "hidden" : ""}`}>
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
          <SessionBadge session={session} />
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
