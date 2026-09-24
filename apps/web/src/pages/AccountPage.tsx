import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Invoice, InvoiceStatus } from "@energy-manager/shared";
import { invoicePeriodLabel } from "@energy-manager/shared";
import { api } from "../api/client";
import { useI18n, useT, type MessageKey } from "../i18n/context";
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

/**
 * A labelled figure, kept as one word for wrapping purposes — `flex-wrap`
 * breaks a row between children, never inside one, so pairing the label with
 * its value here is what stops "kWh" ending up alone at the start of the
 * next line while "42.0" stays on the one above it.
 */
function Stat({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <span className="text-slate-400">{label}: </span>
      {children}
    </span>
  );
}

/**
 * Links to the app's own `/pdf` route rather than a Drive URL: the file has
 * no sharing of its own now (see googleDrive/service.ts), so this proxy —
 * which checks the caller's session and that the invoice is theirs — is
 * the only way to reach it. A plain browser navigation is enough: the
 * Cloudflare Access cookie rides along automatically, the same way it does
 * for every other same-origin request this app makes.
 */
function DownloadPdfButton({ invoiceId, archived }: { invoiceId: string; archived: boolean }) {
  const t = useT();
  const icon = (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M4 2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7.414a1 1 0 0 0-.293-.707l-4.414-4.414A1 1 0 0 0 11.586 2H4Zm7 1.5V7a1 1 0 0 0 1 1h3.5" />
      <path d="M6.5 12h1.75a1.25 1.25 0 1 1 0 2.5H7v1.25a.5.5 0 0 1-1 0V12.5a.5.5 0 0 1 .5-.5Zm.5 1.5h1.25a.25.25 0 0 0 0-.5H7v.5Zm4-1.5h1a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-1a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5Zm.5 2.5h.5v-1.5H12v1.5Zm3.5-2.5h1.25a.5.5 0 0 1 0 1H16v.5h.75a.5.5 0 0 1 0 1H16v.5a.5.5 0 0 1-1 0V12.5a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
  if (archived) {
    return (
      <a
        href={`/api/invoices/${invoiceId}/pdf`}
        target="_blank"
        rel="noreferrer"
        title={t("invoice.downloadPdf")}
        aria-label={t("invoice.downloadPdf")}
        className="inline-block rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        {icon}
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled
      title={t("invoice.pdfComingSoon")}
      aria-label={t("invoice.pdfComingSoon")}
      className="rounded p-1 text-slate-300"
    >
      {icon}
    </button>
  );
}

/** The admin's "revert to issued" control — a mistaken mark-paid undone in one click, no date to pick. */
function MarkUnpaidControl({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.invoices.markUnpaid(invoiceId),
    onSuccess: () => {
      setError(null);
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("account.markUnpaid")}
      </button>
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
        className="btn-primary px-3 py-1 text-xs"
      >
        {t("account.markPaid")}
      </button>
    </div>
  );
}

export function AccountPage() {
  const { t, locale } = useI18n();
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

      {/* Full width, like every other card in the app — the row content
          below is what's capped, not this border, so the card lines up
          with the ones on every other tab instead of stopping short. */}
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
          <div>
            {rows.map((inv: Invoice) => {
              // "Q1 2027" when the period is a whole calendar quarter/year/
              // month — matching what a period picker would have called it —
              // else null, in which case the headline line falls back to the
              // exact dates the second line always shows anyway.
              const periodLabel = invoicePeriodLabel(inv.from, inv.to, locale);
              return (
                <div key={inv.id} className="border-t py-2.5 text-sm first:border-t-0">
                  {/* Capped, unlike the card around it: a row this short just
                      grows an empty gap between its left end and the
                      right-aligned amount on a wide monitor, rather than
                      gaining anything from the extra width. */}
                  <div className="flex max-w-6xl flex-col gap-1.5">
                    {/* Headline: who, which period, the benefit, the PDF, the
                        bottom line — what you scan for. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      {!isParticipant && (
                        <span className="whitespace-nowrap font-medium text-slate-900">
                          {inv.partyName}
                        </span>
                      )}
                      <span className="whitespace-nowrap text-slate-900">
                        {periodLabel ?? `${localDate(inv.from)} – ${localDate(inv.to)}`}
                      </span>
                      <Stat
                        label={t("account.column.advantage")}
                        className="tabular-nums text-slate-600"
                      >
                        CHF {chf(inv.savingChf)}
                      </Stat>
                      <DownloadPdfButton invoiceId={inv.id} archived={inv.drivePdfFileId != null} />
                      <span className="ml-auto whitespace-nowrap text-base font-semibold tabular-nums text-slate-900">
                        CHF {chf(inv.totalChf)}
                      </span>
                    </div>
                    {/* Detail: the exact interval, when it was issued, what was
                        consumed, its status, and the admin's action on it. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="whitespace-nowrap text-slate-500">
                        {localDate(inv.from)} – {localDate(inv.to)}
                      </span>
                      <Stat label={t("account.column.issued")} className="text-slate-500">
                        {localDate(inv.issuedAt)}
                      </Stat>
                      <Stat
                        label={t("account.column.consumed")}
                        className="tabular-nums text-slate-500"
                      >
                        {kwh(inv.gridKwh + inv.localKwh)} kWh
                      </Stat>
                      <StatusBadge status={inv.status} />
                      {canEdit && inv.status === "issued" && (
                        <MarkPaidControl
                          invoiceId={inv.id}
                          onDone={() =>
                            queryClient.invalidateQueries({ queryKey: ["invoices", siteId] })
                          }
                        />
                      )}
                      {canEdit && inv.status === "paid" && (
                        <MarkUnpaidControl
                          invoiceId={inv.id}
                          onDone={() =>
                            queryClient.invalidateQueries({ queryKey: ["invoices", siteId] })
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
