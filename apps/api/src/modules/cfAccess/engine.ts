/**
 * Pure diff/merge logic for the Cloudflare Access email sync — no DB, no
 * network (same split as savings/engine.ts vs savings/service.ts).
 */

/**
 * What changed between who *should* be allowed in and who this app last
 * believed it had added.
 *
 * Both lists are treated as sets — order and duplicates don't matter — and
 * comparison is exact-string, so callers must already have lower-cased and
 * trimmed every address (see cfAccess/service.ts).
 */
export function computeAccessDiff(
  desired: readonly string[],
  previouslySynced: readonly string[],
): { toAdd: string[]; toRemove: string[] } {
  const want = new Set(desired);
  const had = new Set(previouslySynced);
  return {
    toAdd: [...want].filter((e) => !had.has(e)).sort(),
    toRemove: [...had].filter((e) => !want.has(e)).sort(),
  };
}

/** One rule of a Cloudflare Access policy's include/exclude/require array. */
export type CfAccessRule = Record<string, unknown>;

function ruleEmail(rule: CfAccessRule): string | undefined {
  const email = rule.email as { email?: unknown } | undefined;
  return typeof email?.email === "string" ? email.email.toLowerCase() : undefined;
}

/** Every address named by an email rule in the list — the other rule kinds contribute nothing. */
export function emailsInRules(rules: readonly CfAccessRule[]): string[] {
  return rules.map(ruleEmail).filter((e): e is string => e !== undefined);
}

/**
 * The name this app looks a policy up by (and creates it under, the first
 * time): "em_" plus the local part of an admin address, so
 * "14yannick@gmail.com" becomes "em_14yannick".
 *
 * Deterministic and requiring no id of its own to configure — the trade-off
 * is that changing that first admin address (AUTH_ADMIN_EMAILS) points the
 * app at a *different* policy name on the next sync, leaving the old one
 * behind under its previous name rather than renaming it. Acceptable here:
 * the admin address is not expected to change, and the alternative — a
 * random or config-supplied id — is exactly the CF_ACCESS_POLICY_ID setting
 * this was built to avoid.
 */
export function policyNameFor(adminEmail: string): string {
  const local = adminEmail.split("@")[0] ?? adminEmail;
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `em_${slug || "admin"}`;
}

/**
 * Applies an add/remove diff to a policy's current `include` rules.
 *
 * The one rule that matters: nothing is ever touched here that isn't an
 * email rule this call was explicitly told to add or remove. A domain rule,
 * an "everyone" rule, a group, a service token, or an email rule for an
 * address outside both lists — all pass through unchanged, in their
 * original position. That's what lets this run against a policy the app
 * doesn't own exclusively without ever taking away access it didn't grant.
 *
 * `toAdd` entries already present (by email, case-insensitively) are not
 * duplicated. Order: untouched rules keep their position; new rules are
 * appended at the end, sorted, so a diff of the raw JSON stays readable.
 */
export function mergeIncludeRules(
  currentInclude: readonly CfAccessRule[],
  toAdd: readonly string[],
  toRemove: readonly string[],
): CfAccessRule[] {
  const removeSet = new Set(toRemove);
  const kept = currentInclude.filter((rule) => {
    const email = ruleEmail(rule);
    return email === undefined || !removeSet.has(email);
  });
  const already = new Set(kept.map(ruleEmail).filter((e): e is string => e !== undefined));
  const additions = [...new Set(toAdd)]
    .filter((e) => !already.has(e))
    .sort()
    .map((email): CfAccessRule => ({ email: { email } }));
  return [...kept, ...additions];
}
