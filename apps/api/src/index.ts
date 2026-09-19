import { buildApp } from "./app.js";
import { adminEmails, env } from "./config/env.js";
import { syncDynamicTariffs } from "./modules/dynamicTariffs/service.js";
import { syncHomeAssistant } from "./modules/homeAssistant/service.js";
import { db } from "./db/client.js";
import { sites } from "./db/schema/index.js";

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Say out loud which mode we came up in. Getting this wrong is quiet by
// nature — a disabled auth layer serves every request happily — so it should
// not take a request to /api/me to find out.
if (env.AUTH_ENABLED) {
  app.log.info(
    { admins: adminEmails.size, team: env.CF_ACCESS_TEAM_DOMAIN },
    "authentication enabled (Cloudflare Access)",
  );
} else if (env.AUTH_DEV_AS) {
  app.log.warn(
    { as: env.AUTH_DEV_AS },
    "AUTH_DEV_AS is set — every request acts as this address. Local preview only.",
  );
} else {
  app.log.warn(
    "AUTH_ENABLED is off — every request is treated as admin. Fine on a LAN-only port; not for public access.",
  );
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

// Home Assistant only keeps 5-minute statistics for ~10 days, so the ongoing
// pull is what turns them into durable quarter-hour history before they age
// out. The lookback re-reads recent windows so late or revised statistics are
// corrected rather than missed.
if (env.HA_SYNC_ENABLED && env.HA_URL && env.HA_TOKEN) {
  const runHaSync = () => {
    void (async () => {
      try {
        const allSites = await db.select({ id: sites.id }).from(sites);
        for (const site of allSites) {
          const result = await syncHomeAssistant(site.id, {
            granularity: "quarter_hour",
            lookbackHours: env.HA_SYNC_LOOKBACK_HOURS,
          });
          app.log.info(
            { siteId: site.id, inserted: result.inserted, updated: result.updated, skipped: result.skipped },
            "home assistant sync completed",
          );
        }
      } catch (err) {
        app.log.error(err, "home assistant sync failed");
      }
    })();
  };
  runHaSync();
  setInterval(runHaSync, env.HA_SYNC_INTERVAL_MINUTES * 60 * 1000);
}
