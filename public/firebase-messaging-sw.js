importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAhEpQQ42PYTeqjtGGyomPFfqZSJLU6Su4",
  authDomain: "yummak-wasel.firebaseapp.com",
  projectId: "yummak-wasel",
  messagingSenderId: "778244622694",
  appId: "1:778244622694:web:5b75284290bfcd854560a7"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const d = payload.data || {};
  const title = d.title || '\u0648\u0627\u0635\u0644 \u0644\u064A\u0645\u064E\u0643';
  const options = {
    body: d.body || '',
    icon: d.icon || undefined,
    badge: d.badge || undefined,
    tag: d.tag || undefined,
    data: { url: d.url || '/' },
    dir: 'rtl',
    lang: 'ar',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) { try { c.navigate(url); } catch (e) {} }
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
