import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HaSyncResult, IntervalMetricKind } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

// Only site-level flows are pullable from Home Assistant: per-party
// consumption needs a party attached, which a single statistic can't express.
const SYNCABLE_KINDS: Array<{ kind: IntervalMetricKind; label: string; hint: string }> = [
  { kind: "production", label: "Production", hint: "Inverter AC yield" },
  { kind: "consumption_own", label: "Own consumption", hint: "Total household load" },
  { kind: "export_grid", label: "Export — grid", hint: "Fed into the grid" },
  { kind: "export_local", label: "Export — local", hint: "Total leaving the household" },
  { kind: "import_grid", label: "Import — grid", hint: "Drawn from the grid" },
  { kind: "battery_charge", label: "Battery charge", hint: "Energy into the battery" },
  { kind: "battery_discharge", label: "Battery discharge", hint: "Energy out of the battery" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function HomeAssistantPage() {
  const { site } = useDefaultSite();
  const statusQuery = useQuery({ queryKey: ["ha-status"], queryFn: api.homeAssistant.status });

  if (!site) return <p className="text-slate-500">Loading…</p>;
  const status = statusQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Home Assistant</h1>
        <p className="text-sm text-slate-500">
          Pulls energy statistics straight from Home Assistant instead of importing CSVs. It reads
          the long-term statistics (the same numbers the Energy dashboard uses), so meter resets are
          already accounted for.
        </p>
      </div>

      {status && !status.configured && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Not configured — set <code>HA_URL</code> and <code>HA_TOKEN</code> in the API environment,
          then restart it.
        </p>
      )}

      {status?.configured && (
        <>
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-600">
            Connected to <span className="font-medium text-slate-900">{status.url}</span>.{" "}
            {status.syncEnabled
              ? `Syncing automatically every ${status.syncIntervalMinutes} minutes.`
              : "Automatic sync is disabled."}
          </div>
          <MappingSection siteId={site.id} />
          <SyncSection siteId={site.id} />
        </>
      )}
    </div>
  );
}

function MappingSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const statsQuery = useQuery({ queryKey: ["ha-statistics"], queryFn: api.homeAssistant.statistics });
  const mapQuery = useQuery({
    queryKey: ["ha-mappings", siteId],
    queryFn: () => api.homeAssistant.mappings(siteId),
  });

  const setMutation = useMutation({
    mutationFn: (input: { metricKind: IntervalMetricKind; statisticId: string }) =>
      api.homeAssistant.setMapping(siteId, input),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["ha-mappings", siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.homeAssistant.removeMapping(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ha-mappings", siteId] }),
  });

  const byKind = new Map((mapQuery.data ?? []).map((m) => [m.metricKind, m]));
  // Home Assistant classifies statistics by unit; "energy" is the set that can
  // be read as kWh. Fall back to the unit string if an install doesn't report a
  // class, and always keep whatever is already mapped so a saved choice can
  // never silently vanish from its own dropdown.
  const mappedIds = new Set((mapQuery.data ?? []).map((m) => m.statisticId));
  const options = (statsQuery.data ?? []).filter(
    (s) =>
      s.unitClass === "energy" ||
      (s.unitClass === null && (s.unit === "kWh" || s.unit === "Wh")) ||
      mappedIds.has(s.statisticId),
  );

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Entity mapping</h2>
        <p className="mt-1 text-xs text-slate-500">
          Which Home Assistant statistic feeds each metric. Only statistics carrying a cumulative
          total are listed — those are the ones Home Assistant can report energy per period for.
        </p>
      </div>

      {statsQuery.isError && (
        <p className="text-sm text-red-600">Could not read the statistic list: {(statsQuery.error as Error).message}</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-4 font-medium">Metric</th>
            <th className="py-1 pr-4 font-medium">Home Assistant statistic</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {SYNCABLE_KINDS.map(({ kind, label, hint }) => {
            const current = byKind.get(kind);
            return (
              <tr key={kind} className="border-t align-middle">
                <td className="py-2 pr-4">
                  <div className="text-slate-900">{label}</div>
                  <div className="text-xs text-slate-500">{hint}</div>
                </td>
                <td className="py-2 pr-4">
                  <select
                    className="input w-full max-w-md"
                    value={current?.statisticId ?? ""}
                    disabled={statsQuery.isLoading || setMutation.isPending}
                    onChange={(e) => {
                      const statisticId = e.target.value;
                      if (statisticId === "") {
                        if (current) removeMutation.mutate(current.id);
                        return;
                      }
                      setMutation.mutate({ metricKind: kind, statisticId });
                    }}
                  >
                    <option value="">— not synced —</option>
                    {options.map((o) => (
                      <option key={o.statisticId} value={o.statisticId}>
                        {o.statisticId}
                        {o.name ? ` · ${o.name}` : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right text-xs text-slate-400">
                  {current ? "mapped" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SyncSection({ siteId }: { siteId: string }) {
  const [granularity, setGranularity] = useState<"quarter_hour" | "hour">("quarter_hour");
  const [useRange, setUseRange] = useState(false);
  const [from, setFrom] = useState(() => daysAgo(7));
  const [to, setTo] = useState(today);
  const [result, setResult] = useState<HaSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncMutation = useMutation({
    mutationFn: () =>
      api.homeAssistant.sync(siteId, {
        granularity,
        ...(useRange ? { from, to } : {}),
      }),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
    },
    onError: (err: Error) => setError(err.message),
  });

  const rangeValid = !useRange || (from !== "" && to !== "" && from <= to);

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Sync</h2>
        <p className="mt-1 text-xs text-slate-500">
          Home Assistant keeps 5-minute statistics for about 10 days and hourly ones indefinitely.
          Quarter-hour therefore only reaches back into that recent window; use hourly to backfill
          older history. Re-syncing a period is safe — rows are replaced, not duplicated.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Granularity
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            {(
              [
                ["quarter_hour", "Quarter-hour"],
                ["hour", "Hourly"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setGranularity(value)}
                className={`px-3 py-1.5 ${
                  granularity === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
          Specific date range
        </label>

        {useRange && (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
            </label>
          </>
        )}

        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || !rangeValid}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncMutation.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {!rangeValid && <p className="text-sm text-red-600">"To" must be on or after "From".</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-2 border-t pt-3 text-sm">
          <div className="flex flex-wrap gap-6">
            <span>
              <span className="font-semibold text-slate-900">{result.inserted}</span> inserted
            </span>
            <span>
              <span className="font-semibold text-slate-900">{result.updated}</span> updated
            </span>
            <span className="text-slate-500">
              {new Date(result.from).toLocaleString("en-CH", { timeZone: "Europe/Zurich" })} –{" "}
              {new Date(result.to).toLocaleString("en-CH", { timeZone: "Europe/Zurich" })}
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {result.metrics.map((m) => (
                <tr key={m.metricKind} className="border-t">
                  <td className="py-1 pr-4 text-slate-700">{m.metricKind}</td>
                  <td className="py-1 pr-4 text-slate-500">{m.statisticId}</td>
                  <td className="py-1 text-right text-slate-900">{m.rows} rows</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.skipped.length > 0 && (
            <ul className="list-inside list-disc text-xs text-amber-700">
              {result.skipped.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
