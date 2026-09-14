import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  intervalMetricKindSchema,
  type IntervalMetricKind,
  type ReadingImportMode,
  type ReadingsImportResult,
} from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

export function ReadingsImportPage() {
  const { site } = useDefaultSite();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ReadingImportMode>("delta");
  const [result, setResult] = useState<ReadingsImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: () => api.readings.import(site!.id, file!, mode),
    onSuccess: (data) => {
      setResult(data);
      // A CSV import can create new parties server-side (consumption rows
      // for a name not seen before) — refresh the Parties section for them.
      void queryClient.invalidateQueries({ queryKey: ["parties", site!.id] });
    },
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Import readings</h1>
        <p className="text-sm text-slate-500">
          CSV columns: <code>timestamp, metric_kind, party, value_kwh</code> — one row per
          timestamp+metric. <code>metric_kind</code> is one of production, export_local,
          export_grid, import_grid, battery_charge, battery_discharge, consumption.{" "}
          <code>party</code> is required (a neighbour's name) when metric_kind is consumption,
          and must be blank otherwise. Re-importing overlapping rows overwrites them.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4">
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === "delta"}
              onChange={() => setMode("delta")}
            />
            Delta — values are already per-interval kWh
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === "cumulative"}
              onChange={() => setMode("cumulative")}
            />
            Cumulative — values are running meter totals, per metric+party
          </label>
        </div>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />

        <button
          onClick={() => importMutation.mutate()}
          disabled={!file || importMutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {importMutation.isPending ? "Importing…" : "Import"}
        </button>
      </div>

      {result && (
        <div className="space-y-3 rounded-lg border bg-white p-4">
          <div className="flex gap-6 text-sm">
            <span>
              <span className="font-semibold text-slate-900">{result.inserted}</span> inserted
            </span>
            <span>
              <span className="font-semibold text-slate-900">{result.updated}</span> updated
            </span>
            <span>
              <span className="font-semibold text-slate-900">{result.skipped}</span> skipped
            </span>
          </div>
          {result.errors.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-4">Row</th>
                  <th className="py-1">Message</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((e, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-4">{e.row}</td>
                    <td className="py-1 text-red-600">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ExportSection siteId={site.id} />

      <PartiesSection siteId={site.id} />
    </div>
  );
}

const METRIC_LABELS: Record<IntervalMetricKind, string> = {
  production: "Production (PV, AC share)",
  inverter_ac: "Inverter AC output (PV + battery)",
  pv_dc: "PV yield (DC)",
  battery_discharge_ac: "Battery discharge (AC share)",
  export_local: "Export — local",
  export_grid: "Export — grid",
  import_grid: "Import — grid",
  battery_charge: "Battery charge",
  battery_discharge: "Battery discharge",
  consumption: "Consumption (per party)",
  consumption_own: "Own consumption (household load)",
  consumption_grid: "Grid draw (per party)",
};

const ALL_METRIC_KINDS = intervalMetricKindSchema.options;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function ExportSection({ siteId }: { siteId: string }) {
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
        <h2 className="text-sm font-medium text-slate-700">Export</h2>
        <p className="mt-1 text-xs text-slate-500">
          Raw readings as an Excel file — one row per timestamp+metric, dates in Europe/Zurich
          (the UTC timestamp is kept in the last column).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </label>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-600">Metrics</span>
          <button
            onClick={() => setKinds([...ALL_METRIC_KINDS])}
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            all
          </button>
          <button
            onClick={() => setKinds([])}
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            none
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {ALL_METRIC_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggle(kind)} />
              {METRIC_LABELS[kind]}
            </label>
          ))}
        </div>
      </div>

      {canExport ? (
        <a
          href={api.readings.exportUrl(siteId, from, to, kinds)}
          className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Download .xlsx
        </a>
      ) : (
        <span className="inline-block cursor-not-allowed rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white opacity-50">
          Download .xlsx
        </span>
      )}
      {!rangeValid && <p className="text-sm text-red-600">"To" must be on or after "From".</p>}
      {rangeValid && kinds.length === 0 && (
        <p className="text-sm text-red-600">Select at least one metric.</p>
      )}
    </div>
  );
}

const EMPTY_PARTY = { reference: "", name: "", emails: "" };

/** One address per line, or comma-separated — whichever the user finds natural. */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
}

function PartiesSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ ...EMPTY_PARTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ ...EMPTY_PARTY });
  const [error, setError] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["parties", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["billing-invoices", siteId] });
  };
  const toInput = (v: typeof EMPTY_PARTY) => ({
    name: v.name.trim(),
    reference: v.reference.trim(),
    emails: parseEmails(v.emails),
  });

  const createMutation = useMutation({
    mutationFn: () => api.parties.create(siteId, toInput(draft)),
    onSuccess: () => {
      setError(null);
      setDraft({ ...EMPTY_PARTY });
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const updateMutation = useMutation({
    mutationFn: () => api.parties.update(editingId!, toInput(edit)),
    onSuccess: () => {
      setError(null);
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.parties.remove(id),
    onSuccess: invalidate,
  });

  const parties = partiesQuery.data ?? [];

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Participants</h2>
        <p className="mt-1 text-xs text-slate-500">
          The neighbours sharing your grid connection. Their consumption is billed separately and
          they count towards the pool size. New names in an imported CSV are added here
          automatically, without a reference or email — fill those in afterwards.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Participant no.
          <input
            type="text"
            className="input w-32"
            placeholder="592971"
            value={draft.reference}
            onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Name
          <input
            type="text"
            className="input w-56"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Emails (one per line or comma-separated)
          <textarea
            rows={2}
            className="input w-80"
            value={draft.emails}
            onChange={(e) => setDraft({ ...draft, emails: e.target.value })}
          />
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending || draft.name.trim() === ""}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add participant
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-3 font-medium">No.</th>
            <th className="py-1 pr-3 font-medium">Name</th>
            <th className="py-1 pr-3 font-medium">Emails</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {parties.map((p) => {
            const isEditing = editingId === p.id;
            return (
              <tr key={p.id} className="border-t align-top">
                <td className="py-2 pr-3">
                  {isEditing ? (
                    <input
                      className="input w-28"
                      value={edit.reference}
                      onChange={(e) => setEdit({ ...edit, reference: e.target.value })}
                    />
                  ) : (
                    <span className="tabular-nums text-slate-600">{p.reference ?? "—"}</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {isEditing ? (
                    <input
                      className="input w-52"
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    />
                  ) : (
                    <span className="text-slate-900">{p.name}</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {isEditing ? (
                    <textarea
                      rows={2}
                      className="input w-80"
                      value={edit.emails}
                      onChange={(e) => setEdit({ ...edit, emails: e.target.value })}
                    />
                  ) : p.emails.length > 0 ? (
                    <ul className="space-y-0.5">
                      {p.emails.map((mail) => (
                        <li key={mail} className="text-slate-600">
                          {mail}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-slate-400">no email</span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => updateMutation.mutate()}
                        disabled={updateMutation.isPending || edit.name.trim() === ""}
                        className="mr-3 font-medium text-slate-900 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-700">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setError(null);
                          setEditingId(p.id);
                          setEdit({
                            reference: p.reference ?? "",
                            name: p.name,
                            emails: p.emails.join("\n"),
                          });
                        }}
                        className="mr-3 text-slate-500 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(p.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {parties.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-slate-400">
                No participants yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
