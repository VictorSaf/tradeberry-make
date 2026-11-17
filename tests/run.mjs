// tradeBerry test net: node tests/run.mjs [filter]   (several filters: comma-separated, a test runs if its name contains any)
// Own static server on a free port (port 0), headless Chromium via Playwright, explicit assertions.
// Exit code 1 on any failure. External requests (rates API, fonts) are aborted, so the engine uses its offline seed.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
// every tests/*.mjs except this runner exports `tests`; suite.mjs first, the rest alphabetically
const HERE = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(HERE)).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').sort((a, b) => (a === 'suite.mjs' ? -1 : b === 'suite.mjs' ? 1 : a.localeCompare(b)));
const tests = [];
for (const f of files) { const m = await import('./' + f); if (!Array.isArray(m.tests)) throw new Error(`${f} does not export tests`); tests.push(...m.tests); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(join(ROOT, path || 'index.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(path || 'index.html')] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const filter = process.argv[2] || '';
const FIXED = new Date('2026-10-16T10:30:00Z'); // pinned clock for the determinism checks (session volatility depends on the hour)

// the live world (broker + gateway + web server + fake platform, tests/fixtures/live-env.mjs), started on first use
let LIVE = null;
const liveEnv = async () => (LIVE ||= (await import('./fixtures/live-env.mjs')).startLive(ROOT));
// one fresh context per page: no shared storage, service worker or state between tests
// live: the page is served signed in (user 1 'tl' by default, or { user: 2 }) by host/server.mjs, its account is on the
// test broker through the test gateway; the page clock runs on the live world's market clock. { world } instead: a live
// world the test started itself (tests/e2e-server.mjs: broker and gateway as processes it kills and restarts)
const live = [];
async function open(path = '/', { clock = false, init = null, live: lv = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  live.push(ctx);
  const L = lv ? lv.world || await liveEnv() : null, base = L ? L.base : BASE; // lv.world: a test's own live world (startLive)
  await ctx.route(u => !u.href.startsWith(base), r => r.abort());
  // the web fonts are local since 09.11.2026 (vendor/fonts, audit F16); the tests keep measuring on the fallback fonts,
  // as when the fonts came from Google and were aborted above (A11Y-2's phone sizes were set on those)
  await ctx.route(u => u.href.startsWith(base) && /\/vendor\/fonts\/.+\.woff2$/.test(u.pathname), r => r.abort());
  if (L) {
    await ctx.addCookies(L.session(lv.user || 1));
    // the platform's chart history: the last 12 hours of the fake platform's price, a small wave around it (packed as
    // server/legacy.js packBars does); other instruments have none
    await ctx.route(u => u.href.startsWith(base + '/api/history'), r => {
      const u = new URL(r.request().url()), sym = u.searchParams.get('sym'), res = u.searchParams.get('res') === '60' ? 60 : 1, q = L.Q[sym];
      if (!q) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unknown instrument"}' });
      const ps = sym.endsWith('JPY') ? 1000 : 100000, now = Math.floor(L.clock() / 1000), step = res * 60, n = Math.min(720, Math.floor(12 * 3600 / step));
      const out = { sym, ps, t0: 0, dt: [], c: [], o: [], h: [], l: [] }; let pc = 0;
      for (let i = n; i >= 1; i--) {
        const t = Math.floor(now / step) * step - i * step, c = Math.round(q[0] * ps * (1 + 2e-3 * Math.sin(i / 9))), o = Math.round(q[0] * ps * (1 + 2e-3 * Math.sin((i + 1) / 9)));
        if (!out.t0) out.t0 = t; else out.dt.push(res);
        out.c.push(c - pc); out.o.push(c - o); out.h.push(Math.max(o, c) + 3 - c); out.l.push(c - (Math.min(o, c) - 3)); pc = c;
      }
      const before = u.searchParams.get('before');
      const body = before != null ? { ...out, from: now - (res === 60 ? 31536000 : 604800), to: now, more: false } : out;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
  const page = await ctx.newPage();
  page.live = L;
  // live: the page's socket to the execution server goes through a proxy the test steers: hold() keeps the server's
  // messages back (to see what the page shows before an answer), release() lets them through, cut() closes the link
  // and refuses new connections until mend(); sent lists the commands the page sent
  if (L) {
    const ctl = page.tl = { held: false, queue: [], sent: [], socks: [], refuse: false };
    ctl.hold = () => { ctl.held = true; };
    ctl.release = () => { ctl.held = false; for (const [ws, m] of ctl.queue.splice(0)) ws.send(m); };
    ctl.cut = () => { ctl.refuse = true; for (const s of ctl.socks.splice(0)) { s.ws.close().catch(() => {}); s.srv.close().catch(() => {}); } };
    ctl.mend = () => { ctl.refuse = false; };
    await page.routeWebSocket(/\/api\/trade/, ws => {
      if (ctl.refuse) { ws.close().catch(() => {}); return; }
      const srv = ws.connectToServer();
      ctl.socks.push({ ws, srv });
      ws.onMessage(m => { try { ctl.sent.push(JSON.parse(m)); } catch (e) { /* not JSON */ } srv.send(m); });
      srv.onMessage(m => { if (ctl.held) ctl.queue.push([ws, m]); else ws.send(m); });
    });
  }
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  // clock: true / a Date pins Date.now (frozen); clock: 'run' starts at the same instant and lets time pass (timers and Date move together)
  if (L) await page.clock.install({ time: new Date(L.clock()) });
  else if (clock === 'run') await page.clock.install({ time: FIXED });
  else if (clock) await page.clock.setFixedTime(clock instanceof Date ? clock : FIXED);
  if (init) await page.addInitScript(init.fn, init.arg);
  await page.goto(base + path);
  page.errors = errors;
  return page;
}
// boot the full app; freeze the market (speed 0) and switch off the behavioural gates so trades go straight through
// init: { fn, arg } runs before any page script (e.g. to give the store a market snapshot); clock: true or a Date pins Date.now
async function app(query = '', { freeze = true, clock = false, init = null, live = null, demo = false } = {}) {
  const page = await open('/' + query, { clock, init, live: live === true ? {} : live });
  await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
  if (freeze) await page.evaluate(() => { Engine.speed = 0; pmCfg().on = false; tiltCfg().on = false; });
  // demo history is out of the app (spec 2026-11-02): a test that needs it loads the fixture
  if (demo) { await page.addScriptTag({ url: '/tests/fixtures/demo.js' }); await page.waitForFunction(() => typeof loadDemoHistory === 'function', null, { timeout: 10000 }); }
  // live: the first snapshot of the account has arrived
  if (live) await page.waitForFunction(() => typeof TradeLink === 'object' && TradeLink.seen, null, { timeout: 20000 });
  await page.evaluate(() => {
    window.T = {
      // move a pair's mid to an exact target through the engine's own shock path (base for XXX/USD and crosses, quote for USD/XXX)
      move(sym, target) {
        const m = Engine.META[sym], ls = Math.log(target / Engine.mid(sym));
        if (m.base !== 'USD') Engine.jump(m.base, ls); else Engine.jump(m.quote, -ls);
      },
      toasts: () => [...document.querySelectorAll('#toasts .toast')].map(x => ({ title: x.querySelector('b').textContent, body: x.querySelector('span').textContent })),
      clearToasts: () => document.querySelectorAll('#toasts .toast').forEach(x => x.remove()),
      reset() { S.positions = []; S.orders = []; S.history = []; S.alerts = []; S.balance = 100000; S.peak = 100000; S.set.jur = 'eu'; S.set.lev = 30; T.clearToasts(); },
      // a deterministic platform feed for syms (no network): liveHas says yes, liveRange answers 1-minute (or 1-hour) bars
      // while the market is open, walking back from the first engine bar's open (seeded on sym and `to`). The engine's own
      // week stands as the platform week. o.startAgo: the platform history starts that many days before now;
      // o.fail: the first n calls reject (status 502). T.feedLog lists the calls.
      feed(syms, o = {}) {
        const set = new Set(syms), has0 = window.liveHas, rng0 = window.liveRange;
        let fails = o.fail || 0; T.feedLog = [];
        const start = o.startAgo != null ? Engine.simTime - o.startAgo * 86400 : -Infinity;
        const gen = (sym, res, from, to) => {
          const step = res * 60, lo = Math.max(from, start), out = [];
          let a = 0; for (const ch of sym + '|' + to) a = (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0;
          const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
          const nrm = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
          const c0 = Engine.candles[sym], sd = 6e-5 * Math.sqrt(res);
          let p = c0 && c0.length ? c0[0].open : Engine.mid(sym);
          for (let t = Math.ceil(to / step) * step - step; t >= lo; t -= step) {
            if (t >= to || !Engine.isOpen(sym, t)) continue;
            const c = p, op = c * Math.exp(-sd * nrm()), h = Math.max(op, c) * (1 + Math.abs(nrm()) * sd / 2), l = Math.min(op, c) * (1 - Math.abs(nrm()) * sd / 2);
            out.push({ time: t, open: op, high: h, low: l, close: c }); p = op;
          }
          return out.reverse();
        };
        window.liveHas = s => set.has(s) || (typeof has0 === 'function' && has0(s));
        window.liveRange = (sym, res, from, to, opt = {}) => {
          if (!set.has(sym)) return typeof rng0 === 'function' ? rng0(sym, res, from, to, opt) : Promise.reject(new Error('no feed'));
          res = res === 60 ? 60 : 1; T.feedLog.push({ sym, res, from, to });
          const total = Math.max(1, Math.ceil((to - from) / (res === 60 ? 31536000 : 604800)));
          return new Promise((resolve, reject) => {
            let i = 0;
            const tick = () => {
              if (fails > 0) { fails--; return reject(Object.assign(new Error('History unavailable (502)'), { status: 502 })); }
              i++; if (opt.onProgress) opt.onProgress(i, total);
              if (i < total) return setTimeout(tick, 0);
              const bars = gen(sym, res, from, to);
              resolve({ bars, start: bars.length > 0 && bars[0].time > from + 86400, from, to });
            };
            setTimeout(tick, 0);
          });
        };
      }
    };
  });
  return page;
}

class AssertionError extends Error {}
const fmt = v => typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
const t = {
  ok(c, msg) { if (!c) throw new AssertionError(msg); },
  eq(a, b, msg) { if (a !== b) throw new AssertionError(`${msg}: expected ${fmt(b)}, got ${fmt(a)}`); },
  near(a, b, msg, rel = 1e-9, abs = 1e-9) { if (!(Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b)))) throw new AssertionError(`${msg}: expected ${b}, got ${a}`); },
  deep(a, b, msg) { const x = String(JSON.stringify(a)), y = String(JSON.stringify(b)); if (x !== y) throw new AssertionError(`${msg}: expected ${y.slice(0, 200)}, got ${x.slice(0, 200)}`); },
  noErrors(page) { if (page.errors.length) throw new AssertionError('page errors: ' + page.errors.join(' | ')); }
};

let passed = 0, failed = 0;
const t0 = Date.now();
let pending = 0;
const filters = filter.split(',').filter(Boolean);
const chosen = tests.filter(x => !filters.length || filters.some(f => x.name.includes(f)));
// the count first and [i/n] on every line: tools/front-deploy.sh draws its progress bar from them
console.log(`# ${chosen.length} tests`);
let idx = 0;
for (const tc of chosen) {
  const s = Date.now(), n = `[${++idx}/${chosen.length}]`;
  // a test written for a part another task builds (tc.pending says which): listed, not run, never counted as passed
  if (tc.pending) { pending++; console.log(`  pend ${n} ${tc.name} (${tc.pending})`); continue; }
  try {
    await tc.run({ t, app, open });
    passed++; console.log(`  ok   ${n} ${tc.name} (${Date.now() - s} ms)`);
  } catch (e) {
    failed++; console.log(`  FAIL ${n} ${tc.name}\n       ${e instanceof AssertionError ? e.message : e.stack || e}`);
  } finally { await Promise.all(live.splice(0).map(c => c.close().catch(() => {}))); }
}
await browser.close();
server.close();
if (LIVE) await (await LIVE).close();
console.log(`\n${passed} passed, ${failed} failed${pending ? `, ${pending} pending` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed || !passed ? 1 : 0);
