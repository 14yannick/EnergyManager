import { z } from "zod";
import { env } from "../../config/env.js";

/**
 * Home Assistant's statistics live behind the websocket API only — there is no
 * REST equivalent — so this opens a short-lived connection per call rather
 * than holding one open: syncs run on a timer, minutes apart, and a connection
 * that isn't held can't go stale or leak.
 *
 * Statistics (rather than raw `/api/history`) are the right source for energy:
 * Home Assistant has already normalised meter resets into a monotonic `sum`,
 * which is exactly the problem daily-resetting sensors like
 * `sensor.batteries_day_charge` otherwise push onto the caller.
 */

export type HaPeriod = "5minute" | "hour" | "day" | "month";

// Note the field names: `list_statistic_ids` reports
// `statistics_unit_of_measurement`, *not* the `unit_of_measurement` that
// entity states use. `unit_class` ("energy", "volume", …) is what makes it
// possible to offer only energy statistics without string-matching units.
const statisticIdSchema = z.object({
  statistic_id: z.string(),
  name: z.string().nullish(),
  statistics_unit_of_measurement: z.string().nullish(),
  display_unit_of_measurement: z.string().nullish(),
  unit_class: z.string().nullish(),
  has_sum: z.boolean().nullish(),
});

const bucketSchema = z.object({
  start: z.number(),
  end: z.number().optional(),
  // `change` is the energy in this bucket; HA derives it from `sum`, so it's
  // already reset-corrected. Null when the bucket has no data.
  change: z.number().nullish(),
  sum: z.number().nullish(),
});

export interface HaStatisticMeta {
  statisticId: string;
  name: string | null;
  unit: string | null;
  unitClass: string | null;
  hasSum: boolean;
}

export interface HaBucket {
  start: Date;
  change: number | null;
}

interface Pending {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

class HaSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  readonly ready: Promise<void>;

  constructor(url: string, token: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const fail = (msg: string) => {
        reject(new Error(msg));
        for (const p of this.pending.values()) p.reject(new Error(msg));
        this.pending.clear();
      };
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (msg.type === "auth_required") {
          this.ws.send(JSON.stringify({ type: "auth", access_token: token }));
          return;
        }
        if (msg.type === "auth_invalid") return fail("Home Assistant rejected the access token");
        if (msg.type === "auth_ok") return resolve();
        const id = msg.id as number | undefined;
        if (id === undefined) return;
        const waiting = this.pending.get(id);
        if (!waiting) return;
        this.pending.delete(id);
        waiting.resolve(msg);
      };
      this.ws.onerror = () => fail(`Could not reach Home Assistant at ${env.HA_URL}`);
      this.ws.onclose = () => fail("Home Assistant closed the connection");
    });
  }

  async call<T>(payload: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const id = this.nextId++;
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, ...payload }));
    });
    if (msg.success === false) {
      const err = msg.error as { message?: string } | undefined;
      throw new Error(`Home Assistant request failed: ${err?.message ?? "unknown error"}`);
    }
    return schema.parse(msg.result);
  }

  close() {
    // Drop the close handler first: an intentional close must not reject the
    // callers that already got their answers.
    this.ws.onclose = null;
    this.ws.close();
  }
}

/** The plain HTTP base and token, shared by the websocket and REST callers below. */
function requireHaConfig(): { baseUrl: string; token: string } {
  if (!env.HA_URL || !env.HA_TOKEN) {
    throw new Error("Home Assistant is not configured — set HA_URL and HA_TOKEN");
  }
  return { baseUrl: env.HA_URL, token: env.HA_TOKEN };
}

function requireConfig(): { url: string; token: string } {
  const { baseUrl, token } = requireHaConfig();
  return { url: `${baseUrl.replace(/^http/, "ws")}/api/websocket`, token };
}

async function withSession<T>(fn: (session: HaSession) => Promise<T>): Promise<T> {
  const { url, token } = requireConfig();
  const session = new HaSession(url, token);
  try {
    await session.ready;
    return await fn(session);
  } finally {
    session.close();
  }
}

/** Every statistic that carries a `sum` — i.e. every one usable as an energy meter. */
export async function listEnergyStatistics(): Promise<HaStatisticMeta[]> {
  return withSession(async (session) => {
    const result = await session.call(
      { type: "recorder/list_statistic_ids", statistic_type: "sum" },
      z.array(statisticIdSchema),
    );
    return result.map((r) => ({
      statisticId: r.statistic_id,
      name: r.name ?? null,
      unit: r.statistics_unit_of_measurement ?? r.display_unit_of_measurement ?? null,
      unitClass: r.unit_class ?? null,
      hasSum: r.has_sum ?? true,
    }));
  });
}

/**
 * Per-bucket energy for each statistic over [start, end). Returned per
 * statistic id; ids Home Assistant has no data for are simply absent.
 */
export async function fetchStatistics(
  statisticIds: string[],
  start: Date,
  end: Date,
  period: HaPeriod,
): Promise<Map<string, HaBucket[]>> {
  if (statisticIds.length === 0) return new Map();
  return withSession(async (session) => {
    const result = await session.call(
      {
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: statisticIds,
        period,
        types: ["change"],
      },
      z.record(z.string(), z.array(bucketSchema)),
    );
    const out = new Map<string, HaBucket[]>();
    for (const [statisticId, buckets] of Object.entries(result)) {
      out.set(
        statisticId,
        buckets.map((b) => ({ start: new Date(b.start), change: b.change ?? null })),
      );
    }
    return out;
  });
}

/**
 * A price-forecast entity of the shape a "dynamic tariff" sensor exposes: a
 * current price as the state, plus `today`/`tomorrow` arrays of priced
 * quarter-hour slots as attributes. This is not a stock Home Assistant
 * integration — it is whatever the household has set up (a template sensor
 * re-polling a tariff feed, a Nordpool-style integration, …) — so the shape
 * is validated loosely and extra attributes are simply ignored.
 */
const haTariffSlotSchema = z.object({
  start: z.string(),
  end: z.string().optional(),
  price: z.number(),
});

const haEntityStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z
    .object({
      price_component: z.string().nullish(),
      publication_timestamp: z.string().nullish(),
      unit_of_measurement: z.string().nullish(),
      today: z.array(haTariffSlotSchema).nullish(),
      tomorrow: z.array(haTariffSlotSchema).nullish(),
      tomorrow_valid: z.boolean().nullish(),
    })
    .passthrough(),
});

export interface HaDynamicTariffSlot {
  startTs: string; // ISO, UTC
  endTs: string;
  rateChfPerKwh: number;
}

export interface HaDynamicTariffState {
  entityId: string;
  /** What this sensor claims to price, e.g. "feed_in" — the caller's to match against a TariffKind. */
  priceComponent: string | null;
  unit: string | null;
  publicationTimestamp: string | null;
  /** `today` plus `tomorrow` (only once HA itself marks it valid), sorted, deduplicated. */
  slots: HaDynamicTariffSlot[];
}

/**
 * Reads one entity's current state and attributes over the plain REST API —
 * a single request, unlike the statistics client's websocket session, because
 * there is nothing here to subscribe to: the caller wants this instant's
 * forecast, not a stream of updates.
 *
 * This is the dynamic-tariff sync's actual data source (see
 * dynamicTariffs/service.ts) — replacing a direct call to BKW's own API,
 * which this household's Home Assistant already polls independently.
 */
export async function fetchHaEntityDynamicTariff(entityId: string): Promise<HaDynamicTariffState> {
  const { baseUrl, token } = requireHaConfig();
  const res = await fetch(`${baseUrl}/api/states/${encodeURIComponent(entityId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    throw new Error(`Home Assistant has no entity "${entityId}"`);
  }
  if (!res.ok) {
    throw new Error(`Home Assistant request failed: ${res.status}`);
  }
  const parsed = haEntityStateSchema.parse(await res.json());
  const a = parsed.attributes;

  // `tomorrow_valid` is how these sensors say "tomorrow's auction hasn't
  // cleared yet" — the array can still be present but stale (yesterday's
  // values shifted forward) or simply absent. Treat an explicit `false` as
  // "leave it out"; an unset flag is taken as valid, since not every sensor
  // of this shape sets it at all.
  const includeTomorrow = a.tomorrow_valid !== false;
  const raw = [...(a.today ?? []), ...(includeTomorrow ? (a.tomorrow ?? []) : [])];

  const byStart = new Map<string, HaDynamicTariffSlot>();
  for (const slot of raw) {
    const startTs = new Date(slot.start).toISOString();
    const endTs = slot.end
      ? new Date(slot.end).toISOString()
      : new Date(new Date(slot.start).getTime() + 15 * 60000).toISOString();
    byStart.set(startTs, { startTs, endTs, rateChfPerKwh: slot.price });
  }

  return {
    entityId,
    priceComponent: a.price_component ?? null,
    unit: a.unit_of_measurement ?? null,
    publicationTimestamp: a.publication_timestamp ?? null,
    slots: [...byStart.values()].sort((x, y) => x.startTs.localeCompare(y.startTs)),
  };
}

/**
 * Every entity shaped like a price-forecast sensor: carries a `today` array
 * of slots as an attribute. This is the filter, not a name pattern or a
 * domain check — out of ~1800 entities on a real household instance, exactly
 * the one dynamic-tariff sensor matched it, which is the specificity a
 * mapping dropdown needs (nothing here to narrow further by unit or class,
 * unlike the energy statistics list).
 *
 * Uses `/api/states` (every entity's current state), not the statistics
 * client's websocket session — this is about live state shape, not recorder
 * history.
 */
const haStateEntitySchema = z.object({
  entity_id: z.string(),
  attributes: z
    .object({
      friendly_name: z.string().nullish(),
      price_component: z.string().nullish(),
      unit_of_measurement: z.string().nullish(),
      today: z.array(z.unknown()).nullish(),
    })
    .passthrough(),
});

export interface HaDynamicTariffCandidate {
  entityId: string;
  friendlyName: string | null;
  priceComponent: string | null;
  unit: string | null;
}

export async function listHaDynamicTariffEntities(): Promise<HaDynamicTariffCandidate[]> {
  const { baseUrl, token } = requireHaConfig();
  const res = await fetch(`${baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Home Assistant request failed: ${res.status}`);
  }
  const parsed = z.array(haStateEntitySchema).parse(await res.json());
  return parsed
    .filter((e) => Array.isArray(e.attributes.today))
    .map((e) => ({
      entityId: e.entity_id,
      friendlyName: e.attributes.friendly_name ?? null,
      priceComponent: e.attributes.price_component ?? null,
      unit: e.attributes.unit_of_measurement ?? null,
    }));
}

/**
 * Current numeric values for a set of entities, by entity id.
 *
 * One `/api/states` call however many entities are asked for: Home Assistant
 * has no bulk-by-id endpoint, and fetching each separately would multiply
 * round trips for a view that refreshes on a timer.
 *
 * An entity that is absent, unavailable, or non-numeric is simply left out —
 * "unknown"/"unavailable" are ordinary states here, not failures, and the
 * caller renders a gap rather than a zero.
 */
export async function fetchHaNumericStates(entityIds: string[]): Promise<Map<string, number>> {
  const wanted = new Set(entityIds.filter(Boolean));
  if (wanted.size === 0) return new Map();

  const { baseUrl, token } = requireHaConfig();
  const res = await fetch(`${baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Home Assistant request failed: ${res.status}`);
  }
  const parsed = z
    .array(z.object({ entity_id: z.string(), state: z.string() }))
    .parse(await res.json());

  const out = new Map<string, number>();
  for (const e of parsed) {
    if (!wanted.has(e.entity_id)) continue;
    const value = Number(e.state);
    if (Number.isFinite(value)) out.set(e.entity_id, value);
  }
  return out;
}

export interface HaSensorCandidate {
  entityId: string;
  friendlyName: string | null;
  unit: string | null;
  deviceClass: string | null;
}

/**
 * Sensors of one device class, for the live-view mapping dropdowns. Filtered
 * on Home Assistant's own `device_class` rather than on names or units, the
 * same way the statistics list leans on its `unit_class`.
 */
export async function listHaSensorsByDeviceClass(deviceClass: string): Promise<HaSensorCandidate[]> {
  const { baseUrl, token } = requireHaConfig();
  const res = await fetch(`${baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Home Assistant request failed: ${res.status}`);
  }
  const parsed = z
    .array(
      z.object({
        entity_id: z.string(),
        attributes: z
          .object({
            friendly_name: z.string().nullish(),
            unit_of_measurement: z.string().nullish(),
            device_class: z.string().nullish(),
          })
          .passthrough(),
      }),
    )
    .parse(await res.json());

  return parsed
    // Only the `sensor` domain with a stated unit: a `binary_sensor` can also
    // carry device_class "power", but it reports on/off, never a number.
    .filter(
      (e) =>
        e.attributes.device_class === deviceClass &&
        e.entity_id.startsWith("sensor.") &&
        e.attributes.unit_of_measurement != null,
    )
    .map((e) => ({
      entityId: e.entity_id,
      friendlyName: e.attributes.friendly_name ?? null,
      unit: e.attributes.unit_of_measurement ?? null,
      deviceClass: e.attributes.device_class ?? null,
    }))
    .sort((a, b) => a.entityId.localeCompare(b.entityId));
}
