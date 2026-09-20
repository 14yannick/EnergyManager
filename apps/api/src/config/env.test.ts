import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The flag parser gets its own tests because the failure it prevents is
 * silent: a misspelled AUTH_ENABLED used to disable the auth layer while
 * looking set.
 */
const BASE = { DATABASE_URL: "postgres://x:x@127.0.0.1:1/x" };
const AUTH_KEYS = [
  "AUTH_ENABLED",
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUD",
  "AUTH_ADMIN_EMAILS",
  "AUTH_DEV_AS",
];

async function loadEnv(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of AUTH_KEYS) delete process.env[k];
  Object.assign(process.env, BASE, overrides);
  return import("./env.js");
}

afterEach(() => {
  for (const k of AUTH_KEYS) delete process.env[k];
});

const ENABLED = {
  CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud",
  AUTH_ADMIN_EMAILS: "owner@example.com",
};

describe("boolean env flags", () => {
  it("accepts the spellings people actually type", async () => {
    for (const v of ["true", "TRUE", "True", " true ", "1", "yes", "on"]) {
      const { env } = await loadEnv({ AUTH_ENABLED: v, ...ENABLED });
      expect(env.AUTH_ENABLED, `AUTH_ENABLED=${JSON.stringify(v)}`).toBe(true);
    }
    for (const v of ["false", "FALSE", " off ", "0", "no", ""]) {
      const { env } = await loadEnv({ AUTH_ENABLED: v });
      expect(env.AUTH_ENABLED, `AUTH_ENABLED=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("refuses a value it does not understand rather than defaulting", async () => {
    // The whole point: "enabled", "y", "ja" must not read as "off".
    await expect(loadEnv({ AUTH_ENABLED: "enabled", ...ENABLED })).rejects.toThrow(/AUTH_ENABLED/);
    await expect(loadEnv({ AUTH_ENABLED: "ja" })).rejects.toThrow(/AUTH_ENABLED/);
  });

  it("defaults auth off and the syncs on when unset", async () => {
    const { env } = await loadEnv();
    expect(env.AUTH_ENABLED).toBe(false);
    expect(env.HA_SYNC_ENABLED).toBe(true);
  });

  it("parses the admin list case-insensitively", async () => {
    const { adminEmails } = await loadEnv({
      AUTH_ENABLED: "true",
      ...ENABLED,
      AUTH_ADMIN_EMAILS: "Owner@Example.com, second@example.com",
    });
    expect(adminEmails.has("owner@example.com")).toBe(true);
    expect(adminEmails.has("second@example.com")).toBe(true);
  });
});

describe("AUTH_DEV_AS", () => {
  it("normalises the address, and reads blank as unset", async () => {
    expect((await loadEnv({ AUTH_DEV_AS: "  Neighbour@Example.COM " })).env.AUTH_DEV_AS).toBe(
      "neighbour@example.com",
    );
    expect((await loadEnv({ AUTH_DEV_AS: "" })).env.AUTH_DEV_AS).toBeUndefined();
  });

  it("refuses to start next to real authentication", async () => {
    await expect(
      loadEnv({ AUTH_ENABLED: "true", ...ENABLED, AUTH_DEV_AS: "neighbour@example.com" }),
    ).rejects.toThrow(/AUTH_DEV_AS/);
  });

  it("refuses something that is not an address", async () => {
    await expect(loadEnv({ AUTH_DEV_AS: "neighbour" })).rejects.toThrow(/AUTH_DEV_AS/);
  });
});
