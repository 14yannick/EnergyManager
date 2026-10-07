import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The local preview (AUTH_DEV_AS) must resolve an address exactly as a real
 * sign-in does, so the view it shows is the one that person would get. The
 * database is stubbed to the one query roleForEmail makes.
 */
type PartyRow = { id: string; name: string; siteId: string; siteName: string; role: string };

async function load(env: Record<string, string>, rows: PartyRow[] = []) {
  vi.resetModules();
  for (const k of ["AUTH_ENABLED", "AUTH_DEV_AS", "AUTH_ADMIN_EMAILS"]) delete process.env[k];
  Object.assign(process.env, { DATABASE_URL: "postgres://x:x@127.0.0.1:1/x" }, env);
  const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => rows };
  vi.doMock("../db/client.js", () => ({ db: { select: () => chain } }));
  return import("./identity.js");
}

afterEach(() => {
  vi.doUnmock("../db/client.js");
  for (const k of ["AUTH_ENABLED", "AUTH_DEV_AS", "AUTH_ADMIN_EMAILS"]) delete process.env[k];
});

const neighbour: PartyRow = { id: "p1", name: "Neighbour A", siteId: "s1", siteName: "Home", role: "rcp_party" };

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
      homeSite: { id: "s1", name: "Home" },
      homeParty: { id: "p1", name: "Neighbour A" },
      simulated: true,
    });
  });

  it("tells an admin and a viewer which site they are assigned to, without confining them to it", async () => {
    for (const role of ["rcp_admin", "rcp_admin_only", "viewer"]) {
      const { resolveIdentity } = await load({ AUTH_DEV_AS: "owner@example.com" }, [{ ...neighbour, role }]);
      const identity = await resolveIdentity({});
      expect(identity.homeSite).toEqual({ id: "s1", name: "Home" });
      expect(identity.homeParty).toEqual({ id: "p1", name: "Neighbour A" });
      // The scope stays open: `siteId` is what the guard confines by.
      expect(identity.siteId).toBeNull();
      expect(identity.partyId).toBeNull();
    }
  });

  it("keeps a listed admin an admin, and still tells them the site their party is in", async () => {
    const { resolveIdentity } = await load(
      { AUTH_DEV_AS: "boss@example.com", AUTH_ADMIN_EMAILS: "boss@example.com" },
      // Listed as an ordinary party: the list, not the row, decides the role.
      [neighbour],
    );
    expect(await resolveIdentity({})).toMatchObject({
      role: "admin",
      partyId: null,
      siteId: null,
      homeSite: { id: "s1", name: "Home" },
      homeParty: { id: "p1", name: "Neighbour A" },
    });
  });

  it("has no home site for an address with no party behind it", async () => {
    const { resolveIdentity } = await load({ AUTH_DEV_AS: "boss@example.com", AUTH_ADMIN_EMAILS: "boss@example.com" });
    expect(await resolveIdentity({})).toMatchObject({ role: "admin", siteId: null, homeSite: null, homeParty: null });
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
