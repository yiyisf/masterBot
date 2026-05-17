// Service Worker — Phase 10 Web MVP
// 策略：网络优先（有网用网络，离线走缓存）
// 不缓存 API 请求，仅缓存静态资源

const CACHE_NAME = "cmaster-v1";
const STATIC_ASSETS = [
  "/",
  "/chat/",
  "/skills/",
  "/history/",
  "/settings/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip API, SSE, and non-GET requests
  if (
    request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws")
  ) {
    return;
  }

  // Network-first for HTML navigation, cache-first for assets
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => {
          if (cached) return cached;
          // Offline fallback
          return new Response(
            `<!DOCTYPE html><html><body><p>网络不可用，请检查连接后重试。</p></body></html>`,
            { headers: { "Content-Type": "text/html;charset=utf-8" } },
          );
        })),
    );
  } else {
    // Cache-first for static assets (JS, CSS, fonts, images)
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        });
      }),
    );
  }
});
