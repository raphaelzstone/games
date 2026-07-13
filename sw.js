/* Service worker for the Games hub — caches the little launcher shell so it
 * installs as a PWA and opens offline. Scoped to this folder only (the games
 * live in subfolders and register their own workers), so the three never
 * interfere. Bump CACHE_VERSION when the shell changes.
 *
 * Strategy: cache-first for same-scope GETs, falling back to network. Requests
 * for the game subfolders are left to the network / their own workers. */
const CACHE_VERSION = "v4";
const CACHE = `games-hub-${CACHE_VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon.svg",
  "./identity.js",
  "./firebase-config.js",
  "./hub-board.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== "GET") return;
  // Only serve the hub's own shell from cache; never intercept the games'
  // subfolders (they own their scope and their own caching).
  const scope = self.registration.scope;
  if (!e.request.url.startsWith(scope)) return;
  const rest = e.request.url.slice(scope.length);
  if (rest.startsWith("abodes/") || rest.startsWith("word-split/")) return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => hit))
  );
});
