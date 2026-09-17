import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthIdentity } from "@energy-manager/shared";
import { allowedRoles, isAllowed, isPublic } from "./policy.js";
import { resolveIdentity, UnauthenticatedError, UnknownUserError } from "./identity.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook before any handler runs. */
    identity: AuthIdentity;
  }
}

/**
 * The party a participant is scoped to, or null for admin/viewer (who see
 * everything). Handlers that return per-party data call this and filter.
 */
export function scopedPartyId(req: FastifyRequest): string | null {
  return req.identity.role === "participant" ? req.identity.partyId : null;
}

/**
 * Install the authorisation hook on the root instance.
 *
 * Called directly rather than through `app.register()` on purpose. `register`
 * creates a new encapsulation context, and a hook added inside one applies
 * only to routes registered in that same context — so registering this as a
 * plugin would leave every sibling route module completely unguarded, with no
 * error to notice. Calling it with the root instance adds the hook globally.
 */
export function registerAuth(app: FastifyInstance) {
  // Declare the property without a value. Fastify 5 refuses a shared
  // reference-type default here (every request would alias the same object);
  // the hook below sets it per request before any handler runs.
  app.decorateRequest("identity");

  // Refuse to start if any route lacks a policy entry. The default-deny in
  // policy.ts already makes a forgotten route unreachable rather than open,
  // but failing at boot turns a silent 403-for-everyone into an error at the
  // moment the route is added, which is when it is cheap to fix.
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (isPublic(route.url, method)) continue;
      if (!allowedRoles(route.url, method)) {
        throw new Error(
          `No access policy for ${method} ${route.url}. ` +
            "Add it to POLICY in auth/policy.ts (or to isPublic if it needs no identity).",
        );
      }
    }
  });

  // onRequest runs before the body is parsed, so an unauthorised upload is
  // rejected without reading 50 MB off the wire first.
  app.addHook("onRequest", async (req, reply) => {
    const url = req.routeOptions.url;
    const method = req.method;

    if (isPublic(url ?? "", method)) return;

    // No matched route: let Fastify's 404 handle it rather than reporting a
    // permission problem for something that doesn't exist.
    if (!url) return;

    let identity: AuthIdentity;
    try {
      identity = await resolveIdentity(req.headers);
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        req.log.warn({ err: err.message, url }, "rejected unauthenticated request");
        return reply.status(401).send({ error: "unauthenticated" });
      }
      if (err instanceof UnknownUserError) {
        // Authenticated by Cloudflare but not known here. Log the address —
        // it's how you find out somebody needs adding — but don't tell the
        // caller which list they're missing from.
        req.log.warn({ err: err.message, url }, "rejected unknown user");
        return reply.status(403).send({ error: "forbidden" });
      }
      throw err;
    }

    req.identity = identity;

    if (!isAllowed(identity.role, url, method)) {
      req.log.warn({ role: identity.role, method, url }, "rejected by policy");
      return reply.status(403).send({ error: "forbidden" });
    }

    // A participant belongs to exactly one site. Without this, passing
    // another site's id would run a scoped query against data that isn't
    // theirs — the party filter alone wouldn't catch it, because their own
    // party id simply wouldn't match and they'd get an empty-but-valid
    // answer that still confirms the other site exists.
    if (identity.role === "participant") {
      const params = req.params as { siteId?: string } | undefined;
      if (params?.siteId && params.siteId !== identity.siteId) {
        req.log.warn({ url, siteId: params.siteId }, "participant reached across sites");
        return reply.status(403).send({ error: "forbidden" });
      }
    }
  });
}
