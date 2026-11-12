/* v515 — صور المنتجات المرفوعة على Supabase: نسخة منها داخل التطبيق نفسه (public/m/sb/)
   تنصنع وقت النشر (Cloudflare Workers Builds يشغّل هذا قبل رفع الملفات — wrangler.toml [build]).

   ليش: الصور الكبيرة (‎~84KB) من supabase.co تبطّي أو تعلك على بعض الشبكات — صيدلية الخليل
   طلعت 0 من 111 صورة بعد 15 ثانية. صورنا اللي من نفس عنوان التطبيق (/m/) ما بيها هالمشكلة.

   لكل صورة:  public/m/sb/<مسارها بالمخزن>.webp     ← 720px  (نافذة الصنف)
              public/m/sb/<مسارها بالمخزن>.t.webp   ← 320px  (القوائم)
   التطبيق (oImg/tImg بـ index.html) يطلبها من هنا، وإذا ما لكاها (صورة انرفعت بعد آخر نشر) يرجع للأصل.

   هذا السكربت ما يوقّف النشر أبداً: أي خطأ ← يكتب سطر ويطلع بنجاح (التطبيق يرجع للصور الأصلية). */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const SB = 'https://obvxqyfmcmldruauhsgw.supabase.co';
const SB_PUB = 'sb_publishable_HJxHDApXLZVPVQ1p8wqq6w_ELPotqfq';   /* المفتاح العام — نفس الي بالتطبيق */
const PFX = SB + '/storage/v1/object/public/images/';
const NAME = /^[\w.\/-]+\.(jpe?g|png|webp)$/i;                      /* نفس الشرط بالتطبيق (sbLocal) */
const OUT = 'public/m/sb';
const log = (...a) => console.log('[sbimg]', ...a);

function getSharp() {
  const req = createRequire(join(process.cwd(), 'package.json'));
  try { return req('sharp'); } catch (e) {}
  log('installing sharp…');
  execSync('npm i --no-save --no-audit --no-fund --no-package-lock --loglevel=error sharp@0.33.5',
    { stdio: 'inherit', timeout: 240000 });
  return req('sharp');
}

/* كل روابط الصور المرفوعة على مخزن images: صورة المنتج + صور الخيارات (sizes) */
function collect(shops) {
  const set = new Set();
  const add = u => { u = String(u || ''); if (u.startsWith(PFX) && NAME.test(u.slice(PFX.length)) && !u.includes('..')) set.add(u.slice(PFX.length)); };
  for (const s of shops || []) for (const p of (Array.isArray(s.products) ? s.products : [])) {
    if (!p || typeof p !== 'object') continue;
    add(p.img);
    if (Array.isArray(p.sizes)) for (const z of p.sizes) if (z && typeof z === 'object') add(z.img);
  }
  return [...set];
}

async function convert(sharp, buf, rel) {
  const base = join(OUT, rel);
  await mkdir(dirname(base), { recursive: true });
  const src = () => sharp(buf, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
  await src().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
             .webp({ quality: 82, effort: 4 }).toFile(base + '.webp');
  await src().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
             .webp({ quality: 72, effort: 4 }).toFile(base + '.t.webp');
}

async function main() {
  const t0 = Date.now();
  let sharp;
  try { sharp = getSharp(); } catch (e) { log('no sharp — skipped:', e.message); return; }

  /* تجربة محلية: SBIMG_TEST=ملف1,ملف2 — بدون نت */
  if (process.env.SBIMG_TEST) {
    for (const f of process.env.SBIMG_TEST.split(',')) await convert(sharp, await readFile(f), 'test/' + f.split('/').pop());
    log('test done'); return;
  }

  let shops;
  try {
    const r = await fetch(`${SB}/rest/v1/shops?select=id,products&is_approved=eq.true`,
      { headers: { apikey: SB_PUB, Authorization: 'Bearer ' + SB_PUB }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('shops ' + r.status);
    shops = await r.json();
  } catch (e) { log('shops list failed — skipped:', e.message); return; }

  const list = collect(shops);
  let ok = 0, fail = 0, bytesIn = 0;
  const failed = [];
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const rel = list[i++];
      try {
        const r = await fetch(PFX + rel, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error('http ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        bytesIn += buf.length;
        await convert(sharp, buf, rel);
        ok++;
      } catch (e) { fail++; if (failed.length < 20) failed.push(rel + ' → ' + e.message); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const man = { at: new Date().toISOString(), total: list.length, ok, fail, mb_in: +(bytesIn / 1e6).toFixed(1), sec: Math.round((Date.now() - t0) / 1000), failed };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, '_manifest.json'), JSON.stringify(man));
  log(JSON.stringify(man));
}

main().catch(e => log('error — skipped:', e && e.message || e)).finally(() => { process.exitCode = 0; });
