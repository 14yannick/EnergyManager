import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HaSyncResult, IntervalMetricKind, Site, SiteUpdateInput } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";
import { useI18n, useT, type MessageKey } from "../i18n/context";
import { useCanEdit } from "../lib/useIdentity";

/**
 * One labelled control with its explanation underneath.
 *
 * The two forms on this page each had their own idea of a field — different
 * label colours, three different input widths, hints that wrapped at whatever
 * width the flex row happened to leave. Sharing one component, laid out on
 * `FIELD_GRID`, is what makes a label, an input and a hint line up with their
 * counterparts in the section above or below.
 *
 * Read-only figures pass `readOnly` so the wrapper is not a `<label>` with no
 * control to point at.
 */
function Field({
  label,
  hint,
  readOnly,
  children,
}: {
  label: string;
  hint?: string;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const Wrapper = readOnly ? "div" : "label";
  return (
    <Wrapper className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-snug text-slate-400">{hint}</span> : null}
    </Wrapper>
  );
}

/** Equal columns, so fields align across every card on the page. */
const FIELD_GRID = "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:max-w-4xl";

/**
 * A computed figure standing in a field's place. Bordered transparently so it
 * is exactly as tall as an input and the row does not step.
 */
function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-transparent px-2 py-1.5 text-sm font-semibold text-slate-900">
      {children}
    </p>
  );
}

// Only site-level flows are pullable from Home Assistant: per-party
// consumption needs a party attached, which a single statistic can't express.
// `production` and `battery_discharge_ac` are deliberately absent: the inverter
// reports one AC figure covering both PV and battery discharge, so those two
// are derived by splitting it rather than read from a sensor. Offering them
// here would invite mapping a sensor that then gets overwritten every sync.
const SYNCABLE_KINDS: Array<{ kind: IntervalMetricKind; label: MessageKey; hint: MessageKey }> = [
  { kind: "inverter_ac", label: "settings.metric.inverterAc", hint: "settings.metric.inverterAcHint" },
  { kind: "pv_dc", label: "settings.metric.pvDc", hint: "settings.metric.pvDcHint" },
  {
    kind: "consumption_own",
    label: "settings.metric.ownConsumption",
    hint: "settings.metric.ownConsumptionHint",
  },
  { kind: "export_grid", label: "settings.metric.exportGrid", hint: "settings.metric.exportGridHint" },
  {
    kind: "export_local",
    label: "settings.metric.exportLocal",
    hint: "settings.metric.exportLocalHint",
  },
  { kind: "import_grid", label: "settings.metric.importGrid", hint: "settings.metric.importGridHint" },
  {
    kind: "battery_charge",
    label: "settings.metric.batteryCharge",
    hint: "settings.metric.batteryChargeHint",
  },
  {
    kind: "battery_discharge",
    label: "settings.metric.batteryDischarge",
    hint: "settings.metric.batteryDischargeHint",
  },
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
  const t = useT();
  // Everything on this page is an admin-only write in the API's policy table,
  // so the whole page reads rather than edits for anyone else. The controls
  // are left visible on purpose: a viewer being shown the current
  // configuration is useful, being shown buttons that 403 is not.
  const { canEdit, isKnown } = useCanEdit();
  const statusQuery = useQuery({ queryKey: ["ha-status"], queryFn: api.homeAssistant.status });

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;
  const status = statusQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("settings.title")}</h1>
        <p className="text-sm text-slate-500">{t("settings.intro")}</p>
      </div>

      {/* Only once the role is actually known, so an admin never sees this
          flash by while `/api/me` is still in flight. */}
      {isKnown && !canEdit && (
        <p className="rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-600">
          {t("common.readOnly")}
        </p>
      )}

      <ProductionStartSection site={site} canEdit={canEdit} />

      <InvestmentSection siteId={site.id} canEdit={canEdit} />

      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.ha")}</h2>
        <p className="text-sm text-slate-500">{t("settings.haIntro")}</p>
      </div>

      {status && !status.configured && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {t("settings.haUnconfigured")}
        </p>
      )}

      {status?.configured && (
        <>
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-600">
            {t("settings.haConnected", { url: status.url ?? "" })}{" "}
            {status.syncEnabled
              ? t("settings.haSyncing", { minutes: status.syncIntervalMinutes ?? 0 })
              : t("settings.haSyncOff")}
          </div>
          <MappingSection site={site} canEdit={canEdit} />
          <LiveViewSection site={site} canEdit={canEdit} />
          <SyncSection siteId={site.id} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}

function MappingSection({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const t = useT();
  const siteId = site.id;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const statsQuery = useQuery({ queryKey: ["ha-statistics"], queryFn: api.homeAssistant.statistics });
  const mapQuery = useQuery({
    queryKey: ["ha-mappings", siteId],
    queryFn: () => api.homeAssistant.mappings(siteId),
  });
  // Not a statistic (no `sum`), so it never appears in statsQuery above —
  // this is what makes it possible to select a live price-forecast sensor
  // by name instead of typing it.
  const tariffEntitiesQuery = useQuery({
    queryKey: ["ha-dynamic-tariff-entities"],
    queryFn: api.homeAssistant.dynamicTariffEntities,
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
  const tariffSave = useMutation({
    mutationFn: (dynamicTariffEntityId: string | null) => api.sites.update(siteId, { dynamicTariffEntityId }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err: Error) => setError(err.message),
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

  // Same "never let a saved choice vanish from its own dropdown" rule as
  // above: if the stored entity isn't among the candidates Home Assistant
  // currently reports (renamed, or HA briefly unreachable), it still gets an
  // option so it stays visibly selected rather than silently blank.
  const tariffOptions = tariffEntitiesQuery.data ?? [];
  const currentTariffEntity = site.dynamicTariffEntityId;
  const tariffOptionList =
    currentTariffEntity && !tariffOptions.some((o) => o.entityId === currentTariffEntity)
      ? [...tariffOptions, { entityId: currentTariffEntity, friendlyName: null, priceComponent: null, unit: null }]
      : tariffOptions;

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.mapping")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("settings.mappingNote")}</p>
      </div>

      {statsQuery.isError && (
        <p className="text-sm text-red-600">
          {t("settings.statListFailed", { message: (statsQuery.error as Error).message })}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-4 font-medium">{t("settings.metric")}</th>
            <th className="py-1 pr-4 font-medium">{t("settings.haStatistic")}</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {SYNCABLE_KINDS.map(({ kind, label, hint }) => {
            const current = byKind.get(kind);
            return (
              <tr key={kind} className="border-t align-middle">
                <td className="py-2 pr-4">
                  <div className="text-slate-900">{t(label)}</div>
                  <div className="text-xs text-slate-500">{t(hint)}</div>
                </td>
                <td className="py-2 pr-4">
                  <select
                    className="input w-full max-w-md"
                    value={current?.statisticId ?? ""}
                    disabled={!canEdit || statsQuery.isLoading || setMutation.isPending}
                    onChange={(e) => {
                      const statisticId = e.target.value;
                      if (statisticId === "") {
                        if (current) removeMutation.mutate(current.id);
                        return;
                      }
                      setMutation.mutate({ metricKind: kind, statisticId });
                    }}
                  >
                    <option value="">{t("settings.notSynced")}</option>
                    {options.map((o) => (
                      <option key={o.statisticId} value={o.statisticId}>
                        {o.statisticId}
                        {o.name ? ` · ${o.name}` : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right text-xs text-slate-400">
                  {current ? t("settings.mapped") : ""}
                </td>
              </tr>
            );
          })}
          {/* A different kind of setting — a price feed, not an energy flow —
              so it gets a heavier top border, same convention as a totals
              row elsewhere in the app. */}
          <tr className="border-t-2 border-slate-300 align-middle">
            <td className="py-2 pr-4">
              <div className="text-slate-900">{t("settings.dynamicTariffEntity")}</div>
              <div className="text-xs text-slate-500">{t("settings.dynamicTariffEntityHint")}</div>
            </td>
            <td className="py-2 pr-4">
              <select
                className="input w-full max-w-md"
                value={currentTariffEntity ?? ""}
                disabled={!canEdit || tariffEntitiesQuery.isLoading || tariffSave.isPending}
                onChange={(e) => tariffSave.mutate(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">{t("settings.notSynced")}</option>
                {tariffOptionList.map((o) => (
                  <option key={o.entityId} value={o.entityId}>
                    {o.entityId}
                    {o.friendlyName ? ` · ${o.friendlyName}` : ""}
                    {o.priceComponent ? ` (${o.priceComponent})` : ""}
                  </option>
                ))}
              </select>
            </td>
            <td className="py-2 text-right text-xs text-slate-400">
              {currentTariffEntity ? t("settings.mapped") : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {tariffEntitiesQuery.isError && (
        <p className="text-sm text-red-600">
          {t("settings.statListFailed", { message: (tariffEntitiesQuery.error as Error).message })}
        </p>
      )}

      <p className="mt-3 text-xs text-slate-500">{t("settings.derivedNote")}</p>
    </div>
  );
}

/** Which live entity feeds each figure on the participants' "right now" view. */
const LIVE_FIELDS: Array<{
  field: "liveExportPowerEntityId" | "livePvPowerEntityId" | "forecastTodayEntityId" | "forecastRemainingEntityId" | "forecastTomorrowEntityId";
  label: MessageKey;
  hint: MessageKey;
  deviceClass: "power" | "energy";
}> = [
  { field: "liveExportPowerEntityId", label: "settings.live.export", hint: "settings.live.exportHint", deviceClass: "power" },
  { field: "livePvPowerEntityId", label: "settings.live.pv", hint: "settings.live.pvHint", deviceClass: "power" },
  { field: "forecastTodayEntityId", label: "settings.live.today", hint: "settings.live.todayHint", deviceClass: "energy" },
  { field: "forecastRemainingEntityId", label: "settings.live.remaining", hint: "settings.live.remainingHint", deviceClass: "energy" },
  { field: "forecastTomorrowEntityId", label: "settings.live.tomorrow", hint: "settings.live.tomorrowHint", deviceClass: "energy" },
];

/**
 * The live view's sensors, kept apart from the entity mapping above: those
 * are statistics pulled into history on a timer, these are instantaneous
 * readings fetched only while somebody is looking at them. Nothing here is
 * ever written to the database.
 */
function LiveViewSection({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const powerQuery = useQuery({
    queryKey: ["ha-sensors", "power"],
    queryFn: () => api.homeAssistant.sensors("power"),
  });
  const energyQuery = useQuery({
    queryKey: ["ha-sensors", "energy"],
    queryFn: () => api.homeAssistant.sensors("energy"),
  });

  const save = useMutation({
    mutationFn: (input: SiteUpdateInput) => api.sites.update(site.id, input),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const loading = powerQuery.isLoading || energyQuery.isLoading;
  const listFor = (deviceClass: "power" | "energy") =>
    (deviceClass === "power" ? powerQuery.data : energyQuery.data) ?? [];

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.live")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("settings.liveNote")}</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {(powerQuery.isError || energyQuery.isError) && (
        <p className="text-sm text-red-600">
          {t("settings.statListFailed", {
            message: ((powerQuery.error ?? energyQuery.error) as Error).message,
          })}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-4 font-medium">{t("settings.live.figure")}</th>
              <th className="py-1 pr-4 font-medium">{t("settings.haSensor")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {LIVE_FIELDS.map(({ field, label, hint, deviceClass }) => {
              const current = site[field];
              // Same rule as the mapping above: a saved choice never vanishes
              // from its own dropdown, whatever Home Assistant reports today.
              const options = listFor(deviceClass);
              const withCurrent =
                current && !options.some((o) => o.entityId === current)
                  ? [...options, { entityId: current, friendlyName: null, unit: null, deviceClass: null }]
                  : options;
              return (
                <tr key={field} className="border-t align-middle">
                  <td className="py-2 pr-4">
                    <div className="text-slate-900">{t(label)}</div>
                    <div className="text-xs text-slate-500">{t(hint)}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      className="input w-full max-w-md"
                      value={current ?? ""}
                      disabled={!canEdit || loading || save.isPending}
                      onChange={(e) => save.mutate({ [field]: e.target.value === "" ? null : e.target.value })}
                    >
                      <option value="">{t("settings.live.none")}</option>
                      {withCurrent.map((o) => (
                        <option key={o.entityId} value={o.entityId}>
                          {o.entityId}
                          {o.friendlyName ? ` · ${o.friendlyName}` : ""}
                          {o.unit ? ` (${o.unit})` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-right text-xs text-slate-400">
                    {current ? t("settings.live.shown") : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SyncSection({ siteId, canEdit }: { siteId: string; canEdit: boolean }) {
  const { t, tag } = useI18n();
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
        <h2 className="text-sm font-medium text-slate-700">{t("settings.sync")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("settings.syncNote")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {t("settings.granularity")}
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            {(
              [
                ["quarter_hour", "settings.quarterHour"],
                ["hour", "settings.hourly"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setGranularity(value)}
                disabled={!canEdit}
                className={`px-3 py-1.5 disabled:opacity-50 ${
                  granularity === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={useRange}
            disabled={!canEdit}
            onChange={(e) => setUseRange(e.target.checked)}
          />
          {t("settings.dateRange")}
        </label>

        {useRange && (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {t("common.from")}
              <input
                type="date"
                value={from}
                disabled={!canEdit}
                onChange={(e) => setFrom(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {t("common.to")}
              <input
                type="date"
                value={to}
                disabled={!canEdit}
                onChange={(e) => setTo(e.target.value)}
                className="input"
              />
            </label>
          </>
        )}

        <button
          onClick={() => syncMutation.mutate()}
          disabled={!canEdit || syncMutation.isPending || !rangeValid}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncMutation.isPending ? t("settings.syncing") : t("settings.syncNow")}
        </button>
      </div>

      {!rangeValid && <p className="text-sm text-red-600">{t("settings.rangeInvalid")}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-2 border-t pt-3 text-sm">
          <div className="flex flex-wrap gap-6">
            <span>
              <span className="font-semibold text-slate-900">{result.inserted}</span>{" "}
              {t("settings.inserted")}
            </span>
            <span>
              <span className="font-semibold text-slate-900">{result.updated}</span>{" "}
              {t("settings.updated")}
            </span>
            <span className="text-slate-500">
              {new Date(result.from).toLocaleString(tag, { timeZone: "Europe/Zurich" })} –{" "}
              {new Date(result.to).toLocaleString(tag, { timeZone: "Europe/Zurich" })}
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {result.metrics.map((m) => (
                <tr key={m.metricKind} className="border-t">
                  <td className="py-1 pr-4 text-slate-700">{m.metricKind}</td>
                  <td className="py-1 pr-4 text-slate-500">{m.statisticId}</td>
                  <td className="py-1 text-right text-slate-900">
                    {t("settings.rows", { count: m.rows })}
                  </td>
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
 * itemised list. Each input maps to the single cost item of that
 * category; if a category has several (separate invoices, a subsidy booked
 * separately) editing here would be ambiguous, so the field goes read-only and
 * points at the full page instead.
 */
function InvestmentSection({ siteId, canEdit }: { siteId: string; canEdit: boolean }) {
  const t = useT();
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
        // Stored on the cost item and read back by the itemised page: this is
        // data, not chrome, so it does not follow the interface language.
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
    // Two different reasons to show a total instead of a field, kept apart so
    // the explanation underneath matches the actual one.
    return { matching, total, editable: canEdit && matching.length <= 1, split: matching.length > 1 };
  }

  const battery = rowFor("battery");
  const solar = rowFor("solar");
  const total = battery.total + solar.total;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.investment")}</h2>
        <p className="text-xs text-slate-500">{t("settings.investmentNote")}</p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className={FIELD_GRID}>
          {([
            ["battery", "settings.battery", battery],
            ["solar", "settings.solar", solar],
          ] as const).map(([category, label, row]) =>
            row.editable ? (
              <Field key={category} label={t(label)} hint={t("settings.amountChf")}>
                <input
                  type="number"
                  step="0.01"
                  className="input w-full"
                  value={draft[category] ?? (row.matching[0]?.amountChf ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [category]: e.target.value }))}
                  onBlur={(e) => {
                    const amount = Number(e.target.value);
                    if (e.target.value === "" || Number.isNaN(amount)) return;
                    if (amount === row.matching[0]?.amountChf) return;
                    save.mutate({ category, amount });
                  }}
                />
              </Field>
            ) : (
              <Field
                key={category}
                label={t(label)}
                readOnly
                hint={row.split ? t("settings.splitItems", { count: row.matching.length }) : undefined}
              >
                <ReadOnlyValue>CHF {row.total.toFixed(2)}</ReadOnlyValue>
              </Field>
            ),
          )}
          <Field label={t("common.total")} readOnly hint={t("settings.totalHint")}>
            <ReadOnlyValue>CHF {total.toFixed(2)}</ReadOnlyValue>
          </Field>
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
function ProductionStartSection({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const t = useT();
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
        <h2 className="text-sm font-medium text-slate-700">{t("settings.productionStart")}</h2>
        <p className="text-xs text-slate-500">{t("settings.productionStartNote")}</p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className={FIELD_GRID}>
          <Field
            label={t("settings.productionStartDate")}
            hint={
              site.productionStartDate == null && firstProduction
                ? t("settings.productionStartFallback", { date: firstProduction })
                : undefined
            }
          >
            <input
              type="date"
              className="input w-full"
              disabled={!canEdit}
              max={new Date().toISOString().slice(0, 10)}
              value={site.productionStartDate ?? firstProduction ?? ""}
              onChange={(e) =>
                save.mutate({ productionStartDate: e.target.value === "" ? null : e.target.value })
              }
            />
          </Field>
          <Field label={t("settings.conversionLoss")} hint={t("settings.conversionLossNote")}>
            <input
              type="number"
              step="0.1"
              min="0"
              max="90"
              disabled={!canEdit}
              className="input w-full"
              defaultValue={(site.batteryConversionLoss * 100).toFixed(1)}
              onBlur={(e) => {
                const pct = Number(e.target.value);
                if (e.target.value === "" || Number.isNaN(pct)) return;
                const fraction = pct / 100;
                if (fraction === site.batteryConversionLoss) return;
                save.mutate({ batteryConversionLoss: fraction });
              }}
            />
          </Field>
        </div>
        {/* Under the fields it resets, rather than adrift in the row beside a
            setting it has nothing to do with. */}
        {canEdit && site.productionStartDate != null && (
          <button
            type="button"
            onClick={() => save.mutate({ productionStartDate: null })}
            className="mt-3 text-xs text-slate-400 hover:text-slate-900"
          >
            {t("settings.resetProductionStart")}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

