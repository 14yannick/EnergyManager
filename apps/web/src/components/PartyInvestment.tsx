import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Party } from "@energy-manager/shared";
import { api } from "../api/client";
import { formatChf } from "../lib/format";
import { useT } from "../i18n/context";
import { Field, FIELD_GRID, ReadOnlyValue } from "./Field";

/**
 * What a participant's plant cost — the basis for payback and breakeven.
 *
 * Entered per participant with feed-in: an investment is a household's, and
 * with two plants in a vZEV each pays back on its own money. The dashboard
 * still sums them for the site. One amount per category; a category holding
 * several items (a subsidy booked separately, say) shows its total only,
 * rather than guess which item an edit should change.
 */
export function PartyInvestment({ siteId, party, canEdit }: { siteId: string; party: Party; canEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["cost-items", siteId],
    queryFn: () => api.costItems.list(siteId),
  });
  // The site's items are fetched once and shared; this card shows one
  // participant's — the plant the money went into.
  const items = (itemsQuery.data ?? []).filter((i) => i.partyId === party.id);

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
        partyId: party.id,
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
        <h3 className="text-sm font-medium text-slate-700">{t("parties.investmentOf", { name: party.name })}</h3>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">{t("settings.investmentNote")}</p>
      </div>

      <div>
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
                <ReadOnlyValue>CHF {formatChf(row.total)}</ReadOnlyValue>
              </Field>
            ),
          )}
          <Field label={t("common.total")} readOnly hint={t("settings.totalHint")}>
            <ReadOnlyValue>CHF {formatChf(total)}</ReadOnlyValue>
          </Field>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
