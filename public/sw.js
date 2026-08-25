/* واصل ليمَك — Service Worker */
const CACHE='leemak-v25';
const SHELL=['./index.html','./manifest.json','./icon-192.png','./icon-512.png',
  './081cb4e0.png','./25313d72.png','./5113ea67.png','./792707e8.png','./99b1bf2d.png','./cf3f8b3b.png','./e333ce8a.png'];

/* ═══ إشعارات Firebase — تشتغل والهاتف مسكّر ═══ */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:"AIzaSyAhEpQQ42PYTeqjtGGyomPFfqZSJLU6Su4",
  authDomain:"yummak-wasel.firebaseapp.com",
  projectId:"yummak-wasel",
  storageBucket:"yummak-wasel.firebasestorage.app",
  messagingSenderId:"778244622694",
  appId:"1:778244622694:web:5b75284290bfcd854560a7"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const d = payload.data || {};
  const n = payload.notification || {};
  const title = n.title || d.title || 'واصل ليمَك';
  self.registration.showNotification(title,{
    body: n.body || d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [300,120,300,120,300],
    tag: 'lw-'+Date.now(),
    dir: 'rtl',
    lang: 'ar',
    requireInteraction: true,
    data: d
  });
});

self.addEventListener('notificationclick', e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){ if('focus' in c) return c.focus() }
    if(clients.openWindow) return clients.openWindow('./');
  }));
});

/* ═══ الكاش ═══ */
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(e.request.method!=='GET') return;
  if(u.includes('firestore')||u.includes('googleapis')||u.includes('gstatic')) return;
  e.respondWith(
    fetch(e.request).then(r=>{
      const cp=r.clone();
      caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
      return r;
    }).catch(()=>caches.match(e.request))
  );
});
