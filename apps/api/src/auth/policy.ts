import type { Role } from "@energy-manager/shared";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const ADMIN = ["admin"] as const;
const READ = ["admin", "viewer"] as const;
/** Endpoints a participant may reach — every one of them scoped in its handler. */
const PARTICIPANT_READ = ["admin", "viewer", "participant"] as const;

/**
 * Who may call what, keyed by Fastify's *registered* route pattern (
 * `request.routeOptions.url`) rather than the concrete path. Matching the
 * pattern means no path parsing here and no chance of a crafted path like
 * `/api/sites/..%2f..` slipping past a prefix check — the router has already
 * decided which handler runs, and we authorise that decision.
 *
 * Anything absent from this table is denied. New routes are therefore
 * admin-only until somebody deliberately widens them, which is the failure
 * direction we want: a forgotten entry breaks a feature instead of leaking
 * one.
 */
const POLICY: Readonly<Record<string, Partial<Record<Method, readonly Role[]>>>> = {
  "/api/me": { GET: PARTICIPANT_READ },

  "/api/sites": { GET: READ },
  "/api/sites/:id": { PATCH: ADMIN },

  "/api/sites/:siteId/tariff-periods": { GET: READ, POST: ADMIN },
  "/api/tariff-periods/:id": { PATCH: ADMIN, DELETE: ADMIN },

  "/api/sites/:siteId/tariff-surcharges": { GET: READ, POST: ADMIN },
  "/api/tariff-surcharges/:id": { PATCH: ADMIN, DELETE: ADMIN },

  "/api/sites/:siteId/cost-items": { GET: READ, POST: ADMIN },
  "/api/sites/:siteId/cost-items/summary": { GET: READ },
  "/api/cost-items/:id": { PATCH: ADMIN, DELETE: ADMIN },

  "/api/sites/:siteId/readings": { GET: READ, DELETE: ADMIN },
  "/api/sites/:siteId/readings/import": { POST: ADMIN },
  "/api/sites/:siteId/readings/range": { GET: READ },
  "/api/sites/:siteId/readings/export.xlsx": { GET: READ },

  "/api/sites/:siteId/savings/daily": { GET: READ },
  "/api/sites/:siteId/savings/summary": { GET: READ },
  "/api/sites/:siteId/savings/cumulative": { GET: READ },

  "/api/sites/:siteId/dynamic-tariffs": { GET: READ },
  "/api/sites/:siteId/dynamic-tariffs/sync": { POST: ADMIN },

  "/api/sites/:siteId/parties": { GET: READ, POST: ADMIN },
  "/api/parties/:id": { PATCH: ADMIN, DELETE: ADMIN },

  "/api/home-assistant/status": { GET: READ },
  "/api/home-assistant/statistics": { GET: READ },
  "/api/sites/:siteId/home-assistant/entities": { GET: READ, PUT: ADMIN },
  "/api/home-assistant/entities/:id": { DELETE: ADMIN },
  "/api/sites/:siteId/home-assistant/sync": { POST: ADMIN },

  "/api/sites/:siteId/billing/positions": { GET: READ, POST: ADMIN },
  "/api/billing/positions/:id": { PATCH: ADMIN, DELETE: ADMIN },
  // Filtered to the caller's own party for `participant` — see billing/routes.
  "/api/sites/:siteId/billing/invoices": { GET: PARTICIPANT_READ },

  "/api/sites/:siteId/community/summary": { GET: PARTICIPANT_READ },
};

/**
 * Reachable without any identity at all. Health is here so an orchestrator's
 * probe doesn't need a token; OPTIONS is here because a CORS preflight never
 * carries one and must answer before the real request is made.
 */
export function isPublic(url: string, method: string): boolean {
  return method === "OPTIONS" || url === "/api/health";
}

/**
 * The roles allowed to call this route, or `undefined` if none are — an
 * unknown route, or a method nobody has been granted.
 */
export function allowedRoles(url: string, method: string): readonly Role[] | undefined {
  // Fastify answers HEAD from the GET handler, so it must carry GET's rules
  // rather than falling through to the default deny.
  const normalised = (method === "HEAD" ? "GET" : method) as Method;
  return POLICY[url]?.[normalised];
}

export function isAllowed(role: Role, url: string, method: string): boolean {
  return allowedRoles(url, method)?.includes(role) ?? false;
}

/** Exported for the test that asserts every registered route has a rule. */
export const policyRoutes = Object.keys(POLICY);
