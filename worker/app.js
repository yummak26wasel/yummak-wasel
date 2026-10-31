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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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
