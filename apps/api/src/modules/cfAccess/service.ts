import type { CfAccessSyncResult } from "@energy-manager/shared";
import { adminEmails, cfAccessSyncConfigured } from "../../config/env.js";
import { db } from "../../db/client.js";
import { parties } from "../../db/schema/index.js";
import { createAccessPolicy, findAccessPolicyByName, putAccessPolicy } from "./client.js";
import { computeAccessDiff, emailsInRules, mergeIncludeRules, policyNameFor } from "./engine.js";

/**
 * Every address that should be able to reach the app: the static
 * AUTH_ADMIN_EMAILS list, plus every party's own emails across every site —
 * any role, since every one of them maps to *some* access level (see
 * auth/identity.ts). One Cloudflare Access policy serves the whole
 * deployment regardless of how many sites it has.
 */
async function desiredEmails(): Promise<string[]> {
  const rows = await db.select({ emails: parties.emails }).from(parties);
  const set = new Set(adminEmails);
  for (const row of rows) for (const e of row.emails) set.add(e.trim().toLowerCase());
  return [...set].sort();
}

/**
 * Brings the Cloudflare Access policy named after the first admin address
 * (see engine.ts's policyNameFor) in line with the app's own idea of who
 * should be let in — creating it, the very first time, if it doesn't exist.
 *
 * No local bookkeeping of what this app has previously added: the policy is
 * found (or created) by a name only this app would generate, so once it
 * exists it is entirely this app's own, and a sync can safely recompute the
 * *whole* email list from Cloudflare's own current state every time —
 * there is nothing "foreign" on it to preserve. `mergeIncludeRules` still
 * leaves non-email rules (a domain restriction, a country requirement)
 * untouched, in case one was added by hand on top.
 */
export async function syncCloudflareAccess(): Promise<CfAccessSyncResult> {
  if (!cfAccessSyncConfigured) {
    return { configured: false, added: [], removed: [], unchangedCount: 0, created: false, policyName: null };
  }

  // adminEmails.size > 0 is part of cfAccessSyncConfigured — see env.ts.
  const name = policyNameFor([...adminEmails][0]!);
  const desired = await desiredEmails();

  const existing = await findAccessPolicyByName(name);
  if (!existing) {
    await createAccessPolicy({ name, include: desired.map((email) => ({ email: { email } })) });
    return { configured: true, added: desired, removed: [], unchangedCount: 0, created: true, policyName: name };
  }

  const { toAdd, toRemove } = computeAccessDiff(desired, emailsInRules(existing.include));
  if (toAdd.length === 0 && toRemove.length === 0) {
    return {
      configured: true,
      added: [],
      removed: [],
      unchangedCount: desired.length,
      created: false,
      policyName: name,
    };
  }

  const include = mergeIncludeRules(existing.include, toAdd, toRemove);
  await putAccessPolicy({ ...existing, include });
  return {
    configured: true,
    added: toAdd,
    removed: toRemove,
    unchangedCount: desired.length - toAdd.length,
    created: false,
    policyName: name,
  };
}
