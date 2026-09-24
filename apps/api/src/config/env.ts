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
  // Home Assistant. Unset simply disables the integration — the rest of the
  // app runs fine without it. Dynamic feed-in rates come from here too, on
  // the same schedule as the statistics: there is nothing left that is
  // specific to them to configure.
  HA_URL: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\/$/, "")),
  HA_TOKEN: z.string().optional(),
  HA_SYNC_ENABLED: boolFlag("HA_SYNC_ENABLED", true),
  HA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  /** How far back each scheduled sync re-reads, to pick up late-arriving statistics. */
  HA_SYNC_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),

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

  // ---- Cloudflare Access sync (optional) --------------------------------
  // Keeps one reusable Access policy's allowed-email list in step with the
  // parties table: adding a party (or AUTH_ADMIN_EMAILS) pushes their address
  // into the policy, removing one pulls it back out. Entirely optional — with
  // either unset, the feature is off and nothing about auth changes.
  //
  // No policy id to configure: the policy this owns is found (or created,
  // the first time) by a name derived from the first AUTH_ADMIN_EMAILS
  // address — see cfAccess/engine.ts's policyNameFor. That also means the
  // policy is entirely this app's own once created, so a sync can freely
  // overwrite its whole email list rather than having to preserve entries it
  // didn't add — see the doc comment on syncCloudflareAccess.
  //
  // The token is more powerful than this feature strictly needs: Cloudflare
  // has no way to scope a token to a single Access policy, so one with
  // "Access: Apps and Policies" write access can edit or delete *any* Access
  // app or policy in the account, not just the one this creates. Treat it
  // like HA_TOKEN's more dangerous sibling.
  CF_API_TOKEN: z.string().optional(),
  CF_ACCOUNT_ID: z.string().optional(),

  // ---- Google Drive (optional) -------------------------------------------
  // Where generated invoice PDFs are archived, alongside the zip download.
  // A service account, not an OAuth app: unlike Cloudflare/HA there is no
  // per-site "pick an account" step — one credential, and it can only ever
  // see whatever folder a site's admin explicitly shares with its email
  // address (visible at GET .../drive/status). Unset simply disables the
  // feature — invoices still generate, just without a Drive copy.
  //
  // The whole key file's *contents*, not a path to it: some hosts (this
  // app's own Unraid deployment among them) have no convenient way to mount
  // an extra file into the container, but setting one more environment
  // variable is always available.
  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: z.string().optional(),
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

// Same "half-configured is worse than off" rule as AUTH_ENABLED above: a
// token with no account id would fail on the first sync rather than at boot.
if (Boolean(parsed.CF_API_TOKEN) !== Boolean(parsed.CF_ACCOUNT_ID)) {
  throw new Error(
    `Cloudflare Access sync is partially configured — set ${
      parsed.CF_API_TOKEN ? "CF_ACCOUNT_ID" : "CF_API_TOKEN"
    } too, or unset the other to leave it off.`,
  );
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
// The third condition, not just the two env vars: with no admin email there
// is nothing to name the policy after, so the feature can't run yet even if
// the token and account id are both set (e.g. auth still off in local dev).
export const cfAccessSyncConfigured = Boolean(
  parsed.CF_API_TOKEN && parsed.CF_ACCOUNT_ID && adminEmails.size > 0,
);
export const googleDriveConfigured = Boolean(parsed.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
