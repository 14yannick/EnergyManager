import type { TariffKind, TariffPeriod } from "./types.js";

/**
 * Returns the tariff period of `kind` covering `instantIso` (half-open
 * [startTs, endTs)), or undefined if none matches. Used as the fallback when
 * no dynamic rate exists for that exact instant.
 */
export function findRateForInstant<
  T extends Pick<TariffPeriod, "kind" | "startTs" | "endTs">,
>(kind: TariffKind, instantIso: string, periods: T[]): T | undefined {
  return periods.find(
    (p) => p.kind === kind && instantIso >= p.startTs && instantIso < p.endTs,
  );
}

/** Mirrors the DB's exclusion constraint client-side, for immediate form feedback. */
export function periodsOverlap(
  a: Pick<TariffPeriod, "kind" | "startTs" | "endTs">,
  b: Pick<TariffPeriod, "kind" | "startTs" | "endTs">,
): boolean {
  return a.kind === b.kind && a.startTs < b.endTs && b.startTs < a.endTs;
}
