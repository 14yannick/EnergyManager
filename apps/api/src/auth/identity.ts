import { sql } from "drizzle-orm";
import type { AuthIdentity, Role } from "@energy-manager/shared";
import { adminEmails, env } from "../config/env.js";
import { db } from "../db/client.js";
import { parties } from "../db/schema/index.js";
import { AccessTokenError, verifyAccessJwt } from "./cfAccess.js";

/** Identity used when AUTH_ENABLED is false — the pre-auth behaviour. */
export const ANONYMOUS_ADMIN: AuthIdentity = {
  role: "admin",
  email: null,
  partyId: null,
  partyName: null,
  siteId: null,
  simulated: false,
};

export class UnauthenticatedError extends Error {}

/**
 * Cloudflare vouched for this address, but this app has no role for it.
 *
 * Carries the address because the caller needs it: they are signed in to
 * something, and telling them which account that is turns a wall of failing
 * requests into "you are here as X, sign out or ask to be added". It is their
 * own verified address, so it reveals nothing they did not already send.
 */
export class UnknownUserError extends Error {
  constructor(
    message: string,
    readonly email: string,
  ) {
    super(message);
  }
}

/**
 * Map a verified address to a role.
 *
 * Order matters: the explicit admin and viewer lists win over the parties
 * table, so adding your own address as a participant (to preview what they
 * see) can't accidentally demote you.
 */
export async function roleForEmail(
  email: string,
): Promise<{ role: Role; partyId: string | null; partyName: string | null; siteId: string | null }> {
  if (adminEmails.has(email)) {
    return { role: "admin", partyId: null, partyName: null, siteId: null };
  }

  // `parties.emails` is a text[]; compare case-insensitively against each
  // element rather than the array as a whole.
  const rows = await db
    .select({ id: parties.id, name: parties.name, siteId: parties.siteId, role: parties.role })
    .from(parties)
    .where(sql`exists (select 1 from unnest(${parties.emails}) as e where lower(e) = ${email})`)
    .limit(2);

  if (rows.length === 1) {
    const row = rows[0]!;
    // Both admin roles grant full access; they differ only in whether the
    // party is billed, which is a billing question and not an access one.
    if (row.role === "rcp_admin" || row.role === "rcp_admin_only") {
      return { role: "admin", partyId: null, partyName: null, siteId: null };
    }
    // A viewer and an admin are deliberately left unscoped: both see the
    // whole site, so carrying a partyId would invite a handler to narrow
    // their view to their own row.
    if (row.role === "viewer") {
      return { role: "viewer", partyId: null, partyName: null, siteId: null };
    }
    return { role: "participant", partyId: row.id, partyName: row.name, siteId: row.siteId };
  }
  // Zero matches: authenticated by Cloudflare but unknown to this app.
  // More than one: the address is on several parties, so "their own data" is
  // ambiguous — refuse rather than pick one.
  throw new UnknownUserError(
    rows.length === 0
      ? `${email} is not an admin, a viewer, or a participant`
      : `${email} is listed on more than one party`,
    email,
  );
}

/**
 * Turn the incoming request headers into an identity.
 *
 * Only ever called with headers that arrived from outside, so nothing here
 * trusts a header value on its own — the JWT signature is the root of trust.
 */
export async function resolveIdentity(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthIdentity> {
  if (!env.AUTH_ENABLED) {
    // Local preview: the configured address, resolved as a real sign-in.
    // Headers are ignored either way — with auth off nothing in them is
    // verified, so nothing in them may choose who the caller is.
    if (env.AUTH_DEV_AS) {
      const resolved = await roleForEmail(env.AUTH_DEV_AS);
      return { ...resolved, email: env.AUTH_DEV_AS, simulated: true };
    }
    return ANONYMOUS_ADMIN;
  }

  const raw = headers["cf-access-jwt-assertion"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) {
    throw new UnauthenticatedError("no Cloudflare Access token on the request");
  }

  let claims;
  try {
    claims = await verifyAccessJwt(token);
  } catch (err) {
    if (err instanceof AccessTokenError) throw new UnauthenticatedError(err.message);
    throw err;
  }

  const { role, partyId, partyName, siteId } = await roleForEmail(claims.email);
  return { role, email: claims.email, partyId, partyName, siteId, simulated: false };
}
