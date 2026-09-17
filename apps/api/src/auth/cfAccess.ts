import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

/**
 * Cloudflare Access puts a signed JWT on every request it lets through, and
 * also a convenient `Cf-Access-Authenticated-User-Email` header. We use the
 * JWT and ignore the email header on purpose: the header is plain text, so
 * anything that can reach this origin without passing through Cloudflare —
 * another container on the docker network, or a LAN client once the second
 * door exists — could set it to any address and become an admin. The
 * signature is the only part an attacker can't produce.
 */
const JWKS_PATH = "/cdn-cgi/access/certs";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function keySet() {
  if (!jwks) {
    const url = new URL(`https://${env.CF_ACCESS_TEAM_DOMAIN}${JWKS_PATH}`);
    // jose caches the fetched keys and re-fetches only on an unknown `kid`,
    // so Cloudflare's key rotation is picked up without us polling.
    jwks = createRemoteJWKSet(url, { cooldownDuration: 30_000 });
  }
  return jwks;
}

export interface AccessClaims {
  email: string;
  /** Cloudflare's stable user id. */
  sub: string;
}

export class AccessTokenError extends Error {}

/**
 * Verify an Access JWT and return its identity claims.
 *
 * Throws `AccessTokenError` for anything that fails — expired, wrong
 * audience, bad signature, no email claim. Callers turn that into a 401
 * without echoing the reason to the client.
 */
export async function verifyAccessJwt(token: string): Promise<AccessClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySet(), {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      // The AUD tag scopes the token to this Access application. Dropping it
      // would accept a token minted for any other app in the same account.
      audience: env.CF_ACCESS_AUD,
    }));
  } catch (err) {
    throw new AccessTokenError(err instanceof Error ? err.message : "token rejected");
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new AccessTokenError("token carries no email claim");
  if (!payload.sub) throw new AccessTokenError("token carries no subject");

  return { email, sub: String(payload.sub) };
}

/** Test seam: drop the cached key set so a test can swap the team domain. */
export function resetKeySetForTests() {
  jwks = null;
}
