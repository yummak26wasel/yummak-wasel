/* ═══════════════════════════════════════════════════
   v454/v455: تدريب السواق — التصحيح هنا بالسيرفر، والأجوبة الصح ما توصل للتلفون أبد.
     POST /_train/state   حالة السائق (شنو خلص من أسئلة وسط الفيديو، ونتائجه)
     POST /_train/check   سؤال وسط الفيديو {id, answer} ← {ok}
     POST /_train/submit  الاختبار الأخير {answers: {رقم السؤال: نص الجواب}} ← النتيجة
     POST /_train/admin   للمؤسس بس: نتائج كل السواق
   منو الشخص؟ نسأل Supabase بالتوكن مالته (/auth/v1/user) — ما نثق بأي رقم يجي بالطلب.
   النتائج تنحفظ بـ KV (نفس PUSH) بمفاتيح tr:<id>.
   ═══════════════════════════════════════════════════ */
const SB_URL = 'https://obvxqyfmcmldruauhsgw.supabase.co';
const SB_PUB = 'sb_publishable_HJxHDApXLZVPVQ1p8wqq6w_ELPotqfq';
const PASS = 0.9;

/* أسئلة وسط الفيديو: رقم ← [الدرس، الجواب الصح] */
const CHECK = {
  1: [1, '35,000 د.ع'], 2: [1, 'دقيقة'],
  3: [2, '«وصلت للمطعم»'], 4: [2, 'على المطعم'],
  5: [3, 'تعدّه قدام الزبون وترجّع الباقي بالضبط'], 6: [3, 'كل 15 يوم'],
  7: [4, 'واگف وبعيد عن الأكل'], 8: [4, 'منفصل، وتوصّله أول'],
  9: [5, 'أكثر من 20'], 10: [5, 'واحد'],
  11: [6, '100'], 12: [6, 'إيقاف يومين']
};
/* الاختبار الأخير: رقم ← [الدرس، الجواب الصح] */
const FINAL = {
  1: [1, '35,000 د.ع'], 2: [1, 'دقيقة'], 3: [1, '80% أو أكثر'], 4: [1, '90% أو أكثر'], 5: [1, 'أسبوعين'],
  6: [2, '15 لـ 25 دقيقة'], 7: [2, '«وصلت للمطعم»'], 8: [2, 'ما تطلع، المطعم يكمّله أو تبلّغ الدعم'], 9: [2, 'على المطعم'],
  10: [2, 'وكت الاستلام أو بعد التوصيل، حسب الاتفاق'],
  11: [3, 'دقيقتين'], 12: [3, 'تتصل أكثر من مرة وتبلّغ الدعم'], 13: [3, 'كل 15 يوم'], 14: [3, 'يومين'], 15: [3, 'مناصفة بينك وبين التطبيق'],
  16: [4, 'تفصلهم، وتوصّل الآيس كريم أول'], 17: [4, 'الرز جوة، الخبز فوك، والمنظفات بعيدة عن الأكل'],
  18: [4, 'واگف، والغطا مسدود، وبعيد عن الأكل'], 19: [4, 'مستوية وما فوكها شي'], 20: [4, 'ملفوف بكيس مسدود'],
  21: [5, '5 العصر لـ 1 بالليل'], 22: [5, 'أكثر من 20 دقيقة'], 23: [5, 'ساعة'], 24: [5, '5 أيام، قبل 24 ساعة'], 25: [5, 'ساعة'],
  26: [6, '100'], 27: [6, '15'], 28: [6, '10'], 29: [6, 'إيقاف يومين'], 30: [6, '4.5']
};

const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const sbH = tok => ({ apikey: SB_PUB, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' });

const GID_RE = /^[a-f0-9]{32}$/;

/* v455: منو الشخص؟ حساب (توكن Supabase) — أو زائر ما سجّل بعد (رمز عشوائي محفوظ بتلفونه بـ X-Train-Guest).
   الزائر يتدرب قبل ما يسوي حساب، ولما يسجّل نتيجته تنتقل لحسابه (claim) */
async function who(req) {
  const g = String(req.headers.get('X-Train-Guest') || '').toLowerCase();
  const gid = GID_RE.test(g) ? g : '';
  const a = req.headers.get('Authorization') || '';
  const tok = a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  if (tok && tok.length < 4000 && tok !== 'null') {
    try {
      const r = await fetch(SB_URL + '/auth/v1/user', { headers: sbH(tok) });
      if (r.ok) {
        const u = await r.json();
        if (u && u.id) {
          let p = {};
          try {
            const pr = await fetch(SB_URL + '/rest/v1/profiles?select=role,name,phone&id=eq.' + encodeURIComponent(u.id), { headers: sbH(tok) });
            if (pr.ok) p = (await pr.json())[0] || {};
          } catch (e) {}
          return { id: u.id, tok, gid, role: p.role || '', name: p.name || '', phone: p.phone || '' };
        }
      }
    } catch (e) {}
  }
  if (gid) return { id: 'g:' + gid, tok: '', gid: '', guest: true, role: 'guest', name: '', phone: '' };
  return null;
}

/* الزائر صار عنده حساب: ننقل تدريبه لحسابه ونمسح سجل الزائر */
async function claim(env, u) {
  if (!u.gid || u.guest) return;
  const raw = await env.PUSH.get('tr:g:' + u.gid);
  if (!raw) return;
  let g = null; try { g = JSON.parse(raw); } catch (e) {}
  if (g) {
    const s = await load(env, u.id);
    s.checks = Object.assign({}, g.checks || {}, s.checks || {});
    s.results = (g.results || []).concat(s.results || []).sort((a, b) => a.at - b.at).slice(-20);
    await save(env, u, s);
  }
  await env.PUSH.delete('tr:g:' + u.gid);
}

async function load(env, id) {
  const raw = await env.PUSH.get('tr:' + id);
  let s = null; try { s = raw ? JSON.parse(raw) : null; } catch (e) {}
  return s || { checks: {}, results: [] };
}
async function save(env, u, s) {
  s.name = u.name; s.phone = u.phone; s.role = u.role; s.at = Date.now();
  await env.PUSH.put('tr:' + u.id, JSON.stringify(s), { metadata: { r: 'train' } });
}
function view(s) {
  const res = s.results || [];
  const last = res[res.length - 1] || null;
  return {
    checks: Object.keys(s.checks || {}).map(Number).sort((a, b) => a - b),
    attempts: res.length,
    passed: res.some(r => r.passed),
    best: res.length ? Math.max.apply(null, res.map(r => r.score)) : null,
    last
  };
}

export async function train(req, env, path) {
  if (req.method !== 'POST') return J({ error: 'POST only' }, 405);
  if (!env.PUSH) return J({ error: 'kv not bound' }, 500);
  const u = await who(req);
  if (!u) return J({ error: 'signin' }, 401);
  let b = {};
  try { b = await req.json(); } catch (e) {}
  try { await claim(env, u); } catch (e) {}

  if (path === '/state') {
    const s = await load(env, u.id);
    return J(Object.assign({ ok: true, role: u.role, name: u.name, guest: !!u.guest }, view(s)));
  }

  if (path === '/check') {
    const id = Number(b.id), k = CHECK[id];
    if (!k) return J({ error: 'bad question' }, 400);
    const ok = String(b.answer || '') === k[1];
    if (ok) {
      const s = await load(env, u.id);
      if (!s.checks[id]) { s.checks[id] = Date.now(); await save(env, u, s); }
    }
    return J({ ok });
  }

  if (path === '/submit') {
    const s = await load(env, u.id);
    const need = Object.keys(CHECK).length;
    if (Object.keys(s.checks || {}).length < need) return J({ error: 'finish lessons first' }, 409);
    const last = (s.results || [])[s.results.length - 1];
    if (last && Date.now() - last.at < 60000) return J({ error: 'wait' }, 429);
    const ans = (b && typeof b.answers === 'object' && b.answers) || {};
    let score = 0; const wrong = new Set();
    for (const q in FINAL) {
      if (String(ans[q] || '') === FINAL[q][1]) score++; else wrong.add(FINAL[q][0]);
    }
    const total = Object.keys(FINAL).length;
    const passed = score >= Math.ceil(total * PASS);
    const wl = Array.from(wrong).sort((a, c) => a - c);
    s.results = (s.results || []).concat([{ score, total, passed, wrong_lessons: wl, at: Date.now() }]).slice(-20);
    /* رسب: الدروس اللي غلط بيها ترجع مقفولة لحد ما يعيد مشاهدتها ويجاوب أسئلتها */
    if (!passed) for (const id in CHECK) if (wrong.has(CHECK[id][0])) delete s.checks[id];
    await save(env, u, s);
    return J({ ok: true, score, total, passed, wrong_lessons: wl });
  }

  if (path === '/admin') {
    let isAdmin = !u.guest && u.role === 'admin';
    if (isAdmin) {
      try {
        const r = await fetch(SB_URL + '/rest/v1/rpc/sec_admin', { method: 'POST', headers: sbH(u.tok), body: '{}' });
        isAdmin = r.ok && (await r.json()) === true;
      } catch (e) { isAdmin = false; }
    }
    if (!isAdmin) return J({ error: 'forbidden' }, 403);
    /* تدريب كل واحد (من KV) */
    const tr = new Map(); let cursor;
    do {
      const L = await env.PUSH.list({ prefix: 'tr:', cursor });
      for (const k of L.keys) {
        if (k.name.indexOf('tr:g:') === 0) continue;   /* زائر قديم ما سجّل */
        let s = null; try { s = JSON.parse(await env.PUSH.get(k.name)); } catch (e) {}
        if (s) tr.set(k.name.slice(3), s);
      }
      cursor = L.list_complete ? undefined : L.cursor;
    } while (cursor);
    /* v456: كل السواق المسجّلين (حتى اللي بعده ما بدأ التدريب) — نقرا بتوكن المؤسس نفسه */
    let drivers = null;
    try {
      const r = await fetch(SB_URL + '/rest/v1/profiles?select=id,name,phone,is_approved,is_blocked,created_at&role=eq.driver&deleted_at=is.null&order=created_at.desc&limit=500',
                            { headers: sbH(u.tok) });
      if (r.ok) drivers = await r.json();
    } catch (e) {}
    const rows = [];
    const add = (id, p, s) => {
      const v = s ? view(s) : { checks: [], attempts: 0, best: null, passed: false };
      rows.push({ name: (p && p.name) || (s && s.name) || '', phone: (p && p.phone) || (s && s.phone) || '',
                  approved: p ? p.is_approved === true : null, blocked: p ? p.is_blocked === true : false,
                  started: !!s && (v.checks.length > 0 || v.attempts > 0), checks: v.checks.length, attempts: v.attempts,
                  best: v.best, passed: v.passed, at: (s && s.at) || Date.parse((p && p.created_at) || '') || 0 });
    };
    if (Array.isArray(drivers)) {
      const seen = new Set();
      for (const p of drivers) { seen.add(p.id); add(p.id, p, tr.get(p.id)); }
      for (const [id, s] of tr) if (!seen.has(id) && s.role === 'driver') add(id, null, s);
    } else for (const [id, s] of tr) add(id, null, s);
    /* الأول: نجح وبعده ما مفعّل (جاهز تفعّله)، بعدين اللي بالانتظار، وآخر شي المفعّلين */
    const rank = x => (x.passed && x.approved === false) ? 0 : (x.approved === false ? 1 : 2);
    rows.sort((a, c) => rank(a) - rank(c) || c.at - a.at);
    return J({ ok: true, total_checks: Object.keys(CHECK).length, total_final: Object.keys(FINAL).length, pass_min: Math.ceil(Object.keys(FINAL).length * PASS), rows });
  }

  return J({ error: 'not found' }, 404);
}
