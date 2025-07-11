self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('nonstop-cache-v1').then(cache =>
      cache.addAll([
        '/',
        '/index.html',
        '/icon-192.png',
        '/manifest.json',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
      ])
    )
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});
