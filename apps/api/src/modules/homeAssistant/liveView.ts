import { eq } from "drizzle-orm";
import type { LiveEnergyView } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { sites } from "../../db/schema/index.js";
import { fetchHaNumericStates } from "./haClient.js";

/**
 * What the site is doing at this instant, for the participants' view.
 *
 * Read straight from Home Assistant on every call and never written to the
 * database: a current reading is only interesting while it is current, and
 * the interval history that *is* worth keeping already arrives through the
 * statistics sync.
 *
 * Returns null when the site does not exist; a site with nothing configured
 * comes back with `configured: false` and every figure null, which the view
 * shows as "not set up" rather than as a site producing nothing.
 */
export async function getLiveEnergyView(siteId: string): Promise<LiveEnergyView | null> {
  const [site] = await db
    .select({
      exportPower: sites.liveExportPowerEntityId,
      pvPower: sites.livePvPowerEntityId,
      forecastToday: sites.forecastTodayEntityId,
      forecastRemaining: sites.forecastRemainingEntityId,
      forecastTomorrow: sites.forecastTomorrowEntityId,
    })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site) return null;

  const at = new Date().toISOString();
  const ids = Object.values(site).filter((v): v is string => typeof v === "string");
  if (ids.length === 0) {
    return {
      at,
      exportW: null,
      pvW: null,
      forecastTodayKwh: null,
      forecastRemainingKwh: null,
      forecastTomorrowKwh: null,
      configured: false,
    };
  }

  const states = await fetchHaNumericStates(ids);
  const read = (entityId: string | null) => (entityId ? (states.get(entityId) ?? null) : null);

  return {
    at,
    exportW: read(site.exportPower),
    pvW: read(site.pvPower),
    forecastTodayKwh: read(site.forecastToday),
    forecastRemainingKwh: read(site.forecastRemaining),
    forecastTomorrowKwh: read(site.forecastTomorrow),
    configured: true,
  };
}
