
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('nonstop-cache-v1').then(cache => {
      return cache.addAll([
        './',
        './index.html',
        './icon-192.png',
        './icon.ico',
        './manifest.json'
      ]);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
