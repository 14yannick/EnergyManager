import type {
  DirectBillingComparison,
  GridTariffPosition,
  InvoiceLine,
  ParticipantInvoice,
} from "@energy-manager/shared";

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
export function buildInvoiceLines(inputs: InvoiceInputs): InvoiceLine[] {
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
      amountChf: round2(usage.localKwh * localRateChf),
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
        amountChf: round2(quantity * position.rateChf),
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
      amountChf: round2(annualToPeriod(position.rateChf, days) / divisor),
    });
  }

  return lines;
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
export function buildDirectComparison(
  inputs: InvoiceInputs,
  vzevTotalChf: number,
): DirectBillingComparison {
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
        amountChf: round2(totalKwh * position.rateChf),
      });
    } else {
      lines.push({
        category: position.category,
        label: position.label,
        allocation: position.allocation,
        quantity: days,
        quantityUnit: "days",
        unitRateChf: position.rateChf / DAYS_PER_YEAR,
        amountChf: round2(annualToPeriod(position.rateChf, days)),
      });
    }
  }

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

/** Inclusive day count between two YYYY-MM-DD dates, as the provider counts them. */
export function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000) + 1;
}
