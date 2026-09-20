import { z } from "zod";

/**
 * A boolean flag from the environment.
 *
 * Deliberately strict about what it *doesn't* understand: an unrecognised
 * value throws instead of quietly falling back to the default. The earlier
 * version compared `v === "true"`, which turned `AUTH_ENABLED=True`, `=1` or
 * a stray trailing space into a silently disabled auth layer — the one
 * failure direction this whole feature exists to avoid. Being noisy about a
 * typo is worth more than being lenient about a spelling.
 */
const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off", ""]);

function boolFlag(name: string, defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined) return defaultValue;
      const v = raw.trim().toLowerCase();
      if (TRUE_VALUES.has(v)) return true;
      if (FALSE_VALUES.has(v)) return false;
      throw new Error(
        `${name} must be one of true/false/1/0/yes/no/on/off (got ${JSON.stringify(raw)}).`,
      );
    });
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  // Still named BKW_SYNC_* — it once called BKW's own dyntariffs API
  // directly. It now reads the same prices from a Home Assistant entity
  // instead (this household's own HA already polls BKW), so the name is a
  // historical artifact; what it gates is unchanged: "periodically refresh
  // dynamic feed-in rates".
  BKW_SYNC_ENABLED: boolFlag("BKW_SYNC_ENABLED", true),
  BKW_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  // Home Assistant. Unset simply disables the integration — the rest of the
  // app runs fine without it.
  HA_URL: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\/$/, "")),
  HA_TOKEN: z.string().optional(),
  HA_SYNC_ENABLED: boolFlag("HA_SYNC_ENABLED", true),
  HA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  /** How far back each scheduled sync re-reads, to pick up late-arriving statistics. */
  HA_SYNC_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),
  /**
   * The price-forecast entity the dynamic feed-in sync reads — the household's
   * own Home Assistant sensor, not a stock integration (see haClient.ts). It
   * has to publish `today`/`tomorrow` attributes of {start, price} slots in
   * CHF/kWh and a `price_component` of "feed_in", or the sync refuses to
   * write anything rather than mis-price the wrong tariff.
   */
  HA_DYNAMIC_TARIFF_ENTITY_ID: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? "sensor.dynamic_tariff" : v.trim() || undefined)),

  // ---- Authentication (Cloudflare Access) -------------------------------
  // Off by default so local development and existing deployments keep
  // working unchanged. With it off every request is treated as admin, which
  // is only safe because the app is then expected to sit behind something
  // else (a LAN-only port, or Access with no per-user roles).
  AUTH_ENABLED: boolFlag("AUTH_ENABLED", false),
  /** e.g. "yourteam.cloudflareaccess.com" — no scheme. */
  CF_ACCESS_TEAM_DOMAIN: z
    .string()
    .optional()
    .transform((v) => v?.replace(/^https?:\/\//, "").replace(/\/$/, "")),
  /**
   * The Access application's AUD tag. This is what pins a token to *this*
   * app: without checking it, a JWT minted for any other Access application
   * in the same Cloudflare account would be accepted here.
   */
  CF_ACCESS_AUD: z.string().optional(),
  AUTH_ADMIN_EMAILS: z.string().default(""),
  /**
   * Local development only: with auth off, treat every request as this
   * address instead of as an anonymous admin, resolved exactly as a signed-in
   * user would be — so a participant's email shows their view, scoped by the
   * server, without Cloudflare in the loop. Refused alongside AUTH_ENABLED.
   *
   * Read-only access has no list of its own: a party with the viewer role
   * grants it, and this is how to preview it.
   */
  AUTH_DEV_AS: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || undefined)
    .refine((v) => v === undefined || /^[^@\s]+@[^@\s]+$/.test(v), {
      message: "AUTH_DEV_AS must be an email address",
    }),
});

const parsed = envSchema.parse(process.env);

// A simulated identity has no business next to real authentication: set by
// mistake on a server, it would make every visitor that person.
if (parsed.AUTH_ENABLED && parsed.AUTH_DEV_AS) {
  throw new Error(
    "AUTH_DEV_AS is for local development with AUTH_ENABLED=false. Remove it when authentication is on.",
  );
}

// Half-configured auth is worse than none: it fails open on every request
// while looking enabled. Refuse to start instead.
if (parsed.AUTH_ENABLED) {
  const missing = [
    !parsed.CF_ACCESS_TEAM_DOMAIN && "CF_ACCESS_TEAM_DOMAIN",
    !parsed.CF_ACCESS_AUD && "CF_ACCESS_AUD",
    !parsed.AUTH_ADMIN_EMAILS.trim() && "AUTH_ADMIN_EMAILS",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `AUTH_ENABLED=true requires ${missing.join(", ")}. ` +
        "Without an admin address nobody could administer the app.",
    );
  }
}

/** Comma- or space-separated list to a lowercased set. */
function emailSet(raw: string): ReadonlySet<string> {
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const env = parsed;
export const adminEmails = emailSet(parsed.AUTH_ADMIN_EMAILS);
