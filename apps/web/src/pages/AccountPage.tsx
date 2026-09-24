import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Invoice, InvoiceStatus } from "@energy-manager/shared";
import { api } from "../api/client";
import { useT, type MessageKey } from "../i18n/context";
import { useDefaultSite } from "../lib/useDefaultSite";
import { useCanEdit, useIdentity } from "../lib/useIdentity";

const chf = (n: number) => n.toFixed(2);
const kwh = (n: number) => n.toFixed(1);

/** DD.MM.YYYY, the Swiss form used everywhere else in this app. */
const localDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const STATUS_LABEL: Record<InvoiceStatus, MessageKey> = {
  issued: "account.status.issued",
  paid: "account.status.paid",
  cancelled: "account.status.cancelled",
};

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  issued: "bg-slate-100 text-slate-700",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const t = useT();
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {t(STATUS_LABEL[status])}
    </span>
  );
}

/**
 * Unpaid/All, the same segmented-button style already used for the
 * Today/Tomorrow toggle on the live chart and the language switch.
 */
function InvoiceFilterToggle({
  showAll,
  onChange,
}: {
  showAll: boolean;
  onChange: (showAll: boolean) => void;
}) {
  const t = useT();
  const option = (value: boolean, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={showAll === value}
      className={`px-3 py-1 text-xs font-medium ${
        showAll === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {option(false, t("account.filter.unpaid"))}
      <div className="w-px bg-slate-300" />
      {option(true, t("account.filter.all"))}
    </div>
  );
}

/** The admin's inline "mark paid" control — a date input defaulting to today, then a button. */
function MarkPaidControl({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const t = useT();
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.invoices.markPaid(invoiceId, paidAt),
    onSuccess: () => {
      setError(null);
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <input
        type="date"
        className="input w-36 text-xs"
        value={paidAt}
        onChange={(e) => setPaidAt(e.target.value)}
      />
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {t("account.markPaid")}
      </button>
    </div>
  );
}

export function AccountPage() {
  const t = useT();
  const identity = useIdentity();
  const isParticipant = identity.data?.role === "participant";
  const { canEdit } = useCanEdit();
  const { site } = useDefaultSite({ enabled: identity.isSuccess && !isParticipant });
  const siteId = isParticipant ? identity.data?.siteId : site?.id;
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const invoicesQuery = useQuery({
    queryKey: ["invoices", siteId],
    queryFn: () => api.invoices.list(siteId!),
    enabled: !!siteId,
  });

  if (!siteId) return <p className="text-slate-500">{t("common.loading")}</p>;

  const all = invoicesQuery.data ?? [];
  const rows = showAll ? all : all.filter((i) => i.status === "issued");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("account.title")}</h1>
        <p className="max-w-2xl text-sm text-slate-500">{t("account.intro")}</p>
      </div>

      <div className="space-y-4 rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-slate-700">{t("account.title")}</h2>
          <InvoiceFilterToggle showAll={showAll} onChange={setShowAll} />
        </div>

        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">
            {showAll ? t("common.nothingInRange") : t("account.noneUnpaid")}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  {!isParticipant && <th className="py-1 pr-3 font-medium">{t("account.column.party")}</th>}
                  <th className="py-1 pr-3 font-medium">{t("account.column.period")}</th>
                  <th className="py-1 pr-3 font-medium">{t("account.column.issued")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("account.column.consumed")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("account.column.advantage")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("invoice.amountDue")}</th>
                  <th className="py-1 pr-3 font-medium">{t("account.column.status")}</th>
                  <th className="py-1 pr-3" />
                  {canEdit && <th className="py-1" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((inv: Invoice) => (
                  <tr key={inv.id} className="border-t">
                    {!isParticipant && <td className="py-1.5 pr-3 text-slate-900">{inv.partyName}</td>}
                    <td className="py-1.5 pr-3 text-slate-900">
                      {localDate(inv.from)} – {localDate(inv.to)}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{localDate(inv.issuedAt)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                      {kwh(inv.gridKwh + inv.localKwh)} kWh
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                      CHF {chf(inv.savingChf)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-900">CHF {chf(inv.totalChf)}</td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="py-1.5 pr-3">
                      {inv.drivePdfFileId ? (
                        <a
                          href={`https://drive.google.com/file/d/${inv.drivePdfFileId}/view`}
                          target="_blank"
                          rel="noreferrer"
                          title={t("invoice.downloadPdf")}
                          aria-label={t("invoice.downloadPdf")}
                          className="inline-block rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                            <path d="M4 2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7.414a1 1 0 0 0-.293-.707l-4.414-4.414A1 1 0 0 0 11.586 2H4Zm7 1.5V7a1 1 0 0 0 1 1h3.5" />
                            <path d="M6.5 12h1.75a1.25 1.25 0 1 1 0 2.5H7v1.25a.5.5 0 0 1-1 0V12.5a.5.5 0 0 1 .5-.5Zm.5 1.5h1.25a.25.25 0 0 0 0-.5H7v.5Zm4-1.5h1a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-1a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5Zm.5 2.5h.5v-1.5H12v1.5Zm3.5-2.5h1.25a.5.5 0 0 1 0 1H16v.5h.75a.5.5 0 0 1 0 1H16v.5a.5.5 0 0 1-1 0V12.5a.5.5 0 0 1 .5-.5Z" />
                          </svg>
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled
                          title={t("invoice.pdfComingSoon")}
                          aria-label={t("invoice.pdfComingSoon")}
                          className="rounded p-1 text-slate-300"
                        >
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                            <path d="M4 2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7.414a1 1 0 0 0-.293-.707l-4.414-4.414A1 1 0 0 0 11.586 2H4Zm7 1.5V7a1 1 0 0 0 1 1h3.5" />
                            <path d="M6.5 12h1.75a1.25 1.25 0 1 1 0 2.5H7v1.25a.5.5 0 0 1-1 0V12.5a.5.5 0 0 1 .5-.5Zm.5 1.5h1.25a.25.25 0 0 0 0-.5H7v.5Zm4-1.5h1a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-1a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5Zm.5 2.5h.5v-1.5H12v1.5Zm3.5-2.5h1.25a.5.5 0 0 1 0 1H16v.5h.75a.5.5 0 0 1 0 1H16v.5a.5.5 0 0 1-1 0V12.5a.5.5 0 0 1 .5-.5Z" />
                          </svg>
                        </button>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-1.5">
                        {inv.status === "issued" && (
                          <MarkPaidControl
                            invoiceId={inv.id}
                            onDone={() => queryClient.invalidateQueries({ queryKey: ["invoices", siteId] })}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
