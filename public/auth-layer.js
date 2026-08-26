/* ═══════════════════════════════════════════════════
   طبقة الدخول — Firebase Auth ⇄ Supabase
   واصل ليمَك · v2

   يستخدم SB_URL و SB_KEY و _req من sb-layer.js
   ═══════════════════════════════════════════════════ */

const _SESS = 'wasel_session';

/* توحيد الرقم — يقبل أي صيغة ويرجّع 964XXXXXXXXX */
function _norm(v){
  let p = String(v || '').replace(/\D/g, '');
  if(p.startsWith('00964')) p = p.slice(5);
  if(p.startsWith('964'))   p = p.slice(3);
  p = p.replace(/^0+/, '');
  return '964' + p;
}

/* الرقم من الإيميل أو من رقم مباشر */
function _phoneOf(v){
  return _norm(String(v).split('@')[0]);
}

async function _hash(pass, phone){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass + phone));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}

function _save(u){ try{ localStorage.setItem(_SESS, JSON.stringify(u)) }catch(e){} }
function _load(){ try{ return JSON.parse(localStorage.getItem(_SESS)) }catch(e){ return null } }
function _clear(){ try{ localStorage.removeItem(_SESS) }catch(e){} }

const _watchers = [];
function _notify(u){ _watchers.forEach(f => { try{ f(u) }catch(e){} }) }

/* يدوّر الحساب بكل الصيغ الممكنة — فما يضيع حساب أبداً */
async function _find(phone){
  const core = phone.slice(3);                       // بلا 964
  const forms = [phone, '0' + core, core, '+' + phone, '00' + phone];
  for(const f of forms){
    const rows = await _req(`profiles?select=*&phone=eq.${encodeURIComponent(f)}`);
    if(rows && rows[0]){
      /* لقيناه بصيغة قديمة ← نوحّدها عشان ما تتكرر المشكلة */
      if(rows[0].phone !== phone){
        try{
          await _req(`profiles?id=eq.${encodeURIComponent(rows[0].id)}`, {
            method: 'PATCH', body: JSON.stringify({ phone })
          });
          rows[0].phone = phone;
        }catch(e){}
      }
      return rows[0];
    }
  }
  return null;
}

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
    const p = await _find(phone);

    if(!p) throw Object.assign(new Error('الرقم غير مسجّل'), { code: 'auth/user-not-found' });

    /* نجرّب التجزئة بكل الصيغ — للحسابات القديمة */
    const core = phone.slice(3);
    let ok = false;
    for(const f of [phone, '0' + core, core]){
      if(p.password_hash === await _hash(pass, f)){ ok = true; break }
    }

    if(!ok) throw Object.assign(new Error('كلمة السر غلط'), { code: 'auth/wrong-password' });

    /* نوحّد التجزئة على الصيغة الرسمية */
    const std = await _hash(pass, phone);
    if(p.password_hash !== std){
      try{
        await _req(`profiles?id=eq.${encodeURIComponent(p.id)}`, {
          method: 'PATCH', body: JSON.stringify({ password_hash: std })
        });
      }catch(e){}
    }

    const u = { uid: p.id, email };
    _save(u); _notify(u);
    return { user: u };
  },

  async createUserWithEmailAndPassword(email, pass){
    const phone = _phoneOf(email);

    if(await _find(phone))
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

  async signOut(){ _clear(); _notify(null) },

  async sendPasswordResetEmail(){
    throw new Error('استخدم «نسيت كلمة المرور» — يوصلك رمز بالواتساب');
  }
};
