/* ═══════════════════════════════════════════════════════════
   leemak-api — واصل ليمَك

   POST /delete-account    حذف الحساب نهائياً (آبل 5.1.1v · Google Play)
   POST /push/register     تسجيل رمز Expo للتطبيق الأصلي
   POST /push/unregister   إلغاء الرمز عند تسجيل الخروج
   POST /push              إرسال إشعار لمستخدم أو لدور
   GET  /health            فحص الإعداد — بدون أي بيانات

   كل الطلبات (عدا health) تحتاج توكن Supabase للمستخدم:
     Authorization: Bearer <access token>

   رموز Expo تنحفظ بـ KV وليس بجدول push_tokens، لأن leemak-otp
   يقرأ ذاك الجدول ويرسل عبر FCM، وممكن يحذف أي رمز يرفضه FCM —
   ورموز Expo يرفضها FCM دائماً.
   ═══════════════════════════════════════════════════════════ */

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const ROLES = ['customer', 'store', 'driver', 'admin'];
const DELETED_NAME = 'حساب محذوف';
const DELETED_DRIVER = 'مندوب محذوف';

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let res;
    try {
      switch (new URL(req.url).pathname) {
        case '/health':          res = await health(env); break;
        case '/delete-account':  res = await deleteAccount(req, env); break;
        case '/push/register':   res = await registerPush(req, env); break;
        case '/push/unregister': res = await unregisterPush(req, env); break;
        case '/push':            res = await sendPush(req, env); break;
        default:                 res = json({ error: 'not_found' }, 404);
      }
    } catch (e) {
      console.error(e && e.stack || e);
      res = json({ error: 'internal' }, 500);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }
};

/* ═══ أدوات ═══ */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  if (origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

/* المستخدم من توكنه — ما نثق بأي uid يرسله العميل، نسأل Supabase */
async function authUser(req, env) {
  const h = req.headers.get('Authorization') || '';
  const jwt = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!jwt) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${jwt}` }
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? Object.assign(u, { jwt }) : null;
}

/* ترويسات المفتاح السرّي. مفاتيح sb_secret_ الجديدة مو JWT فتروح
   بـ apikey فقط؛ مفتاح service_role القديم (JWT) يروح بالاثنين. */
function adminHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) h.Authorization = `Bearer ${key}`;
  return h;
}

/* PostgREST بصلاحية الخادم — يرمي خطأ لأي رد غير ناجح */
function db(env) {
  return async (path, { method = 'GET', data, returning = false } = {}) => {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: { ...adminHeaders(env), Prefer: returning || method === 'GET' ? 'return=representation' : 'return=minimal' },
      body: data ? JSON.stringify(data) : undefined
    });
    if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${await r.text()}`);
    return r.status === 204 ? [] : r.json().catch(() => []);
  };
}

async function authAdmin(env, uid, method, data) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method, headers: adminHeaders(env), body: data ? JSON.stringify(data) : undefined
  });
  if (!r.ok && r.status !== 404) throw new Error(`auth ${method} → ${r.status} ${await r.text()}`);
}

const needKey = env => env.SUPABASE_SERVICE_ROLE_KEY
  ? null : json({ error: 'server_misconfigured' }, 500);

/* ═══ /health ═══ */

async function health(env) {
  const out = { ok: true, service_key: !!env.SUPABASE_SERVICE_ROLE_KEY, kv: !!env.PUSH };
  if (out.service_key) {
    try { await db(env)('profiles?select=id&limit=1'); out.supabase = true; }
    catch { out.supabase = false; out.ok = false; }
  } else out.ok = false;
  return json(out, out.ok ? 200 : 503);
}

/* ═══ /delete-account ═══
   ما نحذف السجل المحاسبي: الطلبات والتسويات تبقى بدون أي هوية.
   هذا يطابق سياسة الخصوصية (سجل الطلبات يُحفظ سنتين للمحاسبة). */

async function deleteAccount(req, env) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const bad = needKey(env); if (bad) return bad;
  const user = await authUser(req, env);
  if (!user) return json({ error: 'invalid_token' }, 401);

  const uid = user.id, q = encodeURIComponent, sb = db(env);
  const [profile] = await sb(`profiles?id=eq.${uid}&select=role,phone,shop_id`);

  /* حساب المدير ما ينحذف من التطبيق — حتى ما تنقفل لوحة الإدارة */
  if (profile && profile.role === 'admin') return json({ error: 'admin_account' }, 403);

  const phone = (profile && profile.phone) || String(user.email || '').split('@')[0];

  /* حسابات مراجعة المتجر محمية — نفسها تُستعمل بكل مراجعة. الأرقام
     بـ secret اسمه DEMO_PHONES (مفصولة بفواصل) حتى ما تنكشف بالريبو.
     نرفض بوضوح بدل ما نتظاهر بالحذف: المراجع إذا حذف ورجع سجّل دخول
     ولكى الحساب شغّال، يعتبر الحذف معطّل. */
  const demo = String(env.DEMO_PHONES || '').split(',').map(x => x.trim()).filter(Boolean);
  if (demo.includes(phone) || demo.includes(String(user.email || '').split('@')[0])) {
    return json({ error: 'demo_account' }, 403);
  }

  /* ١ · رموز الإشعارات */
  await dropTokens(env, uid);
  await sb(`push_tokens?user_id=eq.${uid}`, { method: 'DELETE' });

  /* ٢ · بيانات تخص الشخص فقط */
  await sb(`notifications?to=eq.${uid}`, { method: 'DELETE' });
  await sb(`addresses?user_id=eq.${uid}`, { method: 'DELETE' });
  await sb(`tickets?id=eq.${uid}`, { method: 'DELETE' });
  await sb(`shop_staff?profile_id=eq.${uid}`, { method: 'DELETE' });
  if (phone) await sb(`otp_codes?phone=eq.${q(phone)}`, { method: 'DELETE' });

  /* ٣ · الطلبات — تجريد من الهوية بدل الحذف */
  await sb(`orders?customer_id=eq.${uid}`, { method: 'PATCH', data: {
    customer_id: null, customer: DELETED_NAME, phone: null, address: null, loc: null, rateNote: null
  }});
  await sb(`orders?driver_id=eq.${uid}`, { method: 'PATCH', data: {
    driver_name: DELETED_DRIVER, driver_phone: null, driverPhoto: null, driver_loc: null
  }});
  await sb(`special_orders?customerUid=eq.${q(uid)}`, { method: 'PATCH', data: {
    customerUid: null, customer: DELETED_NAME, phone: null, addr: null, loc: null
  }});
  await sb(`special_orders?driverUid=eq.${q(uid)}`, { method: 'PATCH', data: {
    driverName: DELETED_DRIVER, driverPhone: null, driverPhoto: null, driverLoc: null
  }});

  /* ٤ · المحل — الطلبات مربوطة به بدون cascade، فنقفله بدل ما نحذفه.
     الموظفين بجدول shop_staff أدوارهم customer، فالشرط role === 'store'
     يضمن إن بس المالك يقفل محله. */
  const retire = {
    deleted_at: new Date().toISOString(), is_open: false, is_approved: false,
    owner_id: null, ownerPhone: null, phone: null, tg_chat: null
  };
  await sb(`shops?owner_id=eq.${uid}`, { method: 'PATCH', data: retire });
  if (profile && profile.role === 'store' && profile.shop_id) {
    await sb(`shops?id=eq.${profile.shop_id}`, { method: 'PATCH', data: retire });
  }

  /* ٥ · الملف والدخول.
     التسويات ومدفوعات المندوب مربوطة بالملف بدون cascade — إذا
     موجودة نمسح الهوية من الملف ونقفل الدخول، وإلا نحذف كلشي. */
  const [s] = await sb(`settlements?driver_id=eq.${uid}&select=id&limit=1`);
  const [p] = await sb(`driver_payments?driver_id=eq.${uid}&select=id&limit=1`);

  if (s || p) {
    await sb(`profiles?id=eq.${uid}`, { method: 'PATCH', data: {
      phone: `deleted-${uid}`, name: DELETED_NAME, address: null, photo_url: null,
      idCard: null, license: null, vehDoc: null, vehImg: null, plate: null,
      vehColor: null, vehicle: null, email: null, dob: null, gender: null,
      loc: null, fcmTokens: null, uid: null, shop_id: null,
      is_blocked: true, is_on_duty: false
    }});
    /* نلغي كل الجلسات، ونحرّر رقم الهاتف حتى يكدر يسجّل من جديد */
    await fetch(`${env.SUPABASE_URL}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${user.jwt}` }
    }).catch(() => {});
    await authAdmin(env, uid, 'PUT', {
      email: `deleted-${uid}@deleted.invalid`, email_confirm: true,
      password: crypto.randomUUID() + crypto.randomUUID(),
      ban_duration: '876000h', user_metadata: {}
    });
    return json({ ok: true, mode: 'anonymized' });
  }

  /* يحذف معه (cascade): profiles · push_tokens · tickets · addresses */
  await authAdmin(env, uid, 'DELETE');
  return json({ ok: true, mode: 'deleted' });
}

/* ═══ رموز Expo بـ KV ═══
   u:<uid>:<hash>  → الرمز، والـmetadata فيها الدور
   t:<hash>        → uid  (حتى نفك الرمز عن حساب قديم على نفس الجهاز) */

async function hashOf(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function listAll(env, prefix) {
  const out = []; let cursor;
  do {
    const r = await env.PUSH.list({ prefix, cursor });
    out.push(...r.keys);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

async function dropTokens(env, uid) {
  for (const k of await listAll(env, `u:${uid}:`)) {
    await env.PUSH.delete(k.name);
    await env.PUSH.delete(`t:${k.name.split(':')[2]}`);
  }
}

async function registerPush(req, env) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const bad = needKey(env); if (bad) return bad;
  const user = await authUser(req, env);
  if (!user) return json({ error: 'invalid_token' }, 401);

  const { token, platform } = await body(req);
  if (!EXPO_TOKEN_RE.test(String(token || ''))) return json({ error: 'bad_token' }, 400);

  /* الدور من القاعدة، مو من العميل */
  const [profile] = await db(env)(`profiles?id=eq.${user.id}&select=role,shop_id`);
  const h = await hashOf(token);

  const prev = await env.PUSH.get(`t:${h}`);
  if (prev && prev !== user.id) await env.PUSH.delete(`u:${prev}:${h}`);

  await env.PUSH.put(`u:${user.id}:${h}`, token, { metadata: {
    r: (profile && profile.role) || 'customer',
    s: (profile && profile.shop_id) || null,
    p: platform === 'android' ? 'android' : 'ios'
  }});
  await env.PUSH.put(`t:${h}`, user.id);
  return json({ ok: true });
}

async function unregisterPush(req, env) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const user = await authUser(req, env);
  if (!user) return json({ error: 'invalid_token' }, 401);
  const { token } = await body(req);
  if (!EXPO_TOKEN_RE.test(String(token || ''))) return json({ error: 'bad_token' }, 400);
  const h = await hashOf(token);
  if ((await env.PUSH.get(`t:${h}`)) === user.id) {
    await env.PUSH.delete(`u:${user.id}:${h}`);
    await env.PUSH.delete(`t:${h}`);
  }
  return json({ ok: true });
}

/* ═══ /push ═══
   نفس شكل الطلب اللي يرسله الموقع لـ leemak-otp:
     { title, body, url, tag, user_id }  أو  { ..., role } */

async function sendPush(req, env) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const user = await authUser(req, env);
  if (!user) return json({ error: 'invalid_token' }, 401);

  const b = await body(req);
  const title = String(b.title || 'واصل ليمَك').slice(0, 100);
  const text = String(b.body || '').slice(0, 400);

  let keys;
  if (b.user_id) keys = await listAll(env, `u:${b.user_id}:`);
  else if (ROLES.includes(b.role)) keys = (await listAll(env, 'u:')).filter(k => k.metadata && k.metadata.r === b.role);
  else return json({ error: 'no_target' }, 400);
  if (!keys.length) return json({ ok: true, sent: 0 });

  const targets = [];
  for (const k of keys) {
    const token = await env.PUSH.get(k.name);
    if (token) targets.push({ key: k.name, token });
  }

  let sent = 0;
  for (let i = 0; i < targets.length; i += 100) {
    const chunk = targets.slice(i, i + 100);
    const r = await fetch(EXPO_SEND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk.map(t => ({
        to: t.token, title, body: text, sound: 'default', priority: 'high',
        channelId: 'orders', data: { url: b.url || '/', tag: b.tag || 'lw' }
      })))
    });
    const res = await r.json().catch(() => null);
    const tickets = (res && res.data) || [];
    for (let j = 0; j < tickets.length; j++) {
      if (tickets[j].status === 'ok') sent++;
      /* جهاز حذف التطبيق — نشيل رمزه */
      else if (tickets[j].details && tickets[j].details.error === 'DeviceNotRegistered') {
        const key = chunk[j].key;
        await env.PUSH.delete(key);
        await env.PUSH.delete(`t:${key.split(':')[2]}`);
      }
    }
  }
  return json({ ok: true, sent });
}
