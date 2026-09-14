import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HaSyncResult, IntervalMetricKind, Site, SiteUpdateInput } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

// Only site-level flows are pullable from Home Assistant: per-party
// consumption needs a party attached, which a single statistic can't express.
// `production` and `battery_discharge_ac` are deliberately absent: the inverter
// reports one AC figure covering both PV and battery discharge, so those two
// are derived by splitting it rather than read from a sensor. Offering them
// here would invite mapping a sensor that then gets overwritten every sync.
const SYNCABLE_KINDS: Array<{ kind: IntervalMetricKind; label: string; hint: string }> = [
  { kind: "inverter_ac", label: "Inverter AC output", hint: "Total AC yield — PV and battery combined" },
  { kind: "pv_dc", label: "PV yield (DC)", hint: "Panel output, used to split the AC figure" },
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

export function SettingsPage() {
  const { site } = useDefaultSite();
  const statusQuery = useQuery({ queryKey: ["ha-status"], queryFn: api.homeAssistant.status });

  if (!site) return <p className="text-slate-500">Loading…</p>;
  const status = statusQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">
          Investment totals used for payback, and the Home Assistant connection that supplies the
          energy data.
        </p>
      </div>

      <ProductionStartSection site={site} />

      <InvestmentSection siteId={site.id} />

      <div>
        <h2 className="text-sm font-medium text-slate-700">Home Assistant</h2>
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

      <p className="mt-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Production</span> and{" "}
        <span className="font-medium text-slate-600">battery discharge (AC)</span> are not listed
        because they are not sensors. The inverter reports a single AC figure covering both the
        panels and the battery, so the two are derived from it after each sync, split in proportion
        to the DC each source supplied. That is what stops solar being recorded at midnight.
      </p>
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


/**
 * Investment totals, as two numbers rather than the itemised list on the
 * Investment costs page. Each input maps to the single cost item of that
 * category; if a category has several (separate invoices, a subsidy booked
 * separately) editing here would be ambiguous, so the field goes read-only and
 * points at the full page instead.
 */
function InvestmentSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["cost-items", siteId],
    queryFn: () => api.costItems.list(siteId),
  });
  const items = itemsQuery.data ?? [];

  const save = useMutation({
    mutationFn: async ({ category, amount }: { category: "battery" | "solar"; amount: number }) => {
      const existing = items.filter((i) => i.category === category);
      if (existing.length === 1) {
        const it = existing[0]!;
        return api.costItems.update(it.id, {
          category,
          label: it.label,
          amountChf: amount,
          incurredOn: it.incurredOn ?? undefined,
          notes: it.notes ?? undefined,
        });
      }
      return api.costItems.create(siteId, {
        category,
        label: category === "battery" ? "Battery" : "Solar",
        amountChf: amount,
      });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["cost-items", siteId] });
      void queryClient.invalidateQueries({ queryKey: ["cost-items-summary", siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function rowFor(category: "battery" | "solar") {
    const matching = items.filter((i) => i.category === category);
    const total = matching.reduce((sum, i) => sum + i.amountChf, 0);
    return { matching, total, editable: matching.length <= 1 };
  }

  const battery = rowFor("battery");
  const solar = rowFor("solar");
  const total = battery.total + solar.total;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Investment</h2>
        <p className="text-xs text-slate-500">
          What the system cost, used for payback and breakeven. Enter subsidies and tax reductions
          as negative amounts on the Investment costs page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {([
          ["battery", "Battery", battery],
          ["solar", "Solar", solar],
        ] as const).map(([category, label, row]) => (
          <div key={category} className="rounded-lg border bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            {row.editable ? (
              <input
                type="number"
                step="0.01"
                className="input mt-1 w-full text-lg"
                value={draft[category] ?? (row.matching[0]?.amountChf ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [category]: e.target.value }))}
                onBlur={(e) => {
                  const amount = Number(e.target.value);
                  if (e.target.value === "" || Number.isNaN(amount)) return;
                  if (amount === row.matching[0]?.amountChf) return;
                  save.mutate({ category, amount });
                }}
              />
            ) : (
              <>
                <p className="mt-1 text-lg text-slate-700">CHF {row.total.toFixed(2)}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {row.matching.length} items — edit on the Investment costs page
                </p>
              </>
            )}
          </div>
        ))}
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Total</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">CHF {total.toFixed(2)}</p>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}


/**
 * When the PV system started producing. Payback divides investment cost by
 * average savings per period, so counting days before the panels existed drags
 * that average down and overstates payback. The dashboard clamps its range to
 * this date.
 *
 * Unset means "not stated", and everything falls back to the first day with
 * recorded production — shown here as the placeholder so the fallback is
 * visible rather than implied.
 */
function ProductionStartSection({ site }: { site: Site }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const rangeQuery = useQuery({
    queryKey: ["readings-range", site.id],
    queryFn: () => api.readings.range(site.id),
  });
  const firstProduction = rangeQuery.data?.firstProduction ?? null;

  const save = useMutation({
    mutationFn: (input: SiteUpdateInput) =>
      api.sites.update(site.id, { productionStartDate: site.productionStartDate, ...input }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Production start</h2>
        <p className="text-xs text-slate-500">
          When the system started producing. The dashboard will not measure payback over days
          before this, which would otherwise count as periods that earned nothing.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Production start date
          <input
            type="date"
            className="input"
            max={new Date().toISOString().slice(0, 10)}
            value={site.productionStartDate ?? firstProduction ?? ""}
            onChange={(e) =>
              save.mutate({ productionStartDate: e.target.value === "" ? null : e.target.value })
            }
          />
        </label>
        {site.productionStartDate == null && firstProduction && (
          <p className="text-xs text-slate-400">
            Not stated — defaulting to {firstProduction}, the first day with recorded production.
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Battery conversion loss (%)
          <input
            type="number"
            step="0.1"
            min="0"
            max="90"
            className="input w-28"
            defaultValue={(site.batteryConversionLoss * 100).toFixed(1)}
            onBlur={(e) => {
              const pct = Number(e.target.value);
              if (e.target.value === "" || Number.isNaN(pct)) return;
              const fraction = pct / 100;
              if (fraction === site.batteryConversionLoss) return;
              save.mutate({ batteryConversionLoss: fraction });
            }}
          />
          <span className="max-w-56 font-normal text-slate-400">
            Charging is metered DC but everything priced is AC, so the export it displaced is
            reduced by this before being charged against the battery.
          </span>
        </label>
        {site.productionStartDate != null && (
          <button
            type="button"
            onClick={() => save.mutate({ productionStartDate: null })}
            className="text-xs text-slate-400 hover:text-slate-900"
          >
            Reset to first recorded production
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
