// Service worker para que Chrome deje instalar la página como app.
// Siempre va primero a internet (así nunca quedan versiones viejas); la copia guardada
// solo se usa si no hay conexión, para que al menos abra la pantalla.
const CACHE = "bingo-musical";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || Response.error())),
  );
});
