import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The local preview (AUTH_DEV_AS) must resolve an address exactly as a real
 * sign-in does, so the view it shows is the one that person would get. The
 * database is stubbed to the one query roleForEmail makes.
 */
type PartyRow = { id: string; name: string; siteId: string; role: string };

async function load(env: Record<string, string>, rows: PartyRow[] = []) {
  vi.resetModules();
  for (const k of ["AUTH_ENABLED", "AUTH_DEV_AS", "AUTH_ADMIN_EMAILS"]) delete process.env[k];
  Object.assign(process.env, { DATABASE_URL: "postgres://x:x@127.0.0.1:1/x" }, env);
  const chain = { from: () => chain, where: () => chain, limit: async () => rows };
  vi.doMock("../db/client.js", () => ({ db: { select: () => chain } }));
  return import("./identity.js");
}

afterEach(() => {
  vi.doUnmock("../db/client.js");
  for (const k of ["AUTH_ENABLED", "AUTH_DEV_AS", "AUTH_ADMIN_EMAILS"]) delete process.env[k];
});

const neighbour: PartyRow = { id: "p1", name: "Neighbour A", siteId: "s1", role: "rcp_party" };

describe("resolveIdentity with authentication off", () => {
  it("is an anonymous admin when no preview address is set", async () => {
    const { resolveIdentity } = await load({});
    expect(await resolveIdentity({})).toMatchObject({ role: "admin", email: null, simulated: false });
  });

  it("previews a participant as their party, scoped to it", async () => {
    const { resolveIdentity } = await load({ AUTH_DEV_AS: "Neighbour@Example.com" }, [neighbour]);
    expect(await resolveIdentity({})).toEqual({
      role: "participant",
      email: "neighbour@example.com",
      partyId: "p1",
      partyName: "Neighbour A",
      siteId: "s1",
      simulated: true,
    });
  });

  it("previews a viewer party as a viewer — no list of viewer addresses needed", async () => {
    const { resolveIdentity } = await load({ AUTH_DEV_AS: "guest@example.com" }, [
      { ...neighbour, role: "viewer" },
    ]);
    expect(await resolveIdentity({})).toMatchObject({ role: "viewer", partyId: null, simulated: true });
  });

  it("refuses an address nobody knows, as a real sign-in would be", async () => {
    const { resolveIdentity, UnknownUserError } = await load({ AUTH_DEV_AS: "stranger@example.com" });
    await expect(resolveIdentity({})).rejects.toBeInstanceOf(UnknownUserError);
  });

  it("takes no identity from request headers, preview or not", async () => {
    const { resolveIdentity } = await load({ AUTH_DEV_AS: "neighbour@example.com" }, [neighbour]);
    const forged = { "cf-access-authenticated-user-email": "owner@example.com" };
    expect(await resolveIdentity(forged)).toMatchObject({ role: "participant", partyId: "p1" });
  });
});
