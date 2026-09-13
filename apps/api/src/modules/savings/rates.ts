import type { TariffKind, TariffPricingMode } from "@energy-manager/shared";
import { findRateForInstant } from "@energy-manager/shared";

/**
 * Pure rate resolution — no DB, no network (same split as engine.ts vs
 * service.ts), so the precedence and surcharge rules can be tested directly.
 */

export interface ResolvedPeriod {
  kind: TariffKind;
  startTs: string;
  endTs: string;
  pricingMode: TariffPricingMode;
  rateChfPerKwh: number | null;
}

export interface ResolvedRate {
  kind: TariffKind;
  startTs: string;
  endTs: string;
  rateChfPerKwh: number;
}

export type RateResolver = (kind: TariffKind, instantIso: string) => number | null;

/**
 * Resolves the rate for `kind` at `instantIso`.
 *
 * The period covering the instant decides *which source* prices it. A "flat"
 * period uses its own rate; a "dynamic" period takes the exact-timestamp rate
 * from the day-ahead feed, falling back to the period's own rate only if one
 * is set. Both the feed and the stored readings are quarter-hour aligned, so
 * exact `startTs` matching is reliable.
 *
 * The mode is read off the period rather than inferred from whether a dynamic
 * row exists. The earlier design did infer it, on the assumption that dynamic
 * rows simply would not exist before the contract switched — which stopped
 * being true as soon as ingestion started running ahead of that date, silently
 * repricing a quarter that was still on a fixed rate.
 *
 * Surcharges of the same kind covering that instant are then added on top —
 * a Herkunftsnachweis or Mindestvergütungsprämie is money received per
 * exported kWh *in addition to* the feed-in price, whichever source it came
 * from. Unlike periods they are allowed to overlap each other, so every match
 * is summed rather than one being picked.
 *
 * Returns null when nothing prices the instant: no period covers it, or a
 * dynamic period covers it but the feed has no rate and no fallback is set.
 * A surcharge alone is deliberately not a price: it is defined as an addition
 * to one.
 */
export function makeRateResolver(
  periods: ResolvedPeriod[],
  dynamicRates: ResolvedRate[],
  surcharges: ResolvedRate[],
): RateResolver {
  const dynamicByKindAndTs = new Map<string, number>();
  for (const r of dynamicRates) dynamicByKindAndTs.set(`${r.kind}|${r.startTs}`, r.rateChfPerKwh);

  return (kind, instantIso) => {
    const period = findRateForInstant(kind, instantIso, periods);
    if (!period) return null;

    const base =
      period.pricingMode === "dynamic"
        ? (dynamicByKindAndTs.get(`${kind}|${instantIso}`) ?? period.rateChfPerKwh)
        : period.rateChfPerKwh;
    if (base == null) return null;

    const surchargeSum = surcharges
      .filter((s) => s.kind === kind && instantIso >= s.startTs && instantIso < s.endTs)
      .reduce((sum, s) => sum + s.rateChfPerKwh, 0);
    return base + surchargeSum;
  };
}
