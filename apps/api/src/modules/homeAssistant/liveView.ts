import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { HourKwh, LiveDayCurve, LiveEnergyView, TomorrowForecast } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, sites } from "../../db/schema/index.js";
import { fetchHaNumericStates, fetchHaSunPosition, fetchSolarForecast } from "./haClient.js";
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
  const dayFilter = and(
    eq(intervalMetrics.siteId, siteId),
    isNull(intervalMetrics.partyId),
    sql`(${intervalMetrics.ts} at time zone ${zone})::date = ${day}::date`,
  );
  const [rows, sources] = await Promise.all([
    // All three per hour in one pass, so the chart can draw the split —
    // made this hour, and how much of it left — not just the day's totals.
    db
      .select({
        hour: localHour,
        productionKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'production'), 0)`,
        batteryChargeKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'battery_charge'), 0)`,
        exportLocalKwh: sql<string>`coalesce(sum(${intervalMetrics.valueKwh}) filter (where ${intervalMetrics.metricKind} = 'export_local'), 0)`,
      })
      .from(intervalMetrics)
      .where(and(dayFilter, inArray(intervalMetrics.metricKind, ["production", "battery_charge", "export_local"])))
      .groupBy(localHour)
      .orderBy(localHour),
    cachedForecastSources(),
  ]);

  const round = (v: string) => Number(Number(v).toFixed(3));
  // An hour with none of the three yet — night, or one not synced yet —
  // still needs no row at all, same as `production` alone did before.
  const nonZero = rows.filter((r) => round(r.productionKwh) || round(r.batteryChargeKwh) || round(r.exportLocalKwh));
  const actual: HourKwh[] = nonZero.map((r) => ({ hour: r.hour, kwh: round(r.productionKwh) }));
  const batteryCharge: HourKwh[] = nonZero.map((r) => ({ hour: r.hour, kwh: round(r.batteryChargeKwh) }));
  const exportedLocal: HourKwh[] = nonZero.map((r) => ({ hour: r.hour, kwh: round(r.exportLocalKwh) }));
  const forecast = forecastForDay(mergeForecastSources(sources), day);
  if (actual.length === 0 && forecast.length === 0) return null;
  return { day, currentHour, actual, forecast, batteryCharge, exportedLocal };
}

/** The next local calendar day. Noon UTC as the anchor keeps this safe
 * across a DST boundary, which midnight would not be. */
function nextLocalDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Tomorrow's forecast, hour by hour — from the same feed as today's, which
 * publishes several days ahead. Empty until the feed actually covers
 * tomorrow, which is usually from the evening before.
 */
async function tomorrowsForecast(today: string): Promise<TomorrowForecast> {
  const day = nextLocalDay(today);
  const sources = await cachedForecastSources();
  const hourly = forecastForDay(mergeForecastSources(sources), day);
  return { day, hourly };
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
      batteryPower: sites.liveBatteryPowerEntityId,
      batteryChargeNegative: sites.liveBatteryChargeNegative,
      batterySoc: sites.liveBatterySocEntityId,
      loadPower: sites.liveLoadPowerEntityId,
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
  // Neither needs a live entity: production comes from the store and the
  // forecast from Home Assistant's own energy setup, so a site with no live
  // sensors mapped can still show its day, or tomorrow's forecast.
  // Best-effort like the forecast: the sun's position needs Home Assistant
  // but no entity of this site's, and a mark that cannot tell night from
  // day is not worth taking the live figures down for.
  const [today, tomorrow, sun] = await Promise.all([
    todaysCurve(siteId, now),
    tomorrowsForecast(localDayHour(now).day),
    fetchHaSunPosition().catch(() => null),
  ]);
  if (ids.length === 0) {
    return {
      today,
      tomorrow,
      at,
      sun,
      exportW: null,
      importW: null,
      pvW: null,
      batteryChargeW: null,
      batteryDischargeW: null,
      batterySocPct: null,
      loadW: null,
      forecastTodayKwh: null,
      forecastRemainingKwh: null,
      forecastTomorrowKwh: null,
      configured: false,
    };
  }

  const states = await fetchHaNumericStates(ids);
  const read = (entityId: string | null) => (entityId ? (states.get(entityId) ?? null) : null);

  // The card means "leaving the house", whichever way the sensor counts it.
  // One sensor, two figures: the grid meter reads one direction at a time,
  // so the sign says which and the other is zero.
  const rawExport = read(site.exportPower);
  const gridOut = rawExport == null ? null : site.exportNegative ? -rawExport : rawExport;
  // Likewise for the battery: positive means charging once the sign is
  // normalised, and whichever way it is flowing, the other figure is zero.
  const rawBattery = read(site.batteryPower);
  const charging = rawBattery == null ? null : site.batteryChargeNegative ? -rawBattery : rawBattery;

  return {
    today,
    tomorrow,
    at,
    sun,
    exportW: gridOut == null ? null : Math.max(gridOut, 0),
    importW: gridOut == null ? null : Math.max(-gridOut, 0),
    pvW: read(site.pvPower),
    batteryChargeW: charging == null ? null : Math.max(charging, 0),
    batteryDischargeW: charging == null ? null : Math.max(-charging, 0),
    batterySocPct: read(site.batterySoc),
    loadW: read(site.loadPower),
    forecastTodayKwh: read(site.forecastToday),
    forecastRemainingKwh: read(site.forecastRemaining),
    forecastTomorrowKwh: read(site.forecastTomorrow),
    configured: true,
  };
}
