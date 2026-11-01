/* ═══════════════════════════════════════════════════
   واصل ليمَك — صفحة التطبيق + ممرّات للسيرفرات من نفس العنوان
     /_otp/*  → leemak-otp  (رمز الواتساب، استرجاع كلمة المرور)
     /_api/*  → leemak-api  (المحلات، الإشعارات، حذف الحساب)
     /_db/*   → leemak-db   (الطريق الاحتياطي للقاعدة)
   ليش؟ بعض شبكات الواي فاي بالعراق تحجب عناوين workers.dev.
   لما كلشي يمر من نفس عنوان التطبيق (leemak.app) ما يبقى عنوان ثاني ينحجب،
   وما نحتاج نعدّل إعدادات CORS بكل سيرفر.
   الملفات (index.html، الصور...) تنخدم مثل قبل بالضبط بدون ما يشتغل هذا الكود.
   ═══════════════════════════════════════════════════ */
const OLD_ORIGIN = 'https://leemak-app.dhifvmy.workers.dev';   /* السيرفرات تعرف هذا العنوان */
const MAP = { '/_otp': 'OTP', '/_api': 'API', '/_db': 'DB' };

/* ═══ v372: «طلب ينتظر قبولك» — القاعدة (كل 30 ثانية) تطلب من هنا يدز تذكير لصاحب المحل وموظفينه.
   ما نثق بأي شي يجي بالطلب غير رقم الطلب: نسأل القاعدة (order_nudge_check) إذا الطلب فعلاً ينتظر
   وانطلب تذكيره هسه، ومنها ناخذ منو ندزله. الإشعار يروح لتطبيق المتجر (رموز Expo بـ KV leemak-push). */
const SB_URL = 'https://obvxqyfmcmldruauhsgw.supabase.co';
const SB_PUB = 'sb_publishable_HJxHDApXLZVPVQ1p8wqq6w_ELPotqfq';   /* المفتاح العام — نفس الي بالتطبيق */
const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jres = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json' } });

async function nudge(req, env) {
  if (req.method !== 'POST') return jres({ error: 'POST only' }, 405);
  if (!env.PUSH) return jres({ error: 'kv not bound' }, 500);
  let b = {};
  try { b = await req.json(); } catch (e) {}
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => UUID_RE.test(x)).slice(0, 20);
  /* إذا اكو أكثر من طلب لنفس المحل بنفس اللحظة: إشعار واحد «عندك 3 طلبات» بدل 3 إشعارات ورا بعض */
  const byTok = new Map(); let checked = 0, sent = 0;
  for (const id of ids) {
    let info = null;
    try {
      const r = await fetch(SB_URL + '/rest/v1/rpc/order_nudge_check', {
        method: 'POST',
        headers: { apikey: SB_PUB, Authorization: 'Bearer ' + SB_PUB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_order: id })
      });
      if (r.ok) info = await r.json();
    } catch (e) {}
    if (!info || !Array.isArray(info.users) || !info.users.length) continue;
    checked++;
    const users = info.users.map(String).filter(x => UUID_RE.test(x)).slice(0, 10);
    for (const u of users) {
      const L = await env.PUSH.list({ prefix: 'u:' + u + ':' });
      for (const k of L.keys) {
        const t = await env.PUSH.get(k.name);
        if (!t) continue;
        const g = byTok.get(t) || { orders: [], total: 0, shop: String(info.shop_id || '') };
        g.orders.push(id); g.total += Number(info.total || 0);
        byTok.set(t, g);
      }
    }
  }
  const msgs = [];
  for (const [t, g] of byTok) {
    const n = g.orders.length, first = g.orders[0];
    msgs.push({
      to: t,
      title: n > 1 ? '⏰ عندك ' + n + ' طلبات تنتظر قبولك' : '⏰ طلب ينتظر قبولك',
      body: n > 1 ? 'الزبائن ينتظرون — اقبلها هسه' : 'طلب بقيمة ' + g.total.toLocaleString('en-US') + ' د.ع — الزبون ينتظر، اقبله هسه',
      priority: 'high', channelId: 'orders', sound: 'new_order.wav', interruptionLevel: 'time-sensitive',
      data: { url: '/?nof=' + encodeURIComponent(first), tag: 'new_order', type: 'new_order', order_id: first,
              shop_id: g.shop, total: String(g.total), count: String(n) }
    });
  }
  for (let i = 0; i < msgs.length; i += 100) {
    try {
      const r = await fetch(EXPO_SEND, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                         body: JSON.stringify(msgs.slice(i, i + 100)) });
      const j = await r.json().catch(() => null);
      ((j && j.data) || []).forEach(t => { if (t && t.status === 'ok') sent++; });
    } catch (e) {}
  }
  return jres({ ok: true, orders: ids.length, checked, devices: msgs.length, sent });
}

/* v373: كم جهاز مسجّل بتطبيق المتجر (أعداد بس — بدون أي اسم أو رقم) */
async function pushStats(env) {
  if (!env.PUSH) return jres({ error: 'kv not bound' }, 500);
  const by = {}, plat = {}; let total = 0, cursor;
  do {
    const r = await env.PUSH.list({ prefix: 'u:', cursor });
    for (const k of r.keys) { total++; const m = k.metadata || {}; const role = m.r || '?', p = m.p || '?';
      by[role] = (by[role] || 0) + 1; plat[p] = (plat[p] || 0) + 1; }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return jres({ ok: true, devices: total, by_role: by, by_platform: plat });
}

/* v373 (فحص مؤقت): إشعار تجربة لأجهزة الإدارة بس — مرة بالدقيقة كحد أقصى — ويرجّع جواب Expo (نجح/السبب) */
async function pushTestAdmin(env) {
  if (!env.PUSH) return jres({ error: 'kv not bound' }, 500);
  if (await env.PUSH.get('diag:last')) return jres({ error: 'wait a minute' }, 429);
  await env.PUSH.put('diag:last', '1', { expirationTtl: 60 });
  const toks = []; let cursor;
  do {
    const r = await env.PUSH.list({ prefix: 'u:', cursor });
    for (const k of r.keys) if (k.metadata && k.metadata.r === 'admin') { const t = await env.PUSH.get(k.name); if (t) toks.push({ t, p: k.metadata.p || '?' }); }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  if (!toks.length) return jres({ ok: true, devices: 0 });
  const r = await fetch(EXPO_SEND, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(toks.map(x => ({ to: x.t, title: '🔔 تجربة من السيرفر', body: 'إذا وصلك هذا، إشعارات تطبيق المتجر شغّالة ✓',
      priority: 'high', channelId: 'orders', sound: 'default', data: { type: 'test', url: '/' } }))) });
  const j = await r.json().catch(() => null);
  const res = ((j && j.data) || []).map((x, i) => ({ platform: toks[i] && toks[i].p, status: x.status, error: x.details && x.details.error, message: x.message && String(x.message).slice(0, 120) }));
  return jres({ ok: true, devices: toks.length, http: r.status, results: res, top: j && j.errors });
}

/* v373 (فحص مؤقت): إشعار صامت (ما يبين للشخص) لجهاز آيفون واحد — سائق أو محل — حتى نعرف إذا مفتاح Apple مضبوط */
async function pushTestIos(env) {
  if (!env.PUSH) return jres({ error: 'kv not bound' }, 500);
  if (await env.PUSH.get('diag:ios')) return jres({ error: 'wait a minute' }, 429);
  await env.PUSH.put('diag:ios', '1', { expirationTtl: 60 });
  let pick = null, any = null, cursor;
  do {
    const r = await env.PUSH.list({ prefix: 'u:', cursor });
    for (const k of r.keys) { const m = k.metadata || {}; if (m.p !== 'ios') continue;
      if (!any) any = k; if (!pick && (m.r === 'store' || m.r === 'driver' || m.r === 'admin')) pick = k; }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor && !pick);
  const k = pick || any; if (!k) return jres({ ok: true, ios_devices: 0 });
  const t = await env.PUSH.get(k.name);
  const r = await fetch(EXPO_SEND, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify([{ to: t, _contentAvailable: true, priority: 'normal', data: { type: 'diag' } }]) });
  const j = await r.json().catch(() => null);
  const tk = j && j.data && j.data[0];
  let receipt = null;
  if (tk && tk.id) {
    await new Promise(z => setTimeout(z, 4000));
    const rr = await fetch('https://exp.host/--/api/v2/push/getReceipts', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: [tk.id] }) });
    const jj = await rr.json().catch(() => null);
    receipt = jj && jj.data && jj.data[tk.id] || null;
  }
  return jres({ ok: true, role: (k.metadata || {}).r, ticket: tk && { status: tk.status, error: tk.details && tk.details.error, message: tk.message && String(tk.message).slice(0, 140) },
                receipt: receipt && { status: receipt.status, error: receipt.details && receipt.details.error, message: receipt.message && String(receipt.message).slice(0, 140) } });
}

/* ═══ v387: شيل خلفية صورة المنتج — Cloudflare Images (segment=foreground، ذكاء اصطناعي)
   ناخذ بس روابط صورنا العامة (Supabase /images/) — ما نقبل صور من برّة، حتى محد يستغله.
   يرجّع المنتج بخلفية شفافة (webp)، والتطبيق يقص حواليه ويحطه بالنص على أبيض.
   الحساب المجاني: 5,000 صورة بالشهر — نفس الصورة ما تنحسب مرتين بنفس الشهر. */
const IMG_PATH = '/storage/v1/object/public/images/';
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function bgRemove(req, env, url) {
  let src = url.searchParams.get('u') || '';
  if (req.method === 'POST') { try { const b = await req.json(); src = String((b && b.url) || ''); } catch (e) { src = ''; } }
  else if (req.method !== 'GET') return jres({ error: 'method' }, 405);
  let su = null;
  try { su = new URL(src); } catch (e) {}
  if (!su || su.origin !== SB_URL || !su.pathname.startsWith(IMG_PATH) || su.search || su.pathname.length > 300)
    return jres({ error: 'bad url' }, 400);
  if (!env.IMAGES) return jres({ error: 'images not bound' }, 501);
  let r;
  try { r = await fetch(su.toString()); } catch (e) { return jres({ error: 'fetch' }, 502); }
  if (!r.ok || !r.body) return jres({ error: 'source ' + r.status }, 404);
  if (Number(r.headers.get('content-length') || 0) > 8e6) return jres({ error: 'too big' }, 413);
  try {
    const out = (await env.IMAGES.input(r.body)
      .transform({ width: 1000, height: 1000, fit: 'scale-down', segment: 'foreground' })
      .output({ format: 'image/webp', quality: 90 })).response();
    const type = out.headers.get('content-type') || 'image/webp';
    if (url.searchParams.get('b64')) {   /* فحص من السيرفر: نفس الصورة بس كنص */
      const buf = await out.arrayBuffer();
      return jres({ ok: true, type, bytes: buf.byteLength, b64: b64(buf) });
    }
    return new Response(out.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=600' } });
  } catch (e) {
    return jres({ error: 'transform', message: String((e && e.message) || e).slice(0, 200) }, 502);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/_bg') return bgRemove(req, env, url);
    if (url.pathname === '/_nudge') return nudge(req, env);
    if (url.pathname === '/_pushstats') return pushStats(env);
    if (url.pathname === '/_pushtest') return url.searchParams.get('ios') ? pushTestIos(env) : pushTestAdmin(env);
    for (const pre in MAP) {
      if (url.pathname !== pre && !url.pathname.startsWith(pre + '/')) continue;
      const svc = env[MAP[pre]];
      if (!svc) return new Response('service not bound', { status: 502 });
      const u = new URL(req.url);
      u.pathname = url.pathname.slice(pre.length) || '/';
      const h = new Headers(req.headers);
      if (h.has('Origin')) h.set('Origin', OLD_ORIGIN);
      const init = { method: req.method, headers: h, redirect: 'manual' };
      if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
      let res;
      try { res = await svc.fetch(new Request(u.toString(), init)); }
      catch (e) { return new Response('upstream: ' + (e && e.message || e), { status: 502 }); }
      const out = new Response(res.body, res);
      out.headers.delete('Access-Control-Allow-Origin');   /* نفس العنوان — ما نحتاجها */
      out.headers.set('x-leemak-via', pre.slice(2));
      return out;
    }
    return env.ASSETS.fetch(req);   /* باقي الصفحات: نفس قبل (index.html للتنقل) */
  }
};
