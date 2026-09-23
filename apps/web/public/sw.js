// Present only so the browser considers the app installable — Chrome
// requires an active service worker with a fetch handler before it will
// offer "Install app" instead of a plain "Add to Home screen" shortcut.
//
// Deliberately does no caching. index.html is served `no-store` (see
// nginx.conf.template) so a signed-out browser can never boot a stale shell
// past Cloudflare Access's login; a worker that cached responses would
// reopen exactly that hole from inside the browser instead. Every request
// just goes to the network as if this file did not exist.
self.addEventListener("fetch", () => {});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
