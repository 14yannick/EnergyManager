import type { BillingCategory, InvoiceLocale } from "@energy-manager/shared";

/**
 * The generated PDF's fixed labels, in the three languages the app already
 * speaks — mirroring the wording of the matching keys in apps/web's own
 * i18n catalogues (invoice.*, billing.cat.*) so a participant reading the
 * PDF meets the same terms as the browser's own invoice page. Kept as its
 * own small dictionary rather than importing apps/web's i18n system: this
 * is ~20 fixed strings, not the whole app's UI.
 */
export interface PdfText {
  participantNo: (reference: string) => string;
  header: (from: string, to: string, days: number, participants: number) => string;
  category: Record<BillingCategory, string>;
  columnPosition: string;
  columnQuantity: string;
  columnPrice: string;
  columnAmount: string;
  subtotal: string;
  amountDue: string;
  benefitTitle: (name: string) => string;
  benefitIntro: string;
  directSupply: string;
  directSupplyTotal: string;
  directly: string;
  yourInvoice: string;
  yourBenefit: string;
  footnote: (grid: string, local: string) => string;
  footnoteOwner: (total: string, direct: string, battery: string, grid: string) => string;
  benefitNote: (participants: number, local: string) => string;
  benefitNoteOwner: (own: string, participants: number) => string;
  splitDirectUse: string;
  splitBattery: string;
  splitRcp: string;
  lineLabel: Record<"local" | "self_direct" | "self_battery" | "feed_in", string>;
  cents: string;
  perYear: string;
  days: (count: number) => string;
}

const en: PdfText = {
  participantNo: (reference) => `Participant no. ${reference}`,
  header: (from, to, days, participants) =>
    `Billing from ${from} to ${to} · ${days} days · vZEV of ${participants} participants`,
  category: {
    energie: "Energy",
    netznutzung: "Grid usage",
    messung: "Metering",
    abgaben: "Levies and services",
  },
  columnPosition: "Position",
  columnQuantity: "Quantity",
  columnPrice: "Price",
  columnAmount: "Amount CHF",
  subtotal: "Subtotal",
  amountDue: "Amount due",
  benefitTitle: (name) => `Your benefit in the vZEV — ${name}`,
  benefitIntro: "What you would have paid supplied directly by the grid operator.",
  directSupply: "Direct supply (comparison)",
  directSupplyTotal: "Direct supply total",
  directly: "Directly from the grid operator",
  yourInvoice: "Your vZEV invoice",
  yourBenefit: "Your benefit",
  footnote: (grid, local) =>
    `Grid draw ${grid} kWh · consumption from local production ${local} kWh. Amounts include VAT (the supplier's VAT passed through, no additional VAT).`,
  footnoteOwner: (total, direct, battery, grid) =>
    `Consumption ${total} kWh: ${direct} kWh own production used directly, ${battery} kWh from the battery, ${grid} kWh drawn from the grid. Only the grid draw is charged. Amounts include VAT (the supplier's VAT passed through, no additional VAT).`,
  benefitNote: (participants, local) =>
    `The benefit has two sources: the connection's base charges are split across ${participants} participants in the vZEV instead of being billed individually, and ${local} kWh came from local production rather than from the grid.`,
  benefitNoteOwner: (own, participants) =>
    `The benefit has two sources: ${own} kWh of your own production replaced supply from the grid, and the connection's base charges are split across ${participants} participants in the vZEV instead of being borne alone.`,
  splitDirectUse: "of which own production used directly",
  splitBattery: "of which from the battery",
  splitRcp: "of which the vZEV",
  lineLabel: {
    local: "Energy from local production (vZEV)",
    self_direct: "Own production, used directly",
    self_battery: "Own production, from the battery",
    feed_in: "Feed-in credit (grid export)",
  },
  cents: "ct.",
  perYear: "CHF/year",
  days: (count) => `${count} days`,
};

const fr: PdfText = {
  participantNo: (reference) => `N° de participant ${reference}`,
  header: (from, to, days, participants) =>
    `Facturation du ${from} au ${to} · ${days} jours · RCPv de ${participants} participants`,
  category: {
    energie: "Énergie",
    netznutzung: "Utilisation du réseau",
    messung: "Mesure",
    abgaben: "Redevances et prestations",
  },
  columnPosition: "Position",
  columnQuantity: "Quantité",
  columnPrice: "Prix",
  columnAmount: "Montant CHF",
  subtotal: "Sous-total",
  amountDue: "Montant à payer",
  benefitTitle: (name) => `Votre avantage dans le RCPv — ${name}`,
  benefitIntro: "Ce que vous auriez payé en approvisionnement direct par le gestionnaire de réseau.",
  directSupply: "Approvisionnement direct (comparaison)",
  directSupplyTotal: "Total approvisionnement direct",
  directly: "Directement par le gestionnaire de réseau",
  yourInvoice: "Votre facture RCPv",
  yourBenefit: "Votre avantage",
  footnote: (grid, local) =>
    `Soutirage du réseau ${grid} kWh · consommation issue de la production locale ${local} kWh. Montants TVA incluse (TVA du fournisseur répercutée, aucune TVA supplémentaire).`,
  footnoteOwner: (total, direct, battery, grid) =>
    `Consommation ${total} kWh : ${direct} kWh de production propre consommée directement, ${battery} kWh via la batterie, ${grid} kWh soutirés du réseau. Seul le soutirage est facturé. Montants TVA incluse (TVA du fournisseur répercutée, aucune TVA supplémentaire).`,
  benefitNote: (participants, local) =>
    `L'avantage a deux origines : les tarifs de base du raccordement sont répartis dans le RCPv entre ${participants} participants au lieu d'être facturés individuellement, et ${local} kWh provenaient de la production locale plutôt que du réseau.`,
  benefitNoteOwner: (own, participants) =>
    `L'avantage a deux origines : ${own} kWh de votre propre production ont remplacé la fourniture du réseau, et les tarifs de base du raccordement sont répartis dans le RCPv entre ${participants} participants au lieu d'être supportés seul.`,
  splitDirectUse: "dont production propre consommée directement",
  splitBattery: "dont via la batterie",
  splitRcp: "dont le RCPv",
  lineLabel: {
    local: "Énergie issue de la production locale (RCPv)",
    self_direct: "Production propre, consommée directement",
    self_battery: "Production propre, via la batterie",
    feed_in: "Crédit d'injection (réinjection réseau)",
  },
  cents: "ct.",
  perYear: "CHF/an",
  days: (count) => `${count} jours`,
};

const de: PdfText = {
  participantNo: (reference) => `Teilnehmer-Nr. ${reference}`,
  header: (from, to, days, participants) =>
    `Fakturierung vom ${from} bis ${to} · ${days} Tage · vZEV mit ${participants} Teilnehmern`,
  category: {
    energie: "Energie",
    netznutzung: "Netznutzung",
    messung: "Messung",
    abgaben: "Abgaben & Leistungen",
  },
  columnPosition: "Position",
  columnQuantity: "Bezug",
  columnPrice: "Preis",
  columnAmount: "Betrag in CHF",
  subtotal: "Zwischentotal",
  amountDue: "Zu bezahlender Betrag",
  benefitTitle: (name) => `Ihr Vorteil im vZEV — ${name}`,
  benefitIntro: "Was Sie bei direkter Belieferung durch den Netzbetreiber bezahlt hätten.",
  directSupply: "Direkte Belieferung (Vergleich)",
  directSupplyTotal: "Total direkte Belieferung",
  directly: "Direkt vom Netzbetreiber",
  yourInvoice: "Ihre vZEV-Rechnung",
  yourBenefit: "Ihr Vorteil",
  footnote: (grid, local) =>
    `Netzbezug ${grid} kWh · Verbrauch aus lokaler Produktion ${local} kWh. Beträge inkl. MWST (die MWST des Lieferanten wird weitergegeben, es kommt keine zusätzliche MWST hinzu).`,
  footnoteOwner: (total, direct, battery, grid) =>
    `Verbrauch ${total} kWh: ${direct} kWh eigene Produktion direkt verbraucht, ${battery} kWh aus der Batterie, ${grid} kWh Netzbezug. Nur der Netzbezug wird verrechnet. Beträge inkl. MwSt. (MwSt. des Lieferanten weitergegeben, keine zusätzliche MwSt.).`,
  benefitNote: (participants, local) =>
    `Der Vorteil hat zwei Quellen: Die Grundtarife des Anschlusses werden im vZEV auf ${participants} Teilnehmer aufgeteilt, statt einzeln verrechnet zu werden, und ${local} kWh stammten aus der lokalen Produktion statt aus dem Netz.`,
  benefitNoteOwner: (own, participants) =>
    `Der Vorteil hat zwei Quellen: ${own} kWh eigene Produktion haben den Netzbezug ersetzt, und die Grundgebühren des Anschlusses werden im vZEV auf ${participants} Teilnehmer verteilt statt allein getragen.`,
  splitDirectUse: "davon eigene Produktion direkt verbraucht",
  splitBattery: "davon aus der Batterie",
  splitRcp: "davon der vZEV",
  lineLabel: {
    local: "Energie aus lokaler Produktion (vZEV)",
    self_direct: "Eigene Produktion, direkt verbraucht",
    self_battery: "Eigene Produktion, aus der Batterie",
    feed_in: "Einspeisevergütung (Netzeinspeisung)",
  },
  cents: "Rp.",
  perYear: "CHF/a",
  days: (count) => `${count} Tage`,
};

export function pdfText(locale: InvoiceLocale): PdfText {
  return { en, fr, de }[locale];
}
