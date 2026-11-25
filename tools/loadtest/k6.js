/* اختبار ضغط — واصل ليمَك (قراءة بس، ماكو طلبات ولا كتابة)
   يمثّل زبائن يفتحون التطبيق ويتصفحون: الصفحة ← المحلات ← منيو محل ← صور ← العروض/العجلة
   3 مستويات ورا بعض: 100 ثم 300 ثم 600 زبون بنفس اللحظة. + 150 خط مباشر (طلبات شغّالة/سواق/محلات) */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const APP = 'https://leemak.app';
const SB = 'https://obvxqyfmcmldruauhsgw.supabase.co';
const KEY = 'sb_publishable_HJxHDApXLZVPVQ1p8wqq6w_ELPotqfq';
const SHOPS = '96b07a66-51af-44d2-8d42-e0c4139c53cc,23310b07-a485-4aa1-b30f-1003498e84df,1586355e-2cbc-4504-a2f0-a88d91a0ce78,65fba577-91aa-4aa7-a38a-1b052759a0cd,2f5a4987-423f-4762-bf1f-a2701be7c061,c4bef891-d789-47ca-aedb-9d87acc962cc,baf2b73a-2036-4a62-a249-0b321d3a885c,dc4afd6b-0c79-44ba-aecb-07f3532c6e38,fd17a0c9-16fc-413f-a272-460f35501c07,00dc5fe6-1fe5-4c48-a126-a7c88830bf51,aac59b6d-6acc-4fc0-9d8a-a3397b779ff7,42de7a7f-7b81-49c2-9a8e-03f58c0bfafc,b72eb6ff-9d7e-4316-903b-acb43c328acc,0da45cf5-844c-47f5-ab2f-ecbc2ab513a0'.split(',');
const IMGS = ['bm-002','bm-003','bm-005n','bm-006n','bm-007n','bm-009n','bm-010','bm-010n'].map(n => '/m/baghdad/' + n + '.t.webp');
const SBH = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const rtJoinMs = new Trend('rt_join_ms', true);
const rtOk = new Counter('rt_join_ok');
const rtFail = new Counter('rt_join_fail');

const NAMES = ['index', 'feed', 'menu', 'img', 'offers', 'wheel'];
const LEVELS = ['u100', 'u300', 'u600'];
const thresholds = {};
for (const s of LEVELS) for (const n of NAMES) {
  thresholds[`http_req_duration{scenario:${s},name:${n}}`] = ['p(95)<60000'];
  thresholds[`http_req_failed{scenario:${s},name:${n}}`] = ['rate<1'];
}
thresholds['rt_join_ms'] = ['p(95)<60000'];

export const options = {
  discardResponseBodies: true,
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
  scenarios: {
    u100: { executor: 'constant-vus', vus: 100, duration: '90s', exec: 'browse', startTime: '0s', gracefulStop: '10s' },
    u300: { executor: 'constant-vus', vus: 300, duration: '90s', exec: 'browse', startTime: '100s', gracefulStop: '10s' },
    u600: { executor: 'constant-vus', vus: 600, duration: '90s', exec: 'browse', startTime: '200s', gracefulStop: '10s' },
    live: { executor: 'constant-vus', vus: 150, duration: '75s', exec: 'live', startTime: '200s', gracefulStop: '15s' },
  },
};

const pick = a => a[Math.floor(Math.random() * a.length)];

export function browse() {
  let r = http.get(APP + '/', { tags: { name: 'index' }, headers: { 'Accept-Encoding': 'gzip, br' } });
  check(r, { 'index 200': x => x.status === 200 });
  r = http.get(APP + '/_api/feed', { tags: { name: 'feed' } });
  check(r, { 'feed 200': x => x.status === 200 });
  sleep(1 + Math.random() * 2);
  r = http.get(APP + '/_api/menu?id=' + pick(SHOPS) + '&v=lt' + Math.floor(Math.random() * 3), { tags: { name: 'menu' } });
  check(r, { 'menu 200': x => x.status === 200 });
  const batch = [];
  for (let i = 0; i < 6; i++) batch.push(['GET', APP + pick(IMGS), null, { tags: { name: 'img' } }]);
  http.batch(batch);
  r = http.get(SB + '/rest/v1/offers?select=*&is_active=eq.true&limit=30', { headers: SBH, tags: { name: 'offers' } });
  check(r, { 'offers 200': x => x.status === 200 });
  r = http.post(SB + '/rest/v1/rpc/wheel_state', '{}', { headers: SBH, tags: { name: 'wheel' } });
  check(r, { 'wheel 200': x => x.status === 200 });
  sleep(2 + Math.random() * 4);
}

export function live() {
  const url = SB.replace('https', 'wss') + '/realtime/v1/websocket?apikey=' + KEY + '&vsn=1.0.0';
  const t0 = Date.now();
  let joined = false, replied = false;
  const res = ws.connect(url, {}, socket => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ topic: 'realtime:w_orders', event: 'phx_join', ref: '1', join_ref: '1',
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'shops' }] }, access_token: KEY } }));
      socket.setInterval(() => socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' })), 25000);
    });
    socket.on('message', m => {
      if (joined) return;
      try { const j = JSON.parse(m); if (j.event === 'phx_reply' && j.ref === '1') { replied = true; joined = j.payload && j.payload.status === 'ok'; rtJoinMs.add(Date.now() - t0); if (joined) rtOk.add(1); else rtFail.add(1); } } catch (e) {}
    });
    socket.setTimeout(() => socket.close(), 60000);
  });
  check(res, { 'ws ok': x => x && x.status === 101 });
  if (!replied) rtFail.add(1);
}

export function handleSummary(data) {
  const m = data.metrics, row = [];
  for (const s of LEVELS) for (const n of NAMES) {
    const d = m[`http_req_duration{scenario:${s},name:${n}}`], f = m[`http_req_failed{scenario:${s},name:${n}}`];
    if (!d) continue;
    row.push([s, n, Math.round(d.values['med']), Math.round(d.values['p(95)']), Math.round(d.values['max']), f ? (f.values.rate * 100).toFixed(1) + '%' : '-', f ? f.values.passes + f.values.fails : '-'].join('\t'));
  }
  const rt = m['rt_join_ms'];
  const txt = 'level\tendpoint\tmed_ms\tp95_ms\tmax_ms\tfail\treqs\n' + row.join('\n') +
    '\n\nrealtime joins ok=' + (m['rt_join_ok'] ? m['rt_join_ok'].values.count : 0) + ' fail=' + (m['rt_join_fail'] ? m['rt_join_fail'].values.count : 0) +
    (rt ? ' join_med=' + Math.round(rt.values['med']) + 'ms p95=' + Math.round(rt.values['p(95)']) + 'ms' : '') +
    '\nchecks: ' + JSON.stringify(data.root_group.checks.map(c => [c.name, c.passes, c.fails])) +
    '\niterations=' + (m.iterations ? m.iterations.values.count : 0) + ' data_received_MB=' + (m.data_received ? Math.round(m.data_received.values.count / 1e6) : 0) + '\n';
  return { 'tools/loadtest/out/result.txt': txt, 'tools/loadtest/out/summary.json': JSON.stringify(data, null, 1), stdout: txt };
}
