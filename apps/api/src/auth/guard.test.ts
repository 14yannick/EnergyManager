import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the wiring rather than the table: that the hook is actually
 * installed on every route (not trapped inside a plugin's encapsulation
 * context), and that headers alone can't authenticate.
 *
 * None of these reach a handler, so no database is involved — an unauthorised
 * request is refused in onRequest, before routing to the handler body.
 */
const AUTH_ENV = {
  DATABASE_URL: "postgres://x:x@127.0.0.1:1/x",
  AUTH_ENABLED: "true",
  CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud-tag-for-this-app",
  AUTH_ADMIN_EMAILS: "owner@example.com",
  HA_SYNC_ENABLED: "false",
};

async function buildWith(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...AUTH_ENV, ...overrides })) process.env[k] = v;
  const { buildApp } = await import("../app.js");
  return buildApp();
}

const original = { ...process.env };
beforeEach(() => vi.resetModules());
afterEach(() => {
  for (const k of Object.keys(AUTH_ENV)) delete process.env[k];
  Object.assign(process.env, original);
});

describe("auth guard", () => {
  it("rejects every protected route without a token", async () => {
    const app = await buildWith();
    // A spread across route modules: if the hook were encapsulated inside a
    // registered plugin, these would all answer 200/500 instead of 401.
    const protectedRoutes: Array<[string, string]> = [
      ["GET", "/api/sites"],
      ["GET", "/api/me"],
      ["GET", "/api/sites/s1/savings/summary?from=2026-01-01&to=2026-01-31"],
      ["GET", "/api/sites/s1/billing/invoices?from=2026-01-01&to=2026-01-31"],
      ["GET", "/api/sites/s1/community/summary?from=2026-01-01&to=2026-01-31"],
      ["GET", "/api/sites/s1/parties"],
      ["GET", "/api/home-assistant/status"],
      ["POST", "/api/sites/s1/readings/import"],
      ["DELETE", "/api/sites/s1/readings?from=2026-01-01&to=2026-01-31"],
      ["PATCH", "/api/parties/p1"],
    ];
    for (const [method, url] of protectedRoutes) {
      const res = await app.inject({ method: method as "GET", url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });

  it("does not accept the Cloudflare email header on its own", async () => {
    const app = await buildWith();
    // This header is real — Access sets it — but it is unsigned, so anything
    // that reaches the origin directly could forge it. Only the JWT counts.
    const res = await app.inject({
      method: "GET",
      url: "/api/sites",
      headers: { "cf-access-authenticated-user-email": "owner@example.com" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a syntactically invalid token without reaching a handler", async () => {
    const app = await buildWith();
    const res = await app.inject({
      method: "GET",
      url: "/api/sites",
      headers: { "cf-access-jwt-assertion": "not.a.jwt" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("leaves health open for container probes", async () => {
    const app = await buildWith();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("gates nothing at all when AUTH_ENABLED is false", async () => {
    // The upgrade contract: an existing deployment that sets no auth vars
    // must behave exactly as it did before this feature existed. Every
    // caller is admin, including on writes.
    const app = await buildWith({ AUTH_ENABLED: "false" });

    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/me" });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "admin", email: null, partyId: null });

    // These reach their handlers and fail on the unreachable test database.
    // The point is only that they are not turned away first — a 401/403 here
    // would mean an upgrade had silently locked somebody out of their own app.
    for (const [method, url] of [
      ["GET", "/api/sites"],
      ["DELETE", "/api/parties/p1"],
      ["POST", "/api/sites/s1/readings/import"],
    ] as const) {
      const res = await app.inject({ method, url });
      expect([401, 403], `${method} ${url} was gated`).not.toContain(res.statusCode);
    }
    await app.close();
  });

  it("refuses to register a route that has no policy entry", async () => {
    // The guarantee that makes default-deny maintainable: you find out when
    // you add the route, not when a user reports a 403.
    vi.resetModules();
    Object.assign(process.env, AUTH_ENV);
    const Fastify = (await import("fastify")).default;
    const { registerAuth } = await import("./plugin.js");
    const app = Fastify();
    registerAuth(app);
    expect(() => app.get("/api/something-new", async () => ({}))).toThrow(
      /No access policy for GET \/api\/something-new/,
    );
    await app.close();
  });

  it("refuses to start when auth is half-configured", async () => {
    // No AUD tag means any Access token from the whole account would pass.
    await expect(buildWith({ CF_ACCESS_AUD: "" })).rejects.toThrow(/CF_ACCESS_AUD/);
  });

  it("refuses to start with no admin address", async () => {
    await expect(buildWith({ AUTH_ADMIN_EMAILS: "  " })).rejects.toThrow(/AUTH_ADMIN_EMAILS/);
  });
});
