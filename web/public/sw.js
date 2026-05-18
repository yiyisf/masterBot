// Service Worker — Phase 10 Web MVP
// 策略：网络优先 + 离线回退
// 不缓存 API 请求；静态资源由 Next.js 内容哈希文件名保证新鲜度。
//
// CACHE_NAME 格式：cmaster-v<major>-<yyyymmdd>
// 每次正式部署时需同步更新此版本号，触发旧缓存清理。

const CACHE_NAME = "cmaster-v1-20260517";
const OFFLINE_SHELL = [
  "/",
  "/chat/",
  "/skills/",
  "/history/",
  "/settings/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_SHELL)),
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

  // Skip API, WebSocket, and non-GET requests — let them go directly to network.
  if (
    request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws")
  ) {
    return;
  }

  // Network-first for everything: fresh response preferred, cache as offline fallback.
  // Next.js content-hashed filenames (_next/static/...) provide cache-busting naturally,
  // so cache-first would risk serving stale assets after deployment.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") {
            return new Response(
              `<!DOCTYPE html><html><body><p>网络不可用，请检查连接后重试。</p></body></html>`,
              { headers: { "Content-Type": "text/html;charset=utf-8" } },
            );
          }
          return new Response("", { status: 503 });
        }),
      ),
  );
});
