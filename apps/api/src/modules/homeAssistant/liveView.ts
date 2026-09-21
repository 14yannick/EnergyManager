import { and, eq, isNull, sql } from "drizzle-orm";
import type { HourKwh, LiveDayCurve, LiveEnergyView } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, sites } from "../../db/schema/index.js";
import { fetchHaNumericStates, fetchSolarForecast } from "./haClient.js";
import { SITE_TZ, forecastForDay, localDayHour, mergeForecastSources } from "./forecastCurve.js";

/**
 * The forecast, remembered for a few minutes.
 *
 * Home Assistant revises it every few hours, while the participants' page
 * asks every minute — and each ask would otherwise open a websocket session.
 * Site-independent because the forecast is: it belongs to the Home Assistant
 * instance, and every site this app knows shares that instance.
 */
const FORECAST_TTL_MS = 5 * 60 * 1000;
let forecastCache: { at: number; sources: Array<Record<string, number>> } | null = null;

async function cachedForecastSources(): Promise<Array<Record<string, number>>> {
  const now = Date.now();
  if (forecastCache && now - forecastCache.at < FORECAST_TTL_MS) return forecastCache.sources;
  try {
    const sources = await fetchSolarForecast();
    forecastCache = { at: now, sources };
    return sources;
  } catch {
    // A forecast that cannot be read must not take the live figures down
    // with it. Serve the last one if there is one; otherwise draw no line.
    return forecastCache?.sources ?? [];
  }
}

/**
 * Today's production per completed local hour, from the interval store.
 *
 * `production` is the PV share of the inverter's AC output, and it is only
 * derived once the hour's `pv_dc` has arrived — Home Assistant reports that
 * hourly — so the hour in progress usually has no figure yet. It is sent as
 * `currentHour` so the chart can mark whatever it does have as partial
 * rather than draw a dip.
 */
async function todaysCurve(siteId: string, now: Date): Promise<LiveDayCurve | null> {
  const { day, hour: currentHour } = localDayHour(now);
  // The zone goes in as a literal, not a bound parameter: bound twice — once
  // in SELECT, once in GROUP BY — Postgres cannot see the two expressions are
  // the same and refuses the grouping. A constant of ours, so a literal is safe.
  const zone = sql.raw(`'${SITE_TZ}'`);
  const localHour = sql<number>`extract(hour from ${intervalMetrics.ts} at time zone ${zone})::int`;
  const [rows, sources] = await Promise.all([
    db
      .select({ hour: localHour, kwh: sql<string>`sum(${intervalMetrics.valueKwh})` })
      .from(intervalMetrics)
      .where(
        and(
          eq(intervalMetrics.siteId, siteId),
          isNull(intervalMetrics.partyId),
          eq(intervalMetrics.metricKind, "production"),
          sql`(${intervalMetrics.ts} at time zone ${zone})::date = ${day}::date`,
        ),
      )
      .groupBy(localHour)
      .orderBy(localHour),
    cachedForecastSources(),
  ]);

  const actual: HourKwh[] = rows.map((r) => ({ hour: r.hour, kwh: Number(Number(r.kwh).toFixed(3)) }));
  const forecast = forecastForDay(mergeForecastSources(sources), day);
  if (actual.length === 0 && forecast.length === 0) return null;
  return { day, currentHour, actual, forecast };
}

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
      exportNegative: sites.liveExportNegative,
      pvPower: sites.livePvPowerEntityId,
      forecastToday: sites.forecastTodayEntityId,
      forecastRemaining: sites.forecastRemainingEntityId,
      forecastTomorrow: sites.forecastTomorrowEntityId,
    })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site) return null;

  const now = new Date();
  const at = now.toISOString();
  const ids = Object.values(site).filter((v): v is string => typeof v === "string");
  // The curve needs no entity: production comes from the store and the
  // forecast from Home Assistant's own energy setup, so a site with no live
  // sensors mapped can still show its day.
  const today = await todaysCurve(siteId, now);
  if (ids.length === 0) {
    return {
      today,
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

  // The card means "leaving the house", whichever way the sensor counts it.
  const rawExport = read(site.exportPower);
  const exportW = rawExport == null ? null : site.exportNegative ? -rawExport : rawExport;

  return {
    today,
    at,
    exportW,
    pvW: read(site.pvPower),
    forecastTodayKwh: read(site.forecastToday),
    forecastRemainingKwh: read(site.forecastRemaining),
    forecastTomorrowKwh: read(site.forecastTomorrow),
    configured: true,
  };
}
