// Firebase Messaging Service Worker
// Тоя файл ТРЯБВА да е в root-а на сайта и да се казва точно firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBvA1pJV6XPnIPa50f2JNzlh4Tn5LtJVAg",
  authDomain: "nonstopapp-c30b1.firebaseapp.com",
  projectId: "nonstopapp-c30b1",
  storageBucket: "nonstopapp-c30b1.firebasestorage.app",
  messagingSenderId: "368870682423",
  appId: "1:368870682423:web:placeholder"
});

const messaging = firebase.messaging();

// Background messages (когато приложението е затворено)
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Background message:', payload);
  const title = payload.notification?.title || '🏪 Нон Стоп';
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: true,
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

// Click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
