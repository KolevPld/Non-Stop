const CACHE_NAME = "nonstop-cache-v4";

// Само статични asset-и се кешират — JS и HTML ВИНАГИ от мрежата
const STATIC_CACHE = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg"
];

// Тези файлове НИКОГА не се кешират — винаги network
const NEVER_CACHE = ["/main.js", "/index.html", "/style.css", "/"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(name => name !== CACHE_NAME && caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // Firebase, Cloudinary, CDN — не се кешират
  if (url.includes("firestore") || url.includes("firebase") ||
      url.includes("cloudinary") || url.includes("googleapis") ||
      url.includes("gstatic") || url.includes("cdnjs") ||
      url.includes("jsdelivr")) return;

  // JS, HTML, CSS — винаги от мрежата (за да се взима новия код)
  const pathname = new URL(url).pathname;
  if (NEVER_CACHE.some(p => pathname === p || pathname.startsWith(p + "?"))) return;

  // Всичко друго (икони, manifest) — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
