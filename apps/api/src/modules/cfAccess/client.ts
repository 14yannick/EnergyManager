import { z } from "zod";
import { env } from "../../config/env.js";
import type { CfAccessRule } from "./engine.js";

/**
 * The Cloudflare API v4 client for reusable Access policies — thin I/O, no
 * business logic (that's engine.ts): finding one by name, creating it the
 * first time, updating it afterwards.
 *
 * Every response is wrapped in Cloudflare's own envelope
 * (`{ success, errors, result }`); this unwraps it and turns a failure into
 * a thrown error with whatever message Cloudflare gave.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

function requireConfig(): { accountId: string; token: string } {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    throw new Error("Cloudflare Access sync is not configured (CF_API_TOKEN/CF_ACCOUNT_ID).");
  }
  return { accountId: env.CF_ACCOUNT_ID, token: env.CF_API_TOKEN };
}

const errorSchema = z.object({ code: z.number().optional(), message: z.string() });

const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(errorSchema).default([]),
  // Passthrough: this app only ever inspects/changes `include`, and must not
  // drop fields it doesn't model (session_duration, mfa_config, ...) when it
  // PUTs a policy back.
  result: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]).nullable(),
  result_info: z
    .object({ page: z.number(), per_page: z.number(), total_pages: z.number() })
    .optional(),
});

/**
 * The full policy object as Cloudflare returns and expects it back. Only
 * `include` and `name` are ever inspected or set by this app; everything
 * else is round-tripped untouched on an update.
 */
export interface CfAccessPolicy {
  id: string;
  name: string;
  decision: string;
  include: CfAccessRule[];
  [key: string]: unknown;
}

// What the update/create endpoints accept — a strict subset of what GET
// returns. Read-only fields are dropped rather than sent back, since
// Cloudflare rejects unknown/read-only fields on some of its endpoints and
// there is no reason to test that here.
const READONLY_FIELDS = ["id", "account_id", "app_count", "created_at", "updated_at"] as const;

async function call(path: string, init: RequestInit): Promise<z.infer<typeof envelopeSchema>> {
  const { token } = requireConfig();
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = envelopeSchema.parse(await res.json());
  if (!res.ok || !body.success) {
    const message = body.errors[0]?.message ?? `Cloudflare API request failed: ${res.status}`;
    throw new Error(message);
  }
  return body;
}

/**
 * Every reusable Access policy on the account, across as many pages as it
 * takes. `per_page` is Cloudflare's own maximum, so a real account's policy
 * list — a handful, maybe a few dozen — fits in one request; the loop over
 * `total_pages` is only for correctness if that ever isn't true.
 */
export async function listAccessPolicies(): Promise<CfAccessPolicy[]> {
  const { accountId } = requireConfig();
  const policies: CfAccessPolicy[] = [];
  let page = 1;
  for (;;) {
    const body = await call(`/accounts/${accountId}/access/policies?per_page=1000&page=${page}`, {
      method: "GET",
    });
    if (Array.isArray(body.result)) policies.push(...(body.result as CfAccessPolicy[]));
    const totalPages = body.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return policies;
}

/** The one policy this app owns, if it has been created yet. */
export async function findAccessPolicyByName(name: string): Promise<CfAccessPolicy | null> {
  const policies = await listAccessPolicies();
  return policies.find((p) => p.name === name) ?? null;
}

export async function createAccessPolicy(input: { name: string; include: CfAccessRule[] }): Promise<CfAccessPolicy> {
  const { accountId } = requireConfig();
  const body = await call(`/accounts/${accountId}/access/policies`, {
    method: "POST",
    body: JSON.stringify({ name: input.name, decision: "allow", include: input.include }),
  });
  return body.result as CfAccessPolicy;
}

export async function putAccessPolicy(policy: CfAccessPolicy): Promise<void> {
  const { accountId } = requireConfig();
  const body: Record<string, unknown> = { ...policy };
  for (const field of READONLY_FIELDS) delete body[field];
  await call(`/accounts/${accountId}/access/policies/${policy.id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
