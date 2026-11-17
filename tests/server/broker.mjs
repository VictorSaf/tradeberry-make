// host/broker.mjs, the temporary FIX 4.4 broker: a real broker on a test port, a fake feed (no network), a seeded rng and
// a test initiator in the gateway's place. The market clock runs from Monday 2026-11-02 10:00 UTC (FX open, whatever day
// the test runs) and is moved forward where a test needs time to pass; SendingTime stays the wall clock. B10 runs the
// broker in a child process (tests/server/fixtures/broker-child.mjs) and kills it with SIGKILL between the commit and the
// wire. Usage, from 2-cod-sursa: node tests/server/broker.mjs (also run by tests/server/run.mjs).
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInitiator } from '../../host/fix/session.mjs';
import { openStore } from '../../host/fix/store.mjs';
import * as D from '../../host/fix/dialect.mjs';
import { startBroker } from '../../host/broker.mjs';
import { openBrokerDb } from '../../host/broker/db.mjs';
import { REASON, barSource } from '../../host/broker/recover.mjs';

let pass = 0, fail = 0;
const ok = (v, msg) => { if (v) pass++; else { fail++; console.log('  FAIL', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(20)) { const v = f(); if (v) return v; } return f(); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
const DIR = mkdtempSync(join(tmpdir(), 'tb-broker-')), USER = 'u' + randomBytes(6).toString('hex'), PASS = 'p' + randomBytes(9).toString('base64url');
const logs = [], log = s => logs.push(String(s));
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const OFF = Date.parse('2026-11-02T10:00:00Z') - Date.now();
let skew = 0;
const clock = () => Date.now() + OFF + skew;
const PORT = await freePort(), FILE = join(DIR, 'broker.db');
// test hooks: an account whose every tick throws (Q1), a message type whose handler throws (DL1)
const poison = { tick: new Set(), app: new Set() };
const hooks = { tick: id => { if (poison.tick.has(id)) throw new Error('poisoned account'); }, onApp: m => { if (poison.app.has(m.type + ':' + m.fields.get('1'))) throw new Error('poisoned message'); } };
let B = await startBroker({ db: FILE, port: PORT, user: USER, pass: PASS, feed: false, now: clock, seed: 7, log, staleMs: 1500, hooks }); // stale after 1.5 s here (10 s in service)

// the fake feed: prices by hand, sent again every second (with the clock's time) while it is on
const Q = { EURUSD: [1.1, 1.1001], GBPUSD: [1.3, 1.3002], USDJPY: [150, 150.02] };
let feedOn = true;
const rows = () => Object.entries(Q).map(([s, [b, a]]) => [s, b, a, clock()]);
const px = (sym, bid, ask) => { Q[sym] = [bid, ask]; if (feedOn) B.tick(rows()); };
B.tick(rows());
const keep = setInterval(() => { if (feedOn) B.tick(rows()); }, 1000);

// the test initiator (the gateway's place): every application message it gets is kept
const got = [];
const GW = join(DIR, 'gw.db');
const initiator = () => createInitiator({ port: PORT, compId: 'TB-GW', target: 'TB-BROKER', user: USER, pass: PASS, heartBtInt: 30, store: openStore(GW), log, onApp: m => { got.push(m); } });
let I = initiator();
ok(await until(() => I.state === 'logged-on'), 'logged on: ' + I.state);
const OPTS = { digits: s => B.market.META[s].digits, lotDigits: 2 };
const nth = (() => { let n = 0; return a => `tb-${a}-${++n}`; })();
const order = (a, req, cl = nth(a)) => { I.send('D', D.orderToD({ tif: 'GTC', ...req }, cl, a, OPTS)); return cl; };
const ers = cl => got.filter(m => m.type === '8' && m.fields.get('11') === cl).map(m => ({ ...D.reportToExec(m), m }));
const er = async (cl, kind, n = 1) => (await until(() => ers(cl).filter(x => !kind || x.kind === kind).length >= n)) && ers(cl).filter(x => !kind || x.kind === kind);
const newAcct = async (a, set = {}) => { I.send('U1', D.settingsToU1({ jur: 'none', slip: 'off', type: 'demo', ...set }, a)); return until(() => B.account(a)); };
const of = (type, a) => got.filter(m => m.type === type && m.fields.get('1') === a);
const body = m => [...m.fields].filter(([t]) => !['9', '10', '34', '43', '52', '122'].includes(t));

try {
  // B1: a market D gives an 8 with 150=F; AP (subscribed) and BA show the fill
  {
    await newAcct('b1', { slip: 'sym' }); // the fill noise on (seeded)
    I.send('AN', [[710, 'r1'], [724, 0], [263, 1], [1, 'b1']]);
    ok(await until(() => got.find(m => m.type === 'AO' && m.fields.get('710') === 'r1')), 'B1 AN answered with AO');
    const cl = order('b1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const [f] = await er(cl, 'fill') || [];
    ok(f && f.m.fields.get('150') === 'F' && f.m.fields.get('39') === '2' && f.receipt.lots === 1 && f.receipt.kind === 'open', 'B1 fill 150=F: ' + JSON.stringify(f && f.receipt));
    ok(f && f.m.fields.get('17') === `b1:${f.receipt.fid}`, 'B1 ExecID is account:fid (unique in the session): ' + (f && f.m.fields.get('17')));
    const pos = B.account('b1').acct.positions[0];
    ok(pos && near(pos.entry, f.receipt.px) && f.receipt.pos === pos.id, `B1 position at the fill price ${pos && pos.entry}`);
    const ap = await until(() => of('AP', 'b1').map(D.apToPos).find(x => x.pos.id === pos.id && x.pos.lots === 1));
    ok(ap && ap.pos.side === 'buy' && near(ap.pos.entry, pos.entry), 'B1 AP pushed after the fill: ' + JSON.stringify(ap));
    I.send('BB', [[909, 'c1'], [1, 'b1']]);
    const ba = await until(() => of('BA', 'b1').map(D.baToSummary).find(x => x.summary.margin > 0));
    const s = B.core.summary(B.account('b1').acct);
    ok(ba && near(ba.summary.balance, s.balance) && near(ba.summary.margin, s.margin, 1e-3), 'B1 BA carries the margin of the fill: ' + JSON.stringify(ba && ba.summary));
  }

  // B2: the same ClOrdID twice → one fill, and the second 8 is the first one again
  {
    await newAcct('b2');
    const cl = nth('b2');
    order('b2', { sym: 'EURUSD', side: 'buy', lots: .5, ot: 'market' }, cl);
    await er(cl, 'fill');
    order('b2', { sym: 'EURUSD', side: 'buy', lots: .5, ot: 'market' }, cl);
    const two = await er(cl, 'fill', 2) || [];
    ok(two.length === 2 && B.account('b2').acct.positions.length === 1 && B.account('b2').acct.positions[0].lots === .5, `B2 one position: ${B.account('b2').acct.positions.length}`);
    ok(two.length === 2 && JSON.stringify(body(two[0].m)) === JSON.stringify(body(two[1].m)), 'B2 the second 8 is identical');
    const n = new DatabaseSync(FILE).prepare("SELECT COUNT(*) n FROM executions WHERE json ->> 'cl' = ?").get(cl).n;
    ok(n === 1, `B2 one execution stored: ${n}`);
  }

  // B3: a linked SL fires on a tick with nobody connected; the 8 reaches the gateway by resend when it is back
  {
    await newAcct('b3');
    const cl = order('b3', { sym: 'GBPUSD', side: 'buy', lots: 1, ot: 'market' });
    const [f] = await er(cl, 'fill') || [];
    const sl = order('b3', { sym: 'GBPUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.295, linkPos: f.receipt.pos, leg: 'SL' });
    ok(await er(sl, 'new'), 'B3 SL accepted: ' + JSON.stringify(ers(sl).map(x => [x.kind, x.code, x.text])));
    await I.close();
    // an order sent while the link is down reaches the broker only by resend, too late: refused, never executed at market
    const late = order('b3', { sym: 'GBPUSD', side: 'buy', lots: 1, ot: 'market' });
    await sleep(1600);
    px('GBPUSD', 1.2949, 1.2951);
    ok(await until(() => !B.account('b3').acct.positions.length), 'B3 the SL closed the position with the gateway away');
    ok(new DatabaseSync(FILE).prepare("SELECT COUNT(*) n FROM executions WHERE json ->> 'cl' = ? AND json ->> 'kind' = 'fill'").get(sl).n === 1, 'B3 the fill is stored');
    ok(!ers(sl).some(x => x.kind === 'fill'), 'B3 not received while away');
    I = initiator();
    const [sf] = await er(sl, 'fill') || [];
    ok(sf && sf.m.fields.get('43') === 'Y' && sf.receipt.reason === 'Stop loss' && near(sf.receipt.px, 1.2949), 'B3 SL fill comes by resend (PossDup): ' + JSON.stringify(sf && sf.receipt));
    const [lr] = await er(late) || [];
    ok(lr && lr.kind === 'reject' && lr.code === 'STALE' && !B.account('b3').acct.positions.length, 'B3 the late order is refused as stale: ' + JSON.stringify(lr && { kind: lr.kind, code: lr.code, text: lr.text }));
    await until(() => I.state === 'logged-on');
  }

  // B4: TP1 partial, then the SL is cut to the remaining size (restated) and TP2 stays
  {
    await newAcct('b4');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('b4', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const pid = (await er(cl, 'fill'))[0].receipt.pos;
    const sl = order('b4', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.09, linkPos: pid, leg: 'SL' });
    const t1 = order('b4', { sym: 'EURUSD', side: 'sell', lots: .5, ot: 'limit', price: 1.102, linkPos: pid, leg: 'TP1' });
    const t2 = order('b4', { sym: 'EURUSD', side: 'sell', lots: .5, ot: 'limit', price: 1.104, linkPos: pid, leg: 'TP2' });
    ok(await er(sl, 'new') && await er(t1, 'new') && await er(t2, 'new'), 'B4 SL, TP1, TP2 accepted');
    px('EURUSD', 1.1021, 1.1022);
    const [tf] = await er(t1, 'fill') || [];
    ok(tf && tf.receipt.lots === .5 && tf.receipt.px >= 1.102 && /Take profit/.test(tf.receipt.reason), 'B4 TP1 filled .5 at its limit or better: ' + JSON.stringify(tf && tf.receipt));
    const [rs] = await er(sl, 'restated') || [];
    ok(rs && rs.ids.lots === .5 && rs.order.leg === 'SL' && rs.order.price === 1.09, 'B4 SL restated to .5: ' + JSON.stringify(rs && rs.ids));
    const p = B.account('b4').acct.positions[0];
    ok(p.lots === .5 && p.slLink.lots === .5 && p.tps.length === 1 && p.tps[0].cl === t2, 'B4 the position keeps .5 with TP2');
    I.send('AF', [[584, 'm4'], [585, 7], [1, 'b4']]);
    const st = await until(() => { const a = got.filter(m => m.type === '8' && m.fields.get('584') === 'm4').map(D.reportToExec); return a.length >= 2 && a; });
    ok(st && st.length === 2 && st.every(x => x.total === 2 && x.ordStatus === 'working') && st.find(x => x.ids.clOrdId === sl).ids.lots === .5, 'B4 AF: SL .5 and TP2 working');
  }

  // B4b: a D on a position (721) without net (5004) is close only: after TP1 took 0.5 of 1 lot, a close of 1 lot closes
  // the 0.5 left and opens nothing; a same-side one is refused
  {
    await newAcct('b4b');
    px('EURUSD', 1.1, 1.1001);
    const pid = (await er(order('b4b', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' }), 'fill'))[0].receipt.pos;
    const t1 = order('b4b', { sym: 'EURUSD', side: 'sell', lots: .5, ot: 'limit', price: 1.102, linkPos: pid, leg: 'TP1' });
    await er(t1, 'new');
    px('EURUSD', 1.1021, 1.1022);
    await er(t1, 'fill');
    px('EURUSD', 1.1, 1.1001);
    const x = order('b4b', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'market', posId: pid });
    const [f] = await er(x, 'fill') || [];
    await sleep(100);
    ok(f && f.receipt.lots === .5 && f.receipt.kind === 'close' && !B.account('b4b').acct.positions.length && !ers(x).some(e => e.kind === 'reject'), 'B4b closes the 0.5 left, opens nothing: ' + JSON.stringify(f && f.receipt.lots) + ' ' + B.account('b4b').acct.positions.length);
    const pid2 = (await er(order('b4b', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' }), 'fill'))[0].receipt.pos;
    const [r] = await er(order('b4b', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', posId: pid2 }), 'reject') || [];
    ok(r && r.code === 'CLOSE_ONLY' && B.account('b4b').acct.positions[0].lots === 1, 'B4b a same-side D on the position is refused: ' + (r && r.code));
  }

  // B5: OCO: the first entry of the group to fill cancels its sibling
  {
    await newAcct('b5');
    px('EURUSD', 1.1, 1.1001);
    const a = order('b5', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'stop', price: 1.102, oca: 'g1' });
    const b = order('b5', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.098, oca: 'g1' });
    ok(await er(a, 'new') && await er(b, 'new'), 'B5 both accepted');
    px('EURUSD', 1.1021, 1.1022);
    ok(await er(a, 'fill'), 'B5 the buy stop filled');
    const [c] = await er(b, 'cancel') || [];
    ok(c && /OCO/.test(c.text) && !B.account('b5').acct.orders.length, 'B5 the sell stop cancelled by OCO: ' + (c && c.text));
  }

  // B5b: a working order joins an OCO group by G (5001), a new order comes with the same group: one fills, the other goes
  {
    await newAcct('b5b');
    px('EURUSD', 1.1, 1.1001);
    const a = order('b5b', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'stop', price: 1.102 });
    ok(await er(a, 'new'), 'B5b a buy stop without a group');
    const a2 = nth('b5b');
    I.send('G', D.replaceToG({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'stop', price: 1.102, tif: 'GTC', oca: 'j1' }, a2, a, 'b5b', OPTS));
    const [r] = await er(a2, 'replaced') || [];
    ok(r && r.order.oca === 'j1' && B.account('b5b').acct.orders[0].ocaKey === 'j1', 'B5b the G puts it in the group: ' + JSON.stringify(r && r.order));
    const b = order('b5b', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.098, oca: 'j1' });
    ok(await er(b, 'new'), 'B5b the new order joins the group');
    px('EURUSD', 1.0979, 1.098);
    ok(await er(b, 'fill'), 'B5b the sell stop filled');
    const [c] = await er(a2, 'cancel') || [];
    ok(c && /OCO/.test(c.text) && !B.account('b5b').acct.orders.length, 'B5b the regrouped buy stop is cancelled by OCO: ' + (c && c.text));
  }

  // B6: G on the SL (tightening): the stop moves, the link takes the new ClOrdID, and fires at the new level
  {
    await newAcct('b6');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('b6', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const pid = (await er(cl, 'fill'))[0].receipt.pos;
    const sl = order('b6', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.09, linkPos: pid, leg: 'SL' });
    await er(sl, 'new');
    const sl2 = nth('b6');
    I.send('G', D.replaceToG({ sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.095, tif: 'GTC', linkPos: pid, leg: 'SL' }, sl2, sl, 'b6', OPTS));
    const [r] = await er(sl2, 'replaced') || [];
    ok(r && r.ids.origClOrdId === sl && r.order.price === 1.095 && B.account('b6').acct.positions[0].sl === 1.095, 'B6 replaced: SL at 1.095');
    const bad = nth('b6');
    I.send('G', D.replaceToG({ sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.2, tif: 'GTC', linkPos: pid, leg: 'SL' }, bad, sl2, 'b6', OPTS));
    const nine = await until(() => got.filter(m => m.type === '9' && m.fields.get('11') === bad).map(D.nineToCxlReject)[0]);
    ok(nine && nine.code === 'MOD_SL_SIDE' && nine.responseTo === 'G' && B.account('b6').acct.positions[0].sl === 1.095, 'B6 an SL above the bid is refused with 9: ' + JSON.stringify(nine));
    px('EURUSD', 1.0949, 1.095);
    const [f] = await er(sl2, 'fill') || [];
    ok(f && near(f.receipt.px, 1.0949) && !B.account('b6').acct.positions.length, 'B6 the replaced stop fills');
  }

  // B7: stop-out under 50%
  {
    await newAcct('b7');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('b7', { sym: 'EURUSD', side: 'buy', lots: 20, ot: 'market' });
    await er(cl, 'fill');
    px('EURUSD', 1.0505, 1.0506); // margin level ≈ 18%
    const so = await until(() => got.filter(m => m.type === '8' && m.fields.get('1') === 'b7').map(D.reportToExec).find(x => x.kind === 'fill' && x.receipt.reason === 'Stop-out'));
    ok(so && so.ids.clOrdId.startsWith('bk-b7-') && !B.account('b7').acct.positions.length, 'B7 stop-out fill with a broker ClOrdID: ' + (so && so.ids.clOrdId));
  }

  // B8: a GTD order expires
  {
    await newAcct('b8');
    const exp = Math.floor(clock() / 1000) + 61;
    const cl = order('b8', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.0, tif: 'GTD', expires: exp });
    const [n] = await er(cl, 'new') || [];
    ok(n && n.order.expires === exp, 'B8 GTD accepted with its expiry');
    skew += 62000; B.tick(rows());
    const [c] = await er(cl, 'cancel') || [];
    ok(c && /GTD expiry/.test(c.text) && !B.account('b8').acct.orders.length, 'B8 expired: ' + (c && c.text));
  }

  // B9: U1 Reset on a demo account; refused with NOT_DEMO on a live one
  {
    await newAcct('b9');
    const cl = order('b9', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const p9 = (await er(cl, 'fill'))[0].receipt.pos;
    const x = order('b9', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'market', posId: p9 });
    await er(x, 'fill');
    const o = order('b9', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.0 });
    order('b9', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    await er(o, 'new');
    await until(() => B.account('b9').acct.positions.length === 1);
    ok(B.history('b9').length === 1, 'B9 one closed trade before the reset');
    I.send('U1', D.resetToU1('b9'));
    ok(await er(o, 'cancel'), 'B9 the pending order is cancelled');
    const A = await until(() => B.account('b9').acct.balance === 100000 && B.account('b9'));
    ok(A && !A.acct.positions.length && !A.acct.orders.length && !B.history('b9').length, 'B9 reset: no positions, no orders, empty history, 100000');
    I.send('AD', [[568, 'h9'], [569, 0], [1, 'b9']]); I.send('AN', [[710, 'r9'], [724, 0], [1, 'b9']]);
    const ao = await until(() => got.filter(m => m.type === 'AO' && m.fields.get('710') === 'r9').map(D.aoToAck)[0]);
    ok(ao && ao.total === 0 && !of('AE', 'b9').length, 'B9 AN: 0 positions, AD: no trades');
    await newAcct('l9', { type: 'live', slip: 'sym' });
    I.send('U1', D.resetToU1('l9'));
    const j = await until(() => got.filter(m => m.type === 'j').map(D.jToReject).find(r => r.account === 'l9'));
    ok(j && j.code === 'NOT_DEMO' && j.text === 'Reset is available on demo accounts only', 'B9 live: NOT_DEMO: ' + JSON.stringify(j));
  }

  // B9u: a basket split — U1 UNHEDGE takes a hedged leg into the net book: a later net order reduces it
  {
    await newAcct('hx9');
    order('hx9', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' }); // no 721, no 5004: a hedged leg
    const p = await until(() => B.account('hx9').acct.positions[0]);
    ok(p && p.hedge === true, 'B9u the bare D opened a hedged position');
    I.send('U1', D.unhedgeToU1('hx9', p.id));
    ok(await until(() => B.account('hx9').acct.positions[0] && !B.account('hx9').acct.positions[0].hedge), 'B9u UNHEDGE: the leg is in the net book');
    order('hx9', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'market', net: true });
    ok(await until(() => B.account('hx9').acct.positions.length === 0), 'B9u a net order now closes it instead of opening a hedge');
    I.send('U1', D.unhedgeToU1('hx9', 99999));
    const j = await until(() => got.filter(m => m.type === 'j').map(D.jToReject).find(r => r.account === 'hx9'));
    ok(j && j.code === 'NO_POS', 'B9u unknown position: NO_POS');
  }

  // B12: feed down 15 s → nothing fills (a price past the SL sits in the market); back → it fills
  {
    await newAcct('b12');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('b12', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const pid = (await er(cl, 'fill'))[0].receipt.pos;
    const sl = order('b12', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.098, linkPos: pid, leg: 'SL' });
    await er(sl, 'new');
    feedOn = false;
    B.market.setQuotes([['EURUSD', 1.0979, 1.098, clock()]]); // the last price heard is past the SL (not yet ticked), then silence
    Q.EURUSD = [1.0979, 1.098];
    skew += 15000;
    await sleep(1500); // the broker's 1 s sweep runs on the dead feed
    ok(!B.market.feedAlive() && B.account('b12').acct.positions.length === 1 && !ers(sl).some(x => x.kind === 'fill'), 'B12 no fill while the feed is down');
    const m = order('b12', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const [r] = await er(m, 'reject') || [];
    ok(r && r.code === 'NO_FEED' && /No live prices/.test(r.text), 'B12 a market order is refused: ' + JSON.stringify(r && { code: r.code, text: r.text }));
    feedOn = true; B.tick(rows());
    const [f] = await er(sl, 'fill') || [];
    ok(f && near(f.receipt.px, 1.0979), 'B12 feed back: the SL fills');
  }


  // R1: an account that throws on every tick: rolled back and reloaded alone, quarantined after 3, the others go on
  {
    await newAcct('q1'); await newAcct('q2');
    px('EURUSD', 1.1, 1.1001);
    const a = order('q1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' }), b = order('q2', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const pb = (await er(b, 'fill'))[0].receipt.pos; await er(a, 'fill');
    const sl = order('q2', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.095, linkPos: pb, leg: 'SL' });
    await er(sl, 'new');
    poison.tick.add('q1');
    for (let i = 0; i < 3; i++) { px('EURUSD', 1.1 + i * 1e-5, 1.1001 + i * 1e-5); await sleep(30); }
    ok(await until(() => B.quarantined.has('q1')), 'R1 q1 quarantined after 3 failures');
    ok(logs.filter(l => l.includes('quarantined') && l.includes('q1')).length === 1 && logs.filter(l => /tick failed on account q1/.test(l)).length <= 1, 'R1 one quarantine line, the failure log rate-limited');
    px('EURUSD', 1.0949, 1.095);
    ok(await er(sl, 'fill'), 'R1 the other account still fills');
    ok(B.account('q1').acct.positions.length === 1 && B.account('q1').acct.positions[0].lots === 1, 'R1 q1 kept as committed');
    const d = order('q1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const [r] = await er(d, 'reject') || [];
    ok(r && r.code === 'SUSPENDED', 'R1 a D on the quarantined account is refused: ' + (r && r.code));
    poison.tick.delete('q1');
  }

  // R1b: the failure count resets only on real work: ticks on another instrument between the failing ones (the sweep
  // held) do not save a poisoned account from the quarantine; its D are then refused with the reason
  {
    await newAcct('q3');
    px('EURUSD', 1.1, 1.1001);
    const a = order('q3', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    await er(a, 'fill');
    B.pause(true); poison.tick.add('q3');
    for (let i = 1; i <= 3; i++) { px('EURUSD', 1.1 + i * 2e-5, 1.1001 + i * 2e-5); B.tick([['GBPUSD', 1.3 + i * 2e-5, 1.3002 + i * 2e-5, clock()]]); await sleep(20); }
    ok(await until(() => B.quarantined.has('q3'), 1000), 'R1b q3 quarantined although ticks on GBPUSD came in between');
    const d = order('q3', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const [r] = await er(d, 'reject') || [];
    ok(r && r.code === 'SUSPENDED' && /suspended by the broker/.test(r.text), 'R1b its D refused with the reason: ' + (r && r.text));
    poison.tick.delete('q3'); B.pause(false); px('GBPUSD', 1.3, 1.3002);
  }

  // R2: NBP on a flat account after a D (the close comes before any tick sees the price)
  {
    await newAcct('n1');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('n1', { sym: 'EURUSD', side: 'buy', lots: 20, ot: 'market' });
    const pid = (await er(cl, 'fill'))[0].receipt.pos;
    B.pause(true);
    B.market.setQuotes([...rows().filter(r => r[0] !== 'EURUSD'), ['EURUSD', 1.04, 1.0401, clock()]]); // −122 000, not ticked
    const x = order('n1', { sym: 'EURUSD', side: 'sell', lots: 20, ot: 'market', posId: pid });
    await er(x, 'fill');
    const A = await until(() => B.account('n1').acct.balance === 0 && B.account('n1'));
    ok(A && B.history('n1').some(t => t.nbp), 'R2 balance 0 and an NBP row after the close: ' + B.account('n1').acct.balance);
    B.pause(false); px('EURUSD', 1.1, 1.1001);
  }

  // R3: U1 SET rescales the initial margin; a jurisdiction with no leverage choice takes its FX-major cap; validation
  {
    await newAcct('s1');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('s1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    await er(cl, 'fill');
    const p = B.account('s1').acct.positions[0], im0 = p.im, l0 = B.core.effLev('EURUSD', B.account('s1').acct.set);
    I.send('U1', D.settingsToU1({ jur: 'eu', lev: 200 }, 's1'));
    await until(() => B.account('s1').acct.set.jur === 'eu');
    const A = B.account('s1');
    ok(A.acct.set.lev === 30 && near(A.acct.positions[0].im, im0 * l0 / 30, 1e-6), `R3 EU: lev 30, im ${A.acct.positions[0].im} = ${im0} × ${l0} / 30`);
    const js = n => until(() => got.filter(m => m.type === 'j').map(D.jToReject).filter(r => r.account === 's1').length >= n && got.filter(m => m.type === 'j').map(D.jToReject).filter(r => r.account === 's1'));
    I.send('U1', D.settingsToU1({ type: 'live' }, 's1'));
    I.send('U1', D.settingsToU1({ latMs: 9999 }, 's1'));
    const j = await js(2) || [];
    ok(j[0] && j[0].code === 'ACCT_TYPE' && j[1] && j[1].code === 'EXEC_RANGE', 'R3 type change and an out-of-range latency refused: ' + j.map(x => x.code));
    await newAcct('s2', { type: 'live', slip: 'sym' });
    I.send('U1', D.settingsToU1({ slip: 'off' }, 's2'));
    const j2 = await until(() => got.filter(m => m.type === 'j').map(D.jToReject).find(r => r.account === 's2'));
    ok(j2 && j2.code === 'LIVE_EXEC' && B.account('s2').acct.set.slip === 'sym', 'R3 a live account cannot turn the slippage off');
  }

  // R4: a ClOrdID repeated by another account → j DUP_CLORD, nothing echoed; a reversal's refused remainder → a reject 8
  {
    await newAcct('c1'); await newAcct('c2');
    const cl = order('c1', { sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    await er(cl, 'fill');
    const n8 = ers(cl).length;
    order('c2', { sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' }, cl);
    const j = await until(() => got.filter(m => m.type === 'j').map(D.jToReject).find(r => r.account === 'c2'));
    await sleep(100);
    ok(j && j.code === 'DUP_CLORD' && ers(cl).length === n8 && !B.account('c2').acct.positions.length, 'R4 DUP_CLORD, no echo, no fill');
    const pid = B.account('c1').acct.positions[0].id, flip = nth('c1');
    order('c1', { sym: 'EURUSD', side: 'sell', lots: 50, ot: 'market', posId: pid, net: true }, flip);
    const rj = await er(flip, 'reject') || [];
    ok(ers(flip).some(x => x.kind === 'fill') && rj[0] && /Reversal remainder/.test(rj[0].text), 'R4 the close fills and the remainder is refused: ' + (rj[0] && rj[0].text));
    order('c1', { sym: 'EURUSD', side: 'sell', lots: 50, ot: 'market', posId: pid, net: true }, flip);
    ok(await er(flip, 'reject', 2), 'R4 a repeat returns the refusal too');
  }

  // R5: a plain target covers the whole position and is resized on an add; a stop-limit trigger restates; H on a
  // finished order answers 150=I; BB without 263 is a snapshot only
  {
    await newAcct('t1');
    px('EURUSD', 1.1, 1.1001);
    const cl = order('t1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' });
    const pid = (await er(cl, 'fill'))[0].receipt.pos;
    const tp = order('t1', { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'limit', price: 1.105, linkPos: pid, leg: 'TP1' });
    await er(tp, 'new');
    const add = order('t1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', posId: pid, net: true }); // an add on the position nets (5004)
    await er(add, 'fill');
    const [rs] = await er(tp, 'restated') || [];
    ok(rs && rs.ids.lots === 2 && B.account('t1').acct.positions[0].tp === 1.105 && !B.account('t1').acct.positions[0].tps, 'R5 the plain target follows the add to 2 lots');
    const sl = order('t1', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'stoplimit', price: 1.102, limit: 1.1025 });
    await er(sl, 'new');
    I.send('BB', [[909, 'c5'], [1, 't1']]);
    await until(() => of('BA', 't1').some(m => m.fields.get('909') === 'c5'));
    const nBA = of('BA', 't1').length;
    px('EURUSD', 1.1021, 1.1022);
    ok(await er(sl, 'restated') && await er(sl, 'fill'), 'R5 the stop-limit restates at its trigger, then fills');
    await sleep(1300);
    ok(of('BA', 't1').length === nBA, 'R5 BB without 263: no BA pushed later');
    I.send('H', [[11, cl], [1, 't1'], [55, 'EURUSD'], [54, 1]]);
    const h = await until(() => got.filter(m => m.type === '8' && m.fields.get('11') === cl && m.fields.get('150') === 'I').map(D.reportToExec)[0]);
    ok(h && h.ordStatus === 'filled' && h.ids.lots === 1, 'R5 H on a filled order: 150=I, filled');
  }

  // R9: H on a ClOrdID that a G replaced answers replaced; H on the replacing one, once cancelled, answers cancelled
  {
    await newAcct('h9');
    px('EURUSD', 1.1, 1.1001);
    const o = order('h9', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.05 });
    await er(o, 'new');
    const o2 = nth('h9');
    I.send('G', D.replaceToG({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.06, tif: 'GTC' }, o2, o, 'h9', OPTS));
    await er(o2, 'replaced');
    const st = (cl, n) => until(() => got.filter(m => m.type === '8' && m.fields.get('11') === cl && m.fields.get('150') === 'I').map(D.reportToExec)[n]);
    I.send('H', [[11, o], [1, 'h9'], [55, 'EURUSD'], [54, 1]]);
    const h1 = await st(o, 0);
    ok(h1 && h1.ordStatus === 'replaced', 'R9 H on the replaced ClOrdID: ' + (h1 && h1.ordStatus));
    const f = nth('h9');
    I.send('F', D.cancelToF({ clOrdId: f, origClOrdId: o2, account: 'h9', sym: 'EURUSD', side: 'buy', lots: 1 }, OPTS));
    await er(f, 'cancel');
    I.send('H', [[11, o2], [1, 'h9'], [55, 'EURUSD'], [54, 1]]);
    const h2 = await st(o2, 0);
    ok(h2 && h2.ordStatus === 'cancelled', 'R9 H on the replacing ClOrdID after F: ' + (h2 && h2.ordStatus));
  }

  // R6: a non-D message whose handler throws on the same seq 3 times is consumed with a j (dead letter)
  {
    await newAcct('dl');
    poison.app.add('AD:dl');
    I.send('AD', [[568, 'h-dl'], [569, 0], [1, 'dl']]);
    const j = await until(() => got.filter(m => m.type === 'j').map(D.jToReject).find(r => r.account === 'dl'), 15000);
    ok(j && j.code === 'DEAD_LETTER' && logs.some(l => /dead letter: AD seq \d+ failed 3 times/.test(l)), 'R6 dead letter after 3 attempts');
    poison.app.delete('AD:dl');
    await until(() => I.state === 'logged-on');
    const cl = order('dl', { sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    ok(await er(cl, 'fill'), 'R6 the session goes on');
  }

  // R8: a D whose handler throws every time is dead-lettered with a reject 8 once it is older than the stale limit, so
  // the session goes on (it no longer blocks on it)
  {
    await newAcct('dd');
    poison.app.add('D:dd');
    const cl = order('dd', { sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    const r = await until(() => ers(cl).find(x => x.kind === 'reject'), 15000);
    ok(r && r.code === 'DEAD_LETTER' && /could not process/.test(r.text) && logs.some(l => /dead letter: D seq \d+/.test(l)), 'R8 the D is dead-lettered: ' + JSON.stringify(r && { code: r.code, text: r.text }));
    poison.app.delete('D:dd');
    await until(() => I.state === 'logged-on');
    const c2 = order('dd', { sym: 'EURUSD', side: 'buy', lots: .1, ot: 'market' });
    ok(await er(c2, 'fill') && !ers(cl).some(x => x.kind === 'fill'), 'R8 the next D fills, the dead one never does');
  }

  // R7: fix_out retention: what was sent before the cutoff is pruned, the rest kept
  {
    const db = new DatabaseSync(FILE), n0 = db.prepare('SELECT COUNT(*) n FROM fix_out').get().n;
    const cut = Date.now(); await sleep(20);
    await newAcct('fx');
    const n1 = db.prepare('SELECT COUNT(*) n FROM fix_out').get().n, gone = B.pruneFixOut(cut), n2 = db.prepare('SELECT COUNT(*) n FROM fix_out').get().n;
    ok(gone >= n0 - 2 && n2 === n1 - gone && n2 >= 1, `R7 pruned ${gone} of ${n1}, kept ${n2}`);
    db.close();
  }

  /* ---------- final review (03.11.2026): exits at the broker, the history window, records, the peak ---------- */
  {
    px('EURUSD', 1.1, 1.1001);
    await newAcct('fr');
    // FR1: a market D with its exits: the position opens with its stop loss and targets linked, in the same step
    const cl = order('fr', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', sl: 1.095, tps: [{ price: 1.104, lots: .4 }, { price: 1.108, lots: .6 }] });
    await er(cl, 'fill');
    const p = B.account('fr').acct.positions[0];
    ok(p && p.sl === 1.095 && p.slLink && p.tps && p.tps.length === 2 && p.tps.every(l => l.cl), 'FR1 market D: SL and 2 legs linked at the fill: ' + JSON.stringify(p && { sl: p.sl, tps: p.tps }));
    const news = await until(() => { const x = got.filter(m => m.type === '8' && m.fields.get('1') === 'fr').map(D.reportToExec).filter(x => x.kind === 'new' && x.order?.linkPos === p.id); return x.length >= 3 ? x : null; });
    ok(news && news.filter(x => x.order.leg === 'SL').length === 1 && news.filter(x => /^TP/.test(x.order.leg)).length === 2, 'FR1 the gateway hears of each leg (new): ' + JSON.stringify(news && news.map(x => x.order.leg)));
    // FR2: a pending D with offsets: kept on the order, reported with it, and on the position from the fill
    const cp = order('fr', { sym: 'GBPUSD', side: 'sell', lots: .5, ot: 'limit', price: 1.3030, slPips: 20, tps: [{ pips: 20, pct: 50 }, { pips: 40, pct: 50 }], trail: 25, be: { at: 15, off: 1, onTp: false } });
    const [nw] = await er(cp, 'new') || [];
    ok(nw && nw.order.slPips === 20 && nw.order.trail === 25 && nw.order.tps.length === 2 && nw.order.be.at === 15, 'FR2 the order report carries its exits: ' + JSON.stringify(nw && nw.order));
    px('GBPUSD', 1.3031, 1.3033);
    await er(cp, 'fill');
    const q = B.account('fr').acct.positions.find(x => x.sym === 'GBPUSD');
    ok(q && near(q.sl, q.entry + .002, 1e-9) && q.tps && q.tps.length === 2 && q.slLink && q.tps.every(l => l.cl) && q.trail === 25, 'FR2 filled: SL and targets from the fill: ' + JSON.stringify(q && { e: q.entry, sl: q.sl, tps: q.tps }));
    // FR3: a G of a working order replaces its exits
    const cg = order('fr', { sym: 'EURUSD', side: 'buy', lots: .3, ot: 'limit', price: 1.09, slPips: 15 });
    await er(cg, 'new');
    const cg2 = nth('fr');
    I.send('G', D.replaceToG({ sym: 'EURUSD', side: 'buy', lots: .3, ot: 'limit', price: 1.091, tif: 'GTC', slPips: 25, tpPips: 50 }, cg2, cg, 'fr', OPTS));
    const [rp] = await er(cg2, 'replaced') || [];
    const wo = B.account('fr').acct.orders.find(o => o.clOrdId === cg2);
    ok(rp && wo && wo.slPips === 25 && wo.tpPips === 50 && rp.order.slPips === 25, 'FR3 G: the exits replaced: ' + JSON.stringify(wo && { sl: wo.slPips, tp: wo.tpPips }));
    // FR4: a pending fill through a gap with its stop already past: opened and closed at once by the stop, gap
    const cx = order('fr', { sym: 'USDJPY', side: 'buy', lots: .2, ot: 'limit', price: 149.5, sl: 149.4 });
    await er(cx, 'new');
    px('USDJPY', 149.2, 149.22);
    const [fx] = await er(cx, 'fill') || [];
    const hx = await until(() => B.history('fr').find(h => h.sym === 'USDJPY'));
    ok(fx && hx && hx.reason === 'Stop loss' && hx.gap === true && !B.account('fr').acct.positions.some(x => x.sym === 'USDJPY'), 'FR4 gapped past its stop: closed "Stop loss", gap, never naked: ' + JSON.stringify(hx && { reason: hx.reason, gap: hx.gap }));
    px('USDJPY', 150, 150.02);
    // FR5: AD with a window: AQ says the total, only the window travels
    const n0 = got.length;
    I.send('AD', D.histToAD({ reqId: 'h1', account: 'fr', max: 1, skip: 0 }));
    const aq = await until(() => got.slice(n0).find(m => m.type === 'AQ'));
    await sleep(200);
    const aes = got.slice(n0).filter(m => m.type === 'AE').map(D.aeToTrade);
    ok(aq && D.aqToAck(aq).total === B.history('fr').length && aes.length === 1 && aes[0].trade.close === Math.max(...B.history('fr').map(h => h.close)), 'FR5 history window: 1 of ' + (aq && D.aqToAck(aq).total));
    // FR6: U2 records: the fills (newest first) and the order log
    const c6 = order('fr', { sym: 'EURUSD', side: 'buy', lots: .1, ot: 'limit', price: 1.05 });
    await er(c6, 'new');
    I.send('F', D.cancelToF({ clOrdId: nth('fr'), origClOrdId: c6, account: 'fr', sym: 'EURUSD', side: 'buy', lots: .1 }, OPTS));
    await sleep(200);
    const n1 = got.length;
    I.send('U2', D.recordsToU2({ account: 'fr', reqId: 'r1', fills: 500, log: 300 }));
    const u3 = await until(() => { const x = got.slice(n1).filter(m => m.type === 'U3').map(D.u3ToRecords); return x.some(r => r.kind === 'log') ? x : null; });
    const rf = (u3 || []).filter(x => x.kind === 'fill').flatMap(x => x.rows), rl = (u3 || []).filter(x => x.kind === 'log').flatMap(x => x.rows);
    ok(rf.length >= 4 && rf.every(f => f.fid > 0 && f.px > 0) && rf[0].fid > rf.at(-1).fid, 'FR6 the fill receipts, newest first: ' + rf.length);
    ok(rl.some(x => x.status === 'cancelled' && x.price === 1.05) && rl.some(x => x.status === 'filled' && x.price === 1.303), 'FR6 the order log: ' + JSON.stringify(rl.map(x => [x.status, x.price])));
    // FR7: the BA carries the peak equity, followed once a second; a demo Reset sets it back
    px('EURUSD', 1.103, 1.1031); B.sweep();
    const pk = B.account('fr').acct.peak;
    ok(pk > 100000, 'FR7 the peak follows the equity: ' + pk);
    I.send('BB', [[909, 'pk'], [1, 'fr']]);
    const bpk = await until(() => of('BA', 'fr').map(D.baToSummary).find(x => x.summary.peak === pk));
    ok(bpk, 'FR7 the BA carries it');
    I.send('U1', D.resetToU1('fr'));
    ok(await until(() => B.account('fr').acct.peak === 100000 && !B.account('fr').acct.positions.length), 'FR7 a Reset sets the peak back to 100000');
    const n2 = got.length;
    I.send('U2', D.recordsToU2({ account: 'fr', reqId: 'r2', fills: 500, log: 300 }));
    await sleep(400);
    ok(!got.slice(n2).filter(m => m.type === 'U3').some(m => D.u3ToRecords(m).rows.length), 'FR7 after a Reset the records start again');
    px('EURUSD', 1.1, 1.1001);
    // FR9: a reversal whose targets (prices, for the whole order) do not fit the remainder: cut back nearest first, opened
    const c9 = order('fr', { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market' }); const [f9] = await er(c9, 'fill') || [];
    const c9b = order('fr', { sym: 'EURUSD', side: 'sell', lots: 1.5, ot: 'market', posId: f9.receipt.pos, net: true, sl: 1.11, tps: [{ price: 1.09, lots: .5 }, { price: 1.08, lots: 1 }] });
    await er(c9b, 'fill', 2);
    const r9 = B.account('fr').acct.positions.find(x => x.side === 'sell');
    ok(r9 && near(r9.lots, .5) && r9.tp === 1.08 && r9.sl === 1.11 && r9.tpLink && r9.slLink && !ers(c9b).some(x => x.kind === 'reject'), 'FR9 the remainder opens with its targets cut to its size: ' + JSON.stringify(r9 && { lots: r9.lots, tp: r9.tp, tps: r9.tps }));
  }
  // L1: an account written by the migration: a pending order its jurisdiction no longer offers is cancelled (today's
  // reason) instead of executed, and a stop and a target with no ClOrdID get the broker's own
  {
    await I.close(); await B.close();
    const db = new DatabaseSync(FILE), t = clock() / 1000, set = { jur: 'us', lev: null, slip: 'off', slipSd: .2, latMs: 120, comm: 0 };
    db.prepare('INSERT INTO accounts (id, user_id, device, type, balance, peak, set_json, next_id, next_fill, roll_last, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('u9', 9, '', 'demo', 100000, 100000, JSON.stringify(set), 60, 1, null, Math.floor(t));
    db.prepare('INSERT INTO positions (id, account, json) VALUES (?, ?, ?)').run(50, 'u9', JSON.stringify({ id: 50, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, sl: 1.09, tp: 1.12, trail: 0, swap: 0, comm: 0, im: 2200, open: t }));
    db.prepare('INSERT INTO orders (id, account, cl_ord_id, json) VALUES (?, ?, ?, ?)').run(51, 'u9', 'tb-u9-1', JSON.stringify({ id: 51, sym: 'GOLD', side: 'buy', ot: 'limit', price: 1000, lots: 1, tif: 'GTC', status: 'pending', created: t }));
    db.prepare('INSERT INTO accounts (id, user_id, device, type, balance, peak, set_json, next_id, next_fill, roll_last, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('u8', 8, '', 'demo', -500, 100000, JSON.stringify({ ...set, jur: 'none' }), 5, 1, null, Math.floor(t) - 10);
    db.close();
    B = await startBroker({ db: FILE, port: PORT, user: USER, pass: PASS, feed: false, now: clock, seed: 7, log, staleMs: 1500 });
    B.tick(rows());
    I = initiator();
    const [c] = await er('tb-u9-1', 'cancel') || [];
    ok(c && /US retail/.test(c.text) && !B.account('u9').acct.orders.length, 'L1 the GOLD order is cancelled with the reason: ' + (c && c.text));
    const [sl] = await er('bk-u9-50-SL', 'new') || [], [tp] = await er('bk-u9-50-TP', 'new') || [];
    ok(sl && tp && sl.order.price === 1.09 && tp.order.price === 1.12 && tp.ids.lots === 1, 'L1 the stop and the target are linked orders now');
    px('EURUSD', 1.1201, 1.1202);
    ok(await er('bk-u9-50-TP', 'fill') && !B.account('u9').acct.positions.length, 'L1 the target fills as a linked order');
    const u8 = B.account('u8');
    ok(u8 && u8.acct.balance === 0 && B.history('u8').some(t => t.nbp && near(t.pnl, 500)), 'L1 a flat account at -500 gets its negative balance protection at start: ' + (u8 && u8.acct.balance));
    ok(await er('bk-u9-50-SL', 'cancel'), 'L1 and the stop is cancelled with the position');
  }

  // B10: kill -9 between the commit and the 8; after the restart the 8 comes once, by resend, and the state holds
  {
    await I.close(); await B.close(); clearInterval(keep);
    const P2 = await freePort(), F2 = join(DIR, 'b10.db'), G2 = join(DIR, 'gw10.db'), env = { ...process.env, TB_FIX_USER: USER, TB_FIX_PASS: PASS };
    const child = crash => {
      const c = spawn(process.execPath, ['tests/server/fixtures/broker-child.mjs', P2, F2, String(OFF + skew), crash || ''], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      c.out = ''; c.stdout.on('data', d => { c.out += d; }); c.stderr.on('data', d => { c.out += d; });
      c.feed = setInterval(() => c.stdin.write(JSON.stringify(Object.entries(Q).map(([s, [b, a]]) => [s, b, a])) + '\n'), 200);
      c.gone = new Promise(r => c.on('exit', (code, sig) => { clearInterval(c.feed); r(sig || code); }));
      return c;
    };
    Q.EURUSD = [1.1, 1.1001];
    let c = child('tb-k-2');
    ok(await until(() => c.out.includes('fed'), 5000), 'B10 child up and fed: ' + c.out);
    const g10 = [];
    let J = createInitiator({ port: P2, compId: 'TB-GW', target: 'TB-BROKER', user: USER, pass: PASS, heartBtInt: 30, store: openStore(G2), log, onApp: m => { g10.push(m); } });
    ok(await until(() => J.state === 'logged-on'), 'B10 logged on');
    J.send('U1', D.settingsToU1({ jur: 'none', slip: 'off', type: 'demo' }, 'k'));
    J.send('D', D.orderToD({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', tif: 'GTC' }, 'tb-k-2', 'k', OPTS));
    ok(await Promise.race([c.gone, sleep(4000)]) === 'SIGKILL', 'B10 the broker died after the commit');
    ok(!g10.some(m => m.type === '8'), 'B10 the 8 never reached the wire');
    c = child('');
    ok(await until(() => c.out.includes('ready'), 5000), 'B10 child restarted');
    const r10 = await until(() => g10.filter(m => m.type === '8' && m.fields.get('11') === 'tb-k-2').length && g10.filter(m => m.type === '8' && m.fields.get('11') === 'tb-k-2'), 12000);
    await sleep(500);
    const all = g10.filter(m => m.type === '8' && m.fields.get('11') === 'tb-k-2');
    ok(r10 && all.length === 1 && all[0].fields.get('43') === 'Y' && D.reportToExec(all[0]).kind === 'fill', `B10 the 8 came once, by resend: ${all.length} ${all.map(m => m.fields.get('43') + ' ' + m.fields.get('150') + ' ' + m.fields.get('58'))}`);
    await J.close(); c.kill('SIGTERM'); await c.gone;
    const db = new DatabaseSync(F2);
    const pos = db.prepare("SELECT COUNT(*) n FROM positions WHERE account = 'k'").get().n, ex = db.prepare("SELECT COUNT(*) n FROM executions WHERE account = 'k'").get().n, ac = db.prepare("SELECT balance FROM accounts WHERE id = 'k'").get();
    ok(pos === 1 && ex === 1 && ac && ac.balance === 100000, `B10 one position, one execution, balance ${ac && ac.balance}: ${pos} ${ex}`);
    db.close();
  }

  // B11 / B13 / B14: the recovery after downtime, each case on its own broker and database, the bars fake (fetchBars)
  const T0 = Date.parse('2026-11-02T10:00:00Z') / 1000; // Monday, FX open
  const SET = { jur: 'none', lev: null, slip: 'off', slipSd: .2, latMs: 120, comm: 0 };
  const acc = (id, positions, rollLast = T0) => ({ id, type: 'demo', user_id: 0, device: '', created: T0 - 86400, acct: { balance: 100000, peak: 100000, set: { ...SET }, nextId: 10, nextFill: 1, rollLast, positions, orders: [] } });
  const pos = (id, sym, side, entry, sl, tp = null) => ({ id, sym, side, lots: 1, entry, sl, tp, trail: 0, swap: 0, comm: 0, im: 3000, open: T0 - 86400 });
  const seedDb = (file, accts, ranS) => { const X = openBrokerDb(file); for (const A of accts) { X.save(A); X.metaSet('ran:' + A.id, A.ran ?? ranS); } X.close(); };
  const flat = (t0, n, px) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * 60, o: px, h: px + 2e-4, l: px - 2e-4, c: px }));
  const boot = async (file, atS, fetchBars, extra = {}) => {
    const port = await freePort(), off = atS * 1000 - Date.now();
    const { noWait, ...opt } = extra, X = await startBroker({ db: file, port, user: USER, pass: PASS, feed: false, now: () => Date.now() + off, seed: 5, log, staleMs: 1500, fetchBars, ...opt });
    if (!noWait) await X.recovering;
    return { X, port, clk: () => Date.now() + off };
  };
  const fillsOf = (file, a) => { const db = new DatabaseSync(file), n = db.prepare("SELECT COUNT(*) n FROM executions WHERE account = ? AND json ->> 'kind' = 'fill'").get(a).n; db.close(); return n; };

  // B11: an SL at 1.0800, 20 minutes down, a bar opening at 1.0790 → one fill at 1.0790, gap; an SL inside a bar fills at
  // its level, adverse extreme first (before the target), a short's SL on the ask (bid + the sheet spread); bars not
  // available → pending (a D refused), completed by the retry when they are
  {
    const F11 = join(DIR, 'b11.db');
    seedDb(F11, [acc('r11', [pos(1, 'EURUSD', 'buy', 1.085, 1.08)]), acc('r11b', [pos(1, 'GBPUSD', 'buy', 1.285, 1.28, 1.29)]),
      acc('r11c', [pos(1, 'GBPUSD', 'sell', 1.285, 1.2905, 1.27)]), acc('rb', [pos(1, 'USDJPY', 'buy', 150, 149.5)])], T0);
    const bars = {
      EURUSD: [...flat(T0, 10, 1.085).filter(b => b.t !== T0 + 300), { t: T0 + 600, o: 1.079, h: 1.0795, l: 1.0785, c: 1.0792 }, ...flat(T0 + 660, 9, 1.0792)],
      GBPUSD: [...flat(T0, 10, 1.285), { t: T0 + 600, o: 1.285, h: 1.291, l: 1.2795, c: 1.285 }, ...flat(T0 + 660, 9, 1.285)],
      USDJPY: [...flat(T0, 10, 150), { t: T0 + 600, o: 149.4, h: 149.45, l: 149.3, c: 149.4 }, ...flat(T0 + 660, 9, 149.4)],
    };
    let jpy = false;
    const { X, port } = await boot(F11, T0 + 1205, async sym => (sym === 'USDJPY' && !jpy ? null : bars[sym]), { retryMs: 400 });
    const h11 = X.history('r11')[0];
    ok(!X.account('r11').acct.positions.length && h11 && near(h11.exit, 1.079, 1e-9) && h11.gap === true && h11.close === T0 + 600, 'B11 the SL filled at the gap open 1.0790: ' + JSON.stringify(h11 && { exit: h11.exit, gap: h11.gap, close: h11.close }));
    const hb = X.history('r11b')[0], hc = X.history('r11c')[0];
    ok(hb && near(hb.exit, 1.28, 1e-9) && hb.reason === 'Stop loss', 'B11 inside the bar: the SL at its level, before the target: ' + JSON.stringify(hb && { exit: hb.exit, reason: hb.reason }));
    ok(hc && near(hc.exit, 1.2905, 1e-9) && hc.reason === 'Stop loss', "B11 a short's SL fills on the ask at its level: " + (hc && hc.exit));
    ok(X.recovery('rb') && /bars not available \(USDJPY\)/.test(X.recovery('rb').why) && X.account('rb').acct.positions.length === 1 && logs.some(l => /rb.*pending/.test(l)), 'B11 USDJPY bars not available: rb pending, nothing executed: ' + JSON.stringify(X.recovery('rb')));
    const g11 = [], J = createInitiator({ port, compId: 'TB-GW', target: 'TB-BROKER', user: USER, pass: PASS, heartBtInt: 30, store: openStore(join(DIR, 'gw11.db')), log, onApp: m => { g11.push(m); } });
    const e11 = cl => g11.filter(m => m.type === '8' && m.fields.get('11') === cl).map(D.reportToExec);
    const f = await until(() => e11('bk-r11-1-SL').find(x => x.kind === 'fill'));
    ok(f && near(f.receipt.px, 1.079, 1e-9) && f.receipt.gap === true && f.receipt.reason === REASON && f.receipt.t === T0 + 600, 'B11 the gateway gets the fill on connect: ' + JSON.stringify(f && { px: f.receipt.px, gap: f.receipt.gap, reason: f.receipt.reason, t: f.receipt.t }));
    ok(fillsOf(F11, 'r11') === 1, 'B11 one fill stored');
    await until(() => J.state === 'logged-on');
    J.send('D', D.orderToD({ sym: 'USDJPY', side: 'buy', lots: 1, ot: 'market', tif: 'GTC' }, 'tb-rb-1', 'rb', OPTS));
    const rj = await until(() => e11('tb-rb-1')[0]);
    ok(rj && rj.kind === 'reject' && rj.code === 'RECOVERY', 'B11 a D on the pending account is refused: ' + JSON.stringify(rj && { code: rj.code, text: rj.text }));
    jpy = true;
    ok(await until(() => !X.recovery('rb') && !X.account('rb').acct.positions.length, 4000), 'B11 the retry completes the recovery of rb');
    const hr = X.history('rb')[0];
    ok(hr && near(hr.exit, 149.4, 1e-9) && hr.gap === true && !new DatabaseSync(F11).prepare("SELECT 1 FROM meta WHERE k = 'pending:rb'").get(), 'B11 rb: the SL at the gap open, the pending mark gone: ' + (hr && hr.exit));
    await J.close(); await X.close();
  }

  // B13: down over a rollover (Monday 17:00 New York = 22:00 UTC): the swap is booked once, also after the live rollover
  // and a second restart
  {
    const F13 = join(DIR, 'b13.db'), seen = T0 + 11 * 3600 + 50 * 60, bars = { EURUSD: flat(seen, 30, 1.085) };
    seedDb(F13, [acc('r13b', [pos(1, 'EURUSD', 'buy', 1.085, null)], seen), acc('r13s', [pos(1, 'EURUSD', 'sell', 1.085, null)], seen)], seen);
    let { X } = await boot(F13, seen + 1805, async sym => bars[sym]);
    const exp = side => X.core.swapPerNight('EURUSD', side, 1), sw = a => X.account(a).acct.positions[0].swap;
    ok((exp('buy') || exp('sell')) && near(sw('r13b'), exp('buy'), 1e-9) && near(sw('r13s'), exp('sell'), 1e-9), `B13 one night of swap booked: ${sw('r13b')} / ${sw('r13s')} (expected ${exp('buy')} / ${exp('sell')})`);
    await sleep(1300); // the live sweep's rollover
    ok(near(sw('r13b'), exp('buy'), 1e-9) && near(sw('r13s'), exp('sell'), 1e-9), 'B13 the live rollover does not book it again');
    await X.close();
    ({ X } = await boot(F13, seen + 1810, async sym => bars[sym]));
    ok(near(sw('r13b'), exp('buy'), 1e-9) && near(sw('r13s'), exp('sell'), 1e-9) && X.account('r13b').acct.rollLast >= T0 + 12 * 3600, 'B13 a restart books nothing more');
    await X.close();
  }

  // B14: down over 14 days → nothing executed, the account pending (kept across a restart) until the operator clears
  // it with node host/broker.mjs --clear-recovery <account>; then it trades on live prices again
  {
    const F14 = join(DIR, 'b14.db');
    seedDb(F14, [acc('r14', [pos(1, 'EURUSD', 'buy', 1.085, 1.08)])], T0 - 15 * 86400);
    let asked = 0;
    let { X, clk } = await boot(F14, T0, async () => { asked++; return []; });
    ok(X.recovery('r14') && /over 14/.test(X.recovery('r14').why) && !asked && X.account('r14').acct.positions.length === 1 && logs.some(l => /r14.*pending.*--clear-recovery r14/.test(l)), 'B14 pending, no bars asked, logged: ' + JSON.stringify(X.recovery('r14')));
    await X.close();
    ({ X, clk } = await boot(F14, T0 + 2, async () => { asked++; return []; }));
    ok(X.recovery('r14') && /over 14/.test(X.recovery('r14').why), 'B14 still pending after a restart');
    X.tick([['EURUSD', 1.079, 1.0791, clk()]]); await sleep(1200);
    ok(X.account('r14').acct.positions.length === 1, 'B14 a live price past the SL does not execute a pending account');
    const cli = spawn(process.execPath, ['host/broker.mjs', '--clear-recovery', 'r14'], { env: { ...process.env, TB_BROKER_DB: F14 } });
    let out = ''; cli.stdout.on('data', d => { out += d; });
    await new Promise(r => cli.on('exit', r));
    ok(/cleared/.test(out), 'B14 the operator clears it: ' + out.trim());
    ok(await until(() => !X.recovery('r14'), 3000), 'B14 the broker releases the account');
    // the live price heard while it was pending (past the SL) executes it at the first sweep after the release
    ok(await until(() => !X.account('r14').acct.positions.length) && near(X.history('r14')[0].exit, 1.079, 1e-9), 'B14 it trades again on live prices: ' + JSON.stringify(X.history('r14')[0]));
    await X.close();
  }

  // B15: exits per position, adverse first: in one bar reaching both a stop and a target of every position, a hedged
  // account's long and short and a basket's legs (two longs, one short: net long) all stop out at their stops
  {
    const F15 = join(DIR, 'b15.db'), legs = () => [pos(1, 'EURUSD', 'buy', 1.085, 1.08, 1.09), pos(2, 'EURUSD', 'sell', 1.085, 1.0905, 1.0805)];
    seedDb(F15, [acc('r15h', legs()), acc('r15b', [...legs(), pos(3, 'EURUSD', 'buy', 1.085, 1.08, 1.09)])], T0);
    const bars = { EURUSD: [...flat(T0, 3, 1.085), { t: T0 + 180, o: 1.085, h: 1.091, l: 1.0795, c: 1.085 }, ...flat(T0 + 240, 2, 1.085)] };
    const { X } = await boot(F15, T0 + 400, async sym => bars[sym]);
    for (const a of ['r15h', 'r15b']) {
      const h = X.history(a);
      ok(h.length === (a === 'r15h' ? 2 : 3) && h.every(t => t.reason === 'Stop loss' && near(t.exit, t.side === 'buy' ? 1.08 : 1.0905, 1e-9)), `B15 ${a}: every leg at its stop: ` + JSON.stringify(h.map(t => [t.side, t.exit, t.reason])));
    }
    await X.close();
  }

  // B16: the bar holding from is played as its close only: a low before the crash (when a G had just moved the stop up
  // to 1.0780, the price already back) does not fill the moved stop
  {
    const F16 = join(DIR, 'b16.db');
    seedDb(F16, [acc('r16', [pos(1, 'EURUSD', 'buy', 1.085, 1.078)])], T0 + 30);
    const bars = { EURUSD: [{ t: T0, o: 1.085, h: 1.0855, l: 1.0775, c: 1.085 }, ...flat(T0 + 60, 4, 1.085)] };
    const { X } = await boot(F16, T0 + 330, async sym => bars[sym]);
    ok(X.account('r16').acct.positions.length === 1 && !X.history('r16').length && !X.waiting('r16'), 'B16 no fill on the prices before from: ' + JSON.stringify(X.history('r16')));
    await X.close();
  }

  // B17: no unplayed hole: a stop crossed (and the price back) while the bars are being fetched fills, from the ticks
  // buffered meanwhile
  {
    const F17 = join(DIR, 'b17.db'), hold = {};
    seedDb(F17, [acc('r17', [pos(1, 'EURUSD', 'buy', 1.085, 1.08)])], T0);
    const { X, clk } = await boot(F17, T0 + 300, async () => {
      await sleep(150); hold.X.tick([['EURUSD', 1.0795, 1.0796, hold.clk()]]);
      await sleep(30); hold.X.tick([['EURUSD', 1.085, 1.0851, hold.clk()]]);
      return flat(T0, 5, 1.085);
    }, { noWait: true });
    Object.assign(hold, { X, clk });
    ok(X.waiting('r17'), 'B17 the account waits while the bars are fetched');
    await X.recovering;
    const h = X.history('r17')[0];
    ok(h && near(h.exit, 1.0795, 1e-9) && h.gap === true && !X.waiting('r17'), 'B17 the stop crossed during the fetch filled at that tick: ' + JSON.stringify(h && { exit: h.exit, gap: h.gap }));
    await X.close();
  }

  // B18: a recovery that throws leaves the account pending from the time it last ran (never from now)
  {
    const F18 = join(DIR, 'b18.db');
    seedDb(F18, [acc('r18', [pos(1, 'EURUSD', 'buy', 1.085, 1.08)])], T0 - 600);
    const { X } = await boot(F18, T0, async () => [], { hooks: { recover: () => { throw new Error('injected'); } } });
    const p = X.recovery('r18');
    ok(p && p.why === 'recovery failed' && p.from === T0 - 600 && !X.waiting('r18'), 'B18 pending from its last run: ' + JSON.stringify(p));
    await X.close();
  }

  // B19: the fetch has a time budget; an account with nothing open, or with no complete minute missed, is released at once
  {
    const F19 = join(DIR, 'b19.db');
    seedDb(F19, [acc('r19', [pos(1, 'EURUSD', 'buy', 1.085, 1.08)]), { ...acc('r19f', []) }, { ...acc('r19g', [pos(1, 'GBPUSD', 'buy', 1.285, 1.28)]), ran: T0 + 5 }], T0 - 600);
    const t0 = Date.now();
    const { X } = await boot(F19, T0 + 30, () => new Promise(() => {}), { noWait: true, budgetMs: 300 });
    ok(X.waiting('r19') && !X.waiting('r19f') && !X.waiting('r19g'), 'B19 the flat account and the one with no minute missed are released at once');
    await X.recovering;
    ok(/bars not available/.test(X.recovery('r19')?.why || '') && Date.now() - t0 < 3000, `B19 the budget ends the fetch: pending in ${Date.now() - t0} ms: ` + JSON.stringify(X.recovery('r19')));
    await X.close();
  }

  // B20: barSource: the archive up to its last bar, the platform for the tail; a failed symbol list fails every
  // instrument at once
  {
    const D20 = join(DIR, 'data'), last = T0 - 1800;
    mkdirSync(join(D20, 'bars', '1', 'EURUSD'), { recursive: true });
    writeFileSync(join(D20, 'bars', 'status.json'), JSON.stringify({ syms: { EURUSD: { 1: { last, at: Date.now() } } } }));
    let csv = 't,o,h,l,c\n'; for (let t = T0 - 7200; t <= last; t += 60) csv += `${t},1.1,1.1002,1.0998,1.1\n`;
    writeFileSync(join(D20, 'bars', '1', 'EURUSD', '2026-11.csv.gz'), gzipSync(csv));
    const urls = [], fake = async u => {
      urls.push(u);
      if (/symbol_info/.test(u)) return { ok: true, json: async () => ({ symbol: ['EURUSD'], ticker: ['EUR/USD'] }) };
      const q = new URL(u).searchParams, t = []; for (let x = +q.get('from'); x <= T0; x += 60) t.push(x);
      return { ok: true, json: async () => ({ s: 'ok', t, o: t.map(() => 1.2), h: t.map(() => 1.2002), l: t.map(() => 1.1998), c: t.map(() => 1.2) }) };
    };
    const got = await barSource({ data: D20, platform: 'http://x.test', fetch: fake, gapMs: 0, sleep: async () => {} })('EURUSD', T0 - 3600, T0);
    const hist = urls.filter(u => /history/.test(u));
    // a fractional time is refused by the real platform ("Invalid interval"): whole seconds only, even for a fractional gap
    urls.length = 0; await barSource({ data: join(DIR, 'none'), platform: 'http://x.test', fetch: fake, gapMs: 0, sleep: async () => {} })('EURUSD', T0 - 600.25, T0 + 0.5);
    ok(urls.filter(u => /history/.test(u)).every(u => /from=\d+&to=\d+$/.test(u)), 'B20b history asked in whole seconds: ' + urls.filter(u => /history/.test(u)).join(' '));
    ok(got.length === 61 && got[0].o === 1.1 && got.at(-1).o === 1.2 && hist.length === 1 && new URL(hist[0]).searchParams.get('from') === String(last + 60), `B20 archive then the tail: ${got.length} bars, ${hist.map(u => new URL(u).searchParams.get('from'))}`);
    let n = 0;
    const src = barSource({ data: join(DIR, 'none'), platform: 'http://x.test', fetch: async () => { n++; return { ok: false, status: 503, arrayBuffer: async () => {} }; }, gapMs: 0, sleep: async () => {} });
    const e1 = await src('EURUSD', T0 - 600, T0).then(() => null, e => e), n1 = n, e2 = await src('GBPUSD', T0 - 600, T0).then(() => null, e => e);
    ok(e1 && e2 && /symbol list not available/.test(e2.message) && n === n1 && n1 === 3, `B20 symbol_info failed: the next instrument fails at once (${n1} then ${n} requests)`);
  }

  // B21: a recovery that throws in a later round leaves the account pending from what the earlier round committed
  {
    const F21 = join(DIR, 'b21.db'), off = T0 * 1000 - Date.now();
    let sk = 0, calls = 0;
    seedDb(F21, [acc('r21', [pos(1, 'EURUSD', 'buy', 1.085, 1.08)])], T0 - 600);
    const { X } = await boot(F21, T0, async () => { if (!calls++) sk += 120000; return flat(T0 - 600, 10, 1.085); },
      { now: () => Date.now() + off + sk, hooks: { recover: round => { if (round === 1) throw new Error('injected'); } } });
    const p = X.recovery('r21'), ran = +new DatabaseSync(F21).prepare("SELECT v FROM meta WHERE k = 'ran:r21'").get().v;
    ok(p && p.why === 'recovery failed' && p.from >= T0 && p.from === ran, `B21 pending from the first round's end ${ran}, not ${T0 - 600}: ` + JSON.stringify(p));
    await X.close();
  }

  // FR8: a pending order with its exits filled in the recovery from bars: the position has them, linked
  {
    const T0 = Date.parse('2026-11-02T10:00:00Z') / 1000, F = join(DIR, 'fr8.db');
    const X0 = openBrokerDb(F);
    X0.save({ id: 'r8', type: 'demo', user_id: 0, device: '', created: T0 - 86400, acct: { balance: 100000, peak: 100000, set: { jur: 'none', lev: null, slip: 'off', slipSd: .2, latMs: 120, comm: 0 }, nextId: 10, nextFill: 1, rollLast: T0,
      positions: [], orders: [{ id: 5, sym: 'EURUSD', side: 'buy', ot: 'limit', price: 1.08, lots: 1, slPips: 20, tpPips: 30, trail: 0, tif: 'GTC', expires: null, limit: null, oca: null, net: true, status: 'pending', created: T0 - 3600, clOrdId: 'tb-r8-1' }] } });
    X0.metaSet('ran:r8', T0); X0.close();
    const bars = { EURUSD: [...Array.from({ length: 5 }, (_, i) => ({ t: T0 + i * 60, o: 1.085, h: 1.0852, l: 1.0848, c: 1.085 })), { t: T0 + 300, o: 1.085, h: 1.0851, l: 1.0795, c: 1.0805 }, ...Array.from({ length: 5 }, (_, i) => ({ t: T0 + 360 + i * 60, o: 1.0805, h: 1.0807, l: 1.0803, c: 1.0805 }))] };
    const port = await freePort(), off = (T0 + 700) * 1000 - Date.now();
    const X = await startBroker({ db: F, port, user: USER, pass: PASS, feed: false, now: () => Date.now() + off, seed: 5, log, staleMs: 1500, fetchBars: async s => bars[s] || [] });
    await X.recovering;
    const p8 = X.account('r8').acct.positions[0];
    ok(p8 && p8.sl != null && p8.tp != null && p8.slLink && p8.tpLink && near(p8.sl, p8.entry - .002, 1e-9), 'FR8 recovered fill: SL / TP at the broker, linked: ' + JSON.stringify(p8 && { e: p8.entry, sl: p8.sl, tp: p8.tp, links: [!!p8.slLink, !!p8.tpLink] }));
    await X.close();
  }

  ok(!logs.some(l => l.includes(PASS) || l.includes(USER)), 'no credential in the logs');
  if (process.env.TB_TEST_LOGS) console.log(logs.join('\n'));
} catch (e) { fail++; console.log('  ABORT', e.stack); } finally {
  clearInterval(keep);
  try { await I.close(); } catch {}
  try { await B.close(); } catch {}
  rmSync(DIR, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
