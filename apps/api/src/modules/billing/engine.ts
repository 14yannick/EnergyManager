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
  /**
   * The owner's own consumption that never touched the meter: PV used as it
   * was made, and load covered from the battery. Only the owner's invoice
   * carries them — a participant's local energy is `localKwh`, bought at the
   * RCP rate. They cost nothing here and are what the comparison shows the
   * grid would have charged for.
   */
  selfDirectKwh?: number;
  selfBatteryKwh?: number;
  /**
   * What the grid provider credits for this party's own exported energy, and
   * the kWh behind it — already priced (per interval, for a dynamic period),
   * not recomputed here. Only a party with metered export carries this;
   * today that is always the owner.
   */
  feedInKwh?: number;
  feedInRevenueChf?: number;
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
 * The `+ 1` applies only when no party administers the site at all: the owner
 * still exists and still consumes, they just haven't been entered yet, which
 * is how every site looked before parties could carry a role. Once an admin
 * party exists, its own role says whether to count it, and adding the
 * constant as well would count the same household twice — that bug reached 5
 * for 4 people and under-charged everybody.
 *
 * `siteParties` (all parties at the site, unfiltered) decides *whether* the
 * fallback applies; `billedParties` (which may be narrower — e.g. filtered to
 * who was valid for a given period) decides the count itself. They default to
 * the same list, so a caller with no period in play can pass just one. Without
 * this split, an admin party that has been entered but isn't valid for the
 * period being billed would be mistaken for "never entered" and trigger the
 * fallback anyway, showing a phantom participant instead of the true zero.
 */
export function participantCountOf(
  billedParties: ReadonlyArray<{ role: PartyRole }>,
  siteParties: ReadonlyArray<{ role: PartyRole }> = billedParties,
): number {
  const billed = billedParties.filter(isBilledParty).length;
  const administered = siteParties.some((p) => ADMIN_PARTY_ROLES.includes(p.role));
  return administered ? billed : billed + 1;
}

/**
 * Whether a party was a member for the *entire* period, not just part of
 * it — this engine doesn't prorate a shared cost across a mid-period join or
 * leave, so a party only counts (for being invoiced, and for the pool
 * dividing `pool_shared` costs) when they were present start to end. Null
 * start/end means no bound on that side.
 */
export function partyValidForPeriod<T extends { startDate: string | null; endDate: string | null }>(
  party: T,
  from: string,
  to: string,
): boolean {
  if (party.startDate && party.startDate > from) return false;
  if (party.endDate && party.endDate < to) return false;
  return true;
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

  // The feed-in credit leads the invoice, ahead of everything else: it is
  // money the grid provider pays out, not a charge the RCP levies, so it
  // reads as a credit against the bill rather than one more position in it.
  if ((usage.feedInKwh ?? 0) > 0) {
    const kwh = usage.feedInKwh!;
    const revenue = usage.feedInRevenueChf ?? 0;
    lines.push({
      category: "energie",
      label: "Feed-in credit (grid export)",
      kind: "feed_in",
      allocation: "per_kwh",
      quantity: kwh,
      quantityUnit: "kWh",
      unitRateChf: revenue / kwh,
      amountChf: -revenue,
    });
  }

  // The owner's self-consumption leads the invoice at a price of zero: not
  // a charge, a statement of the whole consumption, so the grid draw below
  // is seen as the part of it that had to be bought. The label is a
  // placeholder — the invoice prints these by `kind`, in its own language.
  const selfLine = (kind: "self_direct" | "self_battery", kwh: number, label: string): InvoiceLine => ({
    category: "energie",
    label,
    kind,
    allocation: "per_kwh",
    quantity: kwh,
    quantityUnit: "kWh",
    unitRateChf: 0,
    amountChf: 0,
  });
  if ((usage.selfDirectKwh ?? 0) > 0) {
    lines.push(selfLine("self_direct", usage.selfDirectKwh!, "Own production, used directly"));
  }
  if ((usage.selfBatteryKwh ?? 0) > 0) {
    lines.push(selfLine("self_battery", usage.selfBatteryKwh!, "Own production, from the battery"));
  }

  if (usage.localKwh > 0 && localRateChf != null) {
    lines.push({
      category: "energie",
      label: "Energy from local production (vZEV)",
      kind: "local",
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
/** Every kWh the household consumed, wherever it came from. */
function consumedKwh(usage: ParticipantUsage): number {
  return usage.gridKwh + usage.localKwh + (usage.selfDirectKwh ?? 0) + (usage.selfBatteryKwh ?? 0);
}

/**
 * What the grid charges per kWh on a direct connection: every per-kWh
 * position that exists without the RCP, whichever of the two kWh
 * allocations it carries — billed directly, both fall on the same total.
 */
function directGridRatePerKwh(positions: GridTariffPosition[]): number {
  return positions
    .filter((p) => p.countsInDirectBilling && (p.allocation === "per_kwh" || p.allocation === "per_kwh_total"))
    .reduce((sum, p) => sum + p.rateChf, 0);
}

function rawDirectLines(inputs: InvoiceInputs): InvoiceLine[] {
  const { days, usage } = inputs;
  // Supplied directly there is no own production to draw on: the self-consumed
  // kWh are bought from the grid like the rest.
  const totalKwh = consumedKwh(usage);
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
  const savingChf = round2(totalChf - vzevTotalChf);

  // Where the saving came from. The owner's own kWh are worth exactly what
  // the grid would have charged for them; whatever is left is the RCP's
  // doing — standing charges shared, local energy under the grid's price.
  // The remainder is taken, not computed, so the three always add up to the
  // saving printed above them, rounding included.
  const rate = directGridRatePerKwh(inputs.positions);
  const directUseChf = round2((inputs.usage.selfDirectKwh ?? 0) * rate);
  const batteryChf = round2((inputs.usage.selfBatteryKwh ?? 0) * rate);
  const rcpChf = round2(savingChf - directUseChf - batteryChf);
  return { lines, totalChf, savingChf, savingSplit: { directUseChf, batteryChf, rcpChf } };
}

/**
 * A party whose local draw was imported but whose grid draw was not.
 *
 * The two arrive as separate CSV series under the same party name, and
 * nothing ties them together. With the grid series missing, every per-kWh
 * position multiplies by zero and prints a CHF 0.00 line — an invoice that
 * looks like a quiet month rather than a half-imported one. Local energy
 * without a single grid kWh over a whole billing period is not how a
 * household behaves, so it is the signature of the missing file.
 */
export function usageLooksHalfImported(usage: Pick<ParticipantUsage, "localKwh" | "gridKwh">): boolean {
  return usage.localKwh > 0 && usage.gridKwh === 0;
}

export function buildParticipantInvoice(inputs: InvoiceInputs): ParticipantInvoice {
  const lines = buildInvoiceLines(inputs);
  const totalChf = round2(lines.reduce((sum, l) => sum + l.amountChf, 0));
  // The feed-in credit is the owner's own income from the grid provider,
  // earned whether or not the connection is shared at all — folding it into
  // the vZEV-vs-direct comparison would count it as part of the vZEV's own
  // benefit, which it isn't.
  const billedTotalChf = round2(
    lines.filter((l) => l.kind !== "feed_in").reduce((sum, l) => sum + l.amountChf, 0),
  );
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
    selfDirectKwh: inputs.usage.selfDirectKwh ?? 0,
    selfBatteryKwh: inputs.usage.selfBatteryKwh ?? 0,
    lines,
    totalChf,
    comparison: buildDirectComparison(inputs, billedTotalChf),
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

/**
 * Positions in force on a calendar day. Tested at 12:00 UTC — 13:00 or 14:00
 * in Zurich, either way inside the day: positions are stored from local
 * midnights, so any instant that far from both edges sits safely inside
 * whichever one covers the day.
 */
export function positionsValidOn(positions: GridTariffPosition[], day: string): GridTariffPosition[] {
  const noon = `${day}T12:00:00.000Z`;
  return positions.filter((p) => p.validFrom <= noon && p.validTo > noon);
}

/**
 * Positions that overlap the period without covering all of it — a tariff
 * that changed somewhere between `from` and `to`.
 *
 * An invoice run must refuse these rather than bill them. Every position it
 * is handed is charged for the whole period, so two versions of "Tarif de
 * base" that each overlap it would both appear at full length: the provider
 * would print two pro-rated lines, this would print two whole ones. The
 * consumption view prices day by day and is untroubled; an invoice is one
 * document for one set of rates, and the honest answer is to split the
 * period at the change.
 */
const SITE_TZ = "Europe/Zurich";

/**
 * Local midnight on a calendar day, as the UTC instant positions and tariff
 * periods are stored at. Zurich is one or two hours ahead of UTC, so it is
 * 23:00Z or 22:00Z the evening before — which is why a bound written as
 * `${day}T00:00:00Z` was wrong by an hour or two, and a position ending
 * exactly on a period's last midnight read as ending inside it.
 */
export function localMidnightIso(day: string, tz: string = SITE_TZ): string {
  for (const offset of ["+01:00", "+02:00"]) {
    const at = new Date(`${day}T00:00:00${offset}`);
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const p = Object.fromEntries(local.map((x) => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}` === day && p.hour === "00") return at.toISOString();
  }
  throw new Error(`${day} has no midnight in ${tz}`);
}

/** The half-open instant range a billing period covers: [from 00:00, to + 1 day 00:00), local. */
export function periodBounds(from: string, to: string): { startIso: string; endExclusiveIso: string } {
  const next = new Date(`${to}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { startIso: localMidnightIso(from), endExclusiveIso: localMidnightIso(next.toISOString().slice(0, 10)) };
}

/** Positions in force at any moment of the period. */
export function positionsOverlapping(positions: GridTariffPosition[], from: string, to: string): GridTariffPosition[] {
  const { startIso, endExclusiveIso } = periodBounds(from, to);
  return positions.filter((p) => p.validFrom < endExclusiveIso && p.validTo > startIso);
}

export function positionsChangingWithin(
  positions: GridTariffPosition[],
  from: string,
  to: string,
): GridTariffPosition[] {
  const { startIso, endExclusiveIso } = periodBounds(from, to);
  // Strictly inside: a position that begins on the period's first midnight
  // or ends on the midnight after its last day covers it whole.
  return positionsOverlapping(positions, from, to).filter(
    (p) => p.validFrom > startIso || p.validTo < endExclusiveIso,
  );
}

/**
 * Whether the owner is a member of the RCP: administering it as `rcp_admin`,
 * or not entered as a party at all (the unlisted owner `participantCountOf`
 * already counts). An `rcp_admin_only` runs the app from outside the RCP and
 * shares no connection.
 */
export function ownerIsMember(parties: ReadonlyArray<{ role: PartyRole }>): boolean {
  const admin = parties.find((p) => ADMIN_PARTY_ROLES.includes(p.role));
  return admin == null || admin.role === "rcp_admin";
}

export interface OwnerFixedCosts {
  /** Every standing charge borne in full, as on a connection of one's own. */
  aloneChf: number;
  /** The owner's part inside the RCP: shared positions divided, own ones whole. */
  rcpChf: number;
}

/**
 * The owner's standing charges for `days` (a day, or 1/24 of one), alone and
 * inside the RCP — the same arithmetic as a participant's invoice and its
 * direct-supply comparison, with no energy. What the owner saves by sharing
 * the connection is `aloneChf - rcpChf`: less when a VZEV-only position (the
 * virtual metering fee) is added, more the more members share the rest.
 */
export function ownerFixedCosts(positions: GridTariffPosition[], participantCount: number, days: number): OwnerFixedCosts {
  const costs = consumptionCosts({
    from: "",
    to: "",
    days,
    participantCount,
    positions,
    localRateChf: null,
    usage: { partyId: null, partyReference: null, partyName: "", gridKwh: 0, localKwh: 0 },
  });
  return { aloneChf: costs.directFixedChf, rcpChf: costs.rcpFixedChf };
}

/** Inclusive day count between two YYYY-MM-DD dates, as the provider counts them. */
export function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000) + 1;
}
