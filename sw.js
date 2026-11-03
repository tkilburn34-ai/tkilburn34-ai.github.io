// Pen Click Morse — offline support.
//
// Updating the app: raise V (and VERSION) here AND the ?v= number in index.html,
// so every phone switches to the new files together.
const V = "?v=5";
const VERSION = "pcm-v5";
const SHELL = [
  "./", "index.html", "styles.css" + V, "decoder.js" + V, "app.js" + V, "click-worklet.js" + V,
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

// Online: always fetch fresh (the page itself skips the browser cache), and keep a copy.
// Offline: serve the saved copy.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = req.mode === "navigate"
        ? await fetch(url.href, { cache: "no-cache", credentials: "same-origin" })
        : await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) ||
        (await cache.match(req, { ignoreSearch: true })) ||
        (req.mode === "navigate" ? await cache.match("index.html") : Response.error());
    }
  })());
});
