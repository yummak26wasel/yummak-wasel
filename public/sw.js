/* ليمك واصل — Service Worker */
const CACHE='leemak-v11';
const SHELL=['./index.html','./manifest.json','./icon-192.png','./icon-512.png',
  './081cb4e0.png','./25313d72.png','./5113ea67.png','./58b7d902.png','./792707e8.png','./99b1bf2d.png','./cf3f8b3b.png','./e333ce8a.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(u.includes('firestore')||u.includes('googleapis')||u.includes('telegram')||
     u.includes('identitytoolkit')||u.includes('tile.openstreetmap')) return;
  // الخطوط: خزّنها حتى تفتح فوراً بالمرات الجاية
  if(u.includes('fonts.googleapis')||u.includes('fonts.gstatic')||u.includes('unpkg.com')){
    e.respondWith(caches.open(CACHE).then(c=>
      c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{c.put(e.request,r.clone());return r}))));
    return;
  }
  e.respondWith(caches.match(e.request)
    .then(hit=>hit||fetch(e.request).catch(()=>caches.match('./index.html'))));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list) if('focus' in c) return c.focus();
    if(clients.openWindow) return clients.openWindow('./index.html');
  }));
});
