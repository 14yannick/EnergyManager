export interface Site {
  id: string;
  name: string;
  timezone: string;
  /** "YYYY-MM-DD", or null when not stated. */
  productionStartDate: string | null;
  /** Fraction (0-1) of battery charge lost to conversion. Defaults to 0.1. */
  batteryConversionLoss: number;
  createdAt: string;
  updatedAt: string;
}

export type CostCategory = "battery" | "solar";

/**
 * "purchase" = grid import rate, "feed_in" = grid export rate, "neighbor_sell"
 * = rate for energy sold directly to neighbours (VZEV-adjacent). Kept as a
 * data value rather than separate hardcoded columns so new kinds don't need
 * a schema change.
 */
export type TariffKind = "purchase" | "feed_in" | "neighbor_sell";

/**
 * How a period is priced. "flat" uses the period's own rate; "dynamic" prices
 * from the day-ahead feed, treating the period's rate (if any) as a fallback
 * for intervals the feed never delivered.
 */
export type TariffPricingMode = "flat" | "dynamic";

export interface TariffPeriod {
  id: string;
  siteId: string;
  kind: TariffKind;
  startTs: string; // ISO datetime, half-open [startTs, endTs)
  endTs: string;
  pricingMode: TariffPricingMode;
  /** Always set for a flat period; optional fallback on a dynamic one. */
  rateChfPerKwh: number | null;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Quarter-hour rates ingested from an external dynamic-pricing feed (e.g.
 * BKW's dyntariffs API). Separate from `TariffPeriod`: this table is bulk
 * upserted by an automated poller, `tariff_periods` is small and hand-entered.
 * When both exist for a given instant, dynamic rates take precedence (see
 * `findRateForInstant` and the savings service).
 */
export interface DynamicTariffRate {
  id: string;
  siteId: string;
  kind: TariffKind;
  startTs: string;
  endTs: string;
  rateChfPerKwh: number;
  source: string;
  publicationTimestamp: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An additive per-kWh component layered on top of the resolved `kind` rate
 * for the same instant — e.g. a "Herkunftsnachweis" (origin certificate) or
 * "Mindestvergütungsprämie" (minimum feed-in premium) on top of the feed-in
 * rate. Unlike `TariffPeriod`, multiple surcharges of the same kind may
 * overlap the same period — they all get summed onto the base rate rather
 * than one being picked.
 */
export interface TariffSurcharge {
  id: string;
  siteId: string;
  kind: TariffKind;
  startTs: string; // ISO datetime, half-open [startTs, endTs)
  endTs: string;
  rateChfPerKwh: number;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface CostItem {
  id: string;
  siteId: string;
  category: CostCategory;
  label: string;
  amountChf: number; // negative = subsidy / tax reduction
  incurredOn: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostItemsSummary {
  battery: number;
  solar: number;
  total: number;
}

export type ReadingImportMode = "delta" | "cumulative";

/**
 * An external consumption-tracked entity (a neighbour in a VZEV-style
 * setup). The homeowner's own consumption stays derived, so there's no
 * "owner" party.
 */
/**
 * What a party is to the RCP.
 *
 * Administering and being billed are independent, which is why there are two
 * admin values: the owner normally consumes from the same connection, pays a
 * share of the fixed costs and imports from the grid like everyone else
 * (`rcp_admin`), but whoever runs the app might instead be outside the RCP
 * altogether (`rcp_admin_only`) — a managing agent, say.
 *
 * `rcp_admin_only` and `viewer` are excluded from invoicing and from the
 * participant count that divides the shared fixed costs; `rcp_admin` and
 * `rcp_party` are billed alike.
 */
export type PartyRole = "rcp_party" | "rcp_admin" | "rcp_admin_only" | "viewer";

/** Roles that consume from the connection, so are billed and counted. */
export const BILLED_PARTY_ROLES: readonly PartyRole[] = ["rcp_party", "rcp_admin"];

/** Roles that administer the app. At most one party per site holds one. */
export const ADMIN_PARTY_ROLES: readonly PartyRole[] = ["rcp_admin", "rcp_admin_only"];

export interface Party {
  id: string;
  siteId: string;
  /** Participant number as used on paperwork, e.g. "592971". */
  reference: string | null;
  name: string;
  /** Contact addresses; a household can have several. */
  emails: string[];
  /** Postal address for the QR-bill's "payable by" half. */
  address: string | null;
  buildingNumber: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  /** What this party is to the RCP. See `PartyRole`. */
  role: PartyRole;
  /** Account the QR-bill is payable to. Only meaningful on an admin party. */
  iban: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Attribute model: one row per (site, timestamp, metric) instead of fixed
 * columns — mirrors TariffPeriod's `kind`. "consumption" is per-party
 * (`partyId` required); every other kind is site-level (`partyId` null).
 */
export type IntervalMetricKind =
  /** PV's share of inverter AC output. Derived — see homeAssistant/split.ts. */
  | "production"
  /** Raw inverter AC output: PV *and* battery discharge. Synced. */
  | "inverter_ac"
  /** Raw DC yield of the panels. Synced; used only as the split's ratio. */
  | "pv_dc"
  /** The battery's share of inverter AC output. Derived. */
  | "battery_discharge_ac"
  | "export_local" // shared directly with a neighbour, not through the grid meter
  | "export_grid"
  | "import_grid"
  | "battery_charge"
  | "battery_discharge"
  | "consumption" // per-party (a neighbour); `partyId` required
  | "consumption_own" // the household's own total load ("Verbrauch"); site-level
  | "consumption_grid"; // per-party: what that participant drew from the grid rather than local PV

export interface IntervalMetric {
  siteId: string;
  ts: string; // ISO timestamp, interval start
  metricKind: IntervalMetricKind;
  partyId: string | null;
  valueKwh: number;
  source: string;
}

/**
 * Which Home Assistant statistic feeds which metric kind. Entity ids encode
 * the user's own device names, so the mapping is configuration rather than
 * something the code can assume.
 */
export interface HaEntityMapping {
  id: string;
  siteId: string;
  metricKind: IntervalMetricKind;
  statisticId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One selectable statistic as Home Assistant reports it, for the mapping UI. */
export interface HaStatisticOption {
  statisticId: string;
  name: string | null;
  unit: string | null;
  /** Home Assistant's own classification, e.g. "energy" — used to offer only energy statistics. */
  unitClass: string | null;
  hasSum: boolean;
}

export interface HaSyncResult {
  from: string;
  to: string;
  granularity: "quarter_hour" | "hour";
  metrics: Array<{ metricKind: IntervalMetricKind; statisticId: string; rows: number }>;
  inserted: number;
  updated: number;
  skipped: string[];
}

export type BillingCategory = "energie" | "netznutzung" | "messung" | "abgaben";

/**
 * How a grid-invoice position is spread across the pool. `pool_shared` is
 * billed once to the connection and divided by participants; `per_participant`
 * is billed once for each of them; `per_kwh` follows their own grid draw, and
 * `per_kwh_total` everything they consumed including local PV.
 */
export type BillingAllocation = "per_kwh" | "per_kwh_total" | "pool_shared" | "per_participant";

export interface GridTariffPosition {
  id: string;
  siteId: string;
  category: BillingCategory;
  label: string;
  allocation: BillingAllocation;
  /** CHF/kWh for `per_kwh`, CHF/year otherwise. */
  rateChf: number;
  validFrom: string;
  validTo: string;
  countsInDirectBilling: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  category: BillingCategory;
  label: string;
  allocation: BillingAllocation;
  /** kWh for per_kwh lines, days for the annual ones. */
  quantity: number;
  quantityUnit: "kWh" | "days";
  /** What one unit costs after allocation — CHF/kWh, or CHF/day already divided by the pool. */
  unitRateChf: number;
  amountChf: number;
}

/** What the participant would have paid billed directly by the grid provider. */
export interface DirectBillingComparison {
  lines: InvoiceLine[];
  totalChf: number;
  savingChf: number;
}

export interface ParticipantInvoice {
  partyId: string | null;
  partyReference: string | null;
  partyName: string;
  from: string;
  to: string;
  days: number;
  participantCount: number;
  gridKwh: number;
  localKwh: number;
  lines: InvoiceLine[];
  totalChf: number;
  comparison: DirectBillingComparison;
}

export interface ReadingsImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface DailySavings {
  date: string;
  producedKwh: number;
  directUseKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  exportedKwh: number;
  /** Total energy leaving the household (the inverter's export figure); `exportedKwh` is what remains after neighbours take their share. */
  exportLocalKwh: number;
  /** Energy consumed by neighbours, summed across parties. */
  neighborConsumptionKwh: number;
  purchaseRateChfPerKwh: number | null;
  sellRateChfPerKwh: number | null;
  neighborSellRateChfPerKwh: number | null;
  selfConsumptionValueChf: number;
  exportRevenueChf: number;
  savingsWithBatteryChf: number;
  savingsWithoutBatteryChf: number;
  batteryOnlySavingsChf: number;
  /** Cost of charging, priced as the feed-in value that energy could have earned as an export instead. */
  batteryChargingCostChf: number;
  /** Portion of discharge that covered load (avoided an import), vs. pushed straight back out to the grid. */
  batteryDischargeConsumedKwh: number;
  batteryDischargeExportedKwh: number;
  /** batteryDischargeConsumedKwh priced at the purchase rate. */
  batteryDischargeConsumedValueChf: number;
  /** batteryDischargeExportedKwh priced at the feed-in rate. */
  batteryDischargeExportedValueChf: number;
  /** consumedValue + exportedValue - chargingCost: the battery's actual net economic contribution this interval. */
  batteryRevenueChf: number;
  /** exportRevenueChf minus whatever's attributed to the battery (batteryDischargeExportedValueChf) — the production-only slice of grid export revenue. */
  directExportRevenueChf: number;
  /** directUseKwh priced at the purchase rate: PV consumed as produced, worth the import it avoided. */
  directConsumptionRevenueChf: number;
  /** neighborConsumptionKwh priced at the neighbour-sale rate. */
  neighborSellRevenueChf: number;
  /**
   * Export revenue in the counterfactual where no battery exists: the PV that
   * charged it would have been exported, and the export that came out of it
   * never happens. Direct consumption and neighbour sales are unaffected, so
   * those fields serve both scenarios.
   */
  noBatteryDirectExportRevenueChf: number;
}

/**
 * One metering interval, priced — the grain every average on the day view is
 * built from.
 *
 * It is a `DailySavings` because that is literally what it is: the engine
 * prices a single interval and a whole day with the same function, and the
 * daily row is these summed. Carrying the same shape means the detail behind
 * an average and the figure it rolls up to can never be computed two
 * different ways.
 */
export interface SavingsSlot extends DailySavings {
  /** ISO instant the interval starts at. `date` is only hour-resolution. */
  ts: string;
  /**
   * Battery charge after conversion loss: the AC export it actually
   * displaced, and so the quantity the feed-in rate is applied to.
   */
  batteryChargeAcKwh: number;
}

/** What one party drew from the local pool on a day, and what it is worth. */
export interface SavingsDayParty {
  partyId: string;
  name: string;
  kwh: number;
  /** Priced interval by interval, so a rate that moved during the day is respected. */
  chf: number;
}

/** A single day, its totals, and the intervals they were summed from. */
export interface SavingsDayDetail {
  date: string;
  totals: DailySavings | null;
  slots: SavingsSlot[];
  /** The per-party split of `totals.neighborConsumptionKwh`. */
  parties: SavingsDayParty[];
}

export interface SavingsSummary {
  from: string;
  to: string;
  totals: {
    withBatteryChf: number;
    withoutBatteryChf: number;
    batteryOnlyChf: number;
    batteryRevenueChf: number;
  };
  daysWithData: number;
  avgDaily: {
    withBatteryChf: number;
    withoutBatteryChf: number;
    batteryOnlyChf: number;
    batteryRevenueChf: number;
  };
  costs: CostItemsSummary;
  payback: {
    withBatteryYears: number | null;
    withoutBatteryYears: number | null;
    batteryOnlyYears: number | null;
  };
  breakeven: {
    withBatteryDate: string | null;
    withoutBatteryDate: string | null;
    batteryOnlyDate: string | null;
  };
}

export interface CumulativeSavingsPoint {
  date: string;
  cumulativeWithBatteryChf: number;
  cumulativeWithoutBatteryChf: number;
  cumulativeBatteryOnlyChf: number;
}

/**
 * Who is calling the API.
 *
 * - `admin` — full read/write.
 * - `viewer` — reads everything, writes nothing.
 * - `participant` — a VZEV neighbour. Sees only their own consumption and
 *   invoice plus site-level community totals; never another participant's
 *   figures, and never the owner's production, battery, export or investment
 *   data.
 *
 * Deliberately not a linear hierarchy: a participant is not "less than" a
 * viewer, it sees a different and much narrower slice. Permissions are
 * therefore expressed as explicit role sets, never as `role >= x`.
 */
export type Role = "admin" | "viewer" | "participant";

export interface AuthIdentity {
  role: Role;
  /** Null when authentication is disabled, or for the local/LAN door. */
  email: string | null;
  /** Set only for `participant`; the party whose data this user may see. */
  partyId: string | null;
  partyName: string | null;
  /** The site this identity belongs to. Null for admin/viewer, who see all. */
  siteId: string | null;
}

/**
 * Site-level context a participant is allowed to see: enough to understand how
 * the local pool they were billed from came about, with no per-party
 * breakdown and no money.
 */
export interface CommunitySummary {
  from: string;
  to: string;
  /** PV generated at the site over the range. */
  productionKwh: number;
  /** Energy shared locally with participants (the pool). */
  localPoolKwh: number;
  /** How many participants the pool was shared between. */
  participantCount: number;
}

/**
 * Why some of a party's consumption could not be priced: no grid-tariff
 * position was valid on a day in the range, or no neighbour-sale rate covered
 * it. Codes rather than sentences, so the page can say it in the reader's
 * language.
 */
export type PartyConsumptionWarning = "no_positions" | "no_local_rate";

/** One period of a party's consumption, and what it cost. */
export interface PartyConsumptionPeriod {
  /** Same keys as the savings series: "YYYY-MM-DD", "YYYY-MM", "YYYY-Q3", "YYYY", "YYYY-MM-DDTHH" or "overall". */
  date: string;
  /** Taken from the site's own production. */
  localKwh: number;
  /** Drawn from the grid through the shared connection. */
  gridKwh: number;
  /** What the party pays through the RCP — the invoice for this period. */
  rcpCostChf: number;
  /** Of that, the local energy at the agreed neighbour rate. */
  localEnergyChf: number;
  /**
   * Of that, the standing charges (per-day positions), pro rata to the days in
   * the period. What is left — `rcpCostChf - localEnergyChf - rcpFixedChf` —
   * is the grid energy and every per-kWh levy.
   */
  rcpFixedChf: number;
  /** The same consumption billed by the grid provider on its own connection. */
  directCostChf: number;
  /** Of that, the standing charges, each borne in full rather than shared. */
  directFixedChf: number;
  /** `directCostChf - rcpCostChf`. */
  savedChf: number;
}

export interface PartyConsumption {
  partyId: string;
  partyName: string;
  from: string;
  to: string;
  /** First and last day this party has any readings at all, whatever the range. */
  dataFrom: string | null;
  dataTo: string | null;
  totals: Omit<PartyConsumptionPeriod, "date">;
  periods: PartyConsumptionPeriod[];
  warnings: PartyConsumptionWarning[];
}
