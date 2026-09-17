import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  // z.coerce.boolean() would treat the string "false" as truthy (non-empty
  // string) — compare explicitly instead.
  BKW_SYNC_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  BKW_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  // Home Assistant. Unset simply disables the integration — the rest of the
  // app runs fine without it.
  HA_URL: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\/$/, "")),
  HA_TOKEN: z.string().optional(),
  HA_SYNC_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  HA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  /** How far back each scheduled sync re-reads, to pick up late-arriving statistics. */
  HA_SYNC_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),

  // ---- Authentication (Cloudflare Access) -------------------------------
  // Off by default so local development and existing deployments keep
  // working unchanged. With it off every request is treated as admin, which
  // is only safe because the app is then expected to sit behind something
  // else (a LAN-only port, or Access with no per-user roles).
  AUTH_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
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
  AUTH_VIEWER_EMAILS: z.string().default(""),
});

const parsed = envSchema.parse(process.env);

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
export const viewerEmails = emailSet(parsed.AUTH_VIEWER_EMAILS);
