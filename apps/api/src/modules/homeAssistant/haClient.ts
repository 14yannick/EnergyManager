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

function requireConfig(): { url: string; token: string } {
  if (!env.HA_URL || !env.HA_TOKEN) {
    throw new Error("Home Assistant is not configured — set HA_URL and HA_TOKEN");
  }
  return { url: `${env.HA_URL.replace(/^http/, "ws")}/api/websocket`, token: env.HA_TOKEN };
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
