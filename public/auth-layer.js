/* ═══════════════════════════════════════════════════
   طبقة الدخول — Supabase Auth حقيقي
   واصل ليمَك · v4

   يعتمد على SB_URL و SB_KEY من sb-layer.js
   ويوفّر window.__waselToken() ← sb-layer يقرأ منها
   التوكن الحي (يتجدّد تلقائياً كل ساعة)
   ═══════════════════════════════════════════════════ */

const _SESS = 'wasel_session';
const _DOM  = '@wasel.app';

let _sb = null;
let _live = null;          /* آخر توكن حي */

/* ── تحميل SDK وتهيئة العميل ── */
async function _client(){
  if(_sb) return _sb;

  if(!window.supabase){
    await new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = ok; s.onerror = no;
      document.head.appendChild(s);
    });
  }

  _sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  /* أي تغيّر بالجلسة (دخول · تجديد · خروج) نحدّث التوكن */
  _sb.auth.onAuthStateChange((_e, session) => {
    _live = session ? session.access_token : null;
    if(session){
      _save({
        uid: session.user.id,
        email: session.user.email,
        token: session.access_token
      });
    }
  });

  /* جلسة محفوظة من زيارة سابقة */
  try{
    const { data } = await _sb.auth.getSession();
    if(data && data.session){
      _live = data.session.access_token;
      _save({
        uid: data.session.user.id,
        email: data.session.user.email,
        token: data.session.access_token
      });
    }
  }catch(e){}

  return _sb;
}

/* ── sb-layer ينادي هذي عند كل طلب ── */
window.__waselToken = function(){
  if(_live) return _live;
  try{
    const s = JSON.parse(localStorage.getItem(_SESS));
    return (s && s.token) || null;
  }catch(e){ return null }
};

/* ── توحيد الرقم: أي صيغة ← 964XXXXXXXXX ── */
function _norm(v){
  let p = String(v || '').replace(/\D/g, '');
  if(p.startsWith('00964')) p = p.slice(5);
  if(p.startsWith('964'))   p = p.slice(3);
  p = p.replace(/^0+/, '');
  return '964' + p;
}

function _phoneOf(v){ return _norm(String(v).split('@')[0]) }
function _mail(phone){ return phone + _DOM }

function _save(u){ try{ localStorage.setItem(_SESS, JSON.stringify(u)) }catch(e){} }
function _load(){ try{ return JSON.parse(localStorage.getItem(_SESS)) }catch(e){ return null } }
function _clear(){ try{ localStorage.removeItem(_SESS) }catch(e){} }

const _watchers = [];
function _notify(u){ _watchers.forEach(f => { try{ f(u) }catch(e){} }) }

const auth = {

  get currentUser(){
    const u = _load();
    return u ? { uid: u.uid, email: u.email } : null;
  },

  onAuthStateChanged(cb){
    _watchers.push(cb);
    /* نجهّز العميل أول — عشان الجلسة المحفوظة تنقرأ قبل النداء */
    _client().then(() => cb(auth.currentUser)).catch(() => cb(auth.currentUser));
    return () => { const i = _watchers.indexOf(cb); if(i > -1) _watchers.splice(i,1) };
  },

  async signInWithEmailAndPassword(email, pass){
    const sb = await _client();
    const phone = _phoneOf(email);

    const { data, error } = await sb.auth.signInWithPassword({
      email: _mail(phone), password: pass
    });

    if(error){
      const m = String(error.message || '');
      if(m.includes('Invalid login') || m.includes('Invalid'))
        throw Object.assign(new Error('الرقم أو كلمة المرور غلط'),
          { code: 'auth/invalid-credential' });
      throw Object.assign(new Error(m), { code: 'auth/error' });
    }

    _live = data.session.access_token;
    const u = { uid: data.user.id, email: _mail(phone), token: _live };
    _save(u); _notify(u);
    return { user: u };
  },

  async createUserWithEmailAndPassword(email, pass){
    const sb = await _client();
    const phone = _phoneOf(email);

    const { data, error } = await sb.auth.signUp({
      email: _mail(phone), password: pass
    });

    if(error){
      const m = String(error.message || '');
      if(m.includes('already') || m.includes('registered'))
        throw Object.assign(new Error('الرقم مسجّل مسبقاً'),
          { code: 'auth/email-already-in-use' });
      if(m.includes('at least') || m.includes('weak'))
        throw Object.assign(new Error('كلمة المرور ضعيفة'),
          { code: 'auth/weak-password' });
      throw Object.assign(new Error(m), { code: 'auth/error' });
    }

    _live = data.session ? data.session.access_token : null;
    const u = { uid: data.user.id, email: _mail(phone), token: _live };
    _save(u); _notify(u);
    return { user: u };
  },

  async signOut(){
    const sb = await _client();
    try{ await sb.auth.signOut() }catch(e){}
    _live = null;
    _clear(); _notify(null);
  },

  async sendPasswordResetEmail(){
    throw new Error('استخدم «نسيت كلمة المرور» — يوصلك رمز بالواتساب');
  }
};
