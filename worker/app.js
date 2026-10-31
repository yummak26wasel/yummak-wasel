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
  const msgs = []; let checked = 0, sent = 0;
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
    const data = { url: '/?nof=' + encodeURIComponent(id), tag: 'new_order', type: 'new_order', order_id: id,
                   shop_id: String(info.shop_id || ''), total: String(info.total || 0) };
    const body = 'طلب بقيمة ' + Number(info.total || 0).toLocaleString('en-US') + ' د.ع — الزبون ينتظر، اقبله هسه';
    for (const u of users) {
      const L = await env.PUSH.list({ prefix: 'u:' + u + ':' });
      for (const k of L.keys) {
        const t = await env.PUSH.get(k.name);
        if (t) msgs.push({ to: t, title: '⏰ طلب ينتظر قبولك', body, priority: 'high', channelId: 'orders', data,
                           sound: 'new_order.wav', interruptionLevel: 'time-sensitive' });
      }
    }
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/_nudge') return nudge(req, env);
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
