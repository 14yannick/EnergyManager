import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { swissDate, type HaSyncResult, type Site } from "@energy-manager/shared";
import { api } from "../api/client";
import { chooseSite, useCurrentSite } from "../lib/useCurrentSite";
import { Field } from "../components/Field";
import { PartiesSection } from "../components/PartiesSection";
import { useI18n, useT } from "../i18n/context";
import { useCanEdit } from "../lib/useIdentity";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function SettingsPage() {
  const { site, sites } = useCurrentSite();
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

      <SitesSection sites={sites} current={site} canEdit={canEdit} />

      {/* Who is in the site comes first: it is what an administrator is
          here for most often, and the rest of the page is set once. */}
      <PartiesSection siteId={site.id} canEdit={canEdit} />

      {/* What is left of Home Assistant at the level of the site: which price
          feed it is priced by, and the sync. Every sensor of a meter is mapped on the
          participant it belongs to, in the list above; the connection
          itself is under Integrations. */}
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.ha")}</h2>
        <p className="text-sm text-slate-500">{t("settings.haSiteIntro")}</p>
      </div>

      {status && !status.configured && (
        <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-900 dark:text-amber-200">
          {t("settings.haNotConnected")}{" "}
          <Link to="/integrations" className="font-medium underline">
            {t("nav.integrations")}
          </Link>
        </p>
      )}

      {status?.configured && (
        <>
          <PriceFeedSection site={site} canEdit={canEdit} />
          <SyncSection site={site} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}

/**
 * The sites this installation holds, and the way to add one. Everything
 * below it on the page is about the one being viewed, so this is also
 * where to change which that is — the only place: the Profile page says
 * which site an address is assigned to, and offers no choice.
 */
function SitesSection({ sites, current, canEdit }: { sites: Site[]; current: Site; canEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.sites.create({ name: name.trim() }),
    onSuccess: () => {
      setError(null);
      setName("");
      // Listed, not switched to: a brand-new site is empty, and landing on
      // an empty page in answer to "Add" would read as something lost.
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("sites.title")}</h2>
        <p className="max-w-3xl text-sm text-slate-500">{t("sites.note")}</p>
      </div>
      <ul className="divide-y text-sm">
        {sites.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium text-slate-900">{s.name}</span>
            <span className="text-xs text-slate-500">
              {t("sites.externalId")}: <span className="font-mono">{s.externalUuid}</span>
            </span>
            <span className="text-xs text-slate-500">{t("sites.created", { date: swissDate(s.createdAt.slice(0, 10)) })}</span>
            {s.syncPaused && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {t("sites.syncPaused")}
              </span>
            )}
            <span className="ml-auto">
              {s.id === current.id ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {t("sites.viewing")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => chooseSite(s.id)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("sites.view")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
        >
          <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
            {t("sites.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-64 max-w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            {t("common.add")}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/**
 * Which price feed prices this site's feed-in. The feeds themselves — a key
 * and the Home Assistant entity that carries the series — are the
 * installation's, defined under Integrations; a site only chooses among
 * them.
 */
function PriceFeedSection({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const feedsQuery = useQuery({ queryKey: ["price-feeds"], queryFn: api.priceFeeds.list });
  const save = useMutation({
    mutationFn: (priceFeedId: string | null) => api.sites.update(site.id, { priceFeedId }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
      // Each feed says how many sites it prices.
      void queryClient.invalidateQueries({ queryKey: ["price-feeds"] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const feeds = feedsQuery.data ?? [];

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.priceFeed")}</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          {t("settings.priceFeedNote")}{" "}
          <Link to="/integrations" className="font-medium underline">
            {t("nav.integrations")}
          </Link>
        </p>
      </div>
      <Field label={t("settings.priceFeedKey")} hint={t("settings.priceFeedKeyHint")}>
        <select
          className="input w-full max-w-md"
          value={site.priceFeedId ?? ""}
          disabled={!canEdit || feedsQuery.isLoading || save.isPending}
          onChange={(e) => save.mutate(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">{t("settings.notSynced")}</option>
          {feeds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.key}
              {f.label ? ` · ${f.label}` : ""}
            </option>
          ))}
        </select>
      </Field>
      {feedsQuery.isSuccess && feeds.length === 0 && <p className="text-xs text-slate-500">{t("settings.priceFeedNone")}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function SyncSection({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const { t, tag } = useI18n();
  const siteId = site.id;
  const queryClient = useQueryClient();
  // The site's own switch for the timer (see `Site.syncPaused`).
  const pauseMutation = useMutation({
    mutationFn: (syncPaused: boolean) =>
      api.sites.update(site.id, { syncPaused }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err: Error) => setError(err.message),
  });
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

      <div>
        <label className="flex items-center gap-2 text-sm text-slate-900">
          <input
            type="checkbox"
            checked={site.syncPaused}
            disabled={!canEdit || pauseMutation.isPending}
            onChange={(e) => pauseMutation.mutate(e.target.checked)}
          />
          {t("settings.syncPause")}
        </label>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">{t("settings.syncPauseHint")}</p>
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
          className="btn-primary px-4 py-2 text-sm"
        >
          {syncMutation.isPending ? t("settings.syncing") : t("settings.syncNow")}
        </button>
      </div>

      {!rangeValid && <p className="text-sm text-red-600 dark:text-red-400">{t("settings.rangeInvalid")}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
            <ul className="list-inside list-disc text-xs text-amber-700 dark:text-amber-300">
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
