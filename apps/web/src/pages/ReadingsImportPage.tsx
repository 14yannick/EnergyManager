import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  intervalMetricKindSchema,
  READINGS_CSV_TEMPLATE,
  READINGS_CSV_TEMPLATE_FILENAME,
  type IntervalMetricKind,
  type ReadingImportMode,
  type ReadingsImportResult,
} from "@energy-manager/shared";
import { api } from "../api/client";
import { useT, type MessageKey } from "../i18n/context";
import { useCurrentSite } from "../lib/useCurrentSite";

export function ReadingsImportPage() {
  const { site } = useCurrentSite();
  const t = useT();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ReadingImportMode>("delta");
  const [result, setResult] = useState<ReadingsImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: () => api.readings.import(site!.id, file!, mode),
    onSuccess: (data) => {
      setResult(data);
      // A CSV import can create new parties server-side (consumption rows
      // for a name not seen before) — refresh the parties list for them
      // (see PartiesSection, under Site administration).
      void queryClient.invalidateQueries({ queryKey: ["parties", site!.id] });
    },
  });

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("readings.title")}</h1>
        <p className="max-w-4xl text-sm text-slate-500">
          {t("readings.csvNote", { kinds: intervalMetricKindSchema.options.join(", ") })}
        </p>
        {/* The format as a file to start from: the header and one made-up
            row. A data URL, so it needs no request and works offline. */}
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(READINGS_CSV_TEMPLATE)}`}
          download={READINGS_CSV_TEMPLATE_FILENAME}
          className="mt-2 inline-block rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {t("readings.template")}
        </a>
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4">
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === "delta"}
              onChange={() => setMode("delta")}
            />
            {t("readings.modeDelta")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === "cumulative"}
              onChange={() => setMode("cumulative")}
            />
            {t("readings.modeCumulative")}
          </label>
        </div>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block max-w-full text-sm"
        />

        <button
          onClick={() => importMutation.mutate()}
          disabled={!file || importMutation.isPending}
          className="btn-primary px-4 py-2 text-sm"
        >
          {importMutation.isPending ? t("readings.importing") : t("readings.import")}
        </button>
      </div>

      {result && (
        <div className="space-y-3 rounded-lg border bg-white p-4">
          <div className="flex gap-6 text-sm">
            <span>
              <span className="font-semibold text-slate-900">{result.inserted}</span>{" "}
              {t("settings.inserted")}
            </span>
            <span>
              <span className="font-semibold text-slate-900">{result.updated}</span>{" "}
              {t("settings.updated")}
            </span>
            <span>
              <span className="font-semibold text-slate-900">{result.skipped}</span>{" "}
              {t("readings.skipped")}
            </span>
          </div>
          {result.errors.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-4">{t("readings.row")}</th>
                    <th className="py-1">{t("readings.message")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1 pr-4">{e.row}</td>
                      <td className="py-1 text-red-600 dark:text-red-400">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ExportSection siteId={site.id} />

    </div>
  );
}

const METRIC_LABELS: Record<IntervalMetricKind, MessageKey> = {
  production: "readings.metric.production",
  inverter_ac: "readings.metric.inverterAc",
  pv_dc: "readings.metric.pvDc",
  battery_discharge_ac: "readings.metric.batteryDischargeAc",
  export: "readings.metric.export",
  export_grid: "readings.metric.exportGrid",
  import_grid: "readings.metric.importGrid",
  battery_charge: "readings.metric.batteryCharge",
  battery_discharge: "readings.metric.batteryDischarge",
  consumption: "readings.metric.consumption",
  consumption_own: "readings.metric.consumptionOwn",
  consumption_grid: "readings.metric.consumptionGrid",
};

const ALL_METRIC_KINDS = intervalMetricKindSchema.options;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function ExportSection({ siteId }: { siteId: string }) {
  const t = useT();
  const [from, setFrom] = useState(() => isoDaysAgo(365));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [kinds, setKinds] = useState<IntervalMetricKind[]>([...ALL_METRIC_KINDS]);

  const toggle = (kind: IntervalMetricKind) =>
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));

  const rangeValid = from !== "" && to !== "" && from <= to;
  const canExport = rangeValid && kinds.length > 0;

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("readings.export")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("readings.exportNote")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("common.from")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
          {t("common.to")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </label>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-600">{t("readings.metrics")}</span>
          <button
            onClick={() => setKinds([...ALL_METRIC_KINDS])}
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            {t("readings.all")}
          </button>
          <button
            onClick={() => setKinds([])}
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            {t("readings.none")}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {ALL_METRIC_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggle(kind)} />
              {t(METRIC_LABELS[kind])}
            </label>
          ))}
        </div>
      </div>

      {canExport ? (
        <a
          href={api.readings.exportUrl(siteId, from, to, kinds)}
          className="btn-primary inline-block px-4 py-2 text-sm"
        >
          {t("readings.download")}
        </a>
      ) : (
        <span className="btn-primary inline-block cursor-not-allowed px-4 py-2 text-sm opacity-50">
          {t("readings.download")}
        </span>
      )}
      {!rangeValid && <p className="text-sm text-red-600 dark:text-red-400">{t("settings.rangeInvalid")}</p>}
      {rangeValid && kinds.length === 0 && (
        <p className="text-sm text-red-600 dark:text-red-400">{t("readings.pickMetric")}</p>
      )}
    </div>
  );
}
