import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Party, PartyInput } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT } from "../i18n/context";
import { Field, FIELD_GRID } from "./Field";

/**
 * The plant's own two figures, part of a producer's detailed revenue: when
 * it started producing, and how much of the battery's charge conversion
 * loses.
 *
 * The start date bounds payback — investment cost is divided by average
 * savings per period, so counting days before the panels existed drags that
 * average down and overstates payback. Unset means "not stated", and
 * everything falls back to the first day with recorded production, shown
 * here as the placeholder so the fallback is visible rather than implied.
 *
 * Both used to be the site's, when a site had one plant.
 */

/** Everything the participant already is, so a save of one figure changes nothing else. */
function unchanged(party: Party): PartyInput {
  return {
    name: party.name,
    reference: party.reference ?? undefined,
    emails: party.emails,
    address: party.address,
    buildingNumber: party.buildingNumber,
    zip: party.zip,
    city: party.city,
    country: party.country,
    role: party.role,
    iban: party.iban,
    startDate: party.startDate,
    endDate: party.endDate,
    feedIn: party.feedIn,
    detailedRevenue: party.detailedRevenue,
    detailedLiveView: party.detailedLiveView,
  };
}

export function PartyPlant({ siteId, party, canEdit }: { siteId: string; party: Party; canEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const rangeQuery = useQuery({
    queryKey: ["readings-range", siteId],
    queryFn: () => api.readings.range(siteId),
  });
  const firstProduction = rangeQuery.data?.firstProduction ?? null;

  const save = useMutation({
    mutationFn: (figures: Pick<PartyInput, "productionStartDate" | "batteryConversionLoss">) =>
      api.parties.update(party.id, { ...unchanged(party), ...figures }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["parties", siteId] });
      // The site's own start date and loss are derived from its producers'.
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  // Shown as a percentage; stored as a fraction, null until somebody states it.
  const lossPct = ((party.batteryConversionLoss ?? 0.1) * 100).toFixed(1);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-slate-700">{t("parties.plantOf", { name: party.name })}</h3>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">{t("settings.productionStartNote")}</p>
      </div>

      <div className={FIELD_GRID}>
        <Field
          label={t("settings.productionStartDate")}
          hint={
            party.productionStartDate == null && firstProduction
              ? t("settings.productionStartFallback", { date: firstProduction })
              : undefined
          }
        >
          <input
            type="date"
            className="input w-full"
            disabled={!canEdit}
            max={new Date().toISOString().slice(0, 10)}
            value={party.productionStartDate ?? firstProduction ?? ""}
            onChange={(e) => save.mutate({ productionStartDate: e.target.value === "" ? null : e.target.value })}
          />
        </Field>
        <Field label={t("settings.conversionLoss")} hint={t("settings.conversionLossNote")}>
          <input
            // Remounts when the stored figure changes, so the field shows it.
            key={lossPct}
            type="number"
            step="0.1"
            min="0"
            max="90"
            disabled={!canEdit}
            className="input w-full"
            defaultValue={lossPct}
            onBlur={(e) => {
              const pct = Number(e.target.value);
              if (e.target.value === "" || Number.isNaN(pct)) return;
              const fraction = pct / 100;
              if (fraction === party.batteryConversionLoss) return;
              save.mutate({ batteryConversionLoss: fraction });
            }}
          />
        </Field>
      </div>
      {/* Under the field it resets, rather than adrift in the row. */}
      {canEdit && party.productionStartDate != null && (
        <button
          type="button"
          onClick={() => save.mutate({ productionStartDate: null })}
          className="text-xs text-slate-400 hover:text-slate-900"
        >
          {t("settings.resetProductionStart")}
        </button>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
