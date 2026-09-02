import { z } from "zod";

const BKW_URL = "https://api.bkw.ch/api/dyntariffs/v1/Tariffs";

// Public, unauthenticated endpoint (verified manually). Returns a rolling
// ~24h window of 15-min feed-in prices with no historical query support —
// history can only be built by polling and storing over time (see service.ts).
const priceEntrySchema = z.object({ unit: z.string(), value: z.number() });
const priceIntervalSchema = z.object({
  start_timestamp: z.string(),
  end_timestamp: z.string(),
  feed_in: z.array(priceEntrySchema),
});
const bkwResponseSchema = z.object({
  publication_timestamp: z.string(),
  prices: z.array(priceIntervalSchema),
});

export interface NormalizedDynamicRate {
  kind: "feed_in";
  startTs: string;
  endTs: string;
  rateChfPerKwh: number;
  publicationTimestamp: string;
}

export async function fetchBkwFeedIn(): Promise<NormalizedDynamicRate[]> {
  const res = await fetch(BKW_URL);
  if (!res.ok) throw new Error(`BKW dyntariffs request failed: ${res.status}`);
  const parsed = bkwResponseSchema.parse(await res.json());

  const rows: NormalizedDynamicRate[] = [];
  for (const interval of parsed.prices) {
    const feedIn = interval.feed_in.find((p) => p.unit === "CHF_kWh");
    if (!feedIn) continue; // unexpected/missing unit — skip rather than mis-price
    rows.push({
      kind: "feed_in",
      startTs: interval.start_timestamp,
      endTs: interval.end_timestamp,
      rateChfPerKwh: feedIn.value,
      publicationTimestamp: parsed.publication_timestamp,
    });
  }
  return rows;
}
