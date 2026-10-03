import { and, eq, inArray, sql } from "drizzle-orm";
import type { HourKwh, LiveDayCurve, LiveEnergyView, PartySensorKind, TomorrowForecast } from "@energy-manager/shared";
import { db } from "../../db/client.js";
import { intervalMetrics, sites } from "../../db/schema/index.js";
import { activeSensors } from "../partySensors/service.js";
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
    // The site's whole day, whichever participant produced it: the three
    // metrics below are a plant's, so summing them over the site is summing
    // its producers.
    eq(intervalMetrics.siteId, siteId),
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
  const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId));
  if (!site) return null;
  // The live readings are the participants' now (see party_sensors): each
  // producer maps their own, and the site's figure is all of theirs
  // together.
  const sensors = await activeSensors(siteId, "live");

  const now = new Date();
  const at = now.toISOString();
  const ids = [...new Set(sensors.filter((s) => s.feedIn).map((s) => s.entityId))];
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
  // This view is the plant's: what the producers' houses make, store, draw
  // and send out. Any member may map their grid import now, and a
  // neighbour's draw is no part of that balance — it would read as the
  // producer's house pulling from the grid while it exports.
  const plantSensors = sensors.filter((s) => s.feedIn);
  /**
   * Every reading of one kind, each turned the way its kind names: a sensor
   * flagged `inverted` counts the other way round (see party_sensors).
   * Empty when nobody maps the kind, or no sensor of it answered.
   */
  const readings = (kind: PartySensorKind): number[] =>
    plantSensors
      .filter((s) => s.kind === kind)
      .map((s) => {
        const value = states.get(s.entityId);
        return value == null ? null : s.inverted ? -value : value;
      })
      .filter((v): v is number => v != null);
  /** Power and energy add up across producers; null when there is nothing to add. */
  const total = (kind: PartySensorKind): number | null => {
    const values = readings(kind);
    return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0);
  };
  /** A state of charge does not add up: several batteries show their average. */
  const average = (kind: PartySensorKind): number | null => {
    const values = readings(kind);
    return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
  };

  // The card means "leaving the house", whichever way the sensor counts it.
  // One sensor, two figures: the grid meter reads one direction at a time,
  // so the sign says which and the other is zero.
  const gridOut = total("live_export_power");
  // Likewise for the battery: positive means charging once the sign is
  // normalised, and whichever way it is flowing, the other figure is zero.
  const charging = total("live_battery_power");

  return {
    today,
    tomorrow,
    at,
    sun,
    exportW: gridOut == null ? null : Math.max(gridOut, 0),
    // Its own sensor where a producer maps one; else the export sensor's
    // other sign, which is the same meter read the other way.
    importW: total("live_import_power") ?? (gridOut == null ? null : Math.max(-gridOut, 0)),
    pvW: total("live_pv_power"),
    batteryChargeW: charging == null ? null : Math.max(charging, 0),
    batteryDischargeW: charging == null ? null : Math.max(-charging, 0),
    batterySocPct: average("live_battery_soc"),
    loadW: total("live_load_power"),
    forecastTodayKwh: total("forecast_today"),
    forecastRemainingKwh: total("forecast_remaining"),
    forecastTomorrowKwh: total("forecast_tomorrow"),
    configured: true,
  };
}
