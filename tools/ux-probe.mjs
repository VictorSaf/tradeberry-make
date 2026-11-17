#!/usr/bin/env node
/* UX probe (skill ux-xx): run one small script against a fresh page of the app and print what it returns.
     node tools/ux-probe.mjs .mace/ux/probes/<lens>/<name>.mjs [--w 1220] [--live]
   The script:   export default async ({ page, shot, L, base }) => { …; return anythingJSON; }
   - default: the SOURCE on its own static server, a fresh browser context (its own sandbox account, $100,000), the clock
     started at Tue 2026-10-20 10:00 UTC (FX open), the market frozen (Engine.speed = 0; set it back to 1 if you need ticks).
   - --live: the live world of the test suite (tests/fixtures/live-env.mjs): the real temporary broker and gateway and the
     real web server, on a fake platform whose prices the script moves: L.quote('EURUSD', bid, ask). L.acct('u1')… reads the
     broker's own books (ask L.accounts() for the ids), L.clock() the market clock. page.tl.hold() keeps the server's
     answers back, release() lets them through, cut() drops the link, mend() allows it again; page.tl.sent lists what the
     page sent. A fresh context is a fresh demo account.
   - shot('name') saves .mace/ux/shots/<name>.png. page.problems lists page errors and native dialogs.
   Opening Note and the tour invitation are removed; the pre-mortem and tilt gates stay as the app has them.
   Nothing here reaches the live server or a person's browser profile. */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), file = argv.find(a => !a.startsWith('--') && a.endsWith('.mjs')), LIVE = argv.includes('--live');
const wi = argv.indexOf('--w'), width = wi < 0 ? 1220 : +argv[wi + 1], height = { 1081: 800, 1220: 934, 1440: 900, 1920: 1080 }[width] || 900;
if (!file) { console.error('usage: node tools/ux-probe.mjs <script.mjs> [--w 1220] [--live]'); process.exit(1); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

let L = null, server = null, base;
if (LIVE) { L = await (await import(join(ROOT, 'tests/fixtures/live-env.mjs'))).startLive(ROOT); base = L.base; }
else {
  server = http.createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (p.startsWith('..')) return res.writeHead(403).end();
    try { const body = await readFile(join(ROOT, p || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(p || 'index.html')] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body); } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height } });
await ctx.route(u => !u.href.startsWith(base), r => r.abort());
if (L) {
  await ctx.addCookies(L.session(1));
  // the platform's chart history, as tests/run.mjs serves it: 12 hours of the fake platform's price
  await ctx.route(u => u.href.startsWith(base + '/api/history'), r => {
    const u = new URL(r.request().url()), sym = u.searchParams.get('sym'), res = u.searchParams.get('res') === '60' ? 60 : 1, q = L.Q[sym];
    if (!q) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unknown instrument"}' });
    const ps = sym.endsWith('JPY') ? 1000 : 100000, now = Math.floor(L.clock() / 1000), step = res * 60, n = Math.min(720, Math.floor(12 * 3600 / step));
    const out = { sym, ps, t0: 0, dt: [], c: [], o: [], h: [], l: [] }; let pc = 0;
    for (let i = n; i >= 1; i--) { const t = Math.floor(now / step) * step - i * step, c = Math.round(q[0] * ps * (1 + 2e-3 * Math.sin(i / 9))), o = Math.round(q[0] * ps * (1 + 2e-3 * Math.sin((i + 1) / 9))); if (!out.t0) out.t0 = t; else out.dt.push(res); out.c.push(c - pc); out.o.push(c - o); out.h.push(Math.max(o, c) + 3 - c); out.l.push(c - (Math.min(o, c) - 3)); pc = c; }
    const before = u.searchParams.get('before');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(before != null ? { ...out, from: now - (res === 60 ? 31536000 : 604800), to: now, more: false } : out) });
  });
}
const page = await ctx.newPage();
page.problems = [];
page.on('pageerror', e => page.problems.push('error: ' + String(e).slice(0, 300)));
page.on('dialog', d => { page.problems.push(`native ${d.type()}: ${d.message().slice(0, 160)}`); d.dismiss().catch(() => {}); });
if (L) {
  const ctl = page.tl = { held: false, queue: [], sent: [], socks: [], refuse: false };
  ctl.hold = () => { ctl.held = true; };
  ctl.release = () => { ctl.held = false; for (const [ws, m] of ctl.queue.splice(0)) ws.send(m); };
  ctl.cut = () => { ctl.refuse = true; for (const s of ctl.socks.splice(0)) { s.ws.close().catch(() => {}); s.srv.close().catch(() => {}); } };
  ctl.mend = () => { ctl.refuse = false; };
  await page.routeWebSocket(/\/api\/trade/, ws => {
    if (ctl.refuse) { ws.close().catch(() => {}); return; }
    const srv = ws.connectToServer(); ctl.socks.push({ ws, srv });
    ws.onMessage(m => { try { ctl.sent.push(JSON.parse(m)); } catch { /* not JSON */ } srv.send(m); });
    srv.onMessage(m => { if (ctl.held) ctl.queue.push([ws, m]); else ws.send(m); });
  });
  L.accounts = () => { try { return L.B.accounts ? L.B.accounts() : Object.keys(L.B).filter(k => /^u\d/.test(k)); } catch { return []; } };
}
await page.clock.install({ time: new Date(L ? L.clock() : '2026-10-20T10:00:00Z') });
await page.goto(base + '/');
await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
if (L) await page.waitForFunction(() => typeof TradeLink === 'object' && TradeLink.seen, null, { timeout: 20000 });
await page.evaluate(live => { if (!live) Engine.speed = 0; document.getElementById('onote')?.remove(); document.querySelector('.tour-chip')?.remove(); }, !!L);
await mkdir(join(ROOT, '.mace/ux/shots'), { recursive: true });
const shot = async name => { const f = join(ROOT, '.mace/ux/shots', name.replace(/[^\w.-]+/g, '-') + '.png'); await page.screenshot({ path: f }); return f; };

let code = 0;
try {
  const fn = (await import(pathToFileURL(resolve(file)).href)).default;
  const out = await fn({ page, shot, L, base });
  console.log(JSON.stringify({ result: out, problems: page.problems }, null, 1));
} catch (e) { code = 1; console.log(JSON.stringify({ failed: String(e).split('\n').slice(0, 6).join(' / ').replace(/\x1b\[\d+m/g, ''), problems: page.problems }, null, 1)); }
await browser.close(); if (server) server.close(); if (L) await L.close();
process.exit(code);
