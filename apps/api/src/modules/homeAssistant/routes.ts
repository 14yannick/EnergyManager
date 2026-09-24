import type { FastifyInstance } from "fastify";
import { haEntityMappingInputSchema, haSyncRequestSchema } from "@energy-manager/shared";
import { env } from "../../config/env.js";
import { syncDynamicTariffs } from "../dynamicTariffs/service.js";
import { listHaSensorsByDeviceClass } from "./haClient.js";
import { getLiveEnergyView } from "./liveView.js";
import {
  deleteMapping,
  listHaDynamicTariffEntities,
  listHaStatistics,
  listMappings,
  syncHomeAssistant,
  upsertMapping,
} from "./service.js";

export async function homeAssistantRoutes(app: FastifyInstance) {
  app.get("/api/home-assistant/status", async () => ({
    configured: Boolean(env.HA_URL && env.HA_TOKEN),
    url: env.HA_URL ?? null,
    syncEnabled: env.HA_SYNC_ENABLED,
    syncIntervalMinutes: env.HA_SYNC_INTERVAL_MINUTES,
  }));

  // Browsing Home Assistant's statistic list is what makes the mapping UI
  // usable — entity ids are unguessable installation-specific strings.
  app.get("/api/home-assistant/statistics", async (_req, reply) => {
    if (!env.HA_URL || !env.HA_TOKEN) {
      return reply.status(503).send({ error: "not_configured", message: "Set HA_URL and HA_TOKEN." });
    }
    return listHaStatistics();
  });

  // Same idea as /statistics above, but for the dynamic-tariff mapping row:
  // a price-forecast sensor carries no `sum`, so it never appears in that
  // list and needs its own, filtered by shape instead of by unit class.
  app.get("/api/home-assistant/dynamic-tariff-entities", async (_req, reply) => {
    if (!env.HA_URL || !env.HA_TOKEN) {
      return reply.status(503).send({ error: "not_configured", message: "Set HA_URL and HA_TOKEN." });
    }
    return listHaDynamicTariffEntities();
  });

  // Sensors of one device class, for the live-view mapping dropdowns.
  app.get<{ Querystring: Record<string, string> }>(
    "/api/home-assistant/sensors",
    async (req, reply) => {
      if (!env.HA_URL || !env.HA_TOKEN) {
        return reply.status(503).send({ error: "not_configured", message: "Set HA_URL and HA_TOKEN." });
      }
      const deviceClass = req.query.deviceClass;
      if (deviceClass !== "power" && deviceClass !== "energy" && deviceClass !== "battery") {
        return reply
          .status(400)
          .send({ error: "invalid_query", message: "deviceClass must be power, energy or battery." });
      }
      return listHaSensorsByDeviceClass(deviceClass);
    },
  );

  // What the site is doing right now — the participants' live view. Read
  // fresh from Home Assistant, nothing stored.
  app.get<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/home-assistant/live",
    async (req, reply) => {
      const view = await getLiveEnergyView(req.params.siteId);
      if (!view) return reply.status(404).send({ error: "not_found" });
      return view;
    },
  );

  app.get<{ Params: { siteId: string } }>("/api/sites/:siteId/home-assistant/entities", async (req) => {
    return listMappings(req.params.siteId);
  });

  app.put<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/home-assistant/entities",
    async (req, reply) => {
      const parsed = haEntityMappingInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
      }
      return upsertMapping(req.params.siteId, parsed.data);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/home-assistant/entities/:id", async (req, reply) => {
    const deleted = await deleteMapping(req.params.id);
    if (!deleted) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  app.post<{ Params: { siteId: string } }>(
    "/api/sites/:siteId/home-assistant/sync",
    async (req, reply) => {
      if (!env.HA_URL || !env.HA_TOKEN) {
        return reply.status(503).send({ error: "not_configured", message: "Set HA_URL and HA_TOKEN." });
      }
      const parsed = haSyncRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
      }
      const { from, to, granularity } = parsed.data;
      if ((from && !to) || (!from && to)) {
        return reply
          .status(400)
          .send({ error: "invalid_input", message: "Give both from and to, or neither." });
      }
      const result = await syncHomeAssistant(req.params.siteId, {
        // Inclusive local calendar days: end bound is the start of the day after `to`.
        from: from ? new Date(`${from}T00:00:00`) : undefined,
        to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) : undefined,
        granularity,
        lookbackHours: env.HA_SYNC_LOOKBACK_HOURS,
      });

      // Dynamic feed-in rates come from Home Assistant too, so this one
      // button refreshes both — the scheduled timer treats them together as
      // well. A backfill range is meaningless for them (the entity only ever
      // holds today and tomorrow), so they are refreshed either way, and
      // anything that stopped them is reported alongside the statistics that
      // were skipped.
      const tariffs = await syncDynamicTariffs();
      return {
        ...result,
        skipped: [...result.skipped, ...tariffs.warnings],
      };
    },
  );
}
