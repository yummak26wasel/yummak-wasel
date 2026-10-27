/* ═══════════════════════════════════════════════════════════
   طبقة الترجمة — Firestore ⇄ Supabase
   واصل ليمَك · v8  (سياسة اتصال مثل التطبيقات العالمية + طريق احتياطي)
   ═══════════════════════════════════════════════════════════ */

const SB_URL = "https://obvxqyfmcmldruauhsgw.supabase.co";
const SB_KEY = "sb_publishable_HJxHDApXLZVPVQ1p8wqq6w_ELPotqfq";

/* ═══ v8: طريقين للقاعدة ═══
   عادةً التطبيق يحچي ويا القاعدة مباشرة (أسرع وما يكلّف شي).
   إذا الطريق المباشر انسد (شبكة حاجبة أو ما يرد) يحوّل تلقائياً على الجسر (leemak-db)
   ويبقى عليه 10 دقايق، وبعدها يرجع يجرّب المباشر.
   القراءة تنعاد تلقائياً على الطريق الثاني. الكتابة (طلب، دفع...) ما تنعاد أبداً حتى ما تتكرر.
   حتى تطفي الجسر: خلّي SB_BRIDGE = "" */
const SB_BRIDGE = "https://leemak-db.dhifvmy.workers.dev";
(function(){
  if(typeof window === 'undefined' || typeof window.fetch !== 'function' || !SB_BRIDGE) return;
  const D = SB_URL, B = SB_BRIDGE.replace(/\/+$/, ''), K = 'lw_sb_road';
  const _f = window.fetch.bind(window);
  let road = 'D', until = 0;
  try{ const s = JSON.parse(localStorage.getItem(K) || 'null'); if(s && s.until > Date.now() && (s.road === 'B' || s.road === 'D')){ road = s.road; until = s.until } }catch(e){}
  const cur = () => Date.now() < until ? road : 'D';
  const flip = to => { road = to; until = Date.now() + 10 * 60000; try{ localStorage.setItem(K, JSON.stringify({ road, until })) }catch(e){} };
  /* رد الجسر يُعتبر فاشل إذا خطأ من Cloudflare (الجسر ما گدر يوصل). وإذا الجسر مو مرفوع أو خلص حدّه
     يرد بدون إذن CORS، فالمتصفح يرفضه لوحده ويصير فشل */
  const bad = (w, r) => w === 'B' && (r.status === 502 || r.status === 503 || r.status === 504 || (r.status >= 520 && r.status <= 530));
  window.__sbRoad = () => cur();
  window.fetch = function(input, init){
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : null);
    if(!url || url.indexOf(D + '/') !== 0) return _f(input, init);
    init = init || {};
    const m = String(init.method || 'GET').toUpperCase();
    const path = url.slice(D.length);
    const safe = m === 'GET' || m === 'HEAD' || /^\/auth\/v1\/token\?/.test(path);
    const first = cur(), second = first === 'D' ? 'B' : 'D';
    const go = (w, limit) => new Promise((ok, no) => {
      const sig = init.signal;
      if(sig && sig.aborted) return no(sig.reason || new DOMException('Aborted', 'AbortError'));
      const ac = new AbortController(); let t = null;
      const onA = () => ac.abort(sig.reason);
      if(sig) sig.addEventListener('abort', onA, { once: true });
      if(limit) t = setTimeout(() => ac.abort(new Error('slow')), limit);
      _f((w === 'B' ? B : D) + path, Object.assign({}, init, { signal: ac.signal }))
        .then(r => { if(bad(w, r)) throw new Error('bridge ' + r.status); ok(r) })
        .catch(no)
        .finally(() => { clearTimeout(t); if(sig) sig.removeEventListener('abort', onA) });
    });
    return go(first, safe ? 12000 : 0).catch(e => {
      if(init.signal && init.signal.aborted) throw e;   /* اللي طلب استسلم بنفسه */
      flip(second);                                     /* الطلبات الجاية من الطريق الثاني */
      if(!safe) throw e;                                /* الكتابة: ما نعيدها تلقائياً */
      return go(second, 0);
    });
  };
  /* الصور: إذا صورة من القاعدة ما نزلت، نجيبها من الجسر */
  if(typeof document !== 'undefined') document.addEventListener('error', ev => {
    const t = ev.target; if(!t || t.tagName !== 'IMG' || t.dataset.sbB) return;
    const s = t.currentSrc || t.src || '', P = D + '/storage/v1/object/public/';
    if(s.indexOf(P) !== 0) return;
    t.dataset.sbB = '1'; t.src = B + s.slice(D.length);
  }, true);
})();

/* ═══════════ Realtime ═══════════
   القاعدة تدز التغييرات فوراً بدل ما التطبيق يسأل.
   الاستطلاع يظل شغّال كشبكة أمان بفاصل بطيء.
   ═══════════════════════════════ */
let _rt = null;                 /* عميل supabase */
let _rtOk = false;              /* هل الاتصال الحي شغّال؟ */
const _rtTblOk = {};            /* حالة الاتصال الحي لكل جدول لحاله */
let _rtTok = null;              /* آخر توكن انعطى لقناة Realtime */
const _tblWake = new Map();     /* جدول → دوال إعادة التحميل (لتحديث فوري بعد كتابتنا) */
function _tblAdd(tbl, fn){ if(!_tblWake.has(tbl)) _tblWake.set(tbl, new Set()); _tblWake.get(tbl).add(fn) }
function _tblDel(tbl, fn){ const s=_tblWake.get(tbl); if(s) s.delete(fn) }
function _kick(tbl){
  const run = t => { const s=_tblWake.get(t); if(s) s.forEach(f=>{ try{ f() }catch(e){} }) };
  run(tbl);
  if(tbl === 'orders') run('orders_available');
}
/* القناة الحية تحتاج توكن المستخدم، وإلا RLS ما يخلّي تتوصلها تغييرات الطلبات */
function _rtAuth(){
  if(!_rt) return;
  const t = _token();
  if(t && t !== _rtTok){ _rtTok = t; try{ _rt.realtime.setAuth(t) }catch(e){} }
}
const _rtSubs = new Map();      /* جدول → مجموعة دوال إعادة التحميل */

function _rtInit(){
  if(_rt || typeof supabase === 'undefined' || !supabase.createClient) return;
  try{
    _rt = supabase.createClient(SB_URL, SB_KEY, {
      auth:{ persistSession:false, autoRefreshToken:false },
      realtime:{ params:{ eventsPerSecond: 5 } }
    });
    _rtAuth();
    setInterval(_rtAuth, 45000);
  }catch(e){ _rt=null }
}

/* ═══ سياسة الاتصال (v7) — مثل التطبيقات العالمية:
   التطبيق يحدد (window.__sbPolicy) منو يفتح خط مباشر ولأي جدول، وكل شكد يسأل.
   الزبون اللي يتصفح بس: ماكو خط مباشر. اللي عنده طلب شغّال: خط مباشر لحد ما يستلم. ═══ */
function _pol(){ try{ return (typeof window!=='undefined' && window.__sbPolicy) || null }catch(e){ return null } }
function _rtAllowed(tbl){ const p=_pol(); if(!p || typeof p.rt!=='function') return true; try{ return !!p.rt(tbl) }catch(e){ return true } }
const _rtCh = new Map();        /* جدول → القناة (حتى نسكّرها لما ما يحتاجها أحد) */

/* يشترك بجدول ويرجّع دالة إلغاء */
function _rtWatch(tbl, fn){
  _rtInit();
  if(!_rt) return null;

  _rtAuth();
  if(!_rtSubs.has(tbl)){
    const set = new Set();
    _rtSubs.set(tbl, set);
    try{
      const ch = _rt.channel('w_'+tbl)
        .on('postgres_changes', {event:'*', schema:'public', table:tbl}, ()=>{
          set.forEach(f=>{ try{ f() }catch(e){} });
        })
        .subscribe(st=>{
          if(st==='SUBSCRIBED'){ _rtOk=true; _rtTblOk[tbl]=true }
          else if(st==='CHANNEL_ERROR' || st==='TIMED_OUT' || st==='CLOSED'){ _rtTblOk[tbl]=false }
        });
      _rtCh.set(tbl, ch);
    }catch(e){ _rtSubs.delete(tbl); return null }
  }
  const set=_rtSubs.get(tbl);
  set.add(fn);
  return ()=>{
    set.delete(fn);
    /* ماكو أحد يحتاج هالجدول: نسكّر القناة (وإذا ما بقت قنوات ينقطع الاتصال كله) */
    if(!set.size){
      const ch=_rtCh.get(tbl); _rtCh.delete(tbl); _rtSubs.delete(tbl); _rtTblOk[tbl]=false;
      try{ if(ch && _rt) _rt.removeChannel(ch) }catch(e){}
    }
  };
}

/* ═══ فواصل الاستطلاع حسب أهمية البيانات ═══ */
const _POLL = {
  orders:         3000,   /* الطلبات — حرجة، كل 3 ثواني */
  orders_available: 3000, /* الطلبات المتاحة للسائق — عرض بلا بيانات الزبون */
  special_orders: 4000,   /* طلبات السوق */
  notifications:  8000,   /* الإشعارات */
  tickets:       10000,   /* الدعم */
  shops:         20000,   /* المحلات — تتغيّر نادراً */
  profiles:      20000,
  settings:      60000,   /* الإعدادات — مرة بالدقيقة يكفي */
  push_tokens:   60000,
  banners:       60000,
  discounts:     60000,
  fare_zone:    120000,
  service_fee_tiers: 120000,
  _default:      10000
};
const _RT_TABLES = ['orders','orders_available','special_orders','shops','notifications'];
function _every(tbl){
  const p=_pol();
  if(p && typeof p.poll==='function'){ try{ const v=Number(p.poll(tbl)); if(v>0) return v }catch(e){} }
  /* الجداول اللي عليها Realtime — استطلاع بطيء كشبكة أمان بس */
  if(_rtTblOk[tbl] && _RT_TABLES.indexOf(tbl) > -1){
    /* الطلبات حرجة: حتى لو الاتصال الحي شغّال نبقي شبكة أمان كل 10 ثواني (مو 30) */
    return (tbl==='orders' || tbl==='orders_available' || tbl==='special_orders') ? 10000 : 30000;
  }
  return _POLL[tbl] || _POLL._default;
}


/* ═══ حماية القاعدة من الضغط ═══
   1) إذا القاعدة ما ترد: كل موبايل يبطّئ أسئلته (3ث ← 6 ← 12 ← 20 ثانية كحد أقصى) بدل ما يضربها كل 3 ثواني
   2) فرق عشوائي صغير بالتوقيت حتى ما تسأل كل الموبايلات بنفس اللحظة
   3) التحديث الفوري: إذا جت تغييرات ورا بعض نجمعها بسؤال واحد بدل سؤال لكل تغيير */
function _gapFor(tbl, fails){
  let g = _every(tbl);
  if(fails > 0) g = Math.min(20000, g * Math.pow(2, Math.min(fails, 3)));
  const j = g >= 30000 ? (0.6 + Math.random() * 0.8) : (0.85 + Math.random() * 0.3);
  return Math.round(g * j);
}
function _wakeFn(isDead, getT, setT, tick){
  let pend = null;
  return () => {
    if(isDead() || pend) return;
    pend = setTimeout(() => { pend = null; if(isDead()) return; clearTimeout(getT()); tick() }, 250 + Math.floor(Math.random() * 500));
  };
}
/* ═══ إيقاف الاستطلاع لمن التطبيق بالخلفية ═══ */
let _hidden = false;
if(typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', ()=>{
    _hidden = document.hidden;
    if(!_hidden) _wake.forEach(f=>{ try{ f() }catch(e){} });
  });
}
const _wake = new Set();

/* ═══ التوكن — يُقرأ عند كل طلب ═══ */
let _badTok = null;   /* توكن منتهي ما نقدر نجدده — نتجاهله لين يتبدل بتوكن جديد */
function _token(){
  let t = null;
  if(typeof window !== 'undefined' && typeof window.__waselToken === 'function'){
    t = window.__waselToken() || null;
  }
  if(!t){
    try{
      const s = JSON.parse(localStorage.getItem('wasel_session'));
      t = (s && s.token) || null;
    }catch(e){ t = null }
  }
  return (t && t === _badTok) ? null : t;
}

function _hdr(extra){
  const t = _token();
  const h = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + (t || SB_KEY),
    'Content-Type': 'application/json'
  };
  if(extra) for(const k in extra) h[k] = extra[k];
  return h;
}

/* ═══ هل القيمة فارغة؟ ═══ */
function _empty(v){
  return v === null || v === undefined || v === '' ||
         v === 'null' || v === 'undefined';
}

/* ── خريطة الأسماء ── */
const _TBL = {
  users:          'profiles',
  shops:          'shops',
  orders:         'orders',
  specialOrders:  'special_orders',
  settings:       'settings',
  tickets:        'tickets',
  notifications:  'notifications'
};

/* ── خريطة الحقول ── */
const _FLD = {
  users: {
    name:'name', phone:'phone', role:'role', addr:'address',
    approved:'is_approved', blocked:'is_blocked', photo:'photo_url',
    shopId:'shop_id', vehicle:'vehicle', duty:'is_on_duty',
    oldestUnpaidAt:'oldest_unpaid_at', gender:'gender'
  },
  shops: {
    ownerUid:'owner_id', name:'name', type:'type',
    approved:'is_approved', img:'image_url', open:'is_open',
    phone:'phone', addr:'address', hours:'hours', tgChat:'tg_chat'
  },
  orders: {
    customerUid:'customer_id', shopOwnerUid:'shop_owner_id', shopId:'shop_id',
    shopName:'shop_name', sub:'items_total', serviceFee:'service_fee',
    deliveryFee:'delivery_fee', total:'total', status:'status',
    driverUid:'driver_id', driverName:'driver_name', driverPhone:'driver_phone',
    commission:'commission', commissionPaid:'commission_paid',
    addr:'address', phone:'phone', note:'note', items:'items'
  }
};

/* الأعمدة اللي نوعها UUID — الفارغ فيها لازم يصير null حقيقي */
const _UUID = [
  'id','shop_id','owner_id','customer_id','driver_id',
  'shop_owner_id','order_id','product_id'
];

function _out(coll, data){
  const m = _FLD[coll] || {};
  const o = {};
  for(const k in data){
    const col = m[k] || k;
    let v = data[k];
    if(_UUID.indexOf(col) > -1 && _empty(v)) v = null;
    o[col] = v;
  }
  return o;
}

function _in(coll, row){
  const m = _FLD[coll]; if(!m || !row) return row;
  const rev = {}; for(const k in m) rev[m[k]] = k;
  const o = {};
  for(const k in row){ o[ rev[k] || k ] = row[k] }
  return o;
}

/* ── نداء REST — يعيد المحاولة مرة وحدة لو الجلسة منتهية أو
   التوكن قديم/غير صالح (تجديد صريح عبر window.__waselRefresh) ── */
async function _req(path, opt = {}, _retried){
  const o = { ...opt };
  const extra = o.headers; delete o.headers;
  /* مهلة + إعادة محاولة للقراءة فقط (الإنترنت الضعيف). الكتابة: مهلة أطول بدون إعادة تلقائية */
  const _isGet = !o.method || String(o.method).toUpperCase()==='GET';
  const _tries = _isGet ? 2 : 1, _tmo = _isGet ? 20000 : 45000;
  let r, _lastErr;
  for(let _i=0; _i<_tries; _i++){
    const _ac = new AbortController(); const _t = setTimeout(()=>_ac.abort(), _tmo);
    try{
      r = await fetch(SB_URL + '/rest/v1/' + path, { ...o, headers: _hdr(extra), signal: _ac.signal });
      clearTimeout(_t);
      if(r.status >= 500 && _i < _tries-1){ r = null; await new Promise(z=>setTimeout(z, 1200)); continue }
      break;
    }catch(e){
      clearTimeout(_t); r = null;
      _lastErr = (e && e.name==='AbortError') ? new Error('الاتصال ضعيف — انتهت المهلة') : e;
      if(_i < _tries-1) await new Promise(z=>setTimeout(z, 1200));
    }
  }
  if(!r) throw _lastErr || new Error('ماكو اتصال');
  if(!r.ok){
    const bodyTxt = await r.text();
    if(!_retried && /JWT expired|PGRST30[0-9]|row-level security/.test(bodyTxt) &&
       typeof window !== 'undefined' && typeof window.__waselRefresh === 'function'){
      const _old = _token();
      const fresh = await window.__waselRefresh();
      if(fresh) return _req(path, opt, true);
      /* التجديد فشل والتوكن منتهي فعلاً: نتجاهله ونعيد المحاولة بالمفتاح العام (شاشة الدخول تشتغل) */
      if(_old && /JWT expired|PGRST30[0-9]/.test(bodyTxt)){ _badTok = _old; return _req(path, opt, true) }
    }
    throw new Error(bodyTxt);
  }
  const t = await r.text();
  const res = t ? JSON.parse(t) : null;
  try{
    const m = String(opt.method || 'GET').toUpperCase();
    if(m !== 'GET' && m !== 'HEAD'){
      const tb = String(path).split('?')[0];
      if(tb.indexOf('rpc/') !== 0) setTimeout(()=>_kick(tb), 120);
    }
  }catch(e){}
  return res;
}

/* ── وثيقة واحدة ── */
let _doc = function(coll, id){
  const tbl = _TBL[coll] || coll;
  const key = (coll === 'settings') ? 'key' : 'id';

  return {
    id,

    async get(){
      if(_empty(id)) return { exists:false, id, data: () => undefined };
      const rows = await _req(`${tbl}?select=*&${key}=eq.${encodeURIComponent(id)}`);
      const row = rows && rows[0];
      return {
        exists: !!row,
        id,
        data: () => row ? _in(coll, row) : undefined
      };
    },

    async set(data, opt){
      if(_empty(id)) throw new Error('معرّف ناقص');
      const body = { ..._out(coll, data), [key]: id };
      await _req(tbl, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(body)
      });
    },

    async update(data){
      if(_empty(id)) throw new Error('معرّف ناقص');
      await _req(`${tbl}?${key}=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(_out(coll, data))
      });
    },

    async delete(){
      if(_empty(id)) return;
      await _req(`${tbl}?${key}=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    onSnapshot(cb, err){
      let dead = false, last = '', timer = null, fails = 0, busy = false;
      const gap = () => _gapFor(tbl, fails);
      const tick = async () => {
        if(dead || busy) return;
        if(_hidden){ timer = setTimeout(tick, gap()); return }   /* بالخلفية — ما نسأل */
        busy = true;
        try{
          const snap = await _doc(coll, id).get();
          fails = 0;
          const sig = JSON.stringify(snap.data() || null);
          if(sig !== last){ last = sig; cb(snap) }
        }catch(e){ fails++; if(err) err(e) }
        busy = false;
        if(!dead){ try{ rtFix() }catch(e){} clearTimeout(timer); timer = setTimeout(tick, gap()) }
      };
      const wake = _wakeFn(() => dead, () => timer, t => { timer = t }, tick);
      _wake.add(wake); _tblAdd(tbl, wake);
      let unRt = _rtAllowed(tbl) ? _rtWatch(tbl, wake) : null;      /* تحديث فوري من القاعدة — حسب السياسة */
      const rtFix = () => { const ok=_rtAllowed(tbl); if(ok && !unRt) unRt=_rtWatch(tbl, wake); else if(!ok && unRt){ unRt(); unRt=null } };
      tick();
      return () => {
        dead = true; clearTimeout(timer); _wake.delete(wake); _tblDel(tbl, wake);
        if(unRt) unRt();
      };
    }
  };
}

/* ── استعلام ── */
function _query(coll, filters = [], order = null, lim = null){
  const tbl = _TBL[coll] || coll;

  const build = () => {
    let q = 'select=*';
    for(const f of filters) q += '&' + f;
    if(order) q += '&order=' + order;
    if(lim)   q += '&limit=' + lim;
    return `${tbl}?${q}`;
  };

  const api = {
    where(field, op, val){
      const m = _FLD[coll] || {};
      const col = m[field] || field;
      const OPS = { '==':'eq', '!=':'neq', '>':'gt', '>=':'gte', '<':'lt', '<=':'lte', 'in':'in' };
      const o = OPS[op] || 'eq';

      /* القيمة الفارغة ← is.null بدل eq.null */
      if(_empty(val) && o !== 'in'){
        const f = (o === 'neq') ? `${col}=not.is.null` : `${col}=is.null`;
        return _query(coll, [...filters, f], order, lim);
      }

      const v = (o === 'in') ? '(' + val.join(',') + ')' : encodeURIComponent(val);
      return _query(coll, [...filters, `${col}=${o}.${v}`], order, lim);
    },

    orderBy(field, dir){
      const m = _FLD[coll] || {};
      const col = m[field] || field;
      return _query(coll, filters, col + '.' + (dir === 'desc' ? 'desc' : 'asc'), lim);
    },

    limit(n){ return _query(coll, filters, order, n) },

    async get(){
      const rows = (await _req(build())) || [];
      const docs = rows.map(r => ({
        id: r.id,
        exists: true,
        data: () => _in(coll, r)
      }));
      return { empty: !docs.length, size: docs.length, docs, forEach: f => docs.forEach(f) };
    },

    onSnapshot(cb, err){
      let dead = false, last = '', timer = null, fails = 0, busy = false;
      const gap = () => _gapFor(tbl, fails);
      const tick = async () => {
        if(dead || busy) return;
        if(_hidden){ timer = setTimeout(tick, gap()); return }   /* بالخلفية — ما نسأل */
        busy = true;
        try{
          const snap = await api.get();
          fails = 0;
          const sig = JSON.stringify(snap.docs.map(d => d.data()));
          if(sig !== last){ last = sig; cb(snap) }
        }catch(e){ fails++; if(err) err(e) }
        busy = false;
        if(!dead){ try{ rtFix() }catch(e){} clearTimeout(timer); timer = setTimeout(tick, gap()) }
      };
      const wake = _wakeFn(() => dead, () => timer, t => { timer = t }, tick);
      _wake.add(wake); _tblAdd(tbl, wake);
      let unRt = _rtAllowed(tbl) ? _rtWatch(tbl, wake) : null;      /* تحديث فوري من القاعدة — حسب السياسة */
      const rtFix = () => { const ok=_rtAllowed(tbl); if(ok && !unRt) unRt=_rtWatch(tbl, wake); else if(!ok && unRt){ unRt(); unRt=null } };
      tick();
      return () => {
        dead = true; clearTimeout(timer); _wake.delete(wake); _tblDel(tbl, wake);
        if(unRt) unRt();
      };
    }
  };

  return api;
}

/* ── db ── */
const db = {
  collection(name){
    const q = _query(name);
    return {
      doc: id => _doc(name, id),
      where: (f,o,v) => q.where(f,o,v),
      orderBy: (f,d) => q.orderBy(f,d),
      limit: n => q.limit(n),
      get: () => q.get(),
      onSnapshot: (cb,e) => q.onSnapshot(cb,e),
      async add(data){
        const tbl = _TBL[name] || name;
        const [row] = await _req(tbl, {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(_out(name, data))
        });
        return { id: row.id };
      }
    };
  }
};

/* ═══ arrayUnion ═══ */
function __arrayUnion(...items){
  return { __op: 'append', items };
}

const _rawDoc = _doc;
_doc = function(coll, id){
  const d = _rawDoc(coll, id);
  const wrap = fn => async (data, opt) => {
    const ops = {};
    for(const k in data){
      if(data[k] && data[k].__op === 'append'){ ops[k] = data[k].items; delete data[k] }
    }
    if(Object.keys(ops).length){
      const cur = await d.get();
      const old = cur.exists ? cur.data() : {};
      for(const k in ops) data[k] = (old[k] || []).concat(ops[k]);
    }
    return fn(data, opt);
  };
  return { ...d, update: wrap(d.update), set: wrap(d.set) };
};

/* v7: للتطبيق — تحديث فوري لجدول بعد ما نكتب، وتحويل صف من القاعدة لشكل التطبيق */
if(typeof window !== 'undefined'){
  window.__sbKick = function(tbl){ try{ _kick(tbl) }catch(e){} };
  window.__sbIn = function(coll, row){ try{ return _in(coll, row) }catch(e){ return row } };
}
