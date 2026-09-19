import type { NeighbourSale, NeighbourSales } from "@energy-manager/shared";
import type { RateResolver } from "./rates.js";

/**
 * Energy sold to a participant, priced twice: at the neighbour rate it was
 * sold for, and at the feed-in rate it would otherwise have been exported at.
 * Pure, like engine.ts — the service hands in the draws and the resolver.
 *
 * Both prices are taken per interval. Under a dynamic feed-in tariff the
 * export alternative is worth very different amounts at noon and at dusk, so
 * an average rate over the range would misstate exactly the figure this is
 * for.
 */
export interface PartyDraw {
  partyId: string;
  name: string;
  /** Interval start, ISO. */
  ts: string;
  kwh: number;
}

const emptyFigures = () => ({ kwh: 0, revenueChf: 0, exportValueChf: 0, gainChf: 0, unpricedKwh: 0 });

export function priceNeighbourSales(
  draws: PartyDraw[],
  resolveRate: RateResolver,
  range: { from: string; to: string },
): NeighbourSales {
  const byParty = new Map<string, NeighbourSale>();
  const totals = emptyFigures();

  for (const d of draws) {
    const entry = byParty.get(d.partyId) ?? { partyId: d.partyId, name: d.name, ...emptyFigures() };
    const sell = resolveRate("neighbor_sell", d.ts);
    const feedIn = resolveRate("feed_in", d.ts);

    entry.kwh += d.kwh;
    totals.kwh += d.kwh;
    // Revenue is what was earned, priced whenever the sale was — the same
    // figure the site's revenue chart shows. The comparison needs both prices,
    // so an interval missing either is left out of it rather than setting a
    // known revenue against an export worth "zero".
    const revenue = sell == null ? 0 : d.kwh * sell;
    entry.revenueChf += revenue;
    totals.revenueChf += revenue;
    if (sell == null || feedIn == null) {
      entry.unpricedKwh += d.kwh;
      totals.unpricedKwh += d.kwh;
    } else {
      const exportValue = d.kwh * feedIn;
      entry.exportValueChf += exportValue;
      entry.gainChf += revenue - exportValue;
      totals.exportValueChf += exportValue;
      totals.gainChf += revenue - exportValue;
    }
    byParty.set(d.partyId, entry);
  }

  return {
    ...range,
    parties: [...byParty.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totals,
  };
}
