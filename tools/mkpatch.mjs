/* v586 — تحديث التطبيق بالفرق بس (مو الصفحة كلها)
   قبل: كل تحديث ينزّل صفحة التطبيق كاملة (~650KB مضغوطة). بالنت الضعيف (~4KB/ثانية) هذا 3 دقايق،
   والصور توگف وراه بالدور (عبد، 27/11: «IMGSTALL ok=0/123» بعد 4 تحديثات بليلة وحدة).
   هسه: لكل نسخة قديمة من index.html (آخر 25 تعديل بـ git) نصنع ملف فرق صغير:
       public/u/<أول 16 حرف من sha256 النسخة القديمة>.json
   الـ SW الجديد (sw.js) يحسب sha256 للصفحة المحفوظة بالتلفون، يطلب ملفها، يطبّقه، ويتأكد من sha256 النتيجة.
   أي شي ما يطابق ← ينزّل الصفحة كاملة مثل قبل (ما يخرب شي).

   تشغيل: node tools/mkpatch.mjs   (آخر خطوة قبل الـ commit — بعد كل تعديل على index.html و sw.js) */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const IDX = 'public/index.html', OUT = 'public/u', KEEP = 25;
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');

/* نفس الدالة اللي بـ sw.js حرفياً (applyPatch) */
function applyPatch(oldText, ops) {
  const a = oldText.split('\n'), out = []; let i = 0;
  for (const op of ops) {
    if (typeof op === 'number') { if (op > 0) { if (i + op > a.length) return null; for (let k = 0; k < op; k++) out.push(a[i++]); } else i -= op; }
    else if (typeof op === 'string') out.push(op);
    else return null;
  }
  return i === a.length ? out.join('\n') : null;
}

/* فرق بالأسطر من git diff (-U0) */
function diffOps(oldText, newText, dir) {
  const fa = join(dir, 'a'), fb = join(dir, 'b');
  writeFileSync(fa, oldText); writeFileSync(fb, newText);
  let d = '';
  try { d = execFileSync('git', ['diff', '--no-index', '--no-color', '--text', '-U0', '--diff-algorithm=histogram', fa, fb], { maxBuffer: 64 << 20 }).toString('utf8'); }
  catch (e) { d = e.stdout ? e.stdout.toString('utf8') : ''; }   /* git diff يطلع بـ 1 لما أكو فرق */
  const total = oldText.split('\n').length, ops = []; let pos = 0, cur = null;
  const flush = () => { if (!cur) return; if (cur.start > pos) ops.push(cur.start - pos); if (cur.s) ops.push(-cur.s); if (cur.add.length) ops.push(cur.add.join('\n')); pos = cur.start + cur.s; cur = null; };
  for (const ln of d.split('\n')) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(ln);
    if (h) { flush(); const l = +h[1], s = h[2] === undefined ? 1 : +h[2]; cur = { start: s ? l - 1 : l, s, add: [] }; continue; }
    if (cur && ln.startsWith('+') && !ln.startsWith('+++')) cur.add.push(ln.slice(1));
  }
  flush();
  if (total > pos) ops.push(total - pos);
  /* نضمّ الأرقام المتتالية */
  const m = []; for (const o of ops) { const p = m[m.length - 1]; if (typeof o === 'number' && typeof p === 'number' && Math.sign(o) === Math.sign(p)) m[m.length - 1] = p + o; else m.push(o); }
  return m;
}
/* احتياط مضمون: نفس البداية + نفس النهاية، والوسط ينكتب كامل */
function simpleOps(oldText, newText) {
  const a = oldText.split('\n'), b = newText.split('\n'); let p = 0, s = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const ops = []; if (p) ops.push(p); if (a.length - p - s) ops.push(-(a.length - p - s));
  const mid = b.slice(p, b.length - s); if (mid.length) ops.push(mid.join('\n')); if (s) ops.push(s);
  return ops;
}

/* للتجربة: node tools/mkpatch.mjs --pair <قديم> <جديد> <مجلد>  ← ملف فرق واحد بين ملفين */
if (process.argv[2] === '--pair') {
  const [o, n, outDir] = process.argv.slice(3).map(f => f);
  const old = readFileSync(o, 'utf8'), nw = readFileSync(n, 'utf8'), d = mkdtempSync(join(tmpdir(), 'mkp-'));
  let ops = diffOps(old, nw, d); if (applyPatch(old, ops) !== nw) ops = simpleOps(old, nw);
  if (applyPatch(old, ops) !== nw) { console.error('pair failed'); process.exit(1); }
  mkdirSync(outDir, { recursive: true });
  const f = join(outDir, sha(old).slice(0, 16) + '.json');
  writeFileSync(f, JSON.stringify({ f: (/var VER='(v\d+)'/.exec(old) || [])[1] || '?', t: (/var VER='(v\d+)'/.exec(nw) || [])[1], fh: sha(old), th: sha(nw), ops }));
  console.log('pair', f, readFileSync(f).length); process.exit(0);
}

/* ═══ v586: وقت النشر (Cloudflare يشغّله من tools/sbimg.mjs) — ما يحتاج تاريخ git:
   ١) الصفحة الشغّالة هسه على leemak.app (اللي أغلب التلفونات عليها) ← فرق للنسخة الجديدة
   ٢) ملفات الفرق القديمة (من القائمة /u/list.json بالموقع) تنحفظ مثل ما هي — التلفون يطبّقها وحدة ورا وحدة (سلسلة)
   أي خطأ ← نطلع بهدوء (التلفونات تنزّل الصفحة كاملة مثل قبل) */
if (process.argv[2] === '--build') {
  const SITE = process.env.MKPATCH_SITE || 'https://leemak.app';
  const cur = readFileSync(join(ROOT, IDX), 'utf8'), th = sha(cur);
  const ver = (/var VER='(v\d+)'/.exec(cur) || [])[1] || '?';
  const fullGz = gzipSync(Buffer.from(cur), { level: 6 }).length;
  mkdirSync(join(ROOT, OUT), { recursive: true });
  const get = async (u, ms) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'cache-control': 'no-cache' } }); if (!r.ok) throw new Error(u + ' ' + r.status); return r; };
  const names = [];
  try {
    const live = await (await get(SITE + '/?mkpatch=' + Date.now(), 60000)).text();
    const fh = sha(live);
    if (/var VER='v\d+'/.test(live) && fh !== th) {
      const d = mkdtempSync(join(tmpdir(), 'mkp-'));
      let ops = diffOps(live, cur, d); if (applyPatch(live, ops) !== cur) ops = simpleOps(live, cur);
      const body = JSON.stringify({ f: (/var VER='(v\d+)'/.exec(live) || [])[1] || '?', t: ver, fh, th, ops });
      const gz = gzipSync(Buffer.from(body), { level: 6 }).length;
      if (applyPatch(live, ops) === cur && gz < fullGz * 0.45) { writeFileSync(join(ROOT, OUT, fh.slice(0, 16) + '.json'), body); names.push(fh.slice(0, 16)); console.log('[mkpatch] live', JSON.parse(body).f, '→', ver, '(gz ' + (gz / 1024).toFixed(1) + 'KB)'); }
    }
  } catch (e) { console.log('[mkpatch] live skipped:', e && e.message || e); }
  for (const f of readdirSync(join(ROOT, OUT))) if (/^[0-9a-f]{16}\.json$/.test(f) && !names.includes(f.slice(0, 16))) names.push(f.slice(0, 16));   /* اللي بالـ repo */
  try {
    const old = await (await get(SITE + '/u/list.json', 20000)).json();
    for (const h of (Array.isArray(old) ? old : []).slice(0, 60)) {
      if (!/^[0-9a-f]{16}$/.test(h) || names.includes(h)) continue;
      try { const t = await (await get(SITE + '/u/' + h + '.json', 20000)).text(); const j = JSON.parse(t); if (j && j.fh && j.fh.slice(0, 16) === h && Array.isArray(j.ops)) { writeFileSync(join(ROOT, OUT, h + '.json'), t); names.push(h); } } catch (e) {}
    }
  } catch (e) { console.log('[mkpatch] carry skipped:', e && e.message || e); }
  const keep = names.slice(0, 60);
  for (const f of readdirSync(join(ROOT, OUT))) if (/^[0-9a-f]{16}\.json$/.test(f) && !keep.includes(f.slice(0, 16))) unlinkSync(join(ROOT, OUT, f));
  writeFileSync(join(ROOT, OUT, 'list.json'), JSON.stringify(keep));
  console.log('[mkpatch] build: ' + keep.length + ' ملف فرق (' + ver + ')');
  process.exit(0);
}

const cur = readFileSync(join(ROOT, IDX), 'utf8');
const ver = (/var VER='(v\d+)'/.exec(cur) || [])[1];
const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
const swVer = (/const VER = 'leemak-(v\d+)'/.exec(sw) || [])[1];
if (!ver || ver !== swVer) { console.error('[mkpatch] رقم الإصدار بـ index.html (' + ver + ') لازم يطابق sw.js (' + swVer + ')'); process.exit(1); }
const th = sha(cur), fullGz = gzipSync(Buffer.from(cur), { level: 6 }).length;

const commits = git('log', '--format=%H', '-n', String(KEEP), '--', IDX).trim().split('\n').filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), 'mkp-'));
mkdirSync(join(ROOT, OUT), { recursive: true });
const made = new Set(); let skipped = 0;
for (const c of commits) {
  let old; try { old = git('show', c + ':' + IDX); } catch (e) { continue; }
  const fh = sha(old); if (fh === th || made.has(fh.slice(0, 16))) continue;
  let ops = diffOps(old, cur, dir);
  if (applyPatch(old, ops) !== cur) { ops = simpleOps(old, cur); if (applyPatch(old, ops) !== cur) { console.error('[mkpatch] فشل', c.slice(0, 7)); continue; } }
  const fromVer = (/var VER='(v\d+)'/.exec(old) || [])[1] || '?';
  const body = JSON.stringify({ f: fromVer, t: ver, fh, th, ops });
  const gz = gzipSync(Buffer.from(body), { level: 6 }).length;
  if (gz > fullGz * 0.45) { skipped++; continue; }   /* الفرق كبير — الصفحة الكاملة أحسن */
  writeFileSync(join(ROOT, OUT, fh.slice(0, 16) + '.json'), body);
  made.add(fh.slice(0, 16));
  console.log('[mkpatch]', fromVer, c.slice(0, 7), '→', ver, (body.length / 1024).toFixed(1) + 'KB', '(gz ' + (gz / 1024).toFixed(1) + 'KB)');
}
for (const f of readdirSync(join(ROOT, OUT))) if (/^[0-9a-f]{16}\.json$/.test(f) && !made.has(f.slice(0, 16))) unlinkSync(join(ROOT, OUT, f));
writeFileSync(join(ROOT, OUT, 'list.json'), JSON.stringify([...made]));
console.log('[mkpatch] ' + made.size + ' ملف فرق لـ ' + ver + ' · كامل ' + (fullGz / 1024).toFixed(0) + 'KB مضغوط · تخطّيت ' + skipped);
