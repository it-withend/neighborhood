// Service worker: keeps the app shell available offline.
// Forecast data is cached by app.js in localStorage, so API calls always go to the network.

const CACHE = "nafas-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "core.js",
  "i18n.js",
  "charts.js",
  "config.js",
  "icon.svg",
  "manifest.webmanifest",
  "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin files: network first (fresh after each deploy), cache as fallback.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
