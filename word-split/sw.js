/* Kill switch. Word Split was split into two standalone games (Combos and
 * Forks); this folder now only serves a redirect page. Browsers always check
 * the network for a new service-worker.js on navigation (bypassing whatever
 * fetch handler the currently-installed worker has), so this file replacing
 * the old cache-first shell worker is what lets already-installed PWA users
 * actually reach the redirect instead of an old cached copy of the game. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clientsList = await self.clients.matchAll({ type: "window" });
    for (const client of clientsList) client.navigate(client.url);
  })());
});
