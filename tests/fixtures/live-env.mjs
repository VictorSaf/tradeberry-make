// The live world for the browser suite (tests/run.mjs, app(q, { live: true })): the real temporary broker (host/broker.mjs)
// and the real gateway (host/gateway.mjs) in this process, the real web server (host/server.mjs, a child process serving
// the source tree) in front of them, and a fake platform: /quotes answers the prices of Q, which the test changes with
// quote(). The broker reads the same prices (tick every 200 ms), so the page and the broker see one market.
// The market clock runs from Friday 2026-10-16 10:30 UTC (FX open, whatever day the suite runs): the broker, the
// platform's timestamps and the page's clock (run.mjs installs it) all read clock(). Users: 1 'tl' (a shared login: a
// fresh browser context is a fresh device, so every test gets its own new demo account) and 2 'solo' (personal).
// Sessions are written straight into the database (test tokens generated here). Started on first use, closed at the end.
// procs: true (tests/e2e-server.mjs): the broker and the gateway run as child processes (tests/fixtures/live-proc.mjs) that
// B.kill() / G.kill() end with SIGKILL and B.start() / G.start() start again on the same databases and ports; the broker
// then reads the platform's quotes itself, and acct() reads its database (what is committed).
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
export const START = Date.parse('2026-10-16T10:30:00Z');

export async function startLive(root, { procs = false } = {}) {
  const { startBroker } = procs ? {} : await import(join(root, 'host/broker.mjs'));
  const { startGateway } = procs ? {} : await import(join(root, 'host/gateway.mjs'));
  const logs = [], log = s => { logs.push(String(s)); if (process.env.TB_TEST_LOGS) console.log('LOG', s); };
  const DIR = mkdtempSync(join(tmpdir(), 'tb-live-'));
  const TBDB = join(DIR, 'tradeberry.db'), BDB = join(DIR, 'broker.db');
  execFileSync(process.execPath, [join(root, 'host/migrate.mjs'), TBDB], { stdio: ['ignore', 'pipe', 'inherit'] });
  const db = new DatabaseSync(TBDB);
  for (const [id, u, shared] of [[1, 'tl', 1], [2, 'solo', 0]]) db.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at, shared) VALUES (?, ?, '00', '00', 1, 0, ?)").run(id, u, shared);
  const T0 = Date.now(), clock = () => START + (Date.now() - T0);
  const Q = { EURUSD: [1.16, 1.16008], GBPUSD: [1.34, 1.34015], USDJPY: [150.2, 150.212] };
  const rows = () => Object.entries(Q).map(([s, [b, a]]) => [s, b, a, clock()]);
  // the platform
  const up = http.createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname === '/quotes') return res.writeHead(200, { 'content-type': 'text/csv' }).end(['instrument, bid, ask, timestamp', ...rows().map(r => r.join(', '))].join('\n'));
    res.writeHead(404).end();
  });
  await new Promise(r => up.listen(0, '127.0.0.1', r));
  const USER = 'u' + randomBytes(6).toString('hex'), PASS = 'p' + randomBytes(9).toString('base64url'), SECRET = 's' + randomBytes(18).toString('base64url');
  const BP = await freePort(), GP = await freePort(), WP = await freePort();
  let B, G, keep = null;
  if (!procs) {
    B = await startBroker({ db: BDB, port: BP, user: USER, pass: PASS, feed: false, now: clock, seed: 7, log });
    B.tick(rows());
    keep = setInterval(() => B.tick(rows()), 200);
    G = await startGateway({ db: TBDB, port: GP, fixPort: BP, user: USER, pass: PASS, secret: SECRET, log });
  } else {
    const penv = { ...process.env, TB_TEST_OFF: String(START - T0), TB_BROKER_DB: BDB, TB_DB: TBDB, TB_FIX_PORT: String(BP), TB_GW_PORT: String(GP), TB_FIX_USER: USER, TB_FIX_PASS: PASS,
      TB_GW_SECRET: SECRET, LEGACY_BASE: `http://127.0.0.1:${up.address().port}`, LEGACY_API_KEY: 'test' };
    const proc = kind => {
      const h = { child: null, link: 'down' };
      h.start = () => new Promise((res, rej) => {
        const c = h.child = spawn(process.execPath, [join(root, 'tests/fixtures/live-proc.mjs'), kind], { env: penv, stdio: ['ignore', 'pipe', 'pipe'] });
        const to = setTimeout(() => rej(new Error(kind + ' did not start')), 15000);
        c.stderr.on('data', d => log(kind + ' err: ' + d));
        c.stdout.on('data', d => {
          for (const l of String(d).split('\n').filter(Boolean)) {
            log(l);
            if (/linked to the broker/.test(l)) h.link = 'up'; else if (/broker link down/.test(l)) h.link = 'down';
            if (l === kind + ': ready') { clearTimeout(to); res(); }
          }
        });
        c.on('exit', code => { clearTimeout(to); if (h.child === c) { h.child = null; h.link = 'down'; } rej(new Error(kind + ' exited ' + code)); });
      });
      // kill -9: nothing is closed, flushed or said goodbye to
      h.kill = () => new Promise(r => { const c = h.child; if (!c) return r(); h.child = null; h.link = 'down'; c.once('exit', () => r()); c.kill('SIGKILL'); });
      h.stop = () => new Promise(r => { const c = h.child; if (!c) return r(); h.child = null; c.once('exit', () => r()); c.kill('SIGTERM'); });
      return h;
    };
    B = proc('broker'); G = proc('gateway');
    // what the broker committed: an account (the shape of B.account in-process), its fills and its trades
    const read = f => { const d = new DatabaseSync(BDB, { readOnly: true }); try { return f(d); } finally { d.close(); } };
    B.account = id => read(d => {
      const r = d.prepare('SELECT * FROM accounts WHERE id = ?').get(id); if (!r) return null;
      return { id, acct: { balance: r.balance, peak: r.peak, positions: d.prepare('SELECT json FROM positions WHERE account = ? ORDER BY id').all(id).map(x => JSON.parse(x.json)),
        orders: d.prepare('SELECT cl_ord_id, json FROM orders WHERE account = ? ORDER BY id').all(id).map(x => ({ ...JSON.parse(x.json), clOrdId: x.cl_ord_id })).filter(o => !o.link) } };
    });
    B.fills = id => read(d => d.prepare("SELECT COUNT(*) n FROM executions WHERE account = ? AND json ->> 'kind' = 'fill'").get(id).n);
    B.trades = id => read(d => d.prepare('SELECT json FROM trades WHERE account = ? ORDER BY close_t, rowid').all(id).map(x => JSON.parse(x.json)));
    await B.start(); await G.start();
  }
  for (const t = Date.now(); G.link !== 'up' && Date.now() - t < 10000;) await new Promise(r => setTimeout(r, 50));
  const web = spawn(process.execPath, [join(root, 'host/server.mjs')], {
    env: { ...process.env, TB_PORT: String(WP), TB_APP: root, TB_DB: TBDB, TB_GW_PORT: String(GP), TB_GW_SECRET: SECRET, LEGACY_BASE: `http://127.0.0.1:${up.address().port}`, LEGACY_API_KEY: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  web.stderr.on('data', d => log('web: ' + d));
  await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('web server did not start')), 15000); web.stdout.on('data', d => { log('web: ' + d); if (/tradeBerry on/.test(String(d))) { clearTimeout(to); res(); } }); web.on('exit', c => rej(new Error('web server exited ' + c))); });
  const base = `http://127.0.0.1:${WP}`;
  // a signed-in session for a user: the cookies a sign-in would set
  function session(userId = 1) {
    const tok = randomBytes(32).toString('hex'), now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(createHash('sha256').update(tok).digest('hex'), userId, now, now + 12 * 3600);
    return [{ name: 'tb_s', value: tok, url: base }, { name: 'tb_u', value: '1', url: base }];
  }
  return {
    base, clock, Q, B, G, logs, session,
    quote(sym, bid, ask) { Q[sym] = [bid, ask]; if (!procs) B.tick(rows()); },
    // the broker's view of an account (positions and balance), for assertions
    acct: id => B.account(id),
    async close() {
      clearInterval(keep); web.kill('SIGTERM');
      if (procs) { await G.stop(); await B.stop(); } else { await G.close().catch(() => {}); await B.close().catch(() => {}); } up.close(); db.close(); try { rmSync(DIR, { recursive: true, force: true }); } catch {} },
  };
}
