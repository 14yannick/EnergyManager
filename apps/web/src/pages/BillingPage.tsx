import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BillingAllocation,
  BillingCategory,
  BillingPeriodKind,
  BillingRange,
  GridTariffPosition,
  InvoiceLine,
  InvoicePayee,
  IssuedInvoice,
} from "@energy-manager/shared";
import { billingPeriodLabel, billingPeriodRange, toDateString } from "@energy-manager/shared";
import { api } from "../api/client";
import { useI18n, useT, type MessageKey } from "../i18n/context";
import { useDefaultSite } from "../lib/useDefaultSite";
import { useCanEdit, useIdentity } from "../lib/useIdentity";
import { QrBill } from "../components/QrBill";

const CATEGORY_LABELS: Record<BillingCategory, MessageKey> = {
  energie: "billing.cat.energie",
  netznutzung: "billing.cat.netznutzung",
  messung: "billing.cat.messung",
  abgaben: "billing.cat.abgaben",
};
const CATEGORY_ORDER: BillingCategory[] = ["energie", "netznutzung", "messung", "abgaben"];

const ALLOCATION_LABELS: Record<BillingAllocation, MessageKey> = {
  per_kwh: "billing.alloc.perKwh",
  per_kwh_total: "billing.alloc.perKwhTotal",
  pool_shared: "billing.alloc.poolShared",
  per_participant: "billing.alloc.perParticipant",
};

const chf = (n: number) => n.toFixed(2);

const localDate = (iso: string) =>
  // Numeric DD.MM.YYYY, which is the Swiss form in both languages — so this
  // one does not need to follow the locale.
  new Date(iso).toLocaleDateString("en-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

/**
 * The same position exists once per tariff year, so a flat list shows each
 * label repeatedly and they read as duplicates. Grouping by validity makes the
 * period the heading rather than an invisible attribute of the row.
 */
function groupByValidity(positions: GridTariffPosition[]) {
  const groups = new Map<string, { validFrom: string; validTo: string; items: GridTariffPosition[] }>();
  for (const p of positions) {
    const key = `${p.validFrom}|${p.validTo}`;
    const group = groups.get(key) ?? { validFrom: p.validFrom, validTo: p.validTo, items: [] };
    group.items.push(p);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.sortOrder - b.sortOrder) }))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

const PERIOD_LABELS: Record<BillingPeriodKind, MessageKey> = {
  yearly: "billing.period.yearly",
  quarterly: "billing.period.quarterly",
  monthly: "billing.period.monthly",
  custom: "billing.period.custom",
};
const PERIOD_ORDER: BillingPeriodKind[] = ["yearly", "quarterly", "monthly", "custom"];

/** Today as a local "YYYY-MM-DD", for comparing against a period's bounds. */
function todayLocal(): string {
  const d = new Date();
  return toDateString(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function BillingPage() {
  const t = useT();
  const identity = useIdentity();
  const isParticipant = identity.data?.role === "participant";
  // A participant learns their site from /api/me: the site list is closed to
  // them, since a site row carries the owner's investment figures.
  const { site } = useDefaultSite({ enabled: identity.isSuccess && !isParticipant });
  const siteId = isParticipant ? identity.data?.siteId : site?.id;
  if (!siteId) return <p className="text-slate-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold text-slate-900">{t("billing.title")}</h1>
        <p className="max-w-4xl text-sm text-slate-500">
          {isParticipant ? t("billing.introParticipant") : t("billing.intro")}
        </p>
      </div>
      <PositionsSection siteId={siteId} />
      <InvoiceSection siteId={siteId} />
    </div>
  );
}

/** Per-kWh positions, whether levied on grid draw only or on all consumption. */
const isPerKwhAllocation = (a: BillingAllocation) => a === "per_kwh" || a === "per_kwh_total";

const EMPTY_POSITION = {
  category: "energie" as BillingCategory,
  label: "",
  allocation: "per_kwh" as BillingAllocation,
  rateChf: 0,
  validFrom: `${new Date().getFullYear()}-01-01T00:00`,
  validTo: `${new Date().getFullYear() + 1}-01-01T00:00`,
  countsInDirectBilling: true,
  sortOrder: 0,
};

function PositionsSection({ siteId }: { siteId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  // Everyone else reads the positions — a participant to see what the grid
  // provider charges — but only an admin may change them.
  const { canEdit } = useCanEdit();
  const [draft, setDraft] = useState({ ...EMPTY_POSITION });
  const [error, setError] = useState<string | null>(null);

  const positionsQuery = useQuery({
    queryKey: ["billing-positions", siteId],
    queryFn: () => api.billing.positions(siteId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["billing-positions", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["billing-invoices", siteId] });
  };
  const createMutation = useMutation({
    mutationFn: () => api.billing.createPosition(siteId, draft),
    onSuccess: () => {
      setError(null);
      setDraft({ ...EMPTY_POSITION });
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.billing.removePosition(id),
    onSuccess: invalidate,
  });

  const positions = positionsQuery.data ?? [];
  const isPerKwh = isPerKwhAllocation(draft.allocation);

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4 print:hidden">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("billing.positions")}</h2>
        <p className="mt-1 max-w-4xl text-xs text-slate-500">{t("billing.positionsNote")}</p>
      </div>

      {canEdit && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label={t("billing.category")}>
          <select
            className="input"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as BillingCategory })}
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {t(CATEGORY_LABELS[c])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("billing.position")}>
          <input
            className="input w-64"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </Field>
        <Field label={t("billing.allocation")}>
          <select
            className="input max-w-full"
            value={draft.allocation}
            onChange={(e) => setDraft({ ...draft, allocation: e.target.value as BillingAllocation })}
          >
            {(Object.keys(ALLOCATION_LABELS) as BillingAllocation[]).map((a) => (
              <option key={a} value={a}>
                {t(ALLOCATION_LABELS[a])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isPerKwh ? t("billing.ratePerKwh") : t("billing.ratePerYear")}>
          <input
            type="number"
            step={isPerKwh ? "0.0001" : "0.01"}
            className="input w-32"
            value={draft.rateChf}
            onChange={(e) => setDraft({ ...draft, rateChf: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("billing.validFrom")}>
          <input
            type="datetime-local"
            className="input"
            value={draft.validFrom}
            onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
          />
        </Field>
        <Field label={t("billing.validTo")}>
          <input
            type="datetime-local"
            className="input"
            value={draft.validTo}
            onChange={(e) => setDraft({ ...draft, validTo: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={draft.countsInDirectBilling}
            onChange={(e) => setDraft({ ...draft, countsInDirectBilling: e.target.checked })}
          />
          {t("billing.existsWithout")}
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending || draft.label.trim() === ""}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t("billing.addPosition")}
        </button>
      </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {positions.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">{t("billing.noPositions")}</p>
      )}

      {groupByValidity(positions).map((group) => (
        <div key={`${group.validFrom}|${group.validTo}`}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("billing.validRange", {
              from: localDate(group.validFrom),
              to: localDate(group.validTo),
            })}
            <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
              {t("billing.positionCount", { count: group.items.length })}
            </span>
          </h3>
          {/* Scrolls on a narrow screen instead of widening the page. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t("billing.category")}</th>
                  <th className="py-1 pr-3 font-medium">{t("billing.position")}</th>
                  <th className="py-1 pr-3 font-medium">{t("billing.allocation")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("billing.rate")}</th>
                  <th className="py-1 pr-3 font-medium">{t("billing.withoutRcp")}</th>
                  {canEdit && <th className="py-1" />}
                </tr>
              </thead>
              <tbody>
                {group.items.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1 pr-3 text-slate-500">{t(CATEGORY_LABELS[p.category])}</td>
                    <td className="py-1 pr-3 text-slate-900">{p.label}</td>
                    <td className="py-1 pr-3 text-slate-500">{t(ALLOCATION_LABELS[p.allocation])}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {isPerKwhAllocation(p.allocation)
                        ? `${(p.rateChf * 100).toFixed(2)} ${t("billing.centsPerKwh")}`
                        : `${chf(p.rateChf)} ${t("billing.perYear")}`}
                    </td>
                    <td className="py-1 pr-3 text-slate-500">
                      {p.countsInDirectBilling ? t("billing.yes") : t("billing.no")}
                    </td>
                    {canEdit && (
                      <td className="py-1 text-right">
                        <button
                          onClick={() => deleteMutation.mutate(p.id)}
                          className="text-slate-400 hover:text-red-600"
                        >
                          {t("common.delete")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function InvoiceSection({ siteId }: { siteId: string }) {
  const { t, locale } = useI18n();
  // Billing is retrospective: you invoice a period once it has finished, so
  // the useful default is the previous one rather than the current, partial
  // one. Offset 0 is the period we are in, -1 the one before it.
  const [kind, setKind] = useState<BillingPeriodKind>("quarterly");
  const [offset, setOffset] = useState(-1);

  const seed = useMemo(() => billingPeriodRange("custom", 0), []);
  const [customFrom, setCustomFrom] = useState(seed.from);
  const [customTo, setCustomTo] = useState(seed.to);
  const [customRange, setCustomRange] = useState<BillingRange | null>(null);

  // A calendar period resolves on its own; a custom one waits for the button,
  // so that typing into a date field doesn't fire an invoice run per keystroke.
  const range: BillingRange | null =
    kind === "custom" ? customRange : billingPeriodRange(kind, offset);

  const switchKind = (next: BillingPeriodKind) => {
    if (next === "custom") {
      // Carry the dates across so the view doesn't blank out on the switch —
      // you land on the same range you were looking at, ready to adjust.
      const current = range ?? seed;
      setCustomFrom(current.from);
      setCustomTo(current.to);
      setCustomRange(current);
    }
    setKind(next);
    // Always land on "the previous one" rather than translating the old
    // offset into the new unit, where -5 quarters would silently become
    // 5 months.
    setOffset(-1);
  };

  const invoicesQuery = useQuery({
    queryKey: ["billing-invoices", siteId, range?.from, range?.to],
    queryFn: () => api.billing.invoices(siteId, range!.from, range!.to),
    enabled: !!range,
  });
  const result = invoicesQuery.data;

  return (
    <div className="print-invoices space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 print:hidden">
        <Field label={t("common.period")}>
          <select
            className="input w-36"
            value={kind}
            onChange={(e) => switchKind(e.target.value as BillingPeriodKind)}
          >
            {PERIOD_ORDER.map((k) => (
              <option key={k} value={k}>
                {t(PERIOD_LABELS[k])}
              </option>
            ))}
          </select>
        </Field>

        {kind === "custom" ? (
          <>
            <Field label={t("common.from")}>
              <input
                type="date"
                className="input"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </Field>
            <Field label={t("common.to")}>
              <input
                type="date"
                className="input"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </Field>
            <button
              onClick={() => setCustomRange({ from: customFrom, to: customTo })}
              disabled={customFrom > customTo}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t("billing.generate")}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1 pb-0.5">
            <button
              onClick={() => setOffset(offset - 1)}
              aria-label={t("billing.prevPeriod")}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ‹
            </button>
            <span className="min-w-36 text-center text-sm font-medium text-slate-900">
              {billingPeriodLabel(kind, offset, locale)}
            </span>
            <button
              onClick={() => setOffset(offset + 1)}
              aria-label={t("billing.nextPeriod")}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ›
            </button>
          </div>
        )}

        {range && (
          <span className="pb-2 text-sm text-slate-500">
            {localDate(range.from)} – {localDate(range.to)}
            {/* Periods ahead of today are selectable — handy for checking how
                the fixed positions bill before the energy exists. Say so, so
                that missing consumption doesn't read as a fault. */}
            {range.from > todayLocal() ? (
              <span className="ml-2 text-amber-700">{t("billing.futurePeriod")}</span>
            ) : range.to > todayLocal() ? (
              <span className="ml-2 text-amber-700">{t("billing.currentPeriod")}</span>
            ) : null}
          </span>
        )}

        {result && result.invoices.length > 0 && (
          <button
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("billing.print")}
          </button>
        )}
        {result && (
          <span className="pb-2 text-sm text-slate-500">
            {t("billing.summary", { days: result.days, participants: result.participantCount })}
            {result.localRateChf != null &&
              t("billing.localRate", {
                rate: (result.localRateChf * 100).toFixed(2),
                cents: t("billing.centsPerKwh"),
              })}
          </span>
        )}
      </div>

      {/* A refused run, not a failed one: the period straddles a tariff change
          and the API says where to split it. Shown where the warnings would
          have been, since it is the same kind of message with a firmer verb. */}
      {invoicesQuery.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {invoicesQuery.error.message}
        </p>
      )}
      {result?.warnings.map((w, i) => (
        <p key={i} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          {w}
        </p>
      ))}

      {result?.invoices.map((inv) => (
        <InvoiceDocument
          key={inv.partyId ?? inv.partyName}
          invoice={inv}
          payee={result.payee}
        />
      ))}
    </div>
  );
}

/** Page one mirrors the provider's layout; page two is the VZEV comparison. */
function InvoiceDocument({
  invoice,
  payee,
}: {
  invoice: IssuedInvoice;
  payee: InvoicePayee | null;
}) {
  const t = useT();
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    lines: invoice.lines.filter((l) => l.category === category),
  })).filter((g) => g.lines.length > 0);

  return (
    <>
      <section className="print-sheet print-body rounded-lg border bg-white p-6 print:border-0">
        <header className="mb-4 border-b pb-3">
          <h2 className="text-lg font-semibold text-slate-900">{invoice.partyName}</h2>
          {invoice.partyReference && (
            <p className="text-sm text-slate-600">
              {t("invoice.participantNo", { reference: invoice.partyReference })}
            </p>
          )}
          <p className="text-sm text-slate-500">
            {t("invoice.header", {
              from: localDate(invoice.from),
              to: localDate(invoice.to),
              days: invoice.days,
              participants: invoice.participantCount,
            })}
          </p>
        </header>

        {grouped.map(({ category, lines }) => (
          <div key={category} className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">
              {t(CATEGORY_LABELS[category])}
            </h3>
            <LineTable lines={lines} />
            <div className="flex justify-between border-t pt-1 text-sm font-medium">
              <span>{t("invoice.subtotal")}</span>
              <span className="tabular-nums">
                {chf(lines.reduce((s, l) => s + l.amountChf, 0))}
              </span>
            </div>
          </div>
        ))}

        <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-base font-semibold">
          <span>{t("invoice.amountDue")}</span>
          <span className="tabular-nums">CHF {chf(invoice.totalChf)}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t("invoice.footnote", {
            grid: invoice.gridKwh.toFixed(1),
            local: invoice.localKwh.toFixed(1),
          })}
        </p>
      </section>

      {/* `gap`, not `space-y`: space-y works by putting a margin-top on every
          child but the first, and Tailwind's selector for it outranks the
          `margin-top: auto` that pins the payment part to the foot of the
          printed sheet. A gap creates no margins to compete with. */}
      <div className="print-sheet flex flex-col gap-4">
        <section className="print-body rounded-lg border bg-white p-6 print:border-0">
        <header className="mb-4 border-b pb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {t("invoice.benefitTitle", {
              name:
                invoice.partyName +
                (invoice.partyReference ? ` (${invoice.partyReference})` : ""),
            })}
          </h2>
          <p className="text-sm text-slate-500">{t("invoice.benefitIntro")}</p>
        </header>

        <h3 className="mb-1 text-sm font-semibold text-slate-900">{t("invoice.directSupply")}</h3>
        <LineTable lines={invoice.comparison.lines} />
        <div className="flex justify-between border-t pt-1 text-sm font-medium">
          <span>{t("invoice.directSupplyTotal")}</span>
          <span className="tabular-nums">{chf(invoice.comparison.totalChf)}</span>
        </div>

        <dl className="mt-5 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">{t("invoice.directly")}</dt>
            <dd className="tabular-nums">CHF {chf(invoice.comparison.totalChf)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">{t("invoice.yourRcpBill")}</dt>
            <dd className="tabular-nums">CHF {chf(invoice.totalChf)}</dd>
          </div>
          <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-base font-semibold">
            <dt>{t("invoice.yourBenefit")}</dt>
            <dd className="tabular-nums">CHF {chf(invoice.comparison.savingChf)}</dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-slate-500">
          {t("invoice.benefitNote", {
            participants: invoice.participantCount,
            local: invoice.localKwh.toFixed(1),
          })}
        </p>
      </section>

      {/* The payment part shares this sheet with the comparison and is pinned
          to its bottom edge, where the tear line is.

          Skipped on the administrator's own invoice — a slip payable from and
          to the same account is meaningless. An `rcp_admin` still receives the
          invoice itself: they owe their share, they just settle it without a
          payment slip. */}
      {payee?.partyId !== invoice.partyId && (
        <QrBill payee={payee} invoice={invoice} />
      )}
      </div>
    </>
  );
}

function LineTable({ lines }: { lines: InvoiceLine[] }) {
  const t = useT();
  return (
    // Scrolls on a phone; `print:overflow-visible` so a printed sheet can
    // never clip a line, whatever the paper size turns out to be.
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1 font-medium">{t("billing.position")}</th>
            <th className="py-1 text-right font-medium">{t("invoice.quantity")}</th>
            <th className="py-1 text-right font-medium">{t("invoice.price")}</th>
            <th className="py-1 text-right font-medium">{t("invoice.amountChf")}</th>
          </tr>
        </thead>
        <tbody>
          {/* Energy and grid usage both have a position called "Tarif de base",
              so the label alone is not unique — the section disambiguates. */}
          {lines.map((l) => (
            <tr key={`${l.category}|${l.label}`} className="border-t">
              <td className="py-1 pr-3 text-slate-900">{l.label}</td>
              <td className="py-1 text-right tabular-nums text-slate-600">
                {l.quantityUnit === "kWh"
                  ? `${l.quantity.toFixed(1)} kWh`
                  : t("invoice.days", { count: l.quantity })}
              </td>
              <td className="py-1 text-right tabular-nums text-slate-600">
                {l.quantityUnit === "kWh"
                  ? `${(l.unitRateChf * 100).toFixed(2)} ${t("billing.cents")}`
                  : `${(l.unitRateChf * 365).toFixed(2)} ${t("billing.perYear")}`}
              </td>
              <td className="py-1 text-right tabular-nums text-slate-900">{chf(l.amountChf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}
