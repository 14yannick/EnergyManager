import { NavLink, Route, Routes, Navigate } from "react-router-dom";
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

export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
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
