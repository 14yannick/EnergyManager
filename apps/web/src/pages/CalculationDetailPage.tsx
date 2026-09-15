import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DailySavings, SavingsQuery } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

/**
 * Every figure behind a revenue number, per period, so a total on the dashboard
 * can be traced to the energy and the rate it came from.
 *
 * Deliberately flat and wide rather than summarised: this is the view for
 * checking the engine's arithmetic, and for exporting it somewhere it can be
 * checked against an invoice.
 */
interface Column {
  key: keyof DailySavings;
  label: string;
  unit: "kWh" | "CHF" | "CHF/kWh";
  /** Where the number comes from, shown on hover. */
  note?: string;
}

const ENERGY: Column[] = [
  { key: "producedKwh", label: "Production", unit: "kWh", note: "PV's share of inverter AC output" },
  { key: "directUseKwh", label: "Direct use", unit: "kWh", note: "production − export" },
  { key: "exportedKwh", label: "Export (grid)", unit: "kWh" },
  { key: "exportLocalKwh", label: "Export (total)", unit: "kWh" },
  { key: "neighborConsumptionKwh", label: "Neighbour draw", unit: "kWh" },
  { key: "batteryChargeKwh", label: "Battery charge", unit: "kWh", note: "DC" },
  { key: "batteryDischargeKwh", label: "Battery discharge", unit: "kWh", note: "AC share" },
  { key: "batteryDischargeConsumedKwh", label: "…of which used", unit: "kWh" },
  { key: "batteryDischargeExportedKwh", label: "…of which exported", unit: "kWh" },
];

const RATES: Column[] = [
  { key: "purchaseRateChfPerKwh", label: "Purchase rate", unit: "CHF/kWh" },
  { key: "sellRateChfPerKwh", label: "Feed-in rate", unit: "CHF/kWh" },
  { key: "neighborSellRateChfPerKwh", label: "Neighbour rate", unit: "CHF/kWh" },
];

const MONEY: Column[] = [
  { key: "directConsumptionRevenueChf", label: "Direct consumption", unit: "CHF", note: "direct use × purchase" },
  { key: "directExportRevenueChf", label: "Direct export", unit: "CHF", note: "export revenue less the battery's share" },
  { key: "batteryDischargeConsumedValueChf", label: "Battery → house", unit: "CHF", note: "× purchase" },
  { key: "batteryDischargeExportedValueChf", label: "Battery → grid", unit: "CHF", note: "× feed-in" },
  { key: "batteryChargingCostChf", label: "Charging cost", unit: "CHF", note: "export forgone, after conversion loss" },
  { key: "batteryRevenueChf", label: "Battery net", unit: "CHF", note: "to house + to grid − charging" },
  { key: "neighborSellRevenueChf", label: "Neighbour sales", unit: "CHF" },
  { key: "selfConsumptionValueChf", label: "Self-consumption value", unit: "CHF", note: "(discharge + direct use) × purchase" },
  { key: "exportRevenueChf", label: "Export revenue", unit: "CHF", note: "export × feed-in" },
  { key: "savingsWithBatteryChf", label: "Total (with battery)", unit: "CHF" },
  { key: "savingsWithoutBatteryChf", label: "Total (no battery)", unit: "CHF" },
  { key: "batteryOnlySavingsChf", label: "Battery-only saving", unit: "CHF" },
];

const ALL = [...ENERGY, ...RATES, ...MONEY];

function fmt(v: number | null | undefined, unit: Column["unit"]): string {
  if (v == null) return "—";
  return unit === "kWh" ? v.toFixed(2) : unit === "CHF" ? v.toFixed(3) : v.toFixed(5);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function CalculationDetailPage() {
  const { site } = useDefaultSite();
  const [from, setFrom] = useState(monthsAgo(1));
  const [to, setTo] = useState(today());
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const query = useQuery({
    queryKey: ["savings-detail", site?.id, from, to, granularity],
    queryFn: () => api.savings.daily(site!.id, from, to, granularity),
    enabled: !!site,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);

  function exportCsv() {
    const head = ["period", ...ALL.map((c) => `${c.label} (${c.unit})`)];
    const body = rows.map((r) => [
      r.date,
      ...ALL.map((c) => {
        const v = r[c.key];
        return typeof v === "number" ? String(v) : "";
      }),
    ]);
    // Semicolon-separated: Excel in a de-CH locale splits on ; and would
    // otherwise put every row in one cell.
    const csv = [head, ...body].map((line) => line.join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `energymanager-detail-${from}_${to}_${granularity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!site) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Calculation detail</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Every quantity behind the dashboard's revenue figures, per period, in kWh and CHF. Rates
          are blank on a period that mixes more than one — there is no single rate to show.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          From
          <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          To
          <input type="date" className="input" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Period
          <select className="input" value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}>
            {(["hourly", "daily", "monthly", "quarterly", "yearly", "overall"] as const).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Export CSV
        </button>
        <span className="text-xs text-slate-500">{rows.length} periods</span>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="sticky left-0 bg-slate-100 px-3 py-2 text-left font-medium">Period</th>
              {ALL.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium" title={c.note}>
                  {c.label}
                  <span className="block font-normal text-slate-400">{c.unit}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-t">
                <td className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium text-slate-700">
                  {r.date}
                </td>
                {ALL.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700">
                    {fmt(r[c.key] as number | null, c.unit)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={ALL.length + 1} className="px-3 py-6 text-center text-slate-400">
                  Nothing in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
