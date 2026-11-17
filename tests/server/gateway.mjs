// host/gateway.mjs, the execution gateway: the real temporary broker (host/broker.mjs) on a fake feed, the gateway in
// this process (G9: in a child, killed with SIGKILL in the middle of a fill), browsers as WebSocket clients that carry
// the proxy's headers (G5 also goes through host/server.mjs, the real proxy). The broker's market clock runs from Monday
// 2026-11-02 10:00 UTC (FX open, whatever day the test runs). Throwaway databases and free ports only.
// Usage, from 2-cod-sursa: node tests/server/gateway.mjs (also run by tests/server/run.mjs).
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startBroker } from '../../host/broker.mjs';
import { startGateway } from '../../host/gateway.mjs';

const WebSocket = createRequire(new URL('../../host/package.json', import.meta.url))('ws');
let pass = 0, fail = 0;
const ok = (v, msg) => {  if (v) pass++; else { fail++; console.log('  FAIL', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(20)) { const v = f(); if (v) return v; } return f(); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const DIR = mkdtempSync(join(tmpdir(), 'tb-gw-')), USER = 'u' + randomBytes(6).toString('hex'), PASS = 'p' + randomBytes(9).toString('base64url');
const SECRET = 's' + randomBytes(18).toString('base64url');
const logs = [], log = s => { logs.push(String(s)); if (process.env.TB_TEST_LOGS) console.log("LOG", s); };

// tradeberry.db with every migration, and three users: alice (1) and bob (2) personal, team (3) shared
const TBDB = join(DIR, 'tradeberry.db'), BDB = join(DIR, 'broker.db');
execFileSync(process.execPath, ['host/migrate.mjs', TBDB], { stdio: ['ignore', 'pipe', 'inherit'] });
{
  const db = new DatabaseSync(TBDB);
  for (const [id, u, shared] of [[1, 'alice', 0], [2, 'bob', 0], [3, 'team', 1]]) db.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at, shared) VALUES (?, ?, '00', '00', 1, 0, ?)").run(id, u, shared);
  // a live session each (the gateway checks the sign-in of every socket again, I8)
  for (const id of [1, 2, 3]) db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, 0, ?)').run(createHash('sha256').update('tok' + id).digest('hex'), id, 4e9);
  db.close();
}

const OFF = Date.parse('2026-11-02T10:00:00Z') - Date.now(), clock = () => Date.now() + OFF;
const BP = await freePort(), GP = await freePort();
const Q = { EURUSD: [1.1, 1.1001], GBPUSD: [1.3, 1.3002], USDJPY: [150, 150.02] }; // no EURJPY quote: a leg that cannot fill
const rows = () => Object.entries(Q).map(([s, [b, a]]) => [s, b, a, clock()]);
const BH = {}; // the broker's test hooks
const brokerUp = () => startBroker({ db: BDB, port: BP, user: USER, pass: PASS, feed: false, now: clock, seed: 7, log, hooks: BH });
let B = await brokerUp(); B.tick(rows());
const H = {}; // the gateway's test hooks, changed as the test goes
// the gateway's OMS reads the same fake feed (G.tick), on the same market clock; its pause bars are fake too
const FAKE_BARS = new Map(); // sym -> [[t, o, h, l, c], …]
const gwUp = () => startGateway({ db: TBDB, port: GP, fixPort: BP, user: USER, pass: PASS, secret: SECRET, log, hooks: H, now: clock, bars: async sym => FAKE_BARS.get(sym) || [] });
let G = await gwUp();
const feedAll = () => { if (B) B.tick(rows()); if (G && !H.noGwFeed) G.tick(rows()); };
const keep = setInterval(feedAll, 500);

// a browser: the headers host/server.mjs adds after its sign-in check
const socks = [];
function conn({ user, device, secret = SECRET, port = GP, headers } = {}) {
  const h = headers || { 'x-tb-gw-secret': secret, 'x-tb-user': String(user), ...(device ? { 'x-tb-device': device } : {}) };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/trade`, { headers: h });
  const c = { ws, msgs: [], replies: new Map(), status: null, closed: false, n: 0 };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.cid != null) c.replies.set(m.cid, m); });
  c.open = new Promise(r => {
    ws.on('open', () => r(true)); ws.on('close', (code, why) => { c.closed = true; c.code = code; c.why = String(why); r(false); });
    ws.on('unexpected-response', (req, res) => { c.status = res.statusCode; c.closed = true; req.destroy(); r(false); });
  });
  ws.on('error', () => {});
  c.send = (cmd, cid = 'c' + ++c.n + '-' + randomBytes(3).toString('hex')) => { ws.send(JSON.stringify({ cid, ...cmd })); return cid; };
  c.ask = async (cmd, cid, ms) => { if (cid) c.replies.delete(cid); const id = c.send(cmd, cid); return until(() => c.replies.get(id), ms); };
  c.ev = (ev, f = () => true) => c.msgs.filter(m => m.ev === ev && f(m));
  c.wait = (ev, f, ms) => until(() => c.ev(ev, f)[0], ms);
  c.close = () => new Promise(r => { if (c.closed) return r(); ws.once('close', r); ws.close(); });
  socks.push(c);
  return c;
}
const gw = () => new DatabaseSync(TBDB);
const q1 = (sql, ...a) => { const d = gw(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const brokerPositions = id => B.account(id).acct.positions.map(p => ({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry }));
const fills = cl => q1("SELECT COUNT(*) n FROM gw_exec WHERE json ->> '$.ids.clOrdId' = ? AND json ->> '$.kind' = 'fill'", cl).n;

try {
  ok(await until(() => G.link === 'up'), 'gateway linked to the broker: ' + G.link);

  // G1: two sockets of one user get the same exec for an order one of them sent
  const a1 = conn({ user: 1 }), a2 = conn({ user: 1 }), b1 = conn({ user: 2 });
  ok(await a1.open && await a2.open && await b1.open, 'G1 sockets open');
  const s1 = await a1.wait('snapshot'), sb = await b1.wait('snapshot');
  ok(s1 && s1.account === 'u1' && sb && sb.account === 'u2', 'G1 snapshot per account: ' + JSON.stringify([s1 && s1.account, sb && sb.account]));
  ok(await a1.wait('acct', m => m.acct && m.acct.balance === 100000) || (s1.acct && s1.acct.balance === 100000), 'G1 the account was created on demand (demo, 100000)');
  ok(B.account('u1') && B.account('u1').type === 'demo', 'G1 the broker holds u1 as a demo account');
  const r1 = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
  ok(r1 && r1.ok && /^tb-u1-\d+$/.test(r1.id) && r1.pos > 0, 'G1 order filled: ' + JSON.stringify(r1));
  const e1 = await a1.wait('exec', m => m.exec.ids.clOrdId === r1.id && m.exec.kind === 'fill'), e2 = await a2.wait('exec', m => m.exec.ids.clOrdId === r1.id && m.exec.kind === 'fill');
  ok(e1 && e2 && e1.exec.ids.execId === e2.exec.ids.execId && e2.exec.receipt.lots === 1, 'G1 both sockets get the same fill');
  ok(await a2.wait('pos', m => m.pos.id === r1.pos && m.pos.lots === 1), 'G1 the position reaches the other socket');
  ok(!a2.replies.has([...a1.replies.keys()][0]), 'G1 the reply goes to the sender only');
  const bad = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1000, ot: 'market' });
  ok(bad && !bad.ok && bad.code === 'VOL_MAX' && bad.text === B.core.rej('VOL_MAX', { max: B.core.lotsWord('EURUSD', B.core.volOf('EURUSD')[1]) }).why, "G1 a refusal carries the core's text: " + JSON.stringify(bad));

  // G2: a user never gets another user's events
  await sleep(300);
  ok(!b1.msgs.some(m => (m.ev === 'exec' && m.exec.ids.account !== 'u2') || (m.ev === 'pos' && m.account && m.account !== 'u2') || (m.ev === 'snapshot' && m.account !== 'u2')), 'G2 bob saw nothing of alice');
  ok(!b1.ev('exec').length && !b1.ev('pos').length, 'G2 bob got no exec and no position');
  const t1 = conn({ user: 3, device: 'deviceaaaaaa01' }), t2 = conn({ user: 3, device: 'devicebbbbbb02' }), t0 = conn({ user: 3 });
  const st1 = await t1.wait('snapshot'), st2 = await t2.wait('snapshot');
  ok(st1 && st1.account === 'u3-deviceaaaaaa01' && st2 && st2.account === 'u3-devicebbbbbb02', 'G2 a shared login: one account per browser');
  ok(!(await t0.open) && t0.status === 400, 'G2 a shared login without a device is refused: ' + t0.status);
  const rt = await t1.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: .5, ot: 'market' });
  ok(rt && rt.ok && await t1.wait('exec', m => m.exec.kind === 'fill'), 'G2 the shared browser trades');
  await sleep(300);
  ok(!t2.ev('exec').length && !a1.ev('exec', m => m.exec.ids.account !== 'u1').length, 'G2 the other browser of the shared login sees none of it');

  // G3: a cid sent again after a reconnect: one ClOrdID, one fill
  {
    const n0 = B.account('u1').acct.positions.length;
    const a3 = conn({ user: 1 }); await a3.open; await a3.wait('snapshot');
    a3.send({ op: 'order', sym: 'GBPUSD', side: 'buy', lots: .3, ot: 'market' }, 'g3-cid'); await a3.close(); // gone before the answer
    const a4 = conn({ user: 1 }); await a4.open; await a4.wait('snapshot');
    const r = await a4.ask({ op: 'order', sym: 'GBPUSD', side: 'buy', lots: .3, ot: 'market' }, 'g3-cid');
    const r2 = await a4.ask({ op: 'order', sym: 'GBPUSD', side: 'buy', lots: .3, ot: 'market' }, 'g3-cid');
    await sleep(300);
    ok(r && r.ok && r2 && r2.id === r.id, 'G3 the same reply twice: ' + JSON.stringify([r, r2]));
    ok(B.account('u1').acct.positions.length === n0 + 1, 'G3 one position more: ' + (B.account('u1').acct.positions.length - n0));
    ok(r && fills(r.id) === 1, 'G3 one fill recorded');
    const cl = q1("SELECT json FROM gw_cid WHERE account = 'u1' AND cid = 'g3-cid'");
    ok(cl && JSON.parse(cl.json).cls.length === 1, 'G3 one ClOrdID for the cid');
    await a4.close();
  }

  // G7: round trips: netting at the exact entry, a stop loss set and moved (G on the linked leg), partial and full close,
  // settings; a command that throws leaves no trace and its cid can be sent again
  {
    const px = (sym, b, a) => { Q[sym] = [b, a]; feedAll(); };
    px('EURUSD', 1.1, 1.1001);
    ok((await a1.ask({ op: 'closeAll', sym: 'EURUSD' })).ok && await until(() => ![...G.mirror.get('u1').positions.values()].some(p => p.sym === 'EURUSD')), 'G7 flat on EURUSD');
    const o1 = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .4, ot: 'market' });
    px('EURUSD', 1.1023, 1.1024);
    // no posId from the browser: the gateway finds the net-book position and sends the add with its 721
    const o2 = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .6, ot: 'market' });
    const id = o1.pos, bp = () => B.account('u1').acct.positions.find(p => p.id === id);
    ok(o2 && o2.ok && o2.pos === id && await until(() => G.mirror.get('u1').positions.get(id)?.lots === 1), 'G7 netted into one position by 721: ' + JSON.stringify([o1, o2]));
    ok(a1.ev('exec', m => m.exec.ids.clOrdId === o2.id && m.exec.kind === 'fill' && m.exec.receipt.kind === 'add' && m.exec.receipt.pos === id).length === 1, 'G7 the broker booked an add on that position');
    const me = G.mirror.get('u1').positions.get(id), ev = a1.ev('pos', m => m.pos.id === id && m.pos.lots === 1).at(-1);
    ok(me.entry === bp().entry && ev && ev.pos.entry === bp().entry && !/^\d+\.\d{1,5}$/.test(String(bp().entry)), `G7 the averaged entry is exact: ${me.entry} ${bp().entry}`);
    const m1 = await a1.ask({ op: 'modify', posId: id, sl: 1.09 });
    const leg = () => [...G.mirror.get('u1').orders.values()].find(o => o.linkPos === id && o.leg === 'SL');
    ok(m1 && m1.ok && await until(() => leg()?.price === 1.09) && bp().sl === 1.09, 'G7 SL set: ' + JSON.stringify(m1));
    const first = leg().clOrdId, m2 = await a1.ask({ op: 'modify', posId: id, sl: 1.095 });
    ok(m2 && m2.ok && await until(() => leg()?.price === 1.095 && leg().clOrdId === m2.id) && bp().sl === 1.095 && !G.mirror.get('u1').orders.has(first), 'G7 SL moved by G on the linked leg');
    ok(a1.ev('exec', m => m.exec.kind === 'replaced' && m.exec.ids.clOrdId === m2.id && m.exec.ids.origClOrdId === first).length === 1, 'G7 the replace reached the browser');
    const bp0 = { entry: bp().entry };
    const c1 = await a1.ask({ op: 'close', posId: id, lots: .5 });
    ok(c1 && c1.ok && await until(() => G.mirror.get('u1').positions.get(id)?.lots === .5 && leg()?.lots === .5) && bp().lots === .5, 'G7 half closed, the SL restated to .5: ' + JSON.stringify(c1));
    const c2 = await a1.ask({ op: 'close', posId: id });
    ok(c2 && c2.ok && await until(() => !G.mirror.get('u1').positions.has(id) && !leg()) && !bp(), 'G7 closed, the SL gone with it');
    ok((await a1.ask({ op: 'close', posId: id })).code === 'NO_POS', 'G7 closing it again: NO_POS');
    {
      const h = await a1.ask({ op: 'history' }), mine = h && h.rows.filter(r => r.id === id), theirs = B.history('u1').filter(r => r.id === id);
      ok(mine && mine.length === 2 && theirs.length === 2 && mine.every(r => theirs.some(x => x.entry === r.entry && x.lots === r.lots)) && mine[0].entry === bp0.entry, 'G7 the netted entry in the history is the broker\'s, exactly: ' + JSON.stringify(mine && mine.map(r => r.entry)) + ' ' + bp0.entry);
      ok(mine && mine.every(r => r.reason === 'Manual'), 'G7 a close from the browser says Manual: ' + JSON.stringify(mine && mine.map(r => r.reason)));
    }
    const st = await a1.ask({ op: 'settings', jur: 'eu', comm: 7 });
    ok(st && st.ok && B.account('u1').acct.set.jur === 'eu' && B.account('u1').acct.set.comm === 7, 'G7 settings applied: ' + JSON.stringify(st));
    ok(await a1.wait('acct', m => m.info && m.info.type === 'demo' && m.info.set.jur === 'eu' && m.info.set.comm === 7), 'G7 the acct event carries the account type and settings');
    { const a5 = conn({ user: 1 }), sn = await a5.wait('snapshot'); ok(sn && sn.info && sn.info.type === 'demo' && sn.info.set.jur === 'eu' && 'lev' in sn.info.set && sn.info.set.slipSd === .2 && sn.info.set.latMs === 120, 'G7 the snapshot carries info { type, set }: ' + JSON.stringify(sn && sn.info)); await a5.close(); }
    const sb = await a1.ask({ op: 'settings', jur: 'mars' });
    ok(sb && !sb.ok && sb.code === 'JUR' && B.account('u1').acct.set.jur === 'eu', 'G7 a bad jurisdiction is refused by the broker: ' + JSON.stringify(sb));
    ok((await a1.ask({ op: 'settings', jur: 'none', comm: 0 })).ok, 'G7 settings back');
    H.command = c => { if (c.cid === 'boom-cid' && !H.thrown) { H.thrown = true; throw new Error('injected'); } };
    const x1 = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' }, 'boom-cid');
    ok(x1 && !x1.ok && x1.code === 'ERROR' && !q1("SELECT 1 x FROM gw_cid WHERE cid = 'boom-cid'"), 'G7 a command that throws: an error, no cid row');
    const x2 = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' }, 'boom-cid');
    ok(x2 && x2.ok && fills(x2.id) === 1, 'G7 the same cid again works: ' + JSON.stringify(x2));
    delete H.command;
    ok((await a1.ask({ op: 'close', posId: x2.pos })).ok, 'G7 cleanup');
  }


  /* ---------- the OMS (Task 9): one fresh shared-login account per scenario (u3-<device>), on EURUSD / GBPUSD ---------- */
  const px = (sym, b, a) => { Q[sym] = [b, a]; feedAll(); };
  let devN = 0;
  const dev = async () => { const c = conn({ user: 3, device: 'omsdevice' + String(++devN).padStart(5, '0') }); await c.open; const sn = await c.wait('snapshot'); c.acct = sn.account; await until(() => G.mirror.get(c.acct)?.summary); return c; };
  const legs = (a, pos) => [...(G.mirror.get(a)?.orders.values() || [])].filter(o => o.linkPos === pos);
  const bpos = a => B.account(a).acct.positions;
  const mpos = (a, id) => G.mirror.get(a)?.positions.get(id);
  const metaOf = (a, id) => { const r = q1('SELECT json FROM gw_meta WHERE account = ? AND pos_id = ?', a, id); return r ? JSON.parse(r.json) : null; };
  const stateOf = (a, k) => { const r = q1('SELECT json FROM gw_state WHERE account = ? AND key = ?', a, k); return r ? JSON.parse(r.json) : null; };
  const flat = async c => { await c.ask({ op: 'closeAll' }); await until(() => !bpos(c.acct).length); };
  const near5 = (a, b) => Math.abs(a - b) < 5e-6;

  // G8: a reversal 1 → −0.5 is one D on the position's 721: it closes, the remainder opens a new position of 0.5;
  // a remainder the broker refuses is "remainder refused": the close stands
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o1 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const o2 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: 1.5, ot: 'market' });
    ok(o1 && o1.ok && o2 && o2.ok, 'G8 both orders filled: ' + JSON.stringify([o1, o2]));
    ok(await until(() => bpos(a).length === 1 && bpos(a)[0].side === 'sell' && bpos(a)[0].lots === .5 && bpos(a)[0].id !== o1.pos && !mpos(a, o1.pos) && mpos(a, bpos(a)[0].id)?.lots === .5), 'G8 the position closed and a new sell 0.5 opened: ' + JSON.stringify(bpos(a)));
    const f = c.ev('exec', m => m.exec.ids.clOrdId === o2.id && m.exec.kind === 'fill');
    ok(f.length === 2 && f[0].exec.receipt.pos === o1.pos && f[0].exec.receipt.kind === 'close' && f[1].exec.receipt.kind === 'open', 'G8 one ClOrdID: a close on the 721, then the open');
    const o3 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 45.5, ot: 'market' }); // 45 lots more: past the notional cap
    ok(o3 && o3.ok && await c.wait('exec', m => m.exec.ids.clOrdId === o3.id && m.exec.kind === 'reject' && m.remainder === true), 'G8 the remainder refused is marked as such: ' + JSON.stringify(o3));
    await sleep(200);
    ok(!bpos(a).length && ![...G.mirror.get(a).positions.values()].length && c.replies.get(c.ev('exec').length ? [...c.replies.keys()].at(-1) : '')?.ok !== false, 'G8 the close stands, nothing else opened');
    await c.close();
  }

  // bracket: SL + TP attached at the fill (linked, reduce-only); the target fills, the stop goes with the position
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const bad = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.1005 });
    ok(bad && !bad.ok && bad.code === 'SL_SIDE' && bad.text === B.core.rej('SL_SIDE').why, "bracket a stop on the wrong side: the core's refusal: " + JSON.stringify(bad));
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.09, tp: 1.105, ctx: ['tilt'], pm: { note: 'x' } });
    ok(o && o.ok && await until(() => legs(a, o.pos).length === 2), 'bracket SL and TP legs attached: ' + JSON.stringify(legs(a, o.pos)));
    const L = legs(a, o.pos), sl = L.find(x => x.leg === 'SL'), tp = L.find(x => x.leg === 'TP1');
    ok(sl && sl.price === 1.09 && sl.ot === 'stop' && sl.side === 'sell' && tp && tp.price === 1.105 && tp.ot === 'limit' && tp.lots === 1, 'bracket the legs: a sell stop and a sell limit');
    const bp = bpos(a)[0]; ok(bp.sl === 1.09 && bp.tp === 1.105, 'bracket the broker holds them: ' + JSON.stringify([bp.sl, bp.tp]));
    const m = metaOf(a, o.pos); ok(m && m.sl0 === 1.09 && m.tp0 === 1.105 && JSON.stringify(m.ctx) === '["tilt"]' && m.pm.note === 'x', 'bracket the journal fields in gw_meta: ' + JSON.stringify(m));
    px('EURUSD', 1.1052, 1.1053);
    ok(await until(() => !bpos(a).length && !legs(a, o.pos).length), 'bracket the target filled, the stop cancelled with the position');
    ok(B.history(a).some(h => h.id === o.pos && /^Take profit/.test(h.reason)), 'bracket closed by its take profit');
    ok(await until(() => typeof metaOf(a, o.pos)?.closedAt === 'number'), 'bracket the journal of the closed position is dated for its retention');
    await c.close();
  }

  // time stop (behav.js): a loser at its deadline closes with 'Time stop'; retention of gw_exec and old journals
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .2, ot: 'market', pm: { timeStop: 2 } });
    ok(o && o.ok && metaOf(a, o.pos)?.timeStop === 2, 'time stop kept with the position');
    ok(await until(() => !bpos(a).length, 5000) && B.history(a).some(h => h.id === o.pos && h.reason === 'Time stop'), 'time stop closed the loser: ' + JSON.stringify(B.history(a).map(h => h.reason)));
    const { openGatewayDb } = await import('../../host/gateway/db.mjs'), g2 = openGatewayDb(TBDB), old = Math.floor(Date.now() / 1000) - 40 * 86400;
    g2.store.tx(() => { g2.db.prepare("INSERT INTO gw_exec (account, exec_id, t, json) VALUES ('zz', 'old', ?, '{}')").run(old); g2.putMeta('zz', 1, { closedAt: old - 60 * 86400 }); g2.putMeta('zz', 2, { closedAt: old }); g2.putMeta('zz', 3, { note: 'open' }); });
    const r = g2.prune();
    // the journal of a closed trade stays as long as its history row (Task 10: the Journal shows every closed trade as before)
    ok(r.exec >= 1 && g2.meta('zz', 1) && g2.meta('zz', 2) && g2.meta('zz', 3) && !q1("SELECT 1 x FROM gw_exec WHERE exec_id = 'old'"), 'retention: executions after 30 days; journals are kept: ' + JSON.stringify(r));
    g2.close();
    await c.close();
  }

  // a pending order with slPips / tpPips: the exits wait with its ClOrdID and go out when it fills
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .5, ot: 'limit', price: 1.099, slPips: 20, tpPips: 30, ctx: ['plan'] });
    ok(o && o.ok && stateOf(a, 'ordMeta')?.[o.id]?.exits?.slPips === 20, 'pending placed, its exits kept: ' + JSON.stringify(o));
    px('EURUSD', 1.0985, 1.0986);
    ok(await until(() => bpos(a).length === 1 && legs(a, bpos(a)[0].id).length === 2), 'pending filled, its SL and TP attached');
    const p = bpos(a)[0], L = legs(a, p.id), f = c.ev('exec', m => m.exec.ids.clOrdId === o.id && m.exec.kind === 'fill')[0];
    ok(f && near5(L.find(x => x.leg === 'SL').price, +(f.exec.receipt.px - .002).toFixed(5)) && near5(L.find(x => x.leg === 'TP1').price, +(f.exec.receipt.px + .003).toFixed(5)), 'pending the exits are pips from the fill: ' + JSON.stringify([f && f.exec.receipt.px, L.map(x => [x.leg, x.price])]));
    ok(JSON.stringify(metaOf(a, p.id)?.ctx) === '["plan"]' && !stateOf(a, 'ordMeta')?.[o.id], 'pending the journal moved to the position, the order’s row gone');
    await flat(c); await c.close();
  }

  // multi-TP (two legs of 0.5) and G11: break-even armed by the TP1 fill
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.095, tps: [{ price: 1.102, lots: .5 }, { price: 1.104, lots: .5 }], be: { onTp: true, off: 0 } });
    ok(o && o.ok && await until(() => legs(a, o.pos).length === 3), 'multi-TP SL, TP1 and TP2 attached: ' + JSON.stringify(legs(a, o.pos)));
    const L = legs(a, o.pos);
    ok(L.find(x => x.leg === 'TP1')?.lots === .5 && L.find(x => x.leg === 'TP1').price === 1.102 && L.find(x => x.leg === 'TP2')?.lots === .5 && L.find(x => x.leg === 'TP2').price === 1.104, 'multi-TP two partial legs');
    ok(metaOf(a, o.pos)?.prot?.be?.onTp === true, 'G11 the break-even rule kept with the position');
    const entry = bpos(a)[0].entry;
    px('EURUSD', 1.1021, 1.1022);
    ok(await until(() => bpos(a)[0]?.lots === .5 && !legs(a, o.pos).some(x => x.leg === 'TP1')), 'multi-TP TP1 filled half');
    ok(await until(() => legs(a, o.pos).find(x => x.leg === 'SL')?.price === +entry.toFixed(5), 3000), 'G11 the stop moved to the entry after TP1: ' + JSON.stringify([entry, legs(a, o.pos).find(x => x.leg === 'SL')]));
    ok(bpos(a)[0].sl === +entry.toFixed(5) && metaOf(a, o.pos).prot.be.done === true && bpos(a)[0].slReason === 'Stop loss (break-even)', 'G11 the broker holds the break-even stop');
    px('EURUSD', entry - .0002, entry - .0001);
    ok(await until(() => !bpos(a).length) && B.history(a).some(h => h.id === o.pos && h.reason === 'Stop loss (break-even)'), 'G11 stopped at break-even, with its reason: ' + JSON.stringify(B.history(a).map(h => h.reason)));
    await c.close();
  }

  // modify: a pending order's price, expiry and exits; a position's target legs, trail and break-even
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .5, ot: 'limit', price: 1.098, slPips: 10 });
    const exp = Math.floor(clock() / 1000) + 3600;
    const m1 = await c.ask({ op: 'modify', id: o.id, price: 1.0975, tif: 'GTD', expires: exp, slPips: 15, tpPips: 25 });
    const bo = () => B.account(a).acct.orders[0];
    ok(m1 && m1.ok && await until(() => bo()?.price === 1.0975 && bo().tif === 'GTD' && bo().expires === exp), 'modify a pending order: price and expiry at the broker: ' + JSON.stringify([m1, bo()]));
    ok(await until(() => { const e = Object.values(stateOf(a, 'ordMeta') || {})[0]; return e && e.exits.slPips === 15 && e.exits.tpPips === 25 && stateOf(a, 'ordMeta')[m1.id]; }), 'modify its exits follow its new ClOrdID: ' + JSON.stringify(stateOf(a, 'ordMeta')));
    const me = await c.ask({ op: 'modify', id: m1.id, tif: 'GTD', expires: Math.floor(clock() / 1000) + 10 });
    ok(me && !me.ok && me.code === 'EXPIRY', 'modify an expiry under a minute is refused: ' + JSON.stringify(me));
    await c.ask({ op: 'cancel', id: m1.id });
    const p = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const m2 = await c.ask({ op: 'modify', posId: p.pos, tps: [{ price: 1.103, lots: .4 }, { price: 1.105, lots: .6 }], trail: 15, be: { at: 10, off: 1 } });
    ok(m2 && m2.ok && await until(() => legs(a, p.pos).length === 3), 'modify target legs and a trail: ' + JSON.stringify([m2, legs(a, p.pos)]));
    const L = legs(a, p.pos);
    ok(L.find(x => x.leg === 'TP1')?.lots === .4 && L.find(x => x.leg === 'TP2')?.lots === .6 && near5(L.find(x => x.leg === 'SL').price, 1.0985), 'modify TP1 0.4, TP2 0.6, the trail is the stop at once');
    const pr = metaOf(a, p.pos)?.prot; ok(pr && pr.trail === 15 && pr.trailNow === true && pr.be.at === 10 && pr.be.off === 1, 'modify trail and break-even kept: ' + JSON.stringify(pr));
    const m3 = await c.ask({ op: 'modify', posId: p.pos, tps: [{ price: 1.104, lots: 1 }] });
    ok(m3 && m3.ok && await until(() => { const t = legs(a, p.pos).filter(x => /^TP/.test(x.leg)); return t.length === 1 && t[0].price === 1.104 && t[0].lots === 1; }), 'modify back to one target: ' + JSON.stringify(legs(a, p.pos)));
    const m4 = await c.ask({ op: 'modify', posId: p.pos, trail: .1 });
    ok(m4 && !m4.ok && m4.code === 'TRAIL_SPREAD', 'modify a trail inside the spread is refused: ' + JSON.stringify(m4));
    await flat(c); await c.close();
  }

  // G10: a 20-pip trail on 5 s of rising ticks: at most 5 G, the stop never goes down
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', trail: 20 });
    ok(o && o.ok && await until(() => legs(a, o.pos).some(x => x.leg === 'SL')), 'G10 a trail without a stop is the stop at once');
    const s0 = legs(a, o.pos).find(x => x.leg === 'SL').price;
    const e0 = bpos(a)[0].entry;
    ok(near5(s0, +(e0 - .002).toFixed(5)) && metaOf(a, o.pos).prot.trailNow === true, 'G10 at entry − 20 pips: ' + s0 + ' ' + e0);
    const seen = [s0], t0 = Date.now();
    for (let i = 1; Date.now() - t0 < 4900; i++) { const b = 1.1 + i * .00005; px('EURUSD', +b.toFixed(5), +(b + .0001).toFixed(5)); await sleep(100); const l = legs(a, o.pos).find(x => x.leg === 'SL'); if (l) seen.push(l.price); }
    const gs = c.ev('exec', m => m.exec.kind === 'replaced' && m.exec.order?.linkPos === o.pos && m.exec.order?.leg === 'SL').length; // in the 5 s of ticks
    await sleep(400);
    ok(gs >= 3 && gs <= 5, 'G10 at most 5 replaces in 5 s (and some): ' + gs);
    ok(seen.every((v, i) => !i || v >= seen[i - 1] - 1e-12) && seen.at(-1) > s0, 'G10 the stop only rose: ' + seen[0] + ' → ' + seen.at(-1));
    ok(bpos(a)[0].sl === seen.at(-1) || bpos(a)[0].sl === legs(a, o.pos).find(x => x.leg === 'SL').price, 'G10 the broker holds the trailed stop');
    px('EURUSD', 1.1, 1.1001);
    ok(await until(() => !bpos(a).length) && B.history(a).some(h => h.id === o.pos && h.reason === 'Trailing stop'), 'G10 stopped by the trailing stop, with its reason');
    await c.close();
  }

  // G12: a basket (long EUR + GBP, short USD) with a 20 bp stop on its index: hit → every leg closed, 'Basket stop'
  {
    px('EURUSD', 1.1, 1.1001); px('GBPUSD', 1.3, 1.3002);
    const c = await dev(), a = c.acct;
    const r = await c.ask({ op: 'basket', do: 'open', bid: 'b1', name: 'EG', long: { EUR: 1, GBP: 1 }, short: { USD: 1 }, side: 'buy', lots: 1, sl: 20, tp: 200 });
    ok(r && r.ok && r.legs === 2, 'G12 basket opened: ' + JSON.stringify(r));
    const g = stateOf(a, 'bkPos')?.[0];
    ok(g && g.gid === r.id && g.legs.length === 2 && bpos(a).length === 2 && bpos(a).every(p => metaOf(a, p.id)?.bgid === r.id && p.hedge === true), 'G12 two hedged legs, one group');
    ok(await until(() => bpos(a).every(p => legs(a, p.id).some(x => x.leg === 'SL'))), 'G12 each leg has its disaster stop');
    const n0 = bpos(a).map(p => p.id);
    // a single order on EURUSD does not net with a basket leg
    const s = await c.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: .1, ot: 'market' });
    ok(s && s.ok && bpos(a).length === 3 && n0.every(id => bpos(a).some(p => p.id === id && p.lots === g.legs.find(l => l.id === id).lots)), 'G12 a single order beside a basket leg opens its own position');
    await c.ask({ op: 'close', posId: s.pos });
    px('EURUSD', 1.0966, 1.0967); px('GBPUSD', 1.2961, 1.2963);
    ok(await until(() => !n0.some(id => bpos(a).some(p => p.id === id)), 5000), 'G12 the basket stop closed every leg');
    ok(n0.every(id => B.history(a).some(h => h.id === id && h.reason === 'Basket stop')), 'G12 reason Basket stop on every leg: ' + JSON.stringify(B.history(a).map(h => h.reason)));
    ok(await until(() => stateOf(a, 'bkHist')?.[0]?.reason === 'Basket stop' && !stateOf(a, 'bkPos')?.length), 'G12 the group left the book for the record: ' + JSON.stringify(stateOf(a, 'bkHist')));
    ok(await until(() => c.ev('gw', m => m.key === 'bkHist').length > 0 && c.ev('notice', m => m.kind === 'basket' && m.reason === 'Basket stop').length === 1), 'G12 the browser is told: ' + JSON.stringify(c.ev('notice')));
    await c.close();
  }

  // G13: a challenge attempt: an order whose stop would breach it is refused; the daily loss reached → flatten
  {
    px('EURUSD', 1.1, 1.1001); px('GBPUSD', 1.3, 1.3002);
    const c = await dev(), a = c.acct;
    const rules = { id: 'test', pv: 1, label: 'Test', phases: [{ target: 10 }], daily: { pct: 1, base: 'initial', anchor: 'balance' }, max: { pct: 10, mode: 'static', trailOn: 'balance', lock: false }, minDays: 0, profitDays: null, consistency: null, reset: { tz: 'UTC', hour: 0 } };
    const st = await c.ask({ op: 'settings', chal: { do: 'start', id: 'test', rules } });
    ok(st && st.ok && stateOf(a, 'chal')?.att?.status === 'active', 'G13 attempt started: ' + JSON.stringify(st));
    const blk = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.088 });
    ok(blk && !blk.ok && blk.code === 'CHAL_BLOCK' && /would breach the daily limit/.test(blk.text) && !bpos(a).length, 'G13 a stop-out that would breach is refused: ' + JSON.stringify(blk));
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 2, ot: 'market' });
    ok(o && o.ok, 'G13 an order without a stop goes (the pre-mortem asks in the browser)');
    px('EURUSD', 1.094, 1.0941);
    ok(await until(() => stateOf(a, 'chal')?.att?.status === 'breached' && !bpos(a).length, 5000), 'G13 breached and flattened: ' + JSON.stringify(stateOf(a, 'chal')?.att?.end));
    ok(stateOf(a, 'chal').att.end.why === 'daily' && B.history(a).some(h => h.id === o.pos && h.reason === 'Stop-out (challenge breach)'), 'G13 the daily limit, closed as Stop-out (challenge breach)');
    ok(await until(() => c.ev('notice', m => m.kind === 'chal' && m.what === 'breach').length === 1) && c.ev('notice', m => m.kind === 'chal' && m.what === 'breach').length === 1, 'G13 the browser is told once');
    await c.close();
  }

  // G15 (Task 10): a history row carries its position's journal (pm, ctx, sl0 … set with the order, note and setup later)
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market', sl: 1.09, pm: { conf: 60, mood: 'calm' }, ctx: ['noStop'] });
    ok(o && o.ok, 'G15 order with a journal: ' + JSON.stringify(o));
    const m = await c.ask({ op: 'meta', posId: o.pos, meta: { note: 'waited for the retest', setup: 'Pullback', slLast: 1.09, vol: true } });
    ok(m && m.ok, 'G15 note, setup and the close fields kept: ' + JSON.stringify(m));
    const cl = await c.ask({ op: 'close', posId: o.pos }); ok(cl && cl.ok, 'G15 closed');
    await until(() => B.history(a).some(h => h.id === o.pos));
    const h = await c.ask({ op: 'history', page: 0 }), row = h && h.rows && h.rows.find(r => r.id === o.pos);
    ok(row && row.meta && row.meta.pm && row.meta.pm.conf === 60 && row.meta.ctx[0] === 'noStop' && row.meta.note === 'waited for the retest' && row.meta.setup === 'Pullback' && row.meta.sl0 === 1.09 && row.meta.vol === true,
      'G15 the history row carries the journal: ' + JSON.stringify(row && row.meta));
    ok(row && row.meta && !('prot' in row.meta) && !('closedAt' in row.meta), 'G15 only the journal keys, not the OMS\'s own');
    await c.close();
  }
  // G18 (Task 10): the ticket's OCO with an order already working: modify {id, oca} regroups it at the broker, the new
  // order carries the same group, one fills and the other is cancelled
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o1 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'stop', price: 1.102 });
    ok(o1 && o1.ok, 'G18 a buy stop working: ' + JSON.stringify(o1));
    const j = await c.ask({ op: 'modify', id: o1.id, oca: 'oco-g18' });
    const cur = [...(G.mirror.get(a)?.orders.values() || [])].find(o => o.oca === 'oco-g18');
    ok(j && j.ok && cur && B.account(a).acct.orders.some(o => o.ocaKey === 'oco-g18'), 'G18 the working order joined the group at the broker: ' + JSON.stringify(j));
    const o2 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: .1, ot: 'stop', price: 1.098, oca: 'oco-g18' });
    ok(o2 && o2.ok, 'G18 the new order goes with the same group');
    px('EURUSD', 1.1021, 1.1022);
    ok(await until(() => bpos(a).length === 1 && !B.account(a).acct.orders.filter(o => o.linkPos == null && !o.slLink).length, 5000), 'G18 the buy stop filled and the sell stop was cancelled');
    ok(await until(() => c.ev('exec', m => m.exec.kind === 'cancel' && /OCO/.test(m.exec.text || '')).length >= 1), 'G18 the browser gets the OCO cancel');
    await c.ask({ op: 'closeAll' }); await until(() => !bpos(a).length);
    await c.close();
  }
  // G16 (Task 10): a modify with a stop on the wrong side is refused with today's text, nothing goes to the broker
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    const n0 = B.account(a).acct.orders.length;
    const r = await c.ask({ op: 'modify', posId: o.pos, sl: 1.105 });
    ok(r && !r.ok && r.code === 'MOD_SL_SIDE' && r.text === 'Stop loss must be below the bid', 'G16 a stop above the bid of a buy is refused with today\'s text: ' + JSON.stringify(r));
    ok(B.account(a).acct.orders.length === n0 && !B.account(a).acct.positions[0].sl, 'G16 nothing reached the broker');
    const p = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'limit', price: 1.09 });
    const r2 = await c.ask({ op: 'modify', id: p.id, price: 1.102 });
    ok(r2 && !r2.ok && r2.code === 'MOD_PRICE_SIDE' && r2.text === 'Buy limit must be below market', 'G16 a buy limit moved above the market is refused: ' + JSON.stringify(r2));
    await c.ask({ op: 'cancel', id: p.id }); await c.ask({ op: 'closeAll' }); await until(() => !bpos(a).length);
    await c.close();
  }
  // G17 (Task 10): the challenge choices made in the browser (cfg: custom rules) are kept, and an attempt on them is
  // enforced here: a custom daily limit of 0.5% refuses an order whose stop-out would breach it
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const custom = { id: 'custom', pv: 1, label: 'Mine', phases: [{ target: 8 }], daily: { pct: .5, base: 'initial', anchor: 'balance' }, max: { pct: 10, mode: 'static', trailOn: 'balance', lock: false }, minDays: 0, profitDays: null, consistency: null, reset: { tz: 'UTC', hour: 0 } };
    const cf = await c.ask({ op: 'settings', chal: { do: 'cfg', sel: 'custom', opt: { risk: 1, horizon: 30 }, custom } });
    ok(cf && cf.ok && stateOf(a, 'chal')?.sel === 'custom' && stateOf(a, 'chal').custom.daily.pct === .5 && stateOf(a, 'chal').opt.horizon === 30, 'G17 the choices are kept: ' + JSON.stringify(stateOf(a, 'chal')));
    const st = await c.ask({ op: 'settings', chal: { do: 'start', id: 'custom', rules: custom } });
    ok(st && st.ok && stateOf(a, 'chal').att.rules.daily.pct === .5, 'G17 the attempt runs on the custom rules');
    // 1 lot with a 60-pip stop risks $600 > 0.5% of 100,000; the default 5% would allow it
    const blk = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.094 });
    ok(blk && !blk.ok && blk.code === 'CHAL_BLOCK', 'G17 the custom daily limit is enforced: ' + JSON.stringify(blk));
    await c.ask({ op: 'settings', chal: { do: 'stop' } });
    await c.close();
  }

  // fix round 1 (C2, I1-I7, minors)
  // C2: a basket opening is kept with its cid: the reply lost with the socket comes again, one group only
  {
    px('EURUSD', 1.1, 1.1001); px('GBPUSD', 1.3, 1.3002);
    const c = await dev(), a = c.acct, dv = 'omsdevice' + String(devN).padStart(5, '0');
    c.send({ op: 'basket', do: 'open', bid: 'b2', name: 'EG2', long: { EUR: 1, GBP: 1 }, short: { USD: 1 }, side: 'buy', lots: 1 }, 'bk-lost-cid'); await c.close();
    const c2 = conn({ user: 3, device: dv }); await c2.open; await c2.wait('snapshot');
    const r1 = await c2.ask({ op: 'basket', do: 'open', bid: 'b2', name: 'EG2', long: { EUR: 1, GBP: 1 }, short: { USD: 1 }, side: 'buy', lots: 1 }, 'bk-lost-cid');
    const r2 = await c2.ask({ op: 'basket', do: 'open', bid: 'b2', name: 'EG2', long: { EUR: 1, GBP: 1 }, short: { USD: 1 }, side: 'buy', lots: 1 }, 'bk-lost-cid');
    ok(r1 && r1.ok && r2 && r2.id === r1.id && stateOf(a, 'bkPos')?.length === 1 && bpos(a).length === 2 && !stateOf(a, 'bkOpening'), 'C2 a repeated basket cid: the same reply, one group: ' + JSON.stringify([r1, r2]));
    // basket place and alert add repeated: one row each
    const p1 = await c2.ask({ op: 'basket', do: 'place', bid: 'b2', name: 'EG2', long: { EUR: 1 }, short: { USD: 1 }, side: 'buy', lots: 1, type: 'limit', bp: 50 }, 'bk-place-cid');
    const p2 = await c2.ask({ op: 'basket', do: 'place', bid: 'b2', name: 'EG2', long: { EUR: 1 }, short: { USD: 1 }, side: 'buy', lots: 1, type: 'limit', bp: 50 }, 'bk-place-cid');
    const l1 = await c2.ask({ op: 'alert', do: 'add', sym: 'EURUSD', price: 1.2 }, 'al-cid'), l2 = await c2.ask({ op: 'alert', do: 'add', sym: 'EURUSD', price: 1.2 }, 'al-cid');
    ok(p1.ok && p2.id === p1.id && stateOf(a, 'bkOrders').length === 1 && l1.ok && l2.id === l1.id && stateOf(a, 'alerts').length === 1, 'C2 basket place and alert add: once on a repeated cid');
    // I3: ½ of the basket: kept in the group with its closes, cleared when they are answered
    const g0 = stateOf(a, 'bkPos')[0], h = await c2.ask({ op: 'basket', do: 'half', gid: g0.gid });
    ok(h && h.ok && await until(() => { const g = stateOf(a, 'bkPos')[0]; return g && !g.halving && g.lots === .5 && g.legs.every(l => l.lots < g0.legs.find(x => x.id === l.id).lots); }), 'I3 half closed, the halving cleared: ' + JSON.stringify([h, stateOf(a, 'bkPos')[0]]));
    await c2.ask({ op: 'basket', do: 'close', gid: g0.gid }); await until(() => !bpos(a).length);
    await c2.close();
  }

  // I2: a basket with a leg that cannot fill: the filled leg closes again ('Basket rollback'), as a group in the book until done
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const r = await c.ask({ op: 'basket', do: 'open', bid: 'b3', name: 'EJ', long: { EUR: 1 }, short: { USD: 1, JPY: 1 }, side: 'buy', lots: 1 });
    ok(r && !r.ok && r.code === 'PARTIAL', 'I2 partial: refused as such: ' + JSON.stringify(r));
    ok(await until(() => !bpos(a).length && !stateOf(a, 'bkPos')?.length), 'I2 the filled leg closed, the group gone');
    ok(B.history(a).some(x => x.reason === 'Basket rollback') && !stateOf(a, 'bkHist')?.length, 'I2 closed as Basket rollback, no basket record');
    await c.close();
  }

  // I1: a pending order that reverses the net book: the remainder gets the order's exits
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o1 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const o2 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: 1.5, ot: 'limit', price: 1.101, slPips: 20, tpPips: 30 });
    ok(o1.ok && o2.ok, 'I1 a sell limit of 1.5 against a buy of 1');
    px('EURUSD', 1.1012, 1.1013);
    ok(await until(() => bpos(a).length === 1 && bpos(a)[0].side === 'sell' && bpos(a)[0].lots === .5), 'I1 it reversed: ' + JSON.stringify(bpos(a)));
    const p = bpos(a)[0];
    ok(await until(() => legs(a, p.id).length === 2) && legs(a, p.id).find(x => x.leg === 'SL')?.lots === .5, 'I1 the remainder has its SL and TP: ' + JSON.stringify(legs(a, p.id)));
    await flat(c); await c.close();
  }

  // sell-side trail: falling ticks, the stop only goes down
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: 1, ot: 'market', trail: 20 });
    ok(o.ok && await until(() => legs(a, o.pos).some(x => x.leg === 'SL')), 'sell trail: the stop at once');
    const seen = [legs(a, o.pos).find(x => x.leg === 'SL').price];
    for (let i = 1; i <= 25; i++) { const b = 1.1 - i * .0001; px('EURUSD', +b.toFixed(5), +(b + .0001).toFixed(5)); await sleep(100); seen.push(legs(a, o.pos).find(x => x.leg === 'SL').price); }
    await sleep(1200); seen.push(legs(a, o.pos).find(x => x.leg === 'SL').price);
    ok(seen.every((v, i) => !i || v <= seen[i - 1] + 1e-12) && seen.at(-1) < seen[0] && near5(seen.at(-1), 1.0996), 'sell trail: down only, to the last ask + 20 pips: ' + seen[0] + ' → ' + seen.at(-1));
    await flat(c); await c.close();
  }

  // feed down: no OMS action on stale prices (a time stop due waits), then it acts
  {
    px('EURUSD', 1.1, 1.1001);
    const c = await dev(), a = c.acct;
    H.noGwFeed = true;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .2, ot: 'market', pm: { timeStop: 1 } });
    await sleep(10600);
    G.oms.tick(); await sleep(300);
    ok(o.ok && bpos(a).length === 1 && !G.market.feedAlive(), 'feed down: the due time stop did not act');
    delete H.noGwFeed; feedAll();
    ok(await until(() => !bpos(a).length) && B.history(a).some(h => h.reason === 'Time stop'), 'feed back: it acts');
    await c.close();
  }

  // I6: an order in flight when the challenge breaches: what it opens is flattened too
  {
    px('EURUSD', 1.1, 1.1001); px('GBPUSD', 1.3, 1.3002);
    const c = await dev(), a = c.acct;
    const rules = { id: 'test', pv: 1, label: 'Test', phases: [{ target: 10 }], daily: { pct: 1, base: 'initial', anchor: 'balance' }, max: { pct: 10, mode: 'static', trailOn: 'balance', lock: false }, minDays: 0, profitDays: null, consistency: null, reset: { tz: 'UTC', hour: 0 } };
    await c.ask({ op: 'settings', chal: { do: 'start', id: 'test', rules } });
    const o1 = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 2, ot: 'market' });
    await until(() => G.mirror.get(a)?.summary);
    // the breach is seen by the gateway right after it sent the GBPUSD order, before the broker answers it
    const low = () => [['EURUSD', 1.094, 1.0941, clock()], ['GBPUSD', 1.3, 1.3002, clock()], ['USDJPY', 150, 150.02, clock()]];
    H.command = cmd => { if (cmd.cid === 'inflight-cid') process.nextTick(() => G.tick(low())); };
    const o2 = await c.ask({ op: 'order', sym: 'GBPUSD', side: 'buy', lots: .5, ot: 'market' }, 'inflight-cid');
    delete H.command;
    ok(o1.ok && o2.ok && await until(() => stateOf(a, 'chal')?.att?.status === 'breached'), 'I6 breached with an order in flight');
    ok(await until(() => !bpos(a).length, 6000) && [o1.pos, o2.pos].every(id => B.history(a).some(h => h.id === id && h.reason === 'Stop-out (challenge breach)')), 'I6 both flattened: ' + JSON.stringify(B.history(a).map(h => [h.id, h.reason])));
    await c.close();
  }

  // G4: the broker stops → link down, commands refused, nothing goes out; it comes back → link up and a fresh snapshot
  {
    const n0 = q1("SELECT n FROM gw_clord WHERE account = 'u1'").n;
    await B.close(); B = null;
    ok(await a1.wait('link', m => m.state === 'down'), 'G4 link down');
    const r = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    ok(r && !r.ok && r.text === 'Execution server unreachable', 'G4 refused: ' + JSON.stringify(r));
    ok(q1("SELECT n FROM gw_clord WHERE account = 'u1'").n === n0, 'G4 no ClOrdID used');
    const snaps = a1.ev('snapshot').length;
    H.beforeUp = up => { H.held = up; }; // hold the window between the logon rebuild and 'up'
    B = await brokerUp(); B.tick(rows());
    ok(await until(() => H.held, 6000) && G.fixOn && G.link === 'down', 'G4 logged on, mirror rebuilt, not up yet');
    const rw = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' }), hw = await a1.ask({ op: 'history' });
    ok(rw && rw.text === 'Execution server unreachable' && hw && hw.text === 'Execution server unreachable' && q1("SELECT n FROM gw_clord WHERE account = 'u1'").n === n0, 'G4 commands in the rebuild window are refused: ' + JSON.stringify([rw, hw]));
    delete H.beforeUp; H.held();
    ok(await a1.wait('link', m => m.state === 'up' && a1.msgs.indexOf(m) > a1.msgs.findIndex(x => x.ev === 'link' && x.state === 'down'), 6000), 'G4 link up again');
    ok(await until(() => a1.ev('snapshot').length > snaps), 'G4 a full snapshot after the logon');
    const s = a1.ev('snapshot').at(-1);
    ok(JSON.stringify(s.positions.map(p => ({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry }))) === JSON.stringify(brokerPositions('u1')), 'G4 the snapshot holds the broker positions');
    const r2 = await a1.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'limit', price: 1.0 });
    ok(r2 && r2.ok && await a1.wait('ord', m => m.order && m.order.clOrdId === r2.id), 'G4 orders go again: ' + JSON.stringify(r2));
    const c = await a1.ask({ op: 'cancel', id: r2.id });
    ok(c && c.ok && await a1.wait('ord', m => m.clOrdId === r2.id && m.gone), 'G4 and are cancelled');
  }

  // G5: only the proxy may connect: no secret / a wrong secret is refused; host/server.mjs passes a signed-in user
  {
    const more = Array.from({ length: 10 }, () => conn({ user: 2 })), opened = [];
    for (const m of more) opened.push(await m.open);
    const shut = (await until(() => { const x = more.filter(m => m.closed && m.code === 4029); return x.length ? x : null; })) || [];
    ok(shut.length === 1 && /open in 10 tabs or devices already/.test(shut[0].why) && more.filter(m => !m.closed).length === 9, 'G5 at most 10 sockets per account, the 11th is told why (M10): ' + JSON.stringify(more.map(m => [m.closed, m.code])));
    for (const m of more) await m.close();
    const x = conn({ headers: { 'x-tb-user': '1' } }), y = conn({ user: 1, secret: 'wrong' + SECRET.slice(5) });
    ok(!(await x.open) && x.status === 403 && !(await y.open) && y.status === 403, `G5 refused without the secret: ${x.status} ${y.status}`);
    const SP = await freePort(), tok = randomBytes(32).toString('hex');
    { const d = gw(); d.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 1, 0, ?)').run(createHash('sha256').update(tok).digest('hex'), Math.floor(Date.now() / 1000) + 3600); d.close(); }
    const srv = spawn(process.execPath, ['host/server.mjs'], { env: { ...process.env, TB_PORT: String(SP), TB_DB: TBDB, TB_APP: DIR, LEGACY_API_KEY: '', TB_GW_PORT: String(GP), TB_GW_SECRET: SECRET }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
    await until(() => out.includes('tradeBerry on'), 8000);
    const via = h => conn({ port: SP, headers: { Origin: `http://localhost:${SP}`, Host: `localhost:${SP}`, ...h } });
    const p = via({ Cookie: 'tb_s=' + tok, 'x-tb-user': '2', 'x-tb-gw-secret': 'forged' });
    const ps = await p.wait('snapshot');
    ok(ps && ps.account === 'u1', 'G5 through the proxy: the signed-in user, forged headers dropped: ' + JSON.stringify(ps && ps.account) + ' ' + p.status);
    const n = via({});
    ok(!(await n.open) && n.status === 401, 'G5 the proxy refuses a visitor not signed in: ' + n.status);
    await p.close(); srv.kill('SIGTERM');
    ok(!out.includes(SECRET), 'G5 the secret is not in the server log');
  }

  // G6: history, 200 a page, all of it
  {
    const db = new DatabaseSync(BDB), t0 = clock() / 1000;
    const ins = db.prepare('INSERT INTO trades (id, account, close_t, json) VALUES (?, ?, ?, ?)');
    for (let i = 1; i <= 450; i++) ins.run(1000 + i, 'u2', t0 + i, JSON.stringify({ id: 1000 + i, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.101, open: t0, close: t0 + i, pnl: 100, pips: 10, reason: 'Manual', swap: 0, comm: 0 }));
    db.close();
    const pages = [];
    for (let pg = 0; pg < 3; pg++) pages.push(await b1.ask({ op: 'history', page: pg }));
    ok(pages.every(p => p && p.ok && p.total === 450 && p.pages === 3), 'G6 450 trades in 3 pages: ' + JSON.stringify(pages.map(p => p && { ok: p.ok, total: p.total, pages: p.pages, text: p.text })));
    ok(pages[0].rows.length === 200 && pages[1].rows.length === 200 && pages[2].rows.length === 50, 'G6 200 + 200 + 50');
    const ids = pages.flatMap(p => p.rows.map(r => r.id));
    ok(new Set(ids).size === 450 && ids[0] === 1450 && ids.at(-1) === 1001, 'G6 complete, newest first');
  }


  // G14: the gateway away 10 minutes with a trail running and an alert crossed meanwhile: at the restart the stop is
  // tightened from the pause's bars, and the alert is marked
  {
    const px = (sym, b, a) => { Q[sym] = [b, a]; feedAll(); };
    px('EURUSD', 1.1, 1.1001);
    const c = conn({ user: 3, device: 'omsdevicerestart' }); await c.open; const sn = await c.wait('snapshot'), a = sn.account;
    await until(() => G.mirror.get(a)?.summary);
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', trail: 20 });
    const al = await c.ask({ op: 'alert', do: 'add', sym: 'EURUSD', price: 1.102, cond: 'above' });
    ok(o && o.ok && al && al.ok && await until(() => [...G.mirror.get(a).orders.values()].some(x => x.linkPos === o.pos && x.leg === 'SL')), 'G14 trail and alert set: ' + JSON.stringify([o, al]));
    await c.close(); await G.close(); G = null;
    const t = clock() / 1000;
    { const d = gw(); d.prepare("UPDATE gw_state SET json = ? WHERE account = '*' AND key = 'omsAt'").run(JSON.stringify(t - 600)); d.close(); }
    // the position opened 400 s before the restart (as the broker says): a higher bar before that must not count
    B.account(a).acct.positions[0].open = t - 400;
    FAKE_BARS.set('EURUSD', Array.from({ length: 10 }, (_, i) => [Math.floor(t - 600) + i * 60, 1.1, i === 1 ? 1.104 : i === 6 ? 1.1025 : 1.101, 1.0999, 1.1005]));
    Q.EURUSD = [1.101, 1.1011]; if (B) B.tick(rows());
    G = await gwUp();
    ok(await until(() => G.link === 'up', 6000), 'G14 the gateway is back');
    const sl = () => [...G.mirror.get(a).orders.values()].find(x => x.linkPos === o.pos && x.leg === 'SL')?.price;
    ok(await until(() => sl() === 1.1005, 6000), 'G14 the stop tightened from the bars after its open (1.1025 − 20 pips): ' + sl());
    const A = () => (q1("SELECT json FROM gw_state WHERE account = ? AND key = 'alerts'", a) || {}).json;
    ok(await until(() => JSON.parse(A() || '[]')[0]?.done === true), 'G14 the alert crossed in the pause is marked: ' + A());
    ok(JSON.parse(A())[0].at < t, 'G14 at the bar that crossed it');
    ok(B.account(a).acct.positions[0].sl === 1.1005, 'G14 the broker holds it');
    FAKE_BARS.clear();
    const c2 = conn({ user: 3, device: 'omsdevicerestart' }); await c2.open; await c2.wait('snapshot'); await c2.ask({ op: 'closeAll' }); await c2.close();
  }

  // G9: kill -9 the gateway in the middle of a fill; after the restart the mirror is the broker's
  {
    for (const c of socks) await c.close();
    await G.close(); G = null;
    const P2 = await freePort(), env = { ...process.env, TB_FIX_USER: USER, TB_FIX_PASS: PASS, TB_GW_SECRET: SECRET };
    const child = crash => {
      const c = spawn(process.execPath, ['tests/server/fixtures/gateway-child.mjs', TBDB, String(P2), String(BP), crash || ''], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      c.out = ''; c.stdout.on('data', d => { c.out += d; }); c.stderr.on('data', d => { c.out += d; });
      c.gone = new Promise(r => c.on('exit', (code, sig) => r(sig || code)));
      return c;
    };
    let c = child('fill');
    ok(await until(() => c.out.includes('linked'), 8000), 'G9 child linked: ' + c.out);
    const w = conn({ user: 1, port: P2 }); await w.open; await w.wait('snapshot');
    w.send({ op: 'order', sym: 'EURUSD', side: 'sell', lots: .7, ot: 'market' }, 'g9-cid');
    ok(await Promise.race([c.gone, sleep(5000)]) === 'SIGKILL', 'G9 the gateway died in the fill');
    await until(() => w.closed);
    ok(!w.replies.has('g9-cid') && !w.ev('exec', m => m.exec.kind === 'fill').length, 'G9 the browser never got the fill');
    const cl = JSON.parse(q1("SELECT json FROM gw_cid WHERE account = 'u1' AND cid = 'g9-cid'").json).cls[0];
    ok(fills(cl) === 0, 'G9 nothing of the fill committed');
    c = child('');
    ok(await until(() => c.out.includes('linked'), 8000), 'G9 restarted');
    const v = conn({ user: 1, port: P2 }); await v.open;
    const r = await v.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: .7, ot: 'market' }, 'g9-cid', 6000);
    ok(r && r.ok && r.id === cl, 'G9 the cid gets its fill after the restart: ' + JSON.stringify(r));
    ok(fills(cl) === 1, 'G9 the fill recorded once: ' + fills(cl));
    const s = await v.wait('snapshot', m => m.link === 'up', 6000) || v.ev('snapshot').at(-1);
    const mine = s && s.positions.map(p => ({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry }));
    ok(JSON.stringify(mine) === JSON.stringify(brokerPositions('u1')), 'G9 the mirror positions are the broker\'s: ' + JSON.stringify([mine, brokerPositions('u1')]));
    const bs = B.core.summary(B.account('u1').acct);
    ok(await until(() => { const a = v.ev('acct').at(-1)?.acct || s.acct; return a && near(a.balance, bs.balance) && near(a.margin, bs.margin, 1e-3); }), 'G9 the account is the broker\'s');
    ok(B.account('u1').acct.positions.filter(p => p.side === 'sell' && p.lots === .7).length === 1, 'G9 one order at the broker');
    await v.close(); c.kill('SIGTERM'); await c.gone;
    ok(!c.out.includes(PASS) && !c.out.includes(SECRET), 'G9 no credential in the child log');
  }

  // C2: the gateway killed in the middle of a basket opening: after the restart the group is whole, the cid answers
  {
    const P3 = await freePort(), env = { ...process.env, TB_FIX_USER: USER, TB_FIX_PASS: PASS, TB_GW_SECRET: SECRET, TB_TEST_OFF: String(OFF), TB_TEST_Q: JSON.stringify({ EURUSD: [1.1, 1.1001], GBPUSD: [1.3, 1.3002] }) };
    Q.EURUSD = [1.1, 1.1001]; Q.GBPUSD = [1.3, 1.3002]; B.tick(rows());
    const child = crash => { const c = spawn(process.execPath, ['tests/server/fixtures/gateway-child.mjs', TBDB, String(P3), String(BP), crash || ''], { env, stdio: ['ignore', 'pipe', 'pipe'] }); c.out = ''; c.stdout.on('data', d => { c.out += d; }); c.stderr.on('data', d => { c.out += d; }); c.gone = new Promise(r => c.on('exit', (code, sig) => r(sig || code))); return c; };
    let k = child('fill');
    ok(await until(() => k.out.includes('linked'), 8000), 'C2 kill: child linked');
    const w = conn({ user: 3, device: 'omsdevicekill01', port: P3 }); await w.open; const sn = await w.wait('snapshot'), a = sn.account;
    await sleep(800); // the account opened at the broker, quotes in
    w.send({ op: 'basket', do: 'open', bid: 'bk', name: 'EGK', long: { EUR: 1, GBP: 1 }, short: { USD: 1 }, side: 'buy', lots: 1 }, 'bk-kill-cid');
    ok(await Promise.race([k.gone, sleep(6000)]) === 'SIGKILL', 'C2 kill: the gateway died at the first leg fill');
    ok(stateOf(a, 'bkOpening') && Object.values(stateOf(a, 'bkOpening'))[0].cls.length === 2 && q1('SELECT json FROM gw_cid WHERE account = ? AND cid = ?', a, 'bk-kill-cid'), 'C2 kill: the opening and the cid were committed with the leg orders');
    k = child('');
    ok(await until(() => k.out.includes('linked'), 8000), 'C2 kill: restarted');
    const v = conn({ user: 3, device: 'omsdevicekill01', port: P3 }); await v.open; await v.wait('snapshot');
    const r = await v.ask({ op: 'basket', do: 'open', bid: 'bk', name: 'EGK', long: { EUR: 1, GBP: 1 }, short: { USD: 1 }, side: 'buy', lots: 1 }, 'bk-kill-cid', 8000);
    ok(r && r.ok && r.legs === 2 && stateOf(a, 'bkPos')?.length === 1 && !stateOf(a, 'bkOpening') && bpos(a).length === 2, 'C2 kill: the group is whole and the cid answers: ' + JSON.stringify([r, bpos(a).length]));
    ok(bpos(a).every(p => metaOf(a, p.id)?.bgid === r.id), 'C2 kill: each leg belongs to it');
    await v.close(); k.kill('SIGTERM'); await k.gone;
  }

  /* ---------- final review (03.11.2026) ---------- */
  // FR-I5: the exits travel on the D; the broker creates the legs at the fill (one SL, the targets), the gateway only the journal
  {
    px('EURUSD', 1.1, 1.1001);
    if (!G) { G = await gwUp(); await until(() => G.link === 'up', 6000); } // G9 left the in-process gateway stopped
    const c = await dev(), a = c.acct;
    const o = await c.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.095, tps: [{ price: 1.104, lots: .4 }, { price: 1.108, lots: .6 }], trail: 30, be: { at: 15, off: 1 } });
    ok(o && o.ok && await until(() => legs(a, o.pos).length === 3), 'FR-I5 market: the broker linked SL + 2 targets at the fill: ' + JSON.stringify([o, legs(a, o.pos)]));
    await sleep(300);
    const L = legs(a, o.pos);
    ok(L.filter(x => x.leg === 'SL').length === 1 && L.filter(x => /^TP/.test(x.leg)).length === 2 && L.every(x => /^bk-/.test(x.clOrdId)), 'FR-I5 no duplicate legs, all the broker\'s own: ' + JSON.stringify(L.map(x => [x.leg, x.clOrdId])));
    const mt = metaOf(a, o.pos);
    ok(mt && mt.sl0 === 1.095 && mt.tp0 === 1.104 && mt.prot && mt.prot.trail === 30 && mt.prot.be && mt.prot.be.at === 15, 'FR-I5 the journal and the trail / break-even at the gateway: ' + JSON.stringify(mt));
    // a pending order with offsets, filled while the gateway is away: the position has its exits at the broker
    const p = await c.ask({ op: 'order', sym: 'EURUSD', side: 'sell', lots: .5, ot: 'limit', price: 1.1030, slPips: 20, tpPips: 40, trail: 25, basket: 'x' });
    ok(p && p.ok && await until(() => G.mirror.get(a).orders.get(p.id)?.slPips === 20), 'FR-I5 the pending order carries its exits at the broker: ' + JSON.stringify([p, G.mirror.get(a).orders.get(p.id)]));
    await c.close(); await G.close(); G = null;
    px('EURUSD', 1.1031, 1.1032); await sleep(200);
    const bp = () => bpos(a).find(x => x.side === 'sell');
    ok(bp() && Math.abs(bp().sl - (bp().entry + .002)) < 1e-9 && Math.abs(bp().tp - (bp().entry - .004)) < 1e-9 && bp().slLink && bp().tpLink, 'FR-I5 filled with the gateway down: SL and TP at the broker: ' + JSON.stringify(bp()));
    H.checkMs = 300; G = await gwUp(); await until(() => G.link === 'up', 6000);
    const c2 = conn({ user: 3, device: 'omsdevice' + String(devN).padStart(5, '0') }); await c2.open; const sn = await c2.wait('snapshot'); c2.acct = a;
    const L2 = legs(a, bp().id);
    ok(sn && L2.filter(x => x.leg === 'SL').length === 1 && L2.filter(x => /^TP/.test(x.leg)).length === 1, 'FR-I5 after the restart the mirror has exactly its two legs: ' + JSON.stringify(L2));
    ok(metaOf(a, bp().id) && metaOf(a, bp().id).sl0 != null && metaOf(a, bp().id).prot?.trail === 25, 'FR-I5/I6 the journal and the trail taken over from the fill heard on the resend: ' + JSON.stringify(metaOf(a, bp().id)));
    // E2E2: two quick moves of one stop: both accepted, the last one stands
    const id = o.pos, s1 = c2.send({ op: 'modify', posId: id, sl: 1.096 }), s2 = c2.send({ op: 'modify', posId: id, sl: 1.097 });
    const r1 = await until(() => c2.replies.get(s1)), r2 = await until(() => c2.replies.get(s2));
    ok(r1 && r1.ok && r2 && r2.ok, 'FR-E2E2 two quick stop moves: no refusal: ' + JSON.stringify([r1, r2]));
    ok(await until(() => legs(a, id).find(x => x.leg === 'SL')?.price === 1.097) && bpos(a).find(x => x.id === id).sl === 1.097, 'FR-E2E2 the last one stands at the broker');
    // a stop move chained on one the broker refuses: the second is sent once more against the stop and stands (no false "Order not found")
    {
      let first = true; BH.refuseG = () => { if (!first) return null; first = false; return 'Refused on purpose'; };
      const t1 = c2.send({ op: 'modify', posId: id, sl: 1.0965 }), t2 = c2.send({ op: 'modify', posId: id, sl: 1.0975 });
      const x1 = await until(() => c2.replies.get(t1)), x2 = await until(() => c2.replies.get(t2));
      delete BH.refuseG;
      ok(x1 && !x1.ok && /on purpose/.test(x1.text) && x2 && x2.ok, 'FR-chain the first refused with its own text, the chained one succeeds: ' + JSON.stringify([x1, x2]));
      ok(await until(() => legs(a, id).find(x => x.leg === 'SL')?.price === 1.0975), 'FR-chain the stop is at the chained level');
    }
    // E2E2 for a working order: two quick price moves, then a price move and an exit edit at once: no refusal, both kept
    {
      const w = await c2.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'limit', price: 1.05, slPips: 20 });
      const m1 = c2.send({ op: 'modify', id: w.id, price: 1.051 }), m2 = c2.send({ op: 'modify', id: w.id, price: 1.052 });
      const q1r = await until(() => c2.replies.get(m1)), q2r = await until(() => c2.replies.get(m2));
      ok(q1r && q1r.ok && q2r && q2r.ok, 'FR-E2E2 two quick order-price moves: no refusal: ' + JSON.stringify([q1r, q2r]));
      const wo = () => B.account(a).acct.orders.find(o => o.sym === 'EURUSD' && o.lots === .1);
      ok(await until(() => wo()?.price === 1.052) && wo().slPips === 20, 'FR-E2E2 the last price stands, the exits kept: ' + JSON.stringify(wo() && { p: wo().price, sl: wo().slPips }));
      const id0 = [...G.mirror.get(a).orders.values()].find(o => o.linkPos == null && o.sym === 'EURUSD').clOrdId;
      const m3 = c2.send({ op: 'modify', id: id0, price: 1.053 }), m4 = c2.send({ op: 'modify', id: id0, slPips: 30 });
      const q3 = await until(() => c2.replies.get(m3)), q4 = await until(() => c2.replies.get(m4));
      ok(q3 && q3.ok && q4 && q4.ok, 'FR-E2E2 a price move and an exit edit at once: no refusal: ' + JSON.stringify([q3, q4]));
      ok(await until(() => wo()?.slPips === 30) && wo().price === 1.053, 'FR-E2E2 both changes stand: ' + JSON.stringify(wo() && { p: wo().price, sl: wo().slPips }));
      await c2.ask({ op: 'cancel', id: [...G.mirror.get(a).orders.values()].find(o => o.linkPos == null && o.sym === 'EURUSD').clOrdId });
    }
    // M7: two positions on the other side in the net book: each offset, the rest opens
    await flat(c2);
    px('USDJPY', 150, 150.02);
    const h1 = await c2.ask({ op: 'order', sym: 'USDJPY', side: 'sell', lots: .3, ot: 'market', basket: 'x' }), h2 = await c2.ask({ op: 'order', sym: 'USDJPY', side: 'sell', lots: .2, ot: 'market', basket: 'x' });
    ok(h1.ok && h2.ok && h1.pos !== h2.pos, 'FR-M7 two separate sells');
    const b1 = await c2.ask({ op: 'order', sym: 'USDJPY', side: 'buy', lots: 1, ot: 'market' });
    ok(b1 && b1.ok && await until(() => bpos(a).length === 1 && bpos(a)[0].side === 'buy' && near(bpos(a)[0].lots, .5)), 'FR-M7 both offset, 0.5 left open: ' + JSON.stringify([b1, brokerPositions(a)]));
    ok(B.history(a).filter(x => (x.id === h1.pos || x.id === h2.pos) && x.reason === 'Offset by buy order').length === 2, 'FR-M7 each closed "Offset by buy order": ' + JSON.stringify(B.history(a).map(x => [x.id, x.reason])));
    ok(b1.pos === bpos(a)[0].id, 'FR-M7 the reply names the position that opened');
    // I7: a history window (AD limited), the fills and the order log from the broker, the peak in the BA
    const hw = await c2.ask({ op: 'history', page: 0, size: 2 });
    ok(hw && hw.ok && hw.rows.length === 2 && hw.total >= 4 && hw.pages === Math.ceil(hw.total / 2) && hw.rows[0].close >= hw.rows[1].close, 'FR-I7 history: a window of 2 of ' + (hw && hw.total));
    const pd = await c2.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'limit', price: 1.05 });
    await c2.ask({ op: 'cancel', id: pd.id });
    const rec = await c2.ask({ op: 'records' });
    ok(rec && rec.ok && rec.fills.length >= 8 && rec.fills.every(f => f.fid != null && f.px > 0) && rec.fills[0].t >= rec.fills.at(-1).t, 'FR-I7 records: the fill receipts, newest first: ' + (rec && rec.fills.length));
    ok(rec && rec.ordLog.some(x => x.status === 'cancelled' && x.price === 1.05) && rec.ordLog.some(x => x.status === 'filled' && x.price === 1.103), 'FR-I7 records: the order log (cancelled, filled): ' + JSON.stringify(rec && rec.ordLog.map(x => [x.status, x.price])));
    const ac = await c2.wait('acct', m => m.acct && m.acct.peak >= 100000);
    ok(ac && ac.acct.peak === B.account(a).acct.peak, 'FR-I7 the BA carries the account peak: ' + (ac && ac.acct.peak));
    await flat(c2);
    // I4: an OMS step that throws on this account's reports: the report and the link stay, other accounts trade; 3 → suspended
    const other = await dev();
    H.omsExec = acc => { if (acc === a) throw new Error('injected'); };
    for (let i = 0; i < 3; i++) { const r = await c2.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' }); ok(r && r.ok && G.link === 'up', 'FR-I4 order ' + i + ' filled, link up: ' + JSON.stringify(r)); }
    ok(await until(() => bpos(a).length === 1 && near(G.mirror.get(a).positions.get(bpos(a)[0].id)?.lots, .3)), 'FR-I4 the mirror follows the broker');
    const so = await c2.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    ok(so && !so.ok && so.code === 'OMS_SUSPENDED' && c2.ev('notice', m => m.kind === 'oms').length === 1, 'FR-I4 suspended after 3, told once: ' + JSON.stringify(so));
    ok(logs.filter(l => /suspended after 3/.test(l)).length === 1, 'FR-I4 one log line for the suspension');
    const ro = await other.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market', sl: 1.09 });
    ok(ro && ro.ok && await until(() => legs(other.acct, ro.pos).length === 1), 'FR-I4 another account is not affected');
    ok((await c2.ask({ op: 'closeAll' })).ok, 'FR-I4 a close still goes (the broker side)');
    delete H.omsExec;
    // the suspension is tried again (every 10 minutes in service, 1 s here): a clean pass lifts it and says so
    H.resumeS = 1;
    ok(await until(() => c2.ev('notice', m => m.kind === 'oms' && /work again/.test(m.text)).length === 1, 5000), 'FR-I4 resumed after a clean pass, told');
    const back = await c2.ask({ op: 'order', sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    ok(back && back.ok, 'FR-I4 orders work again after the resume: ' + JSON.stringify(back));
    delete H.resumeS;
    await flat(c2);
    await flat(other); await other.close();
    // I8: a revoked session closes its sockets
    { const d = gw(); d.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at, shared) VALUES (4, 'dave', '00', '00', 1, 0, 0)").run(); d.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 4, 0, 4e9)').run('ab'.repeat(32)); d.close(); }
    const dv = conn({ headers: { 'x-tb-gw-secret': SECRET, 'x-tb-user': '4', 'x-tb-session': 'ab'.repeat(32) } }); await dv.open; await dv.wait('snapshot');
    await sleep(700); ok(!dv.closed, 'FR-I8 a live session stays');
    { const d = gw(); d.prepare('DELETE FROM sessions WHERE user_id = 4').run(); d.close(); }
    ok(await until(() => dv.closed, 3000) && dv.code === 4401 && /Signed out/.test(dv.why), 'FR-I8 revoked: closed with 4401: ' + dv.code);
    await c2.close();
  }

  // F07 (security audit 09.11.2026): a flood of commands on one account is refused with RATE, others are not touched
  {
    H.rateBurst = 3; H.ratePerS = 0.001;
    const fl = conn({ user: 2 }); await fl.open; await fl.wait('snapshot');
    const codes = []; for (let i = 0; i < 5; i++) codes.push((await fl.ask({ op: 'meta' })).code);
    ok(codes.slice(0, 3).every(c => c === 'BAD_REQUEST') && codes.slice(3).every(c => c === 'RATE'), 'F07 the 4th command in the burst is refused with RATE: ' + codes.join(','));
    const al = conn({ user: 1 }); await al.open; await al.wait('snapshot');
    ok((await al.ask({ op: 'meta' })).code === 'BAD_REQUEST', 'F07 another account is not limited');
    delete H.rateBurst; delete H.ratePerS; await sleep(300);
    ok((await fl.ask({ op: 'meta' })).code === 'BAD_REQUEST', 'F07 the bucket refills');
    await fl.close(); await al.close();
  }

  ok(!logs.some(l => l.includes(PASS) || l.includes(USER) || l.includes(SECRET)), 'no credential or secret in the logs');
  if (process.env.TB_TEST_LOGS) console.log(logs.join('\n'));
} catch (e) { fail++; console.log('  ABORT', e.stack); } finally {
  clearInterval(keep);
  for (const c of socks) { try { c.ws.terminate(); } catch {} }
  try { if (G) await G.close(); } catch {}
  try { if (B) await B.close(); } catch {}
  rmSync(DIR, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
