/* واصل ليمَك — Service Worker
   الهدف: التطبيق يفتح فوراً من الكاش حتى بأضعف إنترنت أو بدون إنترنت،
   ويتحدّث بالخلفية، وإذا نزل تحديث جديد يبيّن شريط "فيه تحديث" للمستخدم.
   (طلبات البيانات Supabase/Firebase ما نلمسها — تتعامل وياها الصفحة بمهلة وإعادة محاولة) */
const VER = 'leemak-v359';
const IMGC = 'leemak-img-v1';            /* صور المحلات/البنرات من Supabase — كاش منفصل ما ينمسح مع تحديث التطبيق */
const IMG_MAX = 200;
const LIBC = 'leemak-lib-v1';           /* مكتبات CDN والخطوط — كاش دائم ما ينمسح مع كل تحديث (حتى ما تنزل من جديد بالنت الضعيف) */
const FONT = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const PRE_IMG = ['/081cb4e0.png', '/792707e8.png'];   /* الشعار — ينحفظ بالكاش الدائم */
const SHELL = ['/supabase.js', '/sb-layer.js', '/auth-layer.js', '/manifest.json'];   /* v303: مكتبة Supabase صارت من موقعنا */
const SBIMG = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/.+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i;
const CDN = /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|www\.gstatic\.com\/firebasejs)\//;
const API = /(supabase\.co|firestore|firebaseio|googleapis|openstreetmap\.org|project-osrm\.org|fcm\.googleapis)/;
const IMG = /\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i;
/* v352: صفحة «جاري التحميل / الإنترنت ضعيف / ماكو إنترنت» بنفس شكل التطبيق (بدل الشاشة البيضة أو الدائرة الصغيرة).
   تطلع إذا التطبيق بعده ما محفوظ بالتلفون والنت بطيء — وتفتح التطبيق وحدها أول ما يخلص تحميله */
const LOAD_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><title>واصل ليمَك</title>
<style>html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#2b2240;text-align:center;padding:24px;box-sizing:border-box;overflow:hidden;
background:#fff}
.lg{font-size:30px;font-weight:900;letter-spacing:.3px;color:#F97402}.lg i{font-style:normal;color:#5B2BC9}
.sp{width:58px;height:58px;border-radius:50%;box-sizing:border-box;border:5px solid #E9E2F7;border-top-color:#F97402;border-right-color:#5B2BC9;animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
.off .sp{animation:none;border-color:#E9E2F7;filter:none}
.wf{display:none;width:58px;height:58px}.off .wf{display:block}.off .sp{display:none}
h2{margin:4px 0 0;font-size:19px;font-weight:800}
p{margin:0;font-size:14px;color:#5B5470;line-height:1.8;max-width:320px}
button{margin-top:4px;border:0;border-radius:16px;padding:13px 30px;background:#F97402;color:#fff;font:inherit;font-size:16px;font-weight:800;display:none;box-shadow:0 8px 20px rgba(249,116,2,.35)}</style></head><body>
<div class="lg">واصل <i>ليمَك</i></div>
<div class="sp"></div>
<svg class="wf" viewBox="0 0 24 24" fill="none" stroke="#5B2BC9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.6a10 10 0 0 1 4-2.4M19 12.6a10 10 0 0 0-2.5-1.8"/><path d="M2 8.8a15 15 0 0 1 4.5-2.8M22 8.8A15 15 0 0 0 11 5"/><circle cx="12" cy="19.6" r=".9" fill="#5B2BC9"/></svg>
<h2 id="t">جاري تحميل التطبيق…</h2>
<p id="s">لحظات — نحمّل آخر نسخة</p>
<button id="b" type="button" onclick="location.reload()">حاول هسه</button>
<script>(function(){var t0=Date.now(),T=document.getElementById('t'),S=document.getElementById('s'),B=document.getElementById('b');
function paint(){var off=navigator.onLine===false,s=(Date.now()-t0)/1000;document.body.classList.toggle('off',off);
if(off){T.textContent='ماكو اتصال بالإنترنت';S.textContent='شغّل الواي فاي أو بيانات الموبايل — التطبيق يفتح وحده أول ما يرجع النت';B.style.display='inline-block'}
else if(s>=8){T.textContent='الإنترنت ضعيف';S.textContent='نحمّل التطبيق… لا تسدّه، يفتح وحده أول ما يخلص';B.style.display=s>=25?'inline-block':'none'}
else{T.textContent='جاري تحميل التطبيق…';S.textContent='لحظات — نحمّل آخر نسخة';B.style.display='none'}}
function chk(){fetch('/__sw/ready',{cache:'no-store'}).then(function(r){if(r.status===200)location.reload()}).catch(function(){})}
setInterval(function(){paint();chk()},1500);addEventListener('online',function(){paint();chk()});addEventListener('offline',paint);paint();})();</script>
</body></html>`;

/* Cloudflare يحوّل /index.html إلى / — الرد المحوّل ممنوع نرجعه لصفحة التنقل (يطلع ERR_FAILED)، فنعيد بناءه نظيف */
async function clean(r){
  if(!r || !r.redirected) return r;
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}

const _checked = new Map();   /* آخر فحص تحديث لكل صورة (بالذاكرة) */

/* ينقل أي صور محفوظة بالكاشات القديمة للكاش الدائم (حتى ما تختفي الصور لما يتحدّث التطبيق) */
async function migrateImages(){
  try{
    const ic = await caches.open(IMGC);
    for(const k of await caches.keys()){
      if(k === IMGC || k.indexOf('leemak-v') !== 0) continue;
      const oc = await caches.open(k);
      for(const rq of await oc.keys()){
        if(IMG.test(new URL(rq.url).pathname) && !(await ic.match(rq.url))){
          const rs = await oc.match(rq); if(rs && rs.ok) await ic.put(rq.url, rs);
        }
      }
    }
  }catch(err){}
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(migrateImages().then(() => Promise.all([
    caches.open(IMGC).then(ic => Promise.all(PRE_IMG.map(u =>
      ic.match(u).then(h => h || fetch(u, { cache: 'reload' }).then(r => { if (r.ok) return ic.put(u, r) }))).map(p => p.catch(() => {})))),
    caches.open(VER).then(c => Promise.all([
    /* v352: إذا ما نزلت صفحة التطبيق كاملة، التثبيت يفشل والنسخة القديمة تبقى محفوظة وشغالة (قبل: تنمسح ويطلع تلفون بلا تطبيق) */
    fetch('/', { cache: 'reload' }).then(clean).then(r => { if (!(r && r.ok)) throw new Error('index'); return c.put('/index.html', r) }),
    ...SHELL.map(u =>
      fetch(u, { cache: 'reload' }).then(clean).then(r => { if (r && r.ok) return c.put(u, r) }).catch(() => {})
    )
  ]))])));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const has = await (await caches.open(VER)).match('/index.html');
    const ks = await caches.keys();
    /* v352: إذا النسخة الجديدة ما محفوظة بعد، نخلي القديمة احتياط */
    await Promise.all(ks.filter(k => k !== VER && k !== IMGC && k !== LIBC && (has || k.indexOf('leemak-v') !== 0)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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

/* صفحة التطبيق: من الكاش فوراً، والتحديث بالخلفية.
   v352: إذا ما محفوظة: ننتظر ثانيتين ونص بس، وبعدها نطلّع صفحة «جاري التحميل» بشكل التطبيق والتحميل يكمل بالخلفية */
let _idxP = null;
function fetchIndex(c){
  if(_idxP) return _idxP;
  _idxP = fetch('/', { cache: 'no-cache' }).then(clean)
    .then(async r => { if(r.ok) await store(c, '/index.html', r, true); return r })
    .catch(() => null)
    .then(r => { _idxP = null; return r });
  return _idxP;
}
async function oldIndex(){
  try{
    const ks = (await caches.keys()).filter(k => k.indexOf('leemak-v') === 0 && k !== VER).sort().reverse();
    for(const k of ks){ const r = await (await caches.open(k)).match('/index.html'); if(r) return r }
  }catch(e){}
  return null;
}
async function shell(e){
  const c = await caches.open(VER);
  const cached = (await c.match('/index.html')) || (await oldIndex());
  const net = fetchIndex(c);
  e.waitUntil(net);
  if(cached) return await clean(cached);
  const r = await Promise.race([net, timeout(2500)]);
  if(r && r.ok){ const m = await c.match('/index.html'); return m ? await clean(m) : r }
  return new Response(LOAD_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
  const c = await caches.open(IMGC);
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

/* صور Supabase (أسماء ملفاتها فيها وقت الرفع فما تتغير): الكاش أول، وإذا ما موجودة تنزل وتنحفظ.
   نطلبها بـCORS حتى ما تكون opaque (opaque تاكل مساحة كبيرة من الكاش) */
async function sbimg(req){
  const c = await caches.open(IMGC);
  const cached = await c.match(req.url);
  if(cached) return cached;
  let r = null;
  try{ r = await fetch(req.url, { mode: 'cors', credentials: 'omit' }) }catch(e){ r = null }
  if(r && r.ok){
    try{
      await c.put(req.url, r.clone());
      const ks = await c.keys();
      if(ks.length > IMG_MAX) await Promise.all(ks.slice(0, ks.length - IMG_MAX).map(k => c.delete(k)));
    }catch(e){}
    return r;
  }
  try{ return await fetch(req) }catch(e){ return Response.error() }   /* CORS فشل أو النت طايح: نجرّب الطلب العادي */
}

/* مكتبات CDN (Leaflet وغيرها): الكاش أول */
async function cdn(req){
  const c = await caches.open(LIBC);
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
  if(req.destination === 'image' && SBIMG.test(url.href)){ e.respondWith(sbimg(req)); return }
  if(FONT.test(url.href)){ e.respondWith(cdn(req).catch(() => fetch(req))); return }   /* الخطوط: من الكاش الدائم */
  if(API.test(url.href) && !CDN.test(url.href)) return;          /* بيانات حيّة — بدون كاش */
  if(CDN.test(url.href)){ e.respondWith(cdn(req)); return }
  if(url.origin !== location.origin) return;

  const p = url.pathname;
  if(/^\/_(otp|api|db)(\/|$)/.test(p)) return;   /* v354: ممرّات السيرفرات — بيانات حيّة، بدون كاش */
  if(p === '/__sw/ready'){   /* v352: صفحة التحميل تسأل: التطبيق انحفظ؟ */
    e.respondWith((async () => { const c = await caches.open(VER); const has = await c.match('/index.html');
      if(!has){ const n = fetchIndex(c); e.waitUntil(n) }
      return new Response(has ? '1' : '0', { status: has ? 200 : 202, headers: { 'Cache-Control': 'no-store' } }) })());
    return;
  }
  const isShell = req.mode === 'navigate' && (p === '/' || p === '/index.html' || !/\.[a-z0-9]+$/i.test(p));
  if(isShell){ e.respondWith(shell(e)); return }
  if(p === '/firebase-messaging-sw.js') return;                  /* سيرفس ووركر الإشعارات لحاله */
  if(IMG.test(p)){ e.respondWith(img(e, req)); return }
  e.respondWith(swr(e, req));
});
