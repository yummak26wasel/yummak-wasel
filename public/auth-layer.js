/* ═══════════════════════════════════════════════════
   طبقة الدخول — Firebase Auth ⇄ Supabase
   واصل ليمَك

   تقلّد Firebase Auth بالضبط، بس تشتغل على جدول profiles.
   التطبيق ما يحس بأي فرق.
   ═══════════════════════════════════════════════════ */

/* يستخدم SB_URL و SB_KEY و _req من sb-layer.js */

const _SESS = 'wasel_session';

/* الرقم من الإيميل: 964771234567@yummak-wasel.app → 964771234567 */
function _phoneOf(email){
  return String(email).split('@')[0].replace(/\D/g,'');
}

/* نفس التجزئة المستخدمة بدالة verify-otp */
async function _hash(pass, phone){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass + phone));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}

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
    const phone = _phoneOf(email);
    const rows = await _req(`profiles?select=*&phone=eq.${phone}`);
    const p = rows && rows[0];

    if(!p) throw Object.assign(new Error('الرقم غير مسجّل'), { code: 'auth/user-not-found' });

    const h = await _hash(pass, phone);
    if(p.password_hash !== h)
      throw Object.assign(new Error('كلمة السر غلط'), { code: 'auth/wrong-password' });

    const u = { uid: p.id, email };
    _save(u); _notify(u);
    return { user: u };
  },

  async createUserWithEmailAndPassword(email, pass){
    const phone = _phoneOf(email);

    const exist = await _req(`profiles?select=id&phone=eq.${phone}`);
    if(exist && exist.length)
      throw Object.assign(new Error('الرقم مسجّل مسبقاً'), { code: 'auth/email-already-in-use' });

    const uid = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
    const h = await _hash(pass, phone);

    await _req('profiles', {
      method: 'POST',
      body: JSON.stringify({ id: uid, phone, password_hash: h, role: 'customer', is_verified: false })
    });

    const u = { uid, email };
    _save(u); _notify(u);
    return { user: u };
  },

  async signOut(){
    _clear(); _notify(null);
  },

  async sendPasswordResetEmail(){
    throw new Error('استخدم «نسيت كلمة المرور» — يوصلك رمز بالواتساب');
  }
};
