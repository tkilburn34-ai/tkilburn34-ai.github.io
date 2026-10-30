// Pen Click Morse — offline support.
// Bump VERSION whenever you change any app file so phones pick up the update.
const VERSION = "pcm-v2";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "decoder.js", "click-worklet.js",
  "manifest.webmanifest", "privacy.html", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "fonts/bricolage-grotesque-latin-700-normal.woff2", "fonts/instrument-sans-latin-400-normal.woff2",
  "fonts/instrument-sans-latin-500-normal.woff2", "fonts/instrument-sans-latin-600-normal.woff2",
  "fonts/chivo-mono-latin-400-normal.woff2", "fonts/chivo-mono-latin-600-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Serve from cache straight away, refresh in the background.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: url.origin === location.origin });
      const fresh = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
