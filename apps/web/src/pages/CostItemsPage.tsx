import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { costItemInputSchema, type CostItemInput } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";

export function CostItemsPage() {
  const { site } = useDefaultSite();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["cost-items", site?.id],
    queryFn: () => api.costItems.list(site!.id),
    enabled: !!site,
  });
  const summaryQuery = useQuery({
    queryKey: ["cost-items-summary", site?.id],
    queryFn: () => api.costItems.summary(site!.id),
    enabled: !!site,
  });

  const { register, handleSubmit, reset, formState } = useForm<CostItemInput>({
    resolver: zodResolver(costItemInputSchema),
    defaultValues: { category: "solar" },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cost-items", site?.id] });
    void queryClient.invalidateQueries({ queryKey: ["cost-items-summary", site?.id] });
  };

  const createMutation = useMutation({
    mutationFn: (input: CostItemInput) => api.costItems.create(site!.id, input),
    onSuccess: () => {
      setFormError(null);
      reset({ category: "solar" });
      invalidate();
    },
    onError: (err: Error) => setFormError(err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.costItems.remove(id),
    onSuccess: invalidate,
  });

  if (!site) return <p className="text-slate-500">Loading…</p>;
  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Investment costs</h1>
        <p className="text-sm text-slate-500">
          Installer/material costs, subsidies (negative) and tax reductions (negative), tagged by
          battery or solar. Used for payback and breakeven calculations.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Battery subtotal" value={summary?.battery} />
        <SummaryCard label="Solar subtotal" value={summary?.solar} />
        <SummaryCard label="Total" value={summary?.total} emphasize />
      </div>

      <form
        onSubmit={handleSubmit((input) => createMutation.mutate(input))}
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
      >
        <Field label="Category">
          <select {...register("category")} className="input">
            <option value="battery">Battery</option>
            <option value="solar">Solar</option>
          </select>
        </Field>
        <Field label="Label">
          <input type="text" {...register("label")} className="input" />
        </Field>
        <Field label="Amount (CHF)">
          <input
            type="number"
            step="0.01"
            {...register("amountChf", { valueAsNumber: true })}
            className="input w-32"
          />
        </Field>
        <Field label="Incurred on (optional)">
          <input type="date" {...register("incurredOn")} className="input" />
        </Field>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add cost item
        </button>
      </form>
      {(formError || Object.keys(formState.errors).length > 0) && (
        <p className="text-sm text-red-600">
          {formError ?? Object.values(formState.errors)[0]?.message?.toString()}
        </p>
      )}

      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-slate-100 text-left text-slate-600">
          <tr>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2">Amount (CHF)</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {itemsQuery.data?.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="px-3 py-2 capitalize">{item.category}</td>
              <td className="px-3 py-2">{item.label}</td>
              <td className="px-3 py-2">{item.amountChf.toFixed(2)}</td>
              <td className="px-3 py-2">{item.incurredOn ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {itemsQuery.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                No cost items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, emphasize }: { label: string; value?: number; emphasize?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg ${emphasize ? "font-semibold text-slate-900" : "text-slate-700"}`}>
        {value != null ? `CHF ${value.toFixed(2)}` : "—"}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}
