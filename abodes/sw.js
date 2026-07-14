/* Service worker — caches the app shell so Abodes installs as a PWA and runs
 * offline. Bump CACHE_VERSION when shipped assets change so users pick up the
 * new build instead of an old cached copy.
 *
 * Strategy: cache-first for same-origin GETs, falling back to network. Any
 * future cross-origin leaderboard endpoints are skipped entirely. */
const CACHE_VERSION = "v15";
const CACHE = `abodes-${CACHE_VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./puzzles.js",
  "./puzzles-hard.js",
  "./identity.js",
  "./firebase-config.js",
  "./leaderboard.js",
  "./manifest.json",
  "./icon.svg",
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
