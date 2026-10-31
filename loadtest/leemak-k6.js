/* اختبار ضغط — واصل ليمَك (قراءة بس)
   يقلّد زبون يفتح التطبيق: الصفحة وملفاتها ← الإعدادات والإعلانات والعروض ← قائمة المحلات ← يفتح محل.
   ما يسوي طلبات، ولا يسجّل دخول، ولا يكتب أي شي بالقاعدة.
   يزيد الناس شوية شوية: 50 ← 150 ← 300، ويوقف وحده إذا صار خطأ أكثر من 2% أو صار بطيء كلش. */

import http from 'k6/http';
import { check, sleep, group } from 'k6';

const SITE = 'https://leemak.app';
const MAX = Number(__ENV.MAX || 300);

export const options = {
  stages: [
    { duration: '1m', target: Math.round(MAX / 6) },
    { duration: '1m', target: Math.round(MAX / 2) },
    { duration: '1m30s', target: MAX },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '20s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
    'http_req_duration{step:page}': ['p(95)<2000'],
    'http_req_duration{step:shops}': ['p(95)<2000'],
    'http_req_duration{step:db}': ['p(95)<2000'],
    'http_req_duration{step:shop}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

export function setup() {
  const js = http.get(`${SITE}/sb-layer.js`).body || '';
  const url = (js.match(/SB_URL\s*=\s*"([^"]+)"/) || [])[1];
  const key = (js.match(/SB_KEY\s*=\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error('no db url in sb-layer.js');
  return { url, key };
}

export default function (cfg) {
  const H = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
  const db = (path) => ({ method: 'GET', url: `${cfg.url}/rest/v1/${path}`, params: { headers: H, tags: { step: 'db' } } });

  /* 1 · فتح التطبيق: الصفحة وملفاتها */
  const P = { headers: { 'Accept-Encoding': 'br, gzip' }, tags: { step: 'page' } };   /* مثل المتصفح: الملفات مضغوطة */
  const r1 = http.batch([
    { method: 'GET', url: `${SITE}/`, params: P },
    { method: 'GET', url: `${SITE}/sb-layer.js`, params: P },
    { method: 'GET', url: `${SITE}/auth-layer.js`, params: P },
  ]);
  check(r1[0], { 'page 200': (r) => r.status === 200 });

  /* 2 · الي يجيبه التطبيق أول ما ينفتح */
  const r2 = http.batch([
    { method: 'GET', url: `${SITE}/_api/shops`, params: { tags: { step: 'shops' } } },
    db('settings?select=*&key=eq.app'),
    db('banners?select=*&active=is.true&order=sort_no.asc'),
    db('offers?select=*&is_active=eq.true&order=sort_no.asc.nullslast,value.desc'),
  ]);
  check(r2[0], { 'shops 200': (r) => r.status === 200 });
  check(r2[1], { 'db 200': (r) => r.status === 200 });
  sleep(3 + Math.random() * 4);

  /* 3 · يفتح محل */
  let ids = [];
  try { ids = (r2[0].json() || []).map((s) => s.id).filter(Boolean); } catch (e) {}
  if (ids.length) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    const r3 = http.get(`${cfg.url}/rest/v1/shops?select=*&id=eq.${id}`, { headers: H, tags: { step: 'shop' } });
    check(r3, { 'shop 200': (r) => r.status === 200 });
  }
  sleep(4 + Math.random() * 6);
}
