import { describe, expect, it } from "vitest";
import { allowedRoles, isAllowed, isPublic, policyRoutes } from "./policy.js";

describe("route policy", () => {
  it("denies anything it has never heard of", () => {
    // The default matters more than any individual rule: a route added later
    // without a policy entry must break, not open.
    expect(allowedRoles("/api/sites/:siteId/some-future-thing", "GET")).toBeUndefined();
    expect(isAllowed("admin", "/api/sites/:siteId/some-future-thing", "GET")).toBe(false);
    expect(isAllowed("participant", "/api/sites/:siteId/some-future-thing", "GET")).toBe(false);
  });

  it("denies a method that was never granted on a known route", () => {
    // /api/me exists, but only for GET.
    expect(isAllowed("admin", "/api/me", "DELETE")).toBe(false);
  });

  it("treats HEAD as GET, since Fastify answers it from the GET handler", () => {
    expect(isAllowed("viewer", "/api/sites", "HEAD")).toBe(true);
    // ...but HEAD must not inherit a write rule.
    expect(isAllowed("viewer", "/api/sites/:id", "HEAD")).toBe(false);
  });

  it("lets a viewer read but never write", () => {
    const writes: Array<[string, string]> = [
      ["/api/sites/:id", "PATCH"],
      ["/api/sites/:siteId/tariff-periods", "POST"],
      ["/api/tariff-periods/:id", "DELETE"],
      ["/api/sites/:siteId/readings", "DELETE"],
      ["/api/sites/:siteId/readings/import", "POST"],
      ["/api/parties/:id", "PATCH"],
      ["/api/billing/positions/:id", "DELETE"],
      ["/api/sites/:siteId/home-assistant/sync", "POST"],
    ];
    for (const [url, method] of writes) {
      expect(isAllowed("viewer", url, method), `viewer ${method} ${url}`).toBe(false);
      expect(isAllowed("admin", url, method), `admin ${method} ${url}`).toBe(true);
    }
  });

  it("confines a participant to their own invoice and community context", () => {
    expect(isAllowed("participant", "/api/me", "GET")).toBe(true);
    expect(isAllowed("participant", "/api/sites/:siteId/billing/invoices", "GET")).toBe(true);
    expect(isAllowed("participant", "/api/sites/:siteId/community/summary", "GET")).toBe(true);
    // The provider's rates their invoice is built from — not the owner's tariffs.
    expect(isAllowed("participant", "/api/sites/:siteId/billing/positions", "GET")).toBe(true);
  });

  it("keeps the owner's own figures away from a participant", () => {
    // Each of these would expose production, battery, exports, investment
    // cost, tariffs, or the other neighbours.
    const offLimits = [
      "/api/sites", // carries the owner's investment + battery settings
      "/api/sites/:siteId/savings/daily",
      "/api/sites/:siteId/savings/summary",
      "/api/sites/:siteId/savings/cumulative",
      "/api/sites/:siteId/savings/neighbours", // every participant, and the feed-in rates
      "/api/sites/:siteId/readings",
      "/api/sites/:siteId/readings/export.xlsx",
      "/api/sites/:siteId/cost-items",
      "/api/sites/:siteId/cost-items/summary",
      "/api/sites/:siteId/parties", // the other participants
      "/api/sites/:siteId/tariff-periods",
      "/api/home-assistant/status",
      "/api/home-assistant/statistics",
      "/api/home-assistant/dynamic-tariff-entities",
      "/api/sites/:siteId/home-assistant/entities",
      "/api/sites/:siteId/dynamic-tariffs",
    ];
    for (const url of offLimits) {
      expect(isAllowed("participant", url, "GET"), `participant GET ${url}`).toBe(false);
    }
  });

  it("gives a participant no write anywhere at all", () => {
    for (const url of policyRoutes) {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        expect(isAllowed("participant", url, method), `participant ${method} ${url}`).toBe(false);
      }
    }
  });

  it("exposes only health and CORS preflight anonymously", () => {
    expect(isPublic("/api/health", "GET")).toBe(true);
    expect(isPublic("/api/sites", "OPTIONS")).toBe(true);
    expect(isPublic("/api/sites", "GET")).toBe(false);
    expect(isPublic("/api/me", "GET")).toBe(false);
    expect(isPublic("/api/sites/:siteId/billing/invoices", "GET")).toBe(false);
  });
});
