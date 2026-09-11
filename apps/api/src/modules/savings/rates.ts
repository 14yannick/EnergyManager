import type { TariffKind } from "@energy-manager/shared";
import { findRateForInstant } from "@energy-manager/shared";

/**
 * Pure rate resolution — no DB, no network (same split as engine.ts vs
 * service.ts), so the precedence and surcharge rules can be tested directly.
 */

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
 * An exact-timestamp dynamic rate wins over the flat period covering that
 * instant — both BKW's feed and the stored readings are quarter-hour aligned,
 * so exact `start_ts` matching is reliable. This is the whole mechanism behind
 * "flat until a cutover date, dynamic after": no cutover config is needed,
 * because dynamic rows simply don't exist for dates before ingestion started.
 *
 * Surcharges of the same kind covering that instant are then added on top —
 * a Herkunftsnachweis or Mindestvergütungsprämie is money received per
 * exported kWh *in addition to* the feed-in price, whether that price came
 * from the dynamic feed or a flat period. Unlike flat and dynamic rates they
 * are allowed to overlap each other, so every match is summed rather than one
 * being picked.
 *
 * Returns null when no base rate covers the instant. A surcharge alone is
 * deliberately not a price: it is defined as an addition to one.
 */
export function makeRateResolver(
  flatPeriods: ResolvedRate[],
  dynamicRates: ResolvedRate[],
  surcharges: ResolvedRate[],
): RateResolver {
  const dynamicByKindAndTs = new Map<string, number>();
  for (const r of dynamicRates) dynamicByKindAndTs.set(`${r.kind}|${r.startTs}`, r.rateChfPerKwh);

  return (kind, instantIso) => {
    const dynamic = dynamicByKindAndTs.get(`${kind}|${instantIso}`);
    const base =
      dynamic !== undefined ? dynamic : findRateForInstant(kind, instantIso, flatPeriods)?.rateChfPerKwh;
    if (base === undefined) return null;

    const surchargeSum = surcharges
      .filter((s) => s.kind === kind && instantIso >= s.startTs && instantIso < s.endTs)
      .reduce((sum, s) => sum + s.rateChfPerKwh, 0);
    return base + surchargeSum;
  };
}
