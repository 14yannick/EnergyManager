export interface Site {
  id: string;
  name: string;
  timezone: string;
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

export interface TariffPeriod {
  id: string;
  siteId: string;
  kind: TariffKind;
  startTs: string; // ISO datetime, half-open [startTs, endTs)
  endTs: string;
  rateChfPerKwh: number;
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
export interface Party {
  id: string;
  siteId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Attribute model: one row per (site, timestamp, metric) instead of fixed
 * columns — mirrors TariffPeriod's `kind`. "consumption" is per-party
 * (`partyId` required); every other kind is site-level (`partyId` null).
 */
export type IntervalMetricKind =
  | "production"
  | "export_local" // shared directly with a neighbour, not through the grid meter
  | "export_grid"
  | "import_grid"
  | "battery_charge"
  | "battery_discharge"
  | "consumption";

export interface IntervalMetric {
  siteId: string;
  ts: string; // ISO timestamp, interval start
  metricKind: IntervalMetricKind;
  partyId: string | null;
  valueKwh: number;
  source: string;
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
  purchaseRateChfPerKwh: number | null;
  sellRateChfPerKwh: number | null;
  selfConsumptionValueChf: number;
  exportRevenueChf: number;
  savingsWithBatteryChf: number;
  savingsWithoutBatteryChf: number;
  batteryOnlySavingsChf: number;
  /** Value of battery-discharged kWh priced at the purchase rate (avoided import). */
  batteryAvoidedImportChf: number;
  /** Same discharged kWh priced at the feed-in rate (what exporting it instead would have earned). */
  batteryIfExportedInsteadChf: number;
  /** avoidedImport - ifExportedInstead: the real marginal value of self-consuming via battery vs. exporting. */
  batteryUpliftChf: number;
}

export interface SavingsSummary {
  from: string;
  to: string;
  totals: {
    withBatteryChf: number;
    withoutBatteryChf: number;
    batteryOnlyChf: number;
    batteryUpliftChf: number;
  };
  daysWithData: number;
  avgDaily: {
    withBatteryChf: number;
    withoutBatteryChf: number;
    batteryOnlyChf: number;
    batteryUpliftChf: number;
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
