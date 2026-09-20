import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a rejected caller is told about themselves.
 *
 * Separate from guard.test.ts because it needs a *valid* token and a database
 * that answers, both of which are mocked here — and a mocked database would
 * undo the point of the tests over there, which is that routes really do
 * reach their handlers.
 */

const CLAIMS = vi.hoisted(() => ({ email: "stranger@example.com", sub: "s", aud: "a" }));

vi.mock("./cfAccess.js", () => ({
  AccessTokenError: class extends Error {},
  verifyAccessJwt: vi.fn(async () => CLAIMS),
}));

// A chainable stand-in for Drizzle's query builder: every method returns
// itself, and awaiting it yields no rows — which is exactly "this address is
// on no party".
vi.mock("../db/client.js", () => {
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (rows: unknown[]) => void) => resolve([]);
        return () => chain;
      },
    },
  );
  return { db: chain };
});

const AUTH_ENV = {
  DATABASE_URL: "postgres://x:x@127.0.0.1:1/x",
  AUTH_ENABLED: "true",
  CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud-tag-for-this-app",
  AUTH_ADMIN_EMAILS: "owner@example.com",
  HA_SYNC_ENABLED: "false",
};

const original = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, AUTH_ENV);
});
afterEach(() => {
  for (const k of Object.keys(AUTH_ENV)) delete process.env[k];
  Object.assign(process.env, original);
});

describe("rejecting an authenticated stranger", () => {
  it("names the address back to them so the app can offer a way out", async () => {
    // Without this the web app has no identity to show and no reason to
    // render its sign-out button — the caller is signed in to an account they
    // cannot use and cannot leave.
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "cf-access-jwt-assertion": "a.valid.token" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden", email: "stranger@example.com" });
    await app.close();
  });
});
