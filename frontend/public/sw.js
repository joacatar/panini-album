const CACHE = "panini-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(request) {
  if (request.mode === "navigate") return true;
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname.endsWith(".html")) return true;
  if (url.pathname.startsWith("/src/")) return true;
  return false;
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  if (isAppShellRequest(e.request)) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((response) => {
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || network;
    })
  );
});
