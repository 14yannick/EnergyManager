import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { siteRoutes } from "./modules/sites/routes.js";
import { tariffPeriodRoutes } from "./modules/tariffPeriods/routes.js";
import { tariffSurchargeRoutes } from "./modules/tariffSurcharges/routes.js";
import { costItemRoutes } from "./modules/costItems/routes.js";
import { readingsRoutes } from "./modules/readings/routes.js";
import { savingsRoutes } from "./modules/savings/routes.js";
import { dynamicTariffRoutes } from "./modules/dynamicTariffs/routes.js";
import { partyRoutes } from "./modules/parties/routes.js";
import { homeAssistantRoutes } from "./modules/homeAssistant/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.get("/api/health", async () => ({ status: "ok" }));

  // Fastify's default handler echoes error.message to the client, which for an
  // uncaught DB error means the full SQL query and bound params. Routes handle
  // their own expected error cases (400/404/409) explicitly via reply.send();
  // anything that reaches here is unexpected, so log it in full and return a
  // generic message instead of leaking internals.
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    reply.status(500).send({ error: "internal_error", message: "An unexpected error occurred." });
  });

  await app.register(siteRoutes);
  await app.register(tariffPeriodRoutes);
  await app.register(tariffSurchargeRoutes);
  await app.register(costItemRoutes);
  await app.register(readingsRoutes);
  await app.register(savingsRoutes);
  await app.register(dynamicTariffRoutes);
  await app.register(partyRoutes);
  await app.register(homeAssistantRoutes);
  await app.register(billingRoutes);

  return app;
}
