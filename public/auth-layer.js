/* ═══════════════════════════════════════════════════
   طبقة الدخول — Supabase Auth حقيقي
   واصل ليمَك · v3
   يعتمد على SB_URL و SB_KEY من sb-layer.js
   ═══════════════════════════════════════════════════ */

const _SESS = 'wasel_session';
let _sb = null;

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
  _sb = window.supabase.createClient(SB_URL, SB_KEY);
  return _sb;
}

function _norm(v){
  let p = String(v || '').replace(/\D/g, '');
  if(p.startsWith('00964')) p = p.slice(5);
  if(p.startsWith('964'))   p = p.slice(3);
  p = p.replace(/^0+/, '');
  return '964' + p;
}

function _phoneOf(v){ return _norm(String(v).split('@')[0]) }
function _mail(phone){ return phone + '@wasel.app' }

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
    setTimeout(() => cb(auth.currentUser), 0);
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
      if(m.includes('Invalid login'))
        throw Object.assign(new Error('الرقم أو كلمة السر غلط'), { code: 'auth/wrong-password' });
      throw Object.assign(new Error(m), { code: 'auth/error' });
    }

    const u = { uid: data.user.id, email: _mail(phone), token: data.session.access_token };
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
      if(m.includes('already'))
        throw Object.assign(new Error('الرقم مسجّل مسبقاً'), { code: 'auth/email-already-in-use' });
      throw Object.assign(new Error(m), { code: 'auth/error' });
    }

    const u = {
      uid: data.user.id,
      email: _mail(phone),
      token: data.session ? data.session.access_token : null
    };
    _save(u); _notify(u);
    return { user: u };
  },

  async signOut(){
    const sb = await _client();
    try{ await sb.auth.signOut() }catch(e){}
    _clear(); _notify(null);
  },

  async sendPasswordResetEmail(){
    throw new Error('استخدم «نسيت كلمة المرور» — يوصلك رمز بالواتساب');
  }
};
