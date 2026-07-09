const CACHE = "lingua-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // never cache API calls
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(e.request);
      const fresh = fetch(e.request)
        .then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
