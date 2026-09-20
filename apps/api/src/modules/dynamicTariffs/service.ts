import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DynamicTariffRate, TariffKind } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { dynamicTariffRates, sites } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { fetchHaEntityDynamicTariff } from "../homeAssistant/haClient.js";
import { EXPECTED_UNIT, isChfPerKwh } from "./unit.js";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Row = typeof dynamicTariffRates.$inferSelect;

function toDomain(row: Row): DynamicTariffRate {
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    startTs: row.startTs.toISOString(),
    endTs: row.endTs.toISOString(),
    rateChfPerKwh: toNumber(row.rateChfPerKwh),
    source: row.source,
    publicationTimestamp: row.publicationTimestamp.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const HA_SOURCE = "home_assistant";

export interface SyncResult {
  inserted: number;
  updated: number;
  /** The last site synced this run wrote under — sites can now configure their own entity. */
  source: string;
  publicationTimestamp: string | null;
  /** One entry per site that could not be synced, naming the site and why. */
  warnings: string[];
}

/**
 * One site's worth of the sync: read the entity this site is configured with
 * (Settings → Home Assistant), fetch it, and upsert. Never throws — a
 * problem with one site's entity is reported in the caller's `warnings`
 * rather than aborting every other site's sync.
 */
async function syncSite(
  site: { id: string; name: string; dynamicTariffEntityId: string | null },
): Promise<{ inserted: number; updated: number; source: string | null; publicationTimestamp: string | null; warning: string | null }> {
  const entityId = site.dynamicTariffEntityId;
  const empty = { inserted: 0, updated: 0, source: null, publicationTimestamp: null };
  if (!entityId) {
    return {
      ...empty,
      warning: `${site.name}: no dynamic feed-in sensor chosen — pick one under Settings, Home Assistant.`,
    };
  }

  let forecast;
  try {
    forecast = await fetchHaEntityDynamicTariff(entityId);
  } catch (err) {
    return { ...empty, warning: `${site.name}: ${err instanceof Error ? err.message : "could not reach Home Assistant"}` };
  }
  if (forecast.priceComponent !== "feed_in") {
    // Refuse rather than write feed-in rows under the wrong price — a
    // misconfigured entity id (or one whose sensor changed meaning) would
    // otherwise silently mis-price every savings figure downstream.
    return {
      ...empty,
      warning: `${site.name}: ${entityId} is publishing "${forecast.priceComponent ?? "unknown"}", not "feed_in".`,
    };
  }
  // The same refusal for the unit: the table's column is CHF per kWh by name,
  // and a feed in EUR/MWh with the right component label would otherwise write
  // rates a thousand times off without a word. A sensor that states no unit
  // at all is let through — nothing to compare — but the run says so.
  if (forecast.unit != null && !isChfPerKwh(forecast.unit)) {
    return {
      ...empty,
      warning: `${site.name}: ${entityId} publishes prices in "${forecast.unit}", not ${EXPECTED_UNIT}. Nothing written.`,
    };
  }
  const unitWarning =
    forecast.unit == null
      ? `${site.name}: ${entityId} states no unit; its prices were taken as ${EXPECTED_UNIT} unchecked.`
      : null;

  const source = `${HA_SOURCE}:${entityId}`;
  const rows = forecast.slots;
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, source, publicationTimestamp: forecast.publicationTimestamp, warning: unitWarning };
  }

  let inserted = 0;
  let updated = 0;
  for (const batch of chunk(rows, 500)) {
    const result = await db
      .insert(dynamicTariffRates)
      .values(
        batch.map((r) => ({
          siteId: site.id,
          kind: "feed_in" as const,
          startTs: new Date(r.startTs),
          endTs: new Date(r.endTs),
          rateChfPerKwh: r.rateChfPerKwh.toString(),
          source,
          publicationTimestamp: forecast.publicationTimestamp
            ? new Date(forecast.publicationTimestamp)
            : new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [dynamicTariffRates.siteId, dynamicTariffRates.kind, dynamicTariffRates.startTs],
        set: {
          endTs: sql`excluded.end_ts`,
          rateChfPerKwh: sql`excluded.rate_chf_per_kwh`,
          source: sql`excluded.source`,
          publicationTimestamp: sql`excluded.publication_timestamp`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ wasInsert: sql<boolean>`(xmax = 0)` });

    for (const r of result) {
      if (r.wasInsert) inserted++;
      else updated++;
    }
  }

  return { inserted, updated, source, publicationTimestamp: forecast.publicationTimestamp, warning: unitWarning };
}

/**
 * Fetches the current feed-in window from Home Assistant and upserts it, one
 * site at a time, each from its own configured entity
 * (`Site.dynamicTariffEntityId`). Re-running this naturally picks up revised
 * prices via onConflictDoUpdate, same pattern as upsertReadings in
 * modules/readings/service.ts.
 *
 * Called from the Home Assistant sync timer in index.ts rather than one of
 * its own: the rates come from the same place as the statistics, on the same
 * schedule.
 *
 * Sourced from a Home Assistant entity (see haClient.ts), not a direct call
 * to BKW's own API — a household running this already has Home Assistant
 * polling BKW independently, so the app reads the result from there instead
 * of polling it a second time.
 */
export async function syncDynamicTariffs(): Promise<SyncResult> {
  const allSites = await db
    .select({ id: sites.id, name: sites.name, dynamicTariffEntityId: sites.dynamicTariffEntityId })
    .from(sites);

  const result: SyncResult = { inserted: 0, updated: 0, source: "", publicationTimestamp: null, warnings: [] };
  for (const site of allSites) {
    const one = await syncSite(site);
    result.inserted += one.inserted;
    result.updated += one.updated;
    if (one.source) {
      result.source = one.source;
      result.publicationTimestamp = one.publicationTimestamp;
    }
    if (one.warning) result.warnings.push(one.warning);
  }
  return result;
}

export async function listDynamicTariffRates(
  siteId: string,
  kind: TariffKind | undefined,
  from: string,
  to: string,
): Promise<DynamicTariffRate[]> {
  const conditions = [
    eq(dynamicTariffRates.siteId, siteId),
    gte(dynamicTariffRates.startTs, new Date(`${from}T00:00:00Z`)),
    lte(dynamicTariffRates.startTs, new Date(`${to}T23:59:59Z`)),
  ];
  if (kind) conditions.push(eq(dynamicTariffRates.kind, kind));

  const rows = await db
    .select()
    .from(dynamicTariffRates)
    .where(and(...conditions))
    .orderBy(dynamicTariffRates.startTs);
  return rows.map(toDomain);
}
