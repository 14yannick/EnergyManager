import { eq } from "drizzle-orm";
import { effectiveSensorProfile } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { parties } from "../../db/schema/index.js";
import { toNumber } from "../../lib/numeric.js";
import { DEFAULT_BATTERY_CONVERSION_LOSS } from "../savings/engine.js";

/**
 * A site's plant figures, as its site-wide views apply them.
 *
 * The production start and the battery's conversion loss are a plant's, so
 * they are entered on the participant the plant belongs to. The dashboard
 * and the savings still describe the site as a whole, and need one figure
 * each. With one producer — every installation so far — that is simply
 * theirs. With several:
 *
 *  - the start is the earliest stated: the site produced from the day its
 *    first plant did;
 *  - the loss is the mean of those stated: the site-wide savings price all
 *    the charging together, and no single plant's figure is the right one
 *    for it. A per-plant figure needs per-plant savings, which is the step
 *    after this.
 *
 * Only producers with the detailed revenue option count: that option is
 * what these two belong to, and switching it off stops them being read
 * without discarding them.
 */
export interface PlantSettings {
  productionStartDate: string | null;
  batteryConversionLoss: number;
}

const NONE: PlantSettings = { productionStartDate: null, batteryConversionLoss: DEFAULT_BATTERY_CONVERSION_LOSS };

export function combinePlantSettings(
  producers: Array<{ productionStartDate: string | null; batteryConversionLoss: number | null }>,
): PlantSettings {
  const starts = producers.map((p) => p.productionStartDate).filter((d): d is string => d != null).sort();
  const losses = producers.map((p) => p.batteryConversionLoss).filter((l): l is number => l != null);
  return {
    productionStartDate: starts[0] ?? null,
    batteryConversionLoss:
      losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : DEFAULT_BATTERY_CONVERSION_LOSS,
  };
}

/** Every site's plant settings, keyed by site id; a site with no producer is absent. */
export async function plantSettingsBySite(siteId?: string): Promise<Map<string, PlantSettings>> {
  const rows = await (siteId
    ? db.select().from(parties).where(eq(parties.siteId, siteId))
    : db.select().from(parties));
  const bySite = new Map<string, Array<{ productionStartDate: string | null; batteryConversionLoss: number | null }>>();
  for (const row of rows) {
    if (!effectiveSensorProfile(row).detailedRevenue) continue;
    const list = bySite.get(row.siteId) ?? [];
    list.push({
      productionStartDate: row.productionStartDate,
      batteryConversionLoss: row.batteryConversionLoss == null ? null : toNumber(row.batteryConversionLoss),
    });
    bySite.set(row.siteId, list);
  }
  return new Map([...bySite].map(([id, producers]) => [id, combinePlantSettings(producers)]));
}

export async function plantSettingsOf(siteId: string): Promise<PlantSettings> {
  return (await plantSettingsBySite(siteId)).get(siteId) ?? NONE;
}
