/**
 * Cloudflare Access ends a session by clearing its cookie at this path. It is
 * handled at the edge, so it never reaches our nginx or the API — and for the
 * same reason it only exists when the app is actually being served through
 * Cloudflare.
 *
 * `returnTo` sends the browser back to this app rather than leaving the user
 * on Cloudflare's own logout page. It is read from `location.origin` instead
 * of being written down, so the same build works on whatever hostname it is
 * served from — a second domain, a staging tunnel, or a LAN port.
 */
export function logoutHref(): string {
  const returnTo = `${window.location.origin}/`;
  return `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(returnTo)}`;
}
