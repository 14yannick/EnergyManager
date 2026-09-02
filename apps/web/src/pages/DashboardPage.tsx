import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SavingsQuery } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

type Granularity = NonNullable<SavingsQuery["granularity"]>;

function defaultFrom() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { site } = useDefaultSite();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(today());
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const unit = granularity === "monthly" ? "month" : "day";

  const summaryQuery = useQuery({
    queryKey: ["savings-summary", site?.id, from, to, granularity],
    queryFn: () => api.savings.summary(site!.id, from, to, granularity),
    enabled: !!site,
  });
  const cumulativeQuery = useQuery({
    queryKey: ["savings-cumulative", site?.id, from, to, granularity],
    queryFn: () => api.savings.cumulative(site!.id, from, to, granularity),
    enabled: !!site,
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Savings & payback</h1>
          <p className="text-sm text-slate-500">Mirrors the old spreadsheet's Summary sheet.</p>
        </div>
        <div className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </label>
          <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            View
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {(["daily", "monthly"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 capitalize ${
                    granularity === g ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {granularity === "monthly" && (
        <p className="text-xs text-slate-500">
          Monthly view: totals and payback are computed per calendar month (12/year), not per day —
          use this when your data only has monthly resolution (e.g. an inverter's monthly report),
          where the daily view's averages would be badly skewed.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total savings — with battery"
          value={summary?.totals.withBatteryChf}
          sub={summary ? `CHF ${summary.avgDaily.withBatteryChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Total savings — no battery"
          value={summary?.totals.withoutBatteryChf}
          sub={summary ? `CHF ${summary.avgDaily.withoutBatteryChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Battery-only savings"
          value={summary?.totals.batteryOnlyChf}
          sub={summary ? `CHF ${summary.avgDaily.batteryOnlyChf.toFixed(2)}/${unit} avg` : undefined}
        />
        <StatCard
          label="Battery arbitrage value"
          value={summary?.totals.batteryUpliftChf}
          sub={
            summary
              ? `CHF ${summary.avgDaily.batteryUpliftChf.toFixed(2)}/${unit} avg — self-consuming vs. exporting instead`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PaybackCard
          label="Payback — with battery"
          years={summary?.payback.withBatteryYears}
          breakeven={summary?.breakeven.withBatteryDate}
        />
        <PaybackCard
          label="Payback — no battery"
          years={summary?.payback.withoutBatteryYears}
          breakeven={summary?.breakeven.withoutBatteryDate}
        />
        <PaybackCard
          label="Payback — battery only"
          years={summary?.payback.batteryOnlyYears}
          breakeven={summary?.breakeven.batteryOnlyDate}
        />
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-700">Cumulative savings vs. cost</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeQuery.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="cumulativeWithBatteryChf"
                name="With battery"
                stroke="#0f172a"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeWithoutBatteryChf"
                name="No battery"
                stroke="#3b82f6"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeBatteryOnlyChf"
                name="Battery only"
                stroke="#f59e0b"
                dot={false}
              />
              {summary && summary.costs.total > 0 && (
                <ReferenceLine
                  y={summary.costs.total}
                  stroke="#0f172a"
                  strokeDasharray="4 4"
                  label={{ value: "Total cost", fontSize: 11, position: "insideTopLeft" }}
                />
              )}
              {summary && summary.costs.solar > 0 && (
                <ReferenceLine
                  y={summary.costs.solar}
                  stroke="#3b82f6"
                  strokeDasharray="4 4"
                  label={{ value: "Solar cost", fontSize: 11, position: "insideTopLeft" }}
                />
              )}
              {summary && summary.costs.battery > 0 && (
                <ReferenceLine
                  y={summary.costs.battery}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: "Battery cost", fontSize: 11, position: "insideTopLeft" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">
        {value != null ? `CHF ${value.toFixed(2)}` : "—"}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function PaybackCard({
  label,
  years,
  breakeven,
}: {
  label: string;
  years?: number | null;
  breakeven?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">
        {years != null ? `${years.toFixed(1)} years` : "—"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Breakeven: {breakeven ?? "not reached in range"}
      </p>
    </div>
  );
}
