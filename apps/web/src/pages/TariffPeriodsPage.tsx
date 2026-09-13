import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tariffPeriodInputSchema,
  tariffSurchargeInputSchema,
  type TariffKind,
  type TariffPeriod,
  type TariffPeriodInput,
  type TariffPricingMode,
  type TariffSurcharge,
  type TariffSurchargeInput,
} from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

const KIND_LABELS: Record<TariffKind, string> = {
  purchase: "Purchase",
  feed_in: "Feed-in",
  neighbor_sell: "Neighbour sale",
};

const PRICING_MODE_LABELS: Record<TariffPricingMode, string> = {
  flat: "Quarterly (fixed rate)",
  dynamic: "Day-ahead (spot)",
};

export function TariffPeriodsPage() {
  const { site } = useDefaultSite();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const periodsQuery = useQuery({
    queryKey: ["tariff-periods", site?.id],
    queryFn: () => api.tariffPeriods.list(site!.id),
    enabled: !!site,
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState, watch } = useForm<TariffPeriodInput>({
    resolver: zodResolver(tariffPeriodInputSchema),
    defaultValues: { kind: "purchase", pricingMode: "flat" },
  });

  const blankForm = { kind: "purchase", pricingMode: "flat" } as const;
  function stopEditing() {
    setEditingId(null);
    setFormError(null);
    reset(blankForm);
  }
  function startEditing(p: TariffPeriod) {
    setEditingId(p.id);
    setFormError(null);
    reset({
      kind: p.kind,
      // Stored as UTC; <input type="datetime-local"> wants wall-clock time in
      // the site's zone, which is also how the API reads it back.
      startTs: toLocalInput(p.startTs),
      endTs: toLocalInput(p.endTs),
      pricingMode: p.pricingMode,
      // "" rather than undefined so switching from a period that had a rate to
      // one that doesn't actually clears the input.
      rateChfPerKwh: (p.rateChfPerKwh ?? "") as unknown as number,
      label: p.label ?? "",
    });
  }
  // Drives the rate field's labelling — on a day-ahead period the rate is an
  // optional fallback, not the price.
  const pricingMode = watch("pricingMode");

  const createMutation = useMutation({
    mutationFn: (input: TariffPeriodInput) => api.tariffPeriods.create(site!.id, input),
    onSuccess: () => {
      setFormError(null);
      reset({ kind: "purchase", pricingMode: "flat" });
      void queryClient.invalidateQueries({ queryKey: ["tariff-periods", site?.id] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (input: TariffPeriodInput) => api.tariffPeriods.update(editingId!, input),
    onSuccess: () => {
      stopEditing();
      void queryClient.invalidateQueries({ queryKey: ["tariff-periods", site?.id] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.tariffPeriods.remove(id),
    onSuccess: () => {
      // The row being edited may be the one just deleted.
      stopEditing();
      void queryClient.invalidateQueries({ queryKey: ["tariff-periods", site?.id] });
    },
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Tariff periods</h1>
        <p className="text-sm text-slate-500">
          Purchase, feed-in and neighbour-sale rates, each for a date/time range — as short as a
          quarter-hour or as long as a year. Periods of the same kind must not overlap. Each
          period also says how it is priced: at its own fixed rate, or from the day-ahead feed.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((input) =>
          editingId ? updateMutation.mutate(input) : createMutation.mutate(input),
        )}
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
      >
        <Field label="Kind">
          <select {...register("kind")} className="input">
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <input type="datetime-local" {...register("startTs")} className="input" />
        </Field>
        <Field label="End">
          <input type="datetime-local" {...register("endTs")} className="input" />
        </Field>
        <Field label="Priced by">
          <select {...register("pricingMode")} className="input">
            {Object.entries(PRICING_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={pricingMode === "dynamic" ? "Fallback rate (optional)" : "Rate (CHF/kWh)"}
          hint={
            pricingMode === "dynamic"
              ? "Used only where the feed has no price. Leave blank to leave those intervals unpriced."
              : undefined
          }
        >
          <input
            type="number"
            step="0.00001"
            {...register("rateChfPerKwh")}
            className="input w-32"
          />
        </Field>
        <Field label="Label (optional)">
          <input type="text" {...register("label")} className="input" />
        </Field>
        <button
          type="submit"
          disabled={createMutation.isPending || updateMutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {editingId ? "Save changes" : "Add period"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={stopEditing}
            className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600"
          >
            Cancel
          </button>
        )}
      </form>
      {(formError || Object.keys(formState.errors).length > 0) && (
        <p className="text-sm text-red-600">
          {formError ?? Object.values(formState.errors)[0]?.message?.toString()}
        </p>
      )}

      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-slate-100 text-left text-slate-600">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Start</th>
            <th className="px-3 py-2">End</th>
            <th className="px-3 py-2">Priced by</th>
            <th className="px-3 py-2">Rate</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {periodsQuery.data?.map((p) => (
            <tr key={p.id} className={editingId === p.id ? "border-t bg-amber-50" : "border-t"}>
              <td className="px-3 py-2">{KIND_LABELS[p.kind]}</td>
              <td className="px-3 py-2">{formatLocal(p.startTs)}</td>
              <td className="px-3 py-2">{formatLocal(p.endTs)}</td>
              <td className="px-3 py-2">{PRICING_MODE_LABELS[p.pricingMode]}</td>
              <td className="px-3 py-2">
                {p.rateChfPerKwh == null ? (
                  <span className="text-slate-400">from feed</span>
                ) : (
                  <>
                    {p.rateChfPerKwh.toFixed(5)}
                    {p.pricingMode === "dynamic" && (
                      <span className="ml-1 text-xs text-slate-400">fallback</span>
                    )}
                  </>
                )}
              </td>
              <td className="px-3 py-2">{p.label ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => startEditing(p)}
                  className="mr-3 text-slate-400 hover:text-slate-900"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteMutation.mutate(p.id)}
                  className="text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {periodsQuery.data?.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                No tariff periods yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <DynamicTariffStatus siteId={site.id} />

      <TariffSurchargesSection siteId={site.id} />
    </div>
  );
}

/**
 * What <input type="datetime-local"> expects: "YYYY-MM-DDTHH:mm" wall-clock in
 * Europe/Zurich. Built from the formatted parts rather than slicing toISOString(),
 * which would hand back UTC and shift every edited period by the offset.
 */
function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // hour can come back as "24" at midnight in some runtimes.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString("en-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DynamicTariffStatus({ siteId }: { siteId: string }) {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const ratesQuery = useQuery({
    queryKey: ["dynamic-tariffs", siteId, from, to],
    queryFn: () => api.dynamicTariffs.list(siteId, from, to, "feed_in"),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.dynamicTariffs.sync(siteId),
    onSuccess: () => void ratesQuery.refetch(),
  });

  const rates = ratesQuery.data ?? [];
  const latestPublication = rates.reduce<string | null>(
    (latest, r) => (!latest || r.publicationTimestamp > latest ? r.publicationTimestamp : latest),
    null,
  );

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Dynamic feed-in pricing (BKW)</h2>
          <p className="mt-1 text-xs text-slate-500">
            {rates.length > 0
              ? `${rates.length} quarter-hour rates loaded for the current window, published ${
                  latestPublication ? formatLocal(latestPublication) : "—"
                }.`
              : "No dynamic rates loaded yet — flat feed-in periods above are used until then."}
          </p>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {syncMutation.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {syncMutation.isError && (
        <p className="mt-2 text-sm text-red-600">{(syncMutation.error as Error).message}</p>
      )}
    </div>
  );
}

function TariffSurchargesSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const surchargesQuery = useQuery({
    queryKey: ["tariff-surcharges", siteId],
    queryFn: () => api.tariffSurcharges.list(siteId),
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState } = useForm<TariffSurchargeInput>({
    resolver: zodResolver(tariffSurchargeInputSchema),
    defaultValues: { kind: "feed_in" },
  });

  function stopEditing() {
    setEditingId(null);
    setFormError(null);
    reset({ kind: "feed_in" });
  }
  function startEditing(s: TariffSurcharge) {
    setEditingId(s.id);
    setFormError(null);
    reset({
      kind: s.kind,
      // Stored UTC; the input wants Europe/Zurich wall-clock (see toLocalInput).
      startTs: toLocalInput(s.startTs),
      endTs: toLocalInput(s.endTs),
      rateChfPerKwh: s.rateChfPerKwh,
      label: s.label,
    });
  }

  const createMutation = useMutation({
    mutationFn: (input: TariffSurchargeInput) => api.tariffSurcharges.create(siteId, input),
    onSuccess: () => {
      setFormError(null);
      reset({ kind: "feed_in" });
      void queryClient.invalidateQueries({ queryKey: ["tariff-surcharges", siteId] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (input: TariffSurchargeInput) => api.tariffSurcharges.update(editingId!, input),
    onSuccess: () => {
      stopEditing();
      void queryClient.invalidateQueries({ queryKey: ["tariff-surcharges", siteId] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.tariffSurcharges.remove(id),
    onSuccess: () => {
      stopEditing();
      void queryClient.invalidateQueries({ queryKey: ["tariff-surcharges", siteId] });
    },
  });

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Surcharges</h2>
        <p className="mt-1 text-xs text-slate-500">
          Additive per-kWh components stacked on top of a period's rate — e.g. a Herkunftsnachweis
          or Mindestvergütungsprämie on top of the feed-in rate. Unlike periods above, surcharges
          may overlap each other; every matching one is added to the base rate.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((input) =>
          editingId ? updateMutation.mutate(input) : createMutation.mutate(input),
        )}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label="Kind">
          <select {...register("kind")} className="input">
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <input type="datetime-local" {...register("startTs")} className="input" />
        </Field>
        <Field label="End">
          <input type="datetime-local" {...register("endTs")} className="input" />
        </Field>
        <Field label="Rate (CHF/kWh)">
          <input
            type="number"
            step="0.00001"
            {...register("rateChfPerKwh", { valueAsNumber: true })}
            className="input w-32"
          />
        </Field>
        <Field label="Label">
          <input type="text" {...register("label")} className="input" />
        </Field>
        <button
          type="submit"
          disabled={createMutation.isPending || updateMutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {editingId ? "Save changes" : "Add surcharge"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={stopEditing}
            className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600"
          >
            Cancel
          </button>
        )}
      </form>
      {(formError || Object.keys(formState.errors).length > 0) && (
        <p className="text-sm text-red-600">
          {formError ?? Object.values(formState.errors)[0]?.message?.toString()}
        </p>
      )}

      <table className="w-full overflow-hidden rounded-lg border text-sm">
        <thead className="bg-slate-100 text-left text-slate-600">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Start</th>
            <th className="px-3 py-2">End</th>
            <th className="px-3 py-2">Rate</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {surchargesQuery.data?.map((s) => (
            <tr key={s.id} className={editingId === s.id ? "border-t bg-amber-50" : "border-t"}>
              <td className="px-3 py-2">{KIND_LABELS[s.kind]}</td>
              <td className="px-3 py-2">{formatLocal(s.startTs)}</td>
              <td className="px-3 py-2">{formatLocal(s.endTs)}</td>
              <td className="px-3 py-2">{s.rateChfPerKwh.toFixed(5)}</td>
              <td className="px-3 py-2">{s.label}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => startEditing(s)}
                  className="mr-3 text-slate-400 hover:text-slate-900"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteMutation.mutate(s.id)}
                  className="text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {surchargesQuery.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                No surcharges yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      {children}
      {hint && <span className="max-w-56 font-normal text-slate-400">{hint}</span>}
    </label>
  );
}
