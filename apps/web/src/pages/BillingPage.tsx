import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BillingAllocation,
  BillingCategory,
  BillingPeriodKind,
  BillingRange,
  GridTariffPosition,
  InvoiceLine,
  InvoiceLineKind,
  InvoiceLock,
  IssuedInvoice,
} from "@energy-manager/shared";
import { billingPeriodLabel, billingPeriodRange, toDateString } from "@energy-manager/shared";
import { api } from "../api/client";
import { useI18n, useT, type MessageKey } from "../i18n/context";
import { useDefaultSite } from "../lib/useDefaultSite";
import { useCanEdit, useIdentity } from "../lib/useIdentity";

const LINE_LABELS: Record<InvoiceLineKind, MessageKey> = {
  local: "invoice.line.local",
  self_direct: "invoice.line.selfDirect",
  self_battery: "invoice.line.selfBattery",
  feed_in: "invoice.line.feedIn",
};

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
 * What <input type="datetime-local"> expects: "YYYY-MM-DDTHH:mm" wall-clock in
 * Europe/Zurich. Built from the formatted parts rather than slicing toISOString(),
 * which would hand back UTC and shift an edited position by the offset.
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
  const [editingId, setEditingId] = useState<string | null>(null);

  const positionsQuery = useQuery({
    queryKey: ["billing-positions", siteId],
    queryFn: () => api.billing.positions(siteId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["billing-positions", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["billing-invoices", siteId] });
  };
  function stopEditing() {
    setEditingId(null);
    setError(null);
    setDraft({ ...EMPTY_POSITION });
  }
  function startEditing(p: GridTariffPosition) {
    setEditingId(p.id);
    setError(null);
    setDraft({
      category: p.category,
      label: p.label,
      allocation: p.allocation,
      rateChf: p.rateChf,
      // Stored as UTC; <input type="datetime-local"> wants wall-clock time in
      // the site's zone, which is also how the API reads it back.
      validFrom: toLocalInput(p.validFrom),
      validTo: toLocalInput(p.validTo),
      countsInDirectBilling: p.countsInDirectBilling,
      sortOrder: p.sortOrder,
    });
  }
  const createMutation = useMutation({
    mutationFn: () => api.billing.createPosition(siteId, draft),
    onSuccess: () => {
      setError(null);
      setDraft({ ...EMPTY_POSITION });
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const updateMutation = useMutation({
    mutationFn: () => api.billing.updatePosition(editingId!, draft),
    onSuccess: () => {
      stopEditing();
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.billing.removePosition(id),
    onSuccess: () => {
      // The row being edited may be the one just deleted.
      stopEditing();
      invalidate();
    },
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
          if (editingId) updateMutation.mutate();
          else createMutation.mutate();
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
          disabled={createMutation.isPending || updateMutation.isPending || draft.label.trim() === ""}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {editingId ? t("common.save") : t("billing.addPosition")}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={stopEditing}
            className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600"
          >
            {t("common.cancel")}
          </button>
        )}
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
                  <tr key={p.id} className={editingId === p.id ? "border-t bg-amber-50" : "border-t"}>
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
                          onClick={() => startEditing(p)}
                          className="mr-3 text-slate-400 hover:text-slate-900"
                        >
                          {t("common.edit")}
                        </button>
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

  const locksQuery = useQuery({
    queryKey: ["invoice-locks", siteId, range?.from, range?.to],
    queryFn: () => api.invoices.locks(siteId, range!.from, range!.to),
    enabled: !!range,
  });
  const locks = locksQuery.data ?? [];
  const lockedPartyIds = new Set(locks.map((l) => l.partyId));

  // Every billable party is selected by default; a party already locked for
  // this period can't be selected at all, since generating for it again is
  // refused until the batch that locked it is cancelled.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which range the default selection was last computed for — so the reset
  // below fires exactly once per period, as soon as both the invoice run
  // and the locks for it are both in, and never again on a background
  // refetch, which would silently undo a manual selection mid-review.
  const initializedFor = useRef("");
  useEffect(() => {
    if (!result || !range || !locksQuery.isSuccess) return;
    const key = `${range.from}|${range.to}`;
    if (initializedFor.current === key) return;
    initializedFor.current = key;
    setSelected(
      new Set(
        result.invoices
          .filter((inv): inv is IssuedInvoice & { partyId: string } => !!inv.partyId && !lockedPartyIds.has(inv.partyId))
          .map((inv) => inv.partyId),
      ),
    );
    // lockedPartyIds is derived from `locks`, already covered by
    // `locksQuery.isSuccess` above — the effect only ever needs to run once
    // per range, not once per new Set identity.
  }, [result, range, locksQuery.isSuccess]);

  const selectedInvoices = (result?.invoices ?? []).filter((inv) => inv.partyId && selected.has(inv.partyId));

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

      {result && result.invoices.length > 0 && <ReconciliationCard invoices={result.invoices} />}

      {result && result.invoices.length > 0 && range && (
        <GenerateInvoicesControl
          siteId={siteId}
          from={range.from}
          to={range.to}
          invoices={result.invoices}
          locks={locks}
          selected={selected}
          onSelectedChange={setSelected}
        />
      )}

      {/* The check before generating — a party's own bill, nothing more.
          The QR-bill and the benefit comparison belong to the real, final
          document; this is only for reviewing who's about to be billed for
          what, so neither appears here. */}
      {selectedInvoices.map((inv) => (
        <InvoiceDocument key={inv.partyId ?? inv.partyName} invoice={inv} />
      ))}
    </div>
  );
}

/** One batch's worth of already-locked parties, grouped for a single Cancel action. */
interface LockGroup {
  batchId: string;
  issuedAt: string;
  partyNames: string[];
  paidCount: number;
}

function groupLocks(locks: InvoiceLock[], nameOf: Map<string, string>): LockGroup[] {
  const byBatch = new Map<string, LockGroup>();
  for (const lock of locks) {
    const group = byBatch.get(lock.batchId) ?? {
      batchId: lock.batchId,
      issuedAt: lock.issuedAt,
      partyNames: [],
      paidCount: 0,
    };
    group.partyNames.push(nameOf.get(lock.partyId) ?? lock.partyId);
    if (lock.status === "paid") group.paidCount += 1;
    byBatch.set(lock.batchId, group);
  }
  return [...byBatch.values()];
}

interface ReconciliationBreakdown {
  /** Total grid draw across every invoice — one figure per party, so no
   * position gets double-counted the way summing raw line quantities would
   * if two positions both bill per kWh drawn. */
  gridKwh: number;
  /** Every per-kWh position from the provider's own tariff, no `kind` set. */
  energyChf: number;
  /** Every pool-shared or per-participant position — a lump sum, not a rate. */
  fixChf: number;
  feedInKwh: number;
  /** Negative — a credit, not a charge. */
  feedInChf: number;
  totalChf: number;
}

/**
 * The three components of the grid provider's own invoice, reconstructed
 * from the split invoices: consumption-based energy charges, fixed/standing
 * charges, and the feed-in credit. The app's own lines (locally-bought vZEV
 * energy, the owner's zero-cost self-consumption entries) are left out —
 * they're an internal arrangement the grid provider never sees.
 */
function reconciliationBreakdownOf(invoices: IssuedInvoice[]): ReconciliationBreakdown {
  let gridKwh = 0;
  let energyChf = 0;
  let fixChf = 0;
  let feedInKwh = 0;
  let feedInChf = 0;
  for (const inv of invoices) {
    gridKwh += inv.gridKwh;
    for (const l of inv.lines) {
      if (l.kind === "feed_in") {
        feedInKwh += l.quantity;
        feedInChf += l.amountChf;
      } else if (!l.kind) {
        if (l.allocation === "per_kwh" || l.allocation === "per_kwh_total") energyChf += l.amountChf;
        else fixChf += l.amountChf;
      }
    }
  }
  return { gridKwh, energyChf, fixChf, feedInKwh, feedInChf, totalChf: energyChf + fixChf + feedInChf };
}

/**
 * A reconciliation check, not a bill: the grid provider sends one invoice for
 * the whole connection, broken into the same three pieces this card shows —
 * energy, fixed charges, feed-in credit — and their sum is typed in here once
 * that invoice arrives, to catch a missing position or a wrong rate before
 * either invoice goes out.
 */
function ReconciliationCard({ invoices }: { invoices: IssuedInvoice[] }) {
  const t = useT();
  const [actual, setActual] = useState("");
  const b = reconciliationBreakdownOf(invoices);
  const energyRate = b.gridKwh !== 0 ? b.energyChf / b.gridKwh : 0;
  const feedInRate = b.feedInKwh !== 0 ? Math.abs(b.feedInChf) / b.feedInKwh : 0;
  const actualValue = actual.trim() === "" ? null : Number(actual);
  const delta = actualValue != null && !Number.isNaN(actualValue) ? b.totalChf - actualValue : null;
  // A few centimes of rounding drift across many participants and lines is
  // expected — round2 happens per line, not once at the end — so "matches"
  // allows a small tolerance rather than demanding an exact zero.
  const matches = delta != null && Math.abs(delta) < 0.05;

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 print:hidden">
      <div className="text-sm">
        <div className="font-medium text-slate-700">{t("invoice.reconciliation")}</div>
        <div className="text-xs text-slate-500">{t("invoice.reconciliationHint")}</div>
      </div>

      <table className="w-full text-sm">
        <tbody>
          <tr>
            <td className="py-1 text-slate-600">
              {t("invoice.reconciliationEnergy", { kwh: b.gridKwh.toFixed(1), rate: (energyRate * 100).toFixed(2) })}
            </td>
            <td className="py-1 text-right tabular-nums text-slate-900">{chf(b.energyChf)}</td>
          </tr>
          <tr>
            <td className="py-1 text-slate-600">{t("invoice.reconciliationFixPrice")}</td>
            <td className="py-1 text-right tabular-nums text-slate-900">{chf(b.fixChf)}</td>
          </tr>
          {b.feedInKwh > 0 && (
            <tr>
              <td className="py-1 text-slate-600">
                {t("invoice.reconciliationFeedIn", {
                  kwh: b.feedInKwh.toFixed(1),
                  rate: (feedInRate * 100).toFixed(2),
                })}
              </td>
              <td className="py-1 text-right tabular-nums text-emerald-700">{chf(b.feedInChf)}</td>
            </tr>
          )}
          <tr className="border-t font-medium">
            <td className="py-1 text-slate-900">{t("invoice.reconciliationTotal")}</td>
            <td className="py-1 text-right tabular-nums text-slate-900">CHF {chf(b.totalChf)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("invoice.reconciliationActual")}>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            className="input w-32"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        {delta != null && !Number.isNaN(delta) && (
          <span className={`pb-2 text-sm font-medium ${matches ? "text-emerald-700" : "text-red-700"}`}>
            {matches
              ? t("invoice.reconciliationMatch")
              : t("invoice.reconciliationDiff", {
                  sign: delta > 0 ? "+" : "−",
                  amount: chf(Math.abs(delta)),
                })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Which parties to invoice for this period — every billable one by default
 * — and turning the selection into dated, persisted records: one PDF per
 * selected participant, downloaded as a zip. A party already locked for
 * this period can't be picked at all; cancelling the batch that locked it
 * is offered right there instead of a silent duplicate.
 */
function GenerateInvoicesControl({
  siteId,
  from,
  to,
  invoices,
  locks,
  selected,
  onSelectedChange,
}: {
  siteId: string;
  from: string;
  to: string;
  invoices: IssuedInvoice[];
  locks: InvoiceLock[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const { t, locale } = useI18n();
  const { canEdit } = useCanEdit();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoice-locks", siteId, from, to] });
    void queryClient.invalidateQueries({ queryKey: ["invoices", siteId] });
  };
  const generateMutation = useMutation({
    mutationFn: () => api.invoices.generate(siteId, from, to, locale, [...selected]),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const cancelMutation = useMutation({
    mutationFn: (batchId: string) => api.invoices.cancelBatch(batchId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!canEdit) return null;

  const lockedPartyIds = new Set(locks.map((l) => l.partyId));
  const nameOf = new Map(invoices.filter((inv) => inv.partyId).map((inv) => [inv.partyId!, inv.partyName]));
  const lockGroups = groupLocks(locks, nameOf);

  const toggle = (partyId: string) => {
    const next = new Set(selected);
    if (next.has(partyId)) next.delete(partyId);
    else next.add(partyId);
    onSelectedChange(next);
  };

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 print:hidden">
      <h2 className="text-sm font-medium text-slate-700">{t("invoice.parties")}</h2>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {invoices.map((inv) => {
          const locked = !!inv.partyId && lockedPartyIds.has(inv.partyId);
          return (
            <label
              key={inv.partyId ?? inv.partyName}
              className={`flex items-center gap-2 text-sm ${locked ? "text-slate-400" : "text-slate-900"}`}
            >
              <input
                type="checkbox"
                checked={locked ? false : !!inv.partyId && selected.has(inv.partyId)}
                disabled={locked || !inv.partyId}
                onChange={() => inv.partyId && toggle(inv.partyId)}
              />
              {inv.partyName}
            </label>
          );
        })}
      </div>

      {lockGroups.map((group) => (
        <div key={group.batchId} className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
          <span>{t("invoice.generateLocked", { date: localDate(group.issuedAt) })} — {group.partyNames.join(", ")}</span>
          <button
            onClick={() => cancelMutation.mutate(group.batchId)}
            disabled={group.paidCount > 0 || cancelMutation.isPending}
            title={group.paidCount > 0 ? t("invoice.cancelBlockedPaid", { count: group.paidCount }) : undefined}
            className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t("invoice.cancelBatch")}
          </button>
        </div>
      ))}

      <button
        onClick={() => generateMutation.mutate()}
        disabled={selected.size === 0 || generateMutation.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("invoice.generateAction")}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * A checking preview of what Generate will actually produce — the bill
 * itself, nothing more. Neither the vZEV-benefit comparison nor the QR-bill
 * payment slip belongs here: both are for the real, generated document, not
 * for reviewing who is about to be billed for what before that happens.
 */
function InvoiceDocument({ invoice }: { invoice: IssuedInvoice }) {
  const t = useT();
  // Shown apart from the categorized positions, at the very top: it's the
  // grid provider's own money coming back, not one more charge to read down
  // a table to find.
  const feedInLine = invoice.lines.find((l) => l.kind === "feed_in");
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    lines: invoice.lines.filter((l) => l.category === category && l.kind !== "feed_in"),
  })).filter((g) => g.lines.length > 0);

  return (
    <section className="rounded-lg border bg-white p-6">
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

      {feedInLine && (
        <div className="mb-4 flex justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          <span>
            {t(LINE_LABELS.feed_in)} ({feedInLine.quantity.toFixed(1)} kWh)
          </span>
          <span className="tabular-nums">{chf(feedInLine.amountChf)}</span>
        </div>
      )}

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
        {invoice.selfDirectKwh + invoice.selfBatteryKwh > 0
          ? t("invoice.footnoteOwner", {
              total: (invoice.gridKwh + invoice.localKwh + invoice.selfDirectKwh + invoice.selfBatteryKwh).toFixed(1),
              direct: invoice.selfDirectKwh.toFixed(1),
              battery: invoice.selfBatteryKwh.toFixed(1),
              grid: invoice.gridKwh.toFixed(1),
            })
          : t("invoice.footnote", {
              grid: invoice.gridKwh.toFixed(1),
              local: invoice.localKwh.toFixed(1),
            })}
      </p>
    </section>
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
            <tr key={`${l.category}|${l.kind ?? l.label}`} className="border-t">
              {/* The app's own lines carry a `kind` and are named here, in
                  the reader's language; a provider position keeps the label
                  it was entered with, as on the bill it mirrors. */}
              <td className="py-1 pr-3 text-slate-900">{l.kind ? t(LINE_LABELS[l.kind]) : l.label}</td>
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
