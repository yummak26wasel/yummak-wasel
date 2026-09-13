#!/usr/bin/env python3
"""
store-patch.py — يطبّق تعديلات جاهزية المتجر على public/index.html

ليش ملف مستقل: الموقع ينرفع كاملاً من نسخة محلية عبر GitHub، وكل رفعة
تمسح التعديلات. شغّل هذا بعد أي رفع ويرجّعها كلها:

    python3 tools/store-patch.py

آمن للتكرار: كل خطوة تتخطى نفسها إذا كانت مطبّقة من قبل.
"""
import re, sys, pathlib

P = pathlib.Path(__file__).resolve().parent.parent / "public" / "index.html"
s = P.read_text(encoding="utf-8")
before = s
log = []

def match_end(s, start, tag):
    op, cl = re.compile(r"<" + tag + r"\b"), re.compile(r"</" + tag + r"\s*>")
    i, d = start, 0
    while True:
        mo, mc = op.search(s, i), cl.search(s, i)
        if mc is None:
            sys.exit(f"unbalanced <{tag}> at {start}")
        if mo and mo.start() < mc.start():
            d += 1; i = mo.end()
        else:
            d -= 1; i = mc.end()
            if d == 0:
                return i

def cut(pattern, tag, label):
    global s
    m = re.search(pattern, s)
    if not m:
        log.append(f"  skip   {label} (already gone)"); return
    s = s[:m.start()] + s[match_end(s, m.start(), tag):]
    log.append(f"  remove {label}")

def once(marker, label, fn):
    """run fn() only if marker is not already in the file"""
    global s
    if marker in s:
        log.append(f"  skip   {label} (already applied)"); return
    s = fn(s)
    assert marker in s, f"{label}: marker missing after apply"
    log.append(f"  apply  {label}")

# ─── ١ · واجهة غير فعّالة (Guideline 2.1) ───────────────────────────
cut(r'<div class="screen" id="setup">', "div", "#setup Firebase screen")
s = s.replace("<!-- ═══ SETUP ═══ -->\n", "", 1)
s = s.replace("document.getElementById('setup').classList.add('on'); return;",
              "console.error('firebase not configured'); return;", 1)
cut(r"<button class=\"apill\" onclick=\"toast\('التطبيق بالعربية", "button", "language pill")
cut(r"<button class=\"gbtn\" onclick=\"toast\('تسجيل Google", "button", "Google sign-in button")
s = s.replace('<div class="ordiv"><span>أو</span></div> ', "", 1)
m = re.search(r'<div class="opt dis">(?:(?!</div>).)*?بطاقة إلكترونية — قريباً.*?</div>\s*', s, re.S)
if m: s = s[:m.start()] + s[m.end():]; log.append("  remove e-card checkout option")
m = re.search(r"'\+\s*'<button type=\"button\" class=\"dw-pay off\".*?</button>';", s, re.S)
if m: s = s[:m.start()] + "';" + s[m.end():]; log.append("  remove e-payment wizard button")

# ─── ٢ · leemak-api ─────────────────────────────────────────────────
API = "const API_WORKER='https://leemak-api.dhifvmy.workers.dev';"
once(API, "API_WORKER constant",
     lambda t: t.replace("const OTP_WORKER='https://leemak-otp.dhifvmy.workers.dev';",
                         "const OTP_WORKER='https://leemak-otp.dhifvmy.workers.dev';\n" + API, 1))

# الإشعار يروح للاثنين: leemak-otp (المتصفح/FCM) و leemak-api (التطبيق/Expo)
OLD_SEND = """    await fetch(OTP_WORKER+'/push',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},
      body:JSON.stringify(Object.assign({
        title:__clean(title)||'واصل ليمَك',
        body:__clean(body),
        url:'/', tag:(data&&data.type)||'lw'
      },target))});"""
NEW_SEND = """    const init={method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},
      body:JSON.stringify(Object.assign({
        title:__clean(title)||'واصل ليمَك',
        body:__clean(body),
        url:'/', tag:(data&&data.type)||'lw'
      },target))};
    /* leemak-otp للمتصفح · leemak-api لتطبيق الآيفون/أندرويد (Expo) */
    await Promise.allSettled([fetch(OTP_WORKER+'/push',init),fetch(API_WORKER+'/push',init)]);"""
once("fetch(API_WORKER+'/push',init)", "__sendPush → leemak-api",
     lambda t: t.replace(OLD_SEND, NEW_SEND, 1) if OLD_SEND in t else sys.exit("__sendPush body changed — update store-patch.py"))

# حذف الحساب + إلغاء رمز الإشعار عند الخروج
FN = r"""
/* ══════ حذف الحساب — آبل 5.1.1(v) ══════ */
async function askDeleteAccount(){
  if(!confirm('حذف الحساب نهائي: تنمسح بياناتك الشخصية وما تكدر ترجعها. تريد تكمل؟')) return;
  if(!confirm('تأكيد أخير — راح ينحذف حسابك الآن.')) return;
  const jwt=(window.__waselToken&&window.__waselToken())||'';
  if(!jwt){ toast('سجّل دخولك أولاً'); return }
  busy(true);
  try{
    const r=await fetch(API_WORKER+'/delete-account',{method:'POST',headers:{'Authorization':'Bearer '+jwt}});
    const j=await r.json().catch(()=>({}));
    if(r.status===403&&j.error==='admin_account'){ toast('حساب الإدارة ما ينحذف من التطبيق'); return }
    if(r.status===403&&j.error==='demo_account'){ toast('هذا حساب تجريبي مخصص لمراجعة المتجر، ومحمي من الحذف. حسابات المستخدمين العادية تنحذف فوراً.'); return }
    if(!r.ok||!j.ok) throw new Error(j.error||('HTTP '+r.status));
    toast('انحذف حسابك');
    try{ localStorage.clear() }catch(e){}
    setTimeout(()=>{ Promise.resolve().then(()=>auth.signOut()).catch(()=>{}).then(()=>location.reload()) },1200);
  }catch(e){
    console.warn('delete account:',e.message);
    toast('ما انحذف الحساب — حاول مرة ثانية أو راسل الدعم');
  }finally{ busy(false) }
}
/* يفك رمز إشعار التطبيق عن الحساب قبل الخروج، حتى ما توصل
   إشعاراته لجهاز صار بيد شخص ثاني */
function __dropNativePush(){
  const t=window.__waselExpoToken, jwt=(window.__waselToken&&window.__waselToken())||'';
  if(!t||!jwt) return Promise.resolve();
  const req=fetch(API_WORKER+'/push/unregister',{method:'POST',keepalive:true,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},
    body:JSON.stringify({token:t})}).catch(()=>{});
  return Promise.race([req,new Promise(r=>setTimeout(r,3000))]);
}
"""
OLD_LOGOUT = "function logout(){ if(confirm('تريد تسجيل الخروج؟')){unsubscribeTopics();auth.signOut().then(()=>location.reload())} }"
NEW_LOGOUT = "function logout(){ if(confirm('تريد تسجيل الخروج؟')){unsubscribeTopics();__dropNativePush().then(()=>auth.signOut()).then(()=>location.reload())} }"
once("async function askDeleteAccount()", "askDeleteAccount + logout unregister",
     lambda t: t.replace(OLD_LOGOUT, NEW_LOGOUT + "\n" + FN, 1) if OLD_LOGOUT in t else sys.exit("logout() changed — update store-patch.py"))

# حسابات المراجعة المحمية — للملفات اللي فيها askDeleteAccount بدون هذا السطر
ADMIN_LINE = """    if(r.status===403&&j.error==='admin_account'){ toast('حساب الإدارة ما ينحذف من التطبيق'); return }
"""
DEMO_LINE = """    if(r.status===403&&j.error==='demo_account'){ toast('هذا حساب تجريبي مخصص لمراجعة المتجر، ومحمي من الحذف. حسابات المستخدمين العادية تنحذف فوراً.'); return }
"""
once("error==='demo_account'", "demo-account message",
     lambda t: t.replace(ADMIN_LINE, ADMIN_LINE + DEMO_LINE, 1))

# الطلب الملغي (status = 'cancelled'): خريطة LBL ما فيها المفتاح، فبطاقة
# الطلب عند الزبون تكتب "undefined" مرتين وتعرض موعد وصول وتتبّع لطلب ملغي.
def add_cancelled_label(t):
    m = re.search(r"rejected:'(<svg.*?</svg>) رفضه المحل'\}", t, re.S)
    if not m: sys.exit("LBL map changed — update store-patch.py")
    return t[:m.start()] + f"rejected:'{m.group(1)} رفضه المحل',cancelled:'{m.group(1)} ملغي'}}" + t[m.end():]
once("رفضه المحل',cancelled:", "LBL: cancelled label", add_cancelled_label)

CARD_DONE = re.compile(r"const done=\(o\.status==='delivered'\|\|o\.status==='rejected'\);(\s*const _r=shopRating\(sh\))")
def card_done(t):
    m = CARD_DONE.search(t)
    if not m: sys.exit("order card done-check changed — update store-patch.py")
    return t[:m.start()] + "const done=(o.status==='delivered'||o.status==='rejected'||o.status==='cancelled');" + m.group(1) + t[m.end():]
# ما نستعمل once() هنا: نفس النص موجود بـ DONE العامة، فالعلامة لازم تكون السطر نفسه
CARD_DONE_NEW = re.compile(r"const done=\(o\.status==='delivered'\|\|o\.status==='rejected'\|\|o\.status==='cancelled'\);\s*const _r=shopRating\(sh\)")
if CARD_DONE_NEW.search(s):
    log.append("  skip   order card: cancelled counts as done (already applied)")
else:
    s = card_done(s); log.append("  apply  order card: cancelled counts as done")

once(".st-rejected,.st-cancelled{", "cancelled status styling",
     lambda t: t.replace("\n.st-rejected{", "\n.st-rejected,.st-cancelled{")
                .replace("\n.ordstat.st-rejected{", "\n.ordstat.st-rejected,.ordstat.st-cancelled{"))

# ─── ٣ · أزرار الحذف بالواجهة ───────────────────────────────────────
TRASH = ('<svg class="wic" viewBox="0 0 24 24" fill="none" stroke="currentColor">'
         '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg>')

CUST_ROW = ('<div class="mrow" onclick="askDeleteAccount()" data-del="1"><div class="mi danger">' + TRASH +
            '</div><div class="mt" style="color:var(--dg)">حذف حسابي نهائياً</div><div class="ma">‹</div></div>')
LOGOUT_ROW = re.compile(r'<div class="mrow" onclick="logout\(\)">.*?<div class="ma">‹</div></div>', re.S)
def add_customer(t):
    m = LOGOUT_ROW.search(t)
    if not m: sys.exit("customer logout row not found — update store-patch.py")
    return t[:m.end()] + CUST_ROW + t[m.end():]
once('onclick="askDeleteAccount()" data-del="1"', "customer delete row (p_more)", add_customer)

def panel(pid, note):
    return ('<div class="panel" data-del="' + pid + '"><h3 class="ttl">' + TRASH + ' حذف الحساب</h3>'
            '<div class="tgnote">' + note + '</div><div class="btns">'
            '<button class="btn" style="background:var(--dg)" onclick="askDeleteAccount()">حذف حسابي نهائياً</button>'
            '</div></div> ')
def add_panel(pid, note):
    def f(t):
        m = re.search(r'<div class="page[^"]*" id="' + pid + '"', t)
        if not m: sys.exit(f"page {pid} not found — update store-patch.py")
        end = match_end(t, m.start(), "div")
        close = t.rfind("</div>", m.start(), end)
        return t[:close] + panel(pid, note) + t[close:]
    return f
once('data-del="q_set"', "store delete panel (q_set)", add_panel("q_set",
     "حذف حسابك يمسح بياناتك الشخصية نهائياً ويسكّر محلك من التطبيق. سجل الطلبات يبقى بدون اسمك لأغراض المحاسبة فقط."))
once('data-del="d_set"', "driver delete panel (d_set)", add_panel("d_set",
     "حذف حسابك يمسح بياناتك الشخصية وصورك ووثائقك نهائياً. سجل التوصيلات والتسويات يبقى بدون اسمك لأغراض المحاسبة فقط."))

# ─── ٤ · تحقق ───────────────────────────────────────────────────────
for bad in ["قريباً إن شاء الله", "لغات ثانية قريباً", "بطاقة إلكترونية — قريباً",
            "الدفع الإلكتروني — قريباً", "console.firebase.google.com"]:
    assert bad not in s, f"placeholder still present: {bad}"

P.write_text(s, encoding="utf-8")
print("\n".join(log))
print(f"{len(before):,} → {len(s):,} chars" + ("" if s != before else "  (no changes)"))
