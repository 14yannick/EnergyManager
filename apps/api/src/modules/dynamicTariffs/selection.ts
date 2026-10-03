/**
 * Which sites a dynamic-rate sync covers.
 *
 * Two callers, two scopes. The timer names no site and takes every one that
 * is not paused. "Sync now" names its own and takes only that — a button on
 * one site must not write another's rates, least of all a paused one's — and
 * takes it even when paused, since it was asked for.
 */
export function sitesToSync<S extends { id: string; syncPaused: boolean }>(sites: S[], siteId?: string): S[] {
  return siteId ? sites.filter((s) => s.id === siteId) : sites.filter((s) => !s.syncPaused);
}
