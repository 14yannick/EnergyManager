import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { syncDynamicTariffs } from "./modules/dynamicTariffs/service.js";

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

if (env.BKW_SYNC_ENABLED) {
  const runSync = () => {
    syncDynamicTariffs()
      .then((result) => app.log.info(result, "dynamic tariff sync completed"))
      .catch((err) => app.log.error(err, "dynamic tariff sync failed"));
  };
  runSync();
  setInterval(runSync, env.BKW_SYNC_INTERVAL_MINUTES * 60 * 1000);
}
