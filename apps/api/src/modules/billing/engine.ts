import type {
  DirectBillingComparison,
  GridTariffPosition,
  InvoiceLine,
  ParticipantInvoice,
  PartyRole,
} from "@energy-manager/shared";
import { ADMIN_PARTY_ROLES, BILLED_PARTY_ROLES } from "@energy-manager/shared";

/**
 * Pure invoice arithmetic — no DB, no network (same split as savings/engine.ts).
 *
 * A VZEV buys electricity through one grid connection, so the provider's
 * standing charges land once on the pool rather than once per household. That
 * is the whole economic point of the arrangement, and it's what these two
 * allocations express: `pool_shared` positions are divided by the number of
 * participants, `per_participant` ones are billed for each of them.
 */

export interface ParticipantUsage {
  partyId: string | null;
  partyReference: string | null;
  partyName: string;
  /** Drawn from the grid through the pool's connection. */
  gridKwh: number;
  /** Taken from the operator's PV, billed at the agreed neighbour rate. */
  localKwh: number;
}

export interface InvoiceInputs {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  days: number;
  participantCount: number;
  positions: GridTariffPosition[];
  /** Agreed CHF/kWh for energy taken from the operator's PV. */
  localRateChf: number | null;
  usage: ParticipantUsage;
}

const DAYS_PER_YEAR = 365;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Annual positions are charged pro-rata by day, exactly as the provider bills
 * them (91 days of a 39.00 CHF/a tariff = 9.72 CHF).
 */
function annualToPeriod(rateChfPerYear: number, days: number): number {
  return (rateChfPerYear * days) / DAYS_PER_YEAR;
}

function sortPositions(positions: GridTariffPosition[]): GridTariffPosition[] {
  return [...positions].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/**
 * The participant's own bill: energy taken from the operator first (that's the
 * position the VZEV exists to create), then the grid provider's positions
 * spread according to each one's allocation.
 */
/** Parties that consume from the connection, so are invoiced and counted. */
export function isBilledParty<T extends { role: PartyRole }>(party: T): boolean {
  return BILLED_PARTY_ROLES.includes(party.role);
}

/**
 * Who shares the connection, for dividing `pool_shared` positions.
 *
 * Households only: `rcp_admin_only` and `viewer` consume nothing and must not
 * dilute the division. An `rcp_admin` does consume, so is counted like any
 * member — the owner normally pays a share of the fixed costs and imports
 * from the grid like everyone else.
 *
 * The `+ 1` applies only when no party administers the RCP at all: the owner
 * still exists and still consumes, they just haven't been entered yet, which
 * is how every site looked before parties could carry a role. Once an admin
 * party exists, its own role says whether to count it, and adding the
 * constant as well would count the same household twice — that bug reached 5
 * for 4 people and under-charged everybody.
 */
export function participantCountOf(parties: ReadonlyArray<{ role: PartyRole }>): number {
  const billed = parties.filter(isBilledParty).length;
  const administered = parties.some((p) => ADMIN_PARTY_ROLES.includes(p.role));
  return administered ? billed : billed + 1;
}

/**
 * The invoice's lines with amounts left unrounded.
 *
 * Every amount is linear in days or kWh, so costs computed this way for
 * consecutive stretches add up to the cost of the whole — which is what lets
 * the consumption dashboard price a range day by day and still agree with the
 * invoice for it. Rounding each stretch first would not add up.
 */
function rawInvoiceLines(inputs: InvoiceInputs): InvoiceLine[] {
  const { days, participantCount, usage, localRateChf } = inputs;
  const lines: InvoiceLine[] = [];

  if (usage.localKwh > 0 && localRateChf != null) {
    lines.push({
      category: "energie",
      label: "Énergie issue de la production locale (RCP)",
      allocation: "per_kwh",
      quantity: usage.localKwh,
      quantityUnit: "kWh",
      unitRateChf: localRateChf,
      amountChf: usage.localKwh * localRateChf,
    });
  }

  for (const position of sortPositions(inputs.positions)) {
    if (position.allocation === "per_kwh" || position.allocation === "per_kwh_total") {
      // A levy on all electricity consumed is due on the locally supplied kWh
      // too, not only on what came off the grid.
      const quantity =
        position.allocation === "per_kwh_total" ? usage.gridKwh + usage.localKwh : usage.gridKwh;
      lines.push({
        category: position.category,
        label: position.label,
        allocation: position.allocation,
        quantity,
        quantityUnit: "kWh",
        unitRateChf: position.rateChf,
        amountChf: quantity * position.rateChf,
      });
      continue;
    }
    // Divided across the pool, or borne individually.
    const divisor = position.allocation === "pool_shared" ? Math.max(participantCount, 1) : 1;
    const perDay = position.rateChf / DAYS_PER_YEAR / divisor;
    lines.push({
      category: position.category,
      label: position.label,
      allocation: position.allocation,
      quantity: days,
      quantityUnit: "days",
      unitRateChf: perDay,
      amountChf: annualToPeriod(position.rateChf, days) / divisor,
    });
  }

  return lines;
}

export function buildInvoiceLines(inputs: InvoiceInputs): InvoiceLine[] {
  return rawInvoiceLines(inputs).map((line) => ({ ...line, amountChf: round2(line.amountChf) }));
}

/**
 * The counterfactual for page two: the same household with its own grid
 * connection. Every standing charge is then borne in full rather than shared,
 * and every kWh — including the ones the VZEV supplied locally — is bought
 * from the provider.
 *
 * VZEV-only positions (the virtual metering fee) are excluded: they wouldn't
 * exist without the pool, so counting them would overstate the saving.
 */
function rawDirectLines(inputs: InvoiceInputs): InvoiceLine[] {
  const { days, usage } = inputs;
  const totalKwh = usage.gridKwh + usage.localKwh;
  const lines: InvoiceLine[] = [];

  for (const position of sortPositions(inputs.positions)) {
    if (!position.countsInDirectBilling) continue;
    // Billed directly, every kWh comes off the grid, so both per-kWh
    // allocations fall on the same total.
    if (position.allocation === "per_kwh" || position.allocation === "per_kwh_total") {
      lines.push({
        category: position.category,
        label: position.label,
        allocation: position.allocation,
        quantity: totalKwh,
        quantityUnit: "kWh",
        unitRateChf: position.rateChf,
        amountChf: totalKwh * position.rateChf,
      });
    } else {
      lines.push({
        category: position.category,
        label: position.label,
        allocation: position.allocation,
        quantity: days,
        quantityUnit: "days",
        unitRateChf: position.rateChf / DAYS_PER_YEAR,
        amountChf: annualToPeriod(position.rateChf, days),
      });
    }
  }
  return lines;
}

export function buildDirectComparison(
  inputs: InvoiceInputs,
  vzevTotalChf: number,
): DirectBillingComparison {
  const lines = rawDirectLines(inputs).map((line) => ({ ...line, amountChf: round2(line.amountChf) }));
  const totalChf = round2(lines.reduce((sum, l) => sum + l.amountChf, 0));
  return { lines, totalChf, savingChf: round2(totalChf - vzevTotalChf) };
}

export function buildParticipantInvoice(inputs: InvoiceInputs): ParticipantInvoice {
  const lines = buildInvoiceLines(inputs);
  const totalChf = round2(lines.reduce((sum, l) => sum + l.amountChf, 0));
  return {
    partyId: inputs.usage.partyId,
    partyReference: inputs.usage.partyReference,
    partyName: inputs.usage.partyName,
    from: inputs.from,
    to: inputs.to,
    days: inputs.days,
    participantCount: inputs.participantCount,
    gridKwh: inputs.usage.gridKwh,
    localKwh: inputs.usage.localKwh,
    lines,
    totalChf,
    comparison: buildDirectComparison(inputs, totalChf),
  };
}

export interface ConsumptionCosts {
  /** What the participant pays through the RCP: their invoice, unrounded. */
  rcpChf: number;
  /** Of that, the locally produced energy at the agreed neighbour rate. */
  localEnergyChf: number;
  /**
   * Of that, the standing charges: every position billed per day rather than
   * per kWh, shared across the pool or borne individually as the invoice does.
   */
  rcpFixedChf: number;
  /** The same consumption billed directly by the grid provider. */
  directChf: number;
  /** Of that, the standing charges — each borne in full, nothing shared. */
  directFixedChf: number;
}

/**
 * The invoice and its direct-billing counterfactual as two plain sums, without
 * the per-line rounding a printed invoice needs — see `rawInvoiceLines` on why.
 * `directChf - rcpChf` is the same saving page two of the invoice states.
 */
export function consumptionCosts(inputs: InvoiceInputs): ConsumptionCosts {
  const lines = rawInvoiceLines(inputs);
  const direct = rawDirectLines(inputs);
  const sum = (ls: InvoiceLine[]) => ls.reduce((total, l) => total + l.amountChf, 0);
  const fixed = (ls: InvoiceLine[]) => sum(ls.filter((l) => l.quantityUnit === "days"));
  return {
    rcpChf: sum(lines),
    // Mirrors the local-energy line: absent when the neighbour rate is unset.
    localEnergyChf: inputs.localRateChf == null ? 0 : inputs.usage.localKwh * inputs.localRateChf,
    rcpFixedChf: fixed(lines),
    directChf: sum(direct),
    directFixedChf: fixed(direct),
  };
}

/** Inclusive day count between two YYYY-MM-DD dates, as the provider counts them. */
export function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000) + 1;
}
