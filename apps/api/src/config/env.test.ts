import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The flag parser gets its own tests because the failure it prevents is
 * silent: a misspelled AUTH_ENABLED used to disable the auth layer while
 * looking set.
 */
const BASE = { DATABASE_URL: "postgres://x:x@127.0.0.1:1/x" };

async function loadEnv(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of ["AUTH_ENABLED", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "AUTH_ADMIN_EMAILS"]) {
    delete process.env[k];
  }
  Object.assign(process.env, BASE, overrides);
  return import("./env.js");
}

afterEach(() => {
  for (const k of ["AUTH_ENABLED", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "AUTH_ADMIN_EMAILS"]) {
    delete process.env[k];
  }
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
    expect(env.BKW_SYNC_ENABLED).toBe(true);
    expect(env.HA_SYNC_ENABLED).toBe(true);
  });

  it("parses the admin and viewer lists case-insensitively", async () => {
    const { adminEmails, viewerEmails } = await loadEnv({
      AUTH_ENABLED: "true",
      ...ENABLED,
      AUTH_ADMIN_EMAILS: "Owner@Example.com, second@example.com",
      AUTH_VIEWER_EMAILS: "Guest@Example.COM",
    });
    expect(adminEmails.has("owner@example.com")).toBe(true);
    expect(adminEmails.has("second@example.com")).toBe(true);
    expect(viewerEmails.has("guest@example.com")).toBe(true);
  });
});
