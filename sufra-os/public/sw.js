/* Sufra OS service worker: app shell offline, static assets cache-first. Data lives in IndexedDB / Supabase. */
const VERSION = "sufra-os-v1";
const SHELL = "/app/index.html";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([SHELL, "/app/manifest.webmanifest", "/app/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith("/app/")) return;
  // Pages: network first so updates show immediately; offline → cached shell.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(SHELL, copy)); return res; }).catch(() => caches.match(SHELL)));
    return;
  }
  // Hashed assets, icons, images: cache first.
  if (/\/app\/(assets|icons|img)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
  }
});
