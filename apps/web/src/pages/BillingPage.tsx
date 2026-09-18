import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BillingAllocation,
  BillingCategory,
  BillingPeriodKind,
  BillingRange,
  GridTariffPosition,
  InvoiceLine,
  ParticipantInvoice,
  Party,
  Site,
} from "@energy-manager/shared";
import { billingPeriodLabel, billingPeriodRange, toDateString } from "@energy-manager/shared";
import { api } from "../api/client";
import { useDefaultSite } from "../lib/useDefaultSite";
import { QrBill } from "../components/QrBill";

const CATEGORY_LABELS: Record<BillingCategory, string> = {
  energie: "Énergie",
  netznutzung: "Utilisation du réseau",
  messung: "Mesure",
  abgaben: "Redevances et prestations",
};
const CATEGORY_ORDER: BillingCategory[] = ["energie", "netznutzung", "messung", "abgaben"];

const ALLOCATION_LABELS: Record<BillingAllocation, string> = {
  per_kwh: "par kWh soutiré du réseau",
  per_kwh_total: "par kWh consommé (réseau + production locale)",
  pool_shared: "facturé une fois au RCP, réparti entre les participants",
  per_participant: "facturé une fois par participant",
};

const chf = (n: number) => n.toFixed(2);

const localDate = (iso: string) =>
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

const PERIOD_LABELS: Record<BillingPeriodKind, string> = {
  yearly: "Année",
  quarterly: "Trimestre",
  monthly: "Mois",
  custom: "Personnalisé",
};
const PERIOD_ORDER: BillingPeriodKind[] = ["yearly", "quarterly", "monthly", "custom"];

/** Today as a local "YYYY-MM-DD", for comparing against a period's bounds. */
function todayLocal(): string {
  const d = new Date();
  return toDateString(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function BillingPage() {
  const { site } = useDefaultSite();
  if (!site) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold text-slate-900">Facturation</h1>
        <p className="text-sm text-slate-500">
          Saisissez la facture du gestionnaire de réseau position par position, puis générez une
          facture pour chaque participant du RCP. Les montants sont TVA incluse : la TVA du
          fournisseur est répercutée telle quelle, aucune TVA n'est ajoutée.
        </p>
      </div>
      <PositionsSection siteId={site.id} />
      <InvoiceSection site={site} />
    </div>
  );
}

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
  const queryClient = useQueryClient();
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
  const isPerKwh = draft.allocation === "per_kwh";

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4 print:hidden">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Positions tarifaires du réseau</h2>
        <p className="mt-1 text-xs text-slate-500">
          Une ligne par position de la facture du gestionnaire de réseau. La répartition indique
          comment chaque position est répercutée sur le RCP : les tarifs de base facturés une seule
          fois au raccordement sont divisés entre les participants, tandis que la mesure est
          facturée pour chacun d'eux.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label="Rubrique">
          <select
            className="input"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as BillingCategory })}
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position">
          <input
            className="input w-64"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </Field>
        <Field label="Répartition">
          <select
            className="input"
            value={draft.allocation}
            onChange={(e) => setDraft({ ...draft, allocation: e.target.value as BillingAllocation })}
          >
            {(Object.keys(ALLOCATION_LABELS) as BillingAllocation[]).map((a) => (
              <option key={a} value={a}>
                {ALLOCATION_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isPerKwh ? "Tarif (CHF/kWh)" : "Tarif (CHF/an)"}>
          <input
            type="number"
            step={isPerKwh ? "0.0001" : "0.01"}
            className="input w-32"
            value={draft.rateChf}
            onChange={(e) => setDraft({ ...draft, rateChf: Number(e.target.value) })}
          />
        </Field>
        <Field label="Valable du">
          <input
            type="datetime-local"
            className="input"
            value={draft.validFrom}
            onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
          />
        </Field>
        <Field label="Valable au">
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
          Existe sans le RCP
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending || draft.label.trim() === ""}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Ajouter la position
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {positions.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">
          Aucune position — ajoutez-les telles qu'elles figurent sur la facture du réseau.
        </p>
      )}

      {groupByValidity(positions).map((group) => (
        <div key={`${group.validFrom}|${group.validTo}`}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valable du {localDate(group.validFrom)} au {localDate(group.validTo)}
            <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
              {group.items.length} position{group.items.length === 1 ? "" : "s"}
            </span>
          </h3>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Rubrique</th>
                <th className="py-1 pr-3 font-medium">Position</th>
                <th className="py-1 pr-3 font-medium">Répartition</th>
                <th className="py-1 pr-3 text-right font-medium">Tarif</th>
                <th className="py-1 pr-3 font-medium">Sans RCP</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {group.items.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1 pr-3 text-slate-500">{CATEGORY_LABELS[p.category]}</td>
                  <td className="py-1 pr-3 text-slate-900">{p.label}</td>
                  <td className="py-1 pr-3 text-slate-500">{ALLOCATION_LABELS[p.allocation]}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {p.allocation === "per_kwh"
                      ? `${(p.rateChf * 100).toFixed(2)} ct./kWh`
                      : `${chf(p.rateChf)} CHF/an`}
                  </td>
                  <td className="py-1 pr-3 text-slate-500">{p.countsInDirectBilling ? "oui" : "non"}</td>
                  <td className="py-1 text-right">
                    <button
                      onClick={() => deleteMutation.mutate(p.id)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function InvoiceSection({ site }: { site: Site }) {
  const siteId = site.id;
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

  const partiesQuery = useQuery({
    queryKey: ["parties", siteId],
    queryFn: () => api.parties.list(siteId),
  });
  const parties: Party[] = partiesQuery.data ?? [];
  const partyById = new Map(parties.map((p) => [p.id, p]));
  // Whoever administers the RCP is the QR-bill's payee, whether or not they
  // are also billed by it.
  const operator = parties.find((p) => p.role === "rcp_admin" || p.role === "rcp_admin_only");

  const invoicesQuery = useQuery({
    queryKey: ["billing-invoices", siteId, range?.from, range?.to],
    queryFn: () => api.billing.invoices(siteId, range!.from, range!.to),
    enabled: !!range,
  });
  const result = invoicesQuery.data;

  return (
    <div className="print-invoices space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 print:hidden">
        <Field label="Période">
          <select
            className="input w-36"
            value={kind}
            onChange={(e) => switchKind(e.target.value as BillingPeriodKind)}
          >
            {PERIOD_ORDER.map((k) => (
              <option key={k} value={k}>
                {PERIOD_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>

        {kind === "custom" ? (
          <>
            <Field label="Du">
              <input
                type="date"
                className="input"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </Field>
            <Field label="Au">
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
              Générer les factures
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1 pb-0.5">
            <button
              onClick={() => setOffset(offset - 1)}
              aria-label="Période précédente"
              className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ‹
            </button>
            <span className="min-w-36 text-center text-sm font-medium text-slate-900">
              {billingPeriodLabel(kind, offset)}
            </span>
            <button
              onClick={() => setOffset(offset + 1)}
              aria-label="Période suivante"
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
              <span className="ml-2 text-amber-700">· période à venir</span>
            ) : range.to > todayLocal() ? (
              <span className="ml-2 text-amber-700">· période en cours</span>
            ) : null}
          </span>
        )}

        {result && result.invoices.length > 0 && (
          <button
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Imprimer / enregistrer en PDF
          </button>
        )}
        {result && (
          <span className="pb-2 text-sm text-slate-500">
            {result.days} jours · RCP de {result.participantCount} participants
            {result.localRateChf != null &&
              ` · énergie locale ${(result.localRateChf * 100).toFixed(2)} ct./kWh`}
          </span>
        )}
      </div>

      {result?.warnings.map((w, i) => (
        <p key={i} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          {w}
        </p>
      ))}

      {result?.invoices.map((inv) => (
        <InvoiceDocument
          key={inv.partyId ?? inv.partyName}
          invoice={inv}
          operator={operator}
          party={inv.partyId ? partyById.get(inv.partyId) : undefined}
        />
      ))}
    </div>
  );
}

/** Page one mirrors the provider's layout; page two is the VZEV comparison. */
function InvoiceDocument({
  invoice,
  operator,
  party,
}: {
  invoice: ParticipantInvoice;
  operator?: Party;
  party?: Party;
}) {
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
            <p className="text-sm text-slate-600">N° de participant {invoice.partyReference}</p>
          )}
          <p className="text-sm text-slate-500">
            Facturation du {invoice.from} au {invoice.to} · {invoice.days} jours · RCP de{" "}
            {invoice.participantCount} participants
          </p>
        </header>

        {grouped.map(({ category, lines }) => (
          <div key={category} className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">{CATEGORY_LABELS[category]}</h3>
            <LineTable lines={lines} />
            <div className="flex justify-between border-t pt-1 text-sm font-medium">
              <span>Sous-total</span>
              <span className="tabular-nums">
                {chf(lines.reduce((s, l) => s + l.amountChf, 0))}
              </span>
            </div>
          </div>
        ))}

        <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-base font-semibold">
          <span>Montant à payer</span>
          <span className="tabular-nums">CHF {chf(invoice.totalChf)}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Soutirage du réseau {invoice.gridKwh.toFixed(1)} kWh · consommation issue de la
          production locale {invoice.localKwh.toFixed(1)} kWh. Montants TVA incluse (TVA du
          fournisseur répercutée, aucune TVA supplémentaire).
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
            Votre avantage dans le RCP — {invoice.partyName}
            {invoice.partyReference ? ` (${invoice.partyReference})` : ""}
          </h2>
          <p className="text-sm text-slate-500">
            Ce que vous auriez payé si vous étiez approvisionné directement par le gestionnaire de
            réseau.
          </p>
        </header>

        <h3 className="mb-1 text-sm font-semibold text-slate-900">
          Approvisionnement direct (comparaison)
        </h3>
        <LineTable lines={invoice.comparison.lines} />
        <div className="flex justify-between border-t pt-1 text-sm font-medium">
          <span>Total approvisionnement direct</span>
          <span className="tabular-nums">{chf(invoice.comparison.totalChf)}</span>
        </div>

        <dl className="mt-5 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Directement par le gestionnaire de réseau</dt>
            <dd className="tabular-nums">CHF {chf(invoice.comparison.totalChf)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">Votre facture RCP</dt>
            <dd className="tabular-nums">CHF {chf(invoice.totalChf)}</dd>
          </div>
          <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-base font-semibold">
            <dt>Votre avantage</dt>
            <dd className="tabular-nums">CHF {chf(invoice.comparison.savingChf)}</dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-slate-500">
          L'avantage a deux origines : les tarifs de base du raccordement sont répartis dans le RCP
          entre {invoice.participantCount} participants au lieu d'être facturés individuellement, et{" "}
          {invoice.localKwh.toFixed(1)} kWh provenaient de la production locale plutôt que du réseau.
        </p>
      </section>

      {/* The payment part shares this sheet with the comparison and is pinned
          to its bottom edge, where the tear line is.

          Skipped on the administrator's own invoice — a slip payable from and
          to the same account is meaningless. An `rcp_admin` still receives the
          invoice itself: they owe their share, they just settle it without a
          payment slip. */}
      {!(operator && party && operator.id === party.id) && (
        <QrBill operator={operator} invoice={invoice} party={party} />
      )}
      </div>
    </>
  );
}

function LineTable({ lines }: { lines: InvoiceLine[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr>
          <th className="py-1 font-medium">Position</th>
          <th className="py-1 text-right font-medium">Quantité</th>
          <th className="py-1 text-right font-medium">Prix</th>
          <th className="py-1 text-right font-medium">Montant CHF</th>
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
                : `${l.quantity} jours`}
            </td>
            <td className="py-1 text-right tabular-nums text-slate-600">
              {l.quantityUnit === "kWh"
                ? `${(l.unitRateChf * 100).toFixed(2)} ct.`
                : `${(l.unitRateChf * 365).toFixed(2)} CHF/an`}
            </td>
            <td className="py-1 text-right tabular-nums text-slate-900">{chf(l.amountChf)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
