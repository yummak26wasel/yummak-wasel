/* ═══════════════════════════════════════════════════════════
   طبقة الترجمة — Firestore ⇄ Supabase
   واصل ليمَك · v3  (ترسل توكن المستخدم — RLS يشتغل)

   التغيير الوحيد عن v2:
     كانت ترسل مفتاح anon مع كل طلب ← auth.uid() = null
     صارت ترسل JWT المستخدم        ← auth.uid() = هويته

   يغطّي:
     db.collection('x').doc(id).get()
     db.collection('x').doc(id).set(data, {merge:true})
     db.collection('x').doc(id).update(data)
     db.collection('x').add(data)
     db.collection('x').where(f, op, v).get()
     db.collection('x').orderBy(f).get()
     db.collection('x').onSnapshot(cb)
   ═══════════════════════════════════════════════════════════ */

const SB_URL = "https://obvxqyfmcmldruauhsgw.supabase.co";
const SB_KEY = "sb_publishable_HJxHDApXLZVPVQ1p8wqq6w_ELPotqfq";

/* ═══ التوكن — يُقرأ عند كل طلب، مو مرة وحدة ═══ */
function _token(){
  /* auth-layer يحدّث هذي الدالة لما يجهز عميل Supabase */
  if(typeof window !== 'undefined' && typeof window.__waselToken === 'function'){
    const t = window.__waselToken();
    if(t) return t;
  }
  try{
    const s = JSON.parse(localStorage.getItem('wasel_session'));
    return (s && s.token) || null;
  }catch(e){ return null }
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

/* ── خريطة الأسماء: اسم Firestore ← اسم الجدول ── */
const _TBL = {
  users:          'profiles',
  shops:          'shops',
  orders:         'orders',
  specialOrders:  'special_orders',
  settings:       'settings',
  tickets:        'tickets',
  notifications:  'notifications'
};

/* ── خريطة الحقول: اسم Firestore ← اسم العمود ── */
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

/* ── تحويل الاتجاهين ── */
function _out(coll, data){            // Firestore → Supabase
  const m = _FLD[coll]; if(!m) return { ...data };
  const o = {};
  for(const k in data){ o[ m[k] || k ] = data[k] }
  return o;
}
function _in(coll, row){              // Supabase → Firestore
  const m = _FLD[coll]; if(!m || !row) return row;
  const rev = {}; for(const k in m) rev[m[k]] = k;
  const o = {};
  for(const k in row){ o[ rev[k] || k ] = row[k] }
  return o;
}

/* ── نداء REST ── */
async function _req(path, opt = {}){
  const o = { ...opt };
  const extra = o.headers; delete o.headers;
  const r = await fetch(SB_URL + '/rest/v1/' + path, { ...o, headers: _hdr(extra) });
  if(!r.ok) throw new Error(await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/* ── وثيقة واحدة ── */
let _doc = function(coll, id){
  const tbl = _TBL[coll] || coll;
  const key = (coll === 'settings') ? 'key' : 'id';

  return {
    id,

    async get(){
      const rows = await _req(`${tbl}?select=*&${key}=eq.${encodeURIComponent(id)}`);
      const row = rows && rows[0];
      return {
        exists: !!row,
        id,
        data: () => row ? _in(coll, row) : undefined
      };
    },

    async set(data, opt){
      const body = { ..._out(coll, data), [key]: id };
      await _req(tbl, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(body)
      });
    },

    async update(data){
      await _req(`${tbl}?${key}=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(_out(coll, data))
      });
    },

    async delete(){
      await _req(`${tbl}?${key}=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /* الاستماع لوثيقة واحدة — بتحديث دوري */
    onSnapshot(cb, err){
      let dead = false, last = '';
      const tick = async () => {
        if(dead) return;
        try{
          const snap = await _doc(coll, id).get();
          const sig = JSON.stringify(snap.data() || null);
          if(sig !== last){ last = sig; cb(snap) }
        }catch(e){ if(err) err(e) }
        if(!dead) setTimeout(tick, 3000);
      };
      tick();
      return () => { dead = true };
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

    /* الاستماع — بتحديث دوري */
    onSnapshot(cb, err){
      let dead = false, last = '';
      const tick = async () => {
        if(dead) return;
        try{
          const snap = await api.get();
          const sig = JSON.stringify(snap.docs.map(d => d.data()));
          if(sig !== last){ last = sig; cb(snap) }
        }catch(e){ if(err) err(e) }
        if(!dead) setTimeout(tick, 3000);
      };
      tick();
      return () => { dead = true };
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

/* ═══ إضافة عنصر لمصفوفة (بديل Firestore arrayUnion) ═══ */
function __arrayUnion(...items){
  return { __op: 'append', items };
}

/* نغلّف update و set عشان يفهمون __arrayUnion */
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
