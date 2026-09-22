import { describe, expect, it } from "vitest";
import { computeAccessDiff, emailsInRules, mergeIncludeRules, policyNameFor, type CfAccessRule } from "./engine.js";

describe("computeAccessDiff", () => {
  it("adds what's newly wanted and removes what's no longer wanted", () => {
    const { toAdd, toRemove } = computeAccessDiff(
      ["a@x.com", "b@x.com"],
      ["b@x.com", "c@x.com"],
    );
    expect(toAdd).toEqual(["a@x.com"]);
    expect(toRemove).toEqual(["c@x.com"]);
  });

  it("is empty when the two already match, whatever order they arrive in", () => {
    const { toAdd, toRemove } = computeAccessDiff(["b@x.com", "a@x.com"], ["a@x.com", "b@x.com"]);
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("treats both lists as sets — a duplicate desired entry adds once", () => {
    const { toAdd } = computeAccessDiff(["a@x.com", "a@x.com"], []);
    expect(toAdd).toEqual(["a@x.com"]);
  });

  it("removes everything when nothing is desired any more", () => {
    const { toAdd, toRemove } = computeAccessDiff([], ["a@x.com", "b@x.com"]);
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("mergeIncludeRules", () => {
  const emailRule = (e: string): CfAccessRule => ({ email: { email: e } });

  it("appends a new email rule without touching what was already there", () => {
    const current: CfAccessRule[] = [emailRule("keep@x.com")];
    const merged = mergeIncludeRules(current, ["new@x.com"], []);
    expect(merged).toEqual([emailRule("keep@x.com"), emailRule("new@x.com")]);
  });

  it("removes only the email rules named, leaving everything else exactly as it was", () => {
    const domainRule: CfAccessRule = { email_domain: { domain: "example.com" } };
    const everyone: CfAccessRule = { everyone: {} };
    const current: CfAccessRule[] = [domainRule, emailRule("gone@x.com"), everyone, emailRule("stay@x.com")];
    const merged = mergeIncludeRules(current, [], ["gone@x.com"]);
    expect(merged).toEqual([domainRule, everyone, emailRule("stay@x.com")]);
  });

  it("never removes an email rule that wasn't named, even if it looks like ours", () => {
    // The whole safety property: an address manually added in the Cloudflare
    // dashboard, or by something else entirely, must survive a sync this app
    // runs for its own parties — it was never in `toRemove` because this
    // app's own bookkeeping never claimed to have added it.
    const current: CfAccessRule[] = [emailRule("manually-added@x.com")];
    const merged = mergeIncludeRules(current, [], ["someone-else@x.com"]);
    expect(merged).toEqual(current);
  });

  it("does not duplicate an addition that's already present, case-insensitively", () => {
    const current: CfAccessRule[] = [emailRule("Already@X.com")];
    const merged = mergeIncludeRules(current, ["already@x.com"], []);
    expect(merged).toEqual(current);
  });

  it("adds and removes in the same call without interference", () => {
    const current: CfAccessRule[] = [emailRule("old@x.com")];
    const merged = mergeIncludeRules(current, ["new@x.com"], ["old@x.com"]);
    expect(merged).toEqual([emailRule("new@x.com")]);
  });

  it("is a no-op, byte for byte, when there is nothing to add or remove", () => {
    const domainRule: CfAccessRule = { email_domain: { domain: "example.com" } };
    const current: CfAccessRule[] = [domainRule, emailRule("stay@x.com")];
    expect(mergeIncludeRules(current, [], [])).toEqual(current);
  });
});

describe("emailsInRules", () => {
  const emailRule = (e: string): CfAccessRule => ({ email: { email: e } });

  it("finds every email rule and ignores every other rule kind", () => {
    const rules: CfAccessRule[] = [
      { email_domain: { domain: "example.com" } },
      emailRule("A@x.com"),
      { everyone: {} },
      emailRule("b@x.com"),
    ];
    expect(emailsInRules(rules)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("is empty for a policy with no email rules at all", () => {
    expect(emailsInRules([{ everyone: {} }])).toEqual([]);
  });
});

describe("policyNameFor", () => {
  it("matches the example given: an admin's Gmail address becomes em_<localpart>", () => {
    expect(policyNameFor("14yannick@gmail.com")).toBe("em_14yannick");
  });

  it("lower-cases and collapses anything that isn't alphanumeric", () => {
    expect(policyNameFor("Yannick.Weber+admin@Example.COM")).toBe("em_yannick_weber_admin");
  });

  it("is deterministic — the same address always names the same policy", () => {
    expect(policyNameFor("a@x.com")).toBe(policyNameFor("a@x.com"));
  });

  it("never produces an empty name, even for a pathological local part", () => {
    expect(policyNameFor("...@x.com")).toBe("em_admin");
  });
});
