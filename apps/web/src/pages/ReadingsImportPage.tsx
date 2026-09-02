import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partyInputSchema, type PartyInput, type ReadingImportMode, type ReadingsImportResult } from "@energy-manager/shared";
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

      <PartiesSection siteId={site.id} />
    </div>
  );
}

function PartiesSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId),
  });

  const { register, handleSubmit, reset, formState } = useForm<PartyInput>({
    resolver: zodResolver(partyInputSchema),
  });

  const createMutation = useMutation({
    mutationFn: (input: PartyInput) => api.parties.create(siteId, input),
    onSuccess: () => {
      setFormError(null);
      reset();
      void queryClient.invalidateQueries({ queryKey: ["parties", siteId] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.parties.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["parties", siteId] }),
  });

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Parties</h2>
        <p className="mt-1 text-xs text-slate-500">
          Neighbours whose consumption is tracked separately. New names in an imported CSV are
          added here automatically — this list is just for visibility and manual entry.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((input) => createMutation.mutate(input))}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Name
          <input type="text" {...register("name")} className="input" />
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add party
        </button>
      </form>
      {(formError || Object.keys(formState.errors).length > 0) && (
        <p className="text-sm text-red-600">
          {formError ?? Object.values(formState.errors)[0]?.message?.toString()}
        </p>
      )}

      <ul className="divide-y text-sm">
        {partiesQuery.data?.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2">
            <span>{p.name}</span>
            <button
              onClick={() => deleteMutation.mutate(p.id)}
              className="text-slate-400 hover:text-red-600"
            >
              Delete
            </button>
          </li>
        ))}
        {partiesQuery.data?.length === 0 && <li className="py-2 text-slate-400">No parties yet.</li>}
      </ul>
    </div>
  );
}
