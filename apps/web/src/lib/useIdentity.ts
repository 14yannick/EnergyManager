import { useQuery } from "@tanstack/react-query";
import type { AuthIdentity } from "@energy-manager/shared";
import { ApiError, SessionExpiredError, api } from "../api/client";

/**
 * Who the current user is, according to the API.
 *
 * Who you are doesn't change while the tab is open, so this is cached
 * indefinitely and never retried — a failure here must not spin in a loop
 * behind a login redirect. One shared query key means every caller reads the
 * same answer rather than each polling `/api/me` on its own.
 */
export function useIdentity() {
  return useQuery<AuthIdentity>({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Whether this user may change configuration.
 *
 * Undefined while the answer is still in flight, so a caller can tell "not
 * allowed" from "not known yet" and avoid flashing a permission notice at an
 * admin. Anything other than a confirmed admin is false, including an
 * identity that could not be read at all: the API denies these writes by
 * default, and an enabled button that 403s is worse than a disabled one.
 */
export function useCanEdit(): { canEdit: boolean; isKnown: boolean } {
  const { data, isLoading } = useIdentity();
  return { canEdit: data?.role === "admin", isKnown: !isLoading };
}

/**
 * Whether there is a Cloudflare session, and whether this app will serve it.
 *
 * `rejected` is the case that matters: Cloudflare authenticated somebody the
 * app has no role for, so every request 403s including `/api/me`. Reading
 * that only from `data` would leave exactly those users with no identity
 * shown and no way to sign out — they would be stuck on a broken app in an
 * account they can't leave.
 */
export type SessionState =
  | { kind: "loading" }
  /** No session to end: authentication is off, or the call never resolved. */
  | { kind: "none" }
  | { kind: "active"; identity: AuthIdentity }
  | { kind: "rejected"; email: string | null; status: number }
  /** Cloudflare turned `/api/me` away: the cookie is gone. Sign in again. */
  | { kind: "expired" };

export function useSession(): SessionState {
  const { data, error, isLoading } = useIdentity();

  if (isLoading) return { kind: "loading" };
  // Checked before anything else: this is the one failure that must not be
  // mistaken for "no session to speak of". It used to fall through to `none`,
  // and `none` means anonymous admin.
  if (error instanceof SessionExpiredError) return { kind: "expired" };
  // 401 is an absent or expired token, 403 an address with no role here.
  // Signing out and back in is the remedy for the first and a way to switch
  // accounts for the second, so both get the badge.
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: "rejected", email: error.email, status: error.status };
  }
  if (data?.email) return { kind: "active", identity: data };
  return { kind: "none" };
}
