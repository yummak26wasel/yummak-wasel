/* واصل ليمَك — Service Worker
   الهدف: التطبيق يفتح فوراً من الكاش حتى بأضعف إنترنت أو بدون إنترنت،
   ويتحدّث بالخلفية، وإذا نزل تحديث جديد يبيّن شريط "فيه تحديث" للمستخدم.
   (طلبات البيانات Supabase/Firebase ما نلمسها — تتعامل وياها الصفحة بمهلة وإعادة محاولة) */
const VER = 'leemak-v58';
const SHELL = ['/sb-layer.js', '/auth-layer.js', '/manifest.json', '/792707e8.png'];
const CDN = /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|www\.gstatic\.com\/firebasejs)\//;
const API = /(supabase\.co|firestore|firebaseio|googleapis|openstreetmap\.org|project-osrm\.org|fcm\.googleapis)/;
const IMG = /\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i;
const OFFLINE_HTML = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>واصل ليمَك</title><body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;text-align:center;padding:24px;background:#fff">' +
  '<h2 style="color:#3F0A92;margin:0 0 8px">الإنترنت ضعيف</h2><p style="color:#777;margin:0 0 20px">ما كدرنا نفتح التطبيق أول مرة. تأكد من الاتصال وحاول مرة ثانية.</p>' +
  '<button onclick="location.reload()" style="background:#3F0A92;color:#fff;border:0;border-radius:16px;padding:14px 34px;font-size:17px;font-weight:700">إعادة المحاولة</button></body></html>';

/* Cloudflare يحوّل /index.html إلى / — الرد المحوّل ممنوع نرجعه لصفحة التنقل (يطلع ERR_FAILED)، فنعيد بناءه نظيف */
async function clean(r){
  if(!r || !r.redirected) return r;
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}

const _checked = new Map();   /* آخر فحص تحديث لكل صورة (بالذاكرة) */

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VER).then(c => Promise.all([
    fetch('/', { cache: 'reload' }).then(clean).then(r => { if (r && r.ok) return c.put('/index.html', r) }).catch(() => {}),
    ...SHELL.map(u =>
      fetch(u, { cache: 'reload' }).then(clean).then(r => { if (r && r.ok) return c.put(u, r) }).catch(() => {})
    )
  ])));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function notifyUpdate(){
  const cl = await self.clients.matchAll({ type: 'window' });
  cl.forEach(c => c.postMessage({ type: 'leemak-update' }));
}

/* يخزّن النسخة الجديدة، وإذا تغيّرت عن المخزنة يبلّغ الصفحة */
async function store(c, key, res, notify){
  try{
    const old = notify ? await c.match(key) : null;
    const a = old && (old.headers.get('etag') || old.headers.get('content-length'));
    const b = res.headers.get('etag') || res.headers.get('content-length');
    await c.put(key, res.clone());
    if(old && a && b && a !== b) notifyUpdate();
  }catch(e){}
}

function timeout(ms){ return new Promise(r => setTimeout(() => r(null), ms)) }

/* صفحة التطبيق: من الكاش فوراً، والتحديث بالخلفية */
async function shell(e){
  const c = await caches.open(VER);
  const cached = await c.match('/index.html');
  const net = fetch('/', { cache: 'no-cache' }).then(clean)
    .then(async r => { if(r.ok) await store(c, '/index.html', r, true); return r })
    .catch(() => null);
  if(cached){ e.waitUntil(net); return await clean(cached) }
  const r = await Promise.race([net, timeout(12000)]);
  return (r && r.ok) ? r : new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ملفات ثانية: من الكاش فوراً + تحديث بالخلفية */
async function swr(e, req){
  const c = await caches.open(VER);
  const cached = await c.match(req);
  const net = fetch(req, { cache: 'no-cache' }).then(clean)
    .then(async r => { if(r.ok) await store(c, req, r, false); return r })
    .catch(() => null);
  if(cached){ e.waitUntil(net); return await clean(cached) }
  const r = await Promise.race([net, timeout(15000)]);
  return r || Response.error();
}

/* صور وخطوط: الكاش أول، وتحديث بالخلفية كل 6 ساعات كحد أقصى */
async function img(e, req){
  const c = await caches.open(VER);
  const cached = await c.match(req);
  if(cached){
    const last = _checked.get(req.url) || 0;
    if(Date.now() - last > 6 * 3600 * 1000){
      _checked.set(req.url, Date.now());
      e.waitUntil(fetch(req, { cache: 'no-cache' }).then(r => { if(r.ok) return c.put(req, r) }).catch(() => {}));
    }
    return cached;
  }
  try{
    const r = await fetch(req);
    if(r.ok) c.put(req, r.clone());
    return r;
  }catch(err){ return Response.error() }
}

/* مكتبات CDN (Leaflet وغيرها): الكاش أول */
async function cdn(req){
  const c = await caches.open(VER);
  const cached = await c.match(req);
  if(cached) return cached;
  const r = await fetch(req);
  if(r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(API.test(url.href) && !CDN.test(url.href)) return;          /* بيانات حيّة — بدون كاش */
  if(CDN.test(url.href)){ e.respondWith(cdn(req)); return }
  if(url.origin !== location.origin) return;

  const p = url.pathname;
  const isShell = req.mode === 'navigate' && (p === '/' || p === '/index.html' || !/\.[a-z0-9]+$/i.test(p));
  if(isShell){ e.respondWith(shell(e)); return }
  if(p === '/firebase-messaging-sw.js') return;                  /* سيرفس ووركر الإشعارات لحاله */
  if(IMG.test(p)){ e.respondWith(img(e, req)); return }
  e.respondWith(swr(e, req));
});
