// host/fix/session.mjs + store.mjs: the FIX 4.4 session layer (logon, heartbeats, sequence gaps, resend with GapFill,
// persistence across a kill -9). Raw peers built on the codec drive the acceptor message by message; FS4 runs the
// acceptor in a child process (tests/server/fixtures/fix-acceptor.mjs). Usage, from 2-cod-sursa:
// node tests/server/fix-session.mjs (also run by tests/server/run.mjs).
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encode, Parser } from '../../host/fix/codec.mjs';
import { createAcceptor, createInitiator, fixTime } from '../../host/fix/session.mjs';
import { openStore } from '../../host/fix/store.mjs';

let pass = 0, fail = 0;
const ok = (v, msg) => { if (v) pass++; else { fail++; console.log('  FAIL', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 3000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(20)) { const v = f(); if (v) return v; } return f(); };
const DIR = mkdtempSync(join(tmpdir(), 'tb-fix-')), USER = 'u' + randomBytes(6).toString('hex'), PASS = 'p' + randomBytes(9).toString('base64url');
const logs = [], log = s => logs.push(String(s));
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// a raw FIX peer: we pick every seq and flag, and keep every message the acceptor sends back
class Peer {
  constructor(port, sender) {
    Object.assign(this, { sender, seq: 0, msgs: [], p: new Parser(), done: false });
    this.sock = net.connect(port, '127.0.0.1'); this.sock.on('error', () => {});
    this.sock.on('data', d => this.msgs.push(...this.p.push(d)));
    this.closed = new Promise(r => this.sock.on('close', () => { this.done = true; r(); }));
    this.up = new Promise(r => this.sock.once('connect', r));
  }
  send(type, fields = [], o = {}) {
    const seq = o.seq ?? ++this.seq;
    this.sock.write(encode(type, fields, { sender: this.sender, target: 'TB-BROKER', seq, sendingTime: fixTime(), possDup: o.possDup, origSendingTime: o.possDup ? fixTime() : undefined }));
    return seq;
  }
  logon(hb = 30, user = USER, pw = PASS) { return this.send('A', [[98, 0], [108, hb], [553, user], [554, pw]]); }
  find(pred, from = 0) { return this.msgs.slice(from).find(pred); }
}

const sA = openStore(new DatabaseSync(join(DIR, 'acceptor.db'))), apps = [], authIds = [];
let boomed = false;
const A = createAcceptor({ port: 0, compId: 'TB-BROKER', store: sA, log, logonTimeout: 500, auth: (u, p, c) => { authIds.push(c); return u === USER && p === PASS; },
  onApp: (m, s) => {
    const id = m.fields.get('11');
    // 'boom' fails once, after queueing its report: neither the report nor the seq may survive
    if (id === 'boom' && !boomed) { boomed = true; s.send('8', [[11, id], [17, 'E-boom-lost'], [150, 'F'], [39, '2']]); throw new Error('app down'); }
    apps.push(`${m.fields.get('49')}:${id}`);
    if (id === 'async') return Promise.reject(new Error('later'));
    if (m.type === 'D') s.send('8', [[11, id], [17, 'E-' + id], [150, 'F'], [39, '2']]);
  } });
const PORT = await A.ready;

try {
  // FS1: logon with the right password, refused with a wrong one; a foreign BeginString is dropped by the logon timeout
  {
    const states = [], got = [], sI = openStore(join(DIR, 'initiator.db'));
    const I = createInitiator({ port: PORT, compId: 'TB-GW', target: 'TB-BROKER', user: USER, pass: PASS, heartBtInt: 1, store: sI, log, onApp: m => got.push(m), onState: s => states.push(s) });
    ok(await until(() => states.includes('logged-on')), 'FS1 right password: logged-on: ' + states);
    ok(states[0] === 'connecting', 'FS1 starts as connecting: ' + states);
    I.send('D', [[11, 'g1'], [55, 'EURUSD'], [54, 1], [38, 0.1], [40, 1]]);
    ok(await until(() => got.some(m => m.type === '8' && m.fields.get('11') === 'g1')), 'FS1 an order goes through and its report comes back');
    ok(apps.includes('TB-GW:g1'), 'FS1 the acceptor app saw the order');
    ok(authIds.includes('TB-GW'), 'FS1 auth gets the SenderCompID: ' + authIds);
    await I.close(); ok(states.at(-1) === 'down', 'FS1 close ends down: ' + states); sI.close();
    const b = new Peer(PORT, 'BAD'); await b.up; b.logon(30, USER, PASS + 'x');
    await Promise.race([b.closed, sleep(2000)]);
    ok(b.find(m => m.type === '5') && !b.find(m => m.type === 'A'), 'FS1 wrong password: Logout, no Logon: ' + b.msgs.map(m => m.type));
    ok(b.done, 'FS1 wrong password: socket closed');
    const c = new Peer(PORT, 'OLD'); await c.up;
    c.sock.write(Buffer.from(encode('A', [[98, 0], [108, 30]], { sender: 'OLD', target: 'TB-BROKER', seq: 1, sendingTime: fixTime() }).toString('latin1').replace('FIX.4.4', 'FIX.4.2'), 'latin1'));
    const t0 = Date.now(); await Promise.race([c.closed, sleep(2000)]);
    ok(c.done && Date.now() - t0 < 1500 && !c.msgs.length, 'FS1 a FIX.4.2 Logon gets nothing and is closed by the logon timeout');
  }
  // FS2: silence for heartBtInt brings a Heartbeat; a TestRequest gets a Heartbeat with its 112
  {
    const p = new Peer(PORT, 'P2'); await p.up; p.logon(1);
    ok(await until(() => p.find(m => m.type === 'A')), 'FS2 logged on');
    const t0 = Date.now(), hb = await until(() => p.find(m => m.type === '0' && !m.fields.has('112')), 2500);
    ok(hb && Date.now() - t0 > 700, 'FS2 a Heartbeat after heartBtInt of silence: ' + (Date.now() - t0) + ' ms');
    p.send('1', [[112, 'ping42']]);
    ok(await until(() => p.find(m => m.type === '0' && m.fields.get('112') === 'ping42')), 'FS2 TestRequest answered with 112=ping42');
    p.send('5', []); await Promise.race([p.closed, sleep(1500)]); ok(p.find(m => m.type === '5') && p.done, 'FS2 Logout is answered and the socket closed');
  }
  // FS3 + FS6 + FS5 on one raw session
  {
    const p = new Peer(PORT, 'P3'); await p.up; p.logon(30);
    ok(await until(() => p.find(m => m.type === 'A')), 'FS3 logged on');
    const D = (id, o) => p.send('D', [[11, id], [55, 'EURUSD'], [54, 1], [38, 0.1], [40, 1]], o), mine = () => apps.filter(a => a.startsWith('P3:')).map(a => a.slice(3));
    D('c2'); D('c3'); p.seq = 4; D('c5'); // seq 4 skipped
    const rr = await until(() => p.find(m => m.type === '2'));
    ok(rr && rr.fields.get('7') === '4' && rr.fields.get('16') === '0', 'FS3 a gap brings ResendRequest 7=4 16=0: ' + (rr && [...rr.fields].join(' ')));
    ok(mine().join() === 'c2,c3', 'FS3 the message after the gap waits: ' + mine());
    D('c4', { seq: 4, possDup: true });
    ok(await until(() => mine().join() === 'c2,c3,c4,c5'), 'FS3 the resent message fills the gap, the queued one follows, in order: ' + mine());
    await until(() => p.msgs.filter(m => m.type === '8').length === 4);
    const from = p.msgs.length; p.send('2', [[7, 1], [16, 0]], { seq: 6 }); p.seq = 6;
    await until(() => p.msgs.length >= from + 6);
    const re = p.msgs.slice(from).map(m => `${m.type}${m.seq}${m.type === '4' ? '>' + m.fields.get('36') : m.type === '8' ? ':' + m.fields.get('11') : ''}`);
    ok(re.join() === '41>2,82:c2,83:c3,44>5,85:c4,86:c5', 'FS3 resent in order, admin messages as GapFill (FS6): ' + re);
    ok(p.msgs.slice(from, from + 6).every(m => m.fields.get('43') === 'Y'), 'FS3 every resent message has 43=Y');
    ok(p.msgs.slice(from, from + 6).filter(m => m.type === '4').every(m => m.fields.get('123') === 'Y'), 'FS6 the fills are GapFill (123=Y)');
    ok(p.msgs.slice(from, from + 6).filter(m => m.type === '8').every(m => /^\d{8}-\d\d:\d\d:\d\d\.\d{3}$/.test(m.fields.get('122'))), 'FS3 resent app messages carry OrigSendingTime');
    // FS6 inbound: a GapFill from the peer moves the expected seq, no ResendRequest
    p.send('4', [[123, 'Y'], [36, 10]], { seq: 7 }); p.seq = 9; D('c10');
    ok(await until(() => mine().includes('c10')), 'FS6 after an inbound GapFill 7>10, seq 10 is taken: ' + mine());
    ok(p.msgs.filter(m => m.type === '2').length === 1, 'FS6 no new ResendRequest after the GapFill');
    // FS5: an old seq with PossDup is ignored; without it, Logout and disconnect
    D('dup3', { seq: 3, possDup: true }); D('c11');
    ok(await until(() => mine().includes('c11')) && !mine().includes('dup3'), 'FS5 a PossDup duplicate never reaches onApp: ' + mine());
    D('low5', { seq: 5 });
    await Promise.race([p.closed, sleep(2000)]);
    const lo = p.find(m => m.type === '5');
    ok(lo && /too low/i.test(lo.fields.get('58') || '') && p.done && !mine().includes('low5'), 'FS5 an old seq without PossDup: Logout with the reason, disconnect: ' + (lo && lo.fields.get('58')));
  }
  // FS8: an exception in onApp consumes nothing: rolled back with its sends, Logout, the message returns by resend
  {
    const k = 'TB-BROKER>P4', out0 = sA.seqs(k).out;
    let p = new Peer(PORT, 'P4'); await p.up; p.logon(30); await until(() => p.find(m => m.type === 'A'));
    const out1 = sA.seqs(k).out, D = (q, id, o) => q.send('D', [[11, id], [55, 'EURUSD'], [54, 1], [38, 0.1], [40, 1]], o);
    D(p, 'boom'); await Promise.race([p.closed, sleep(2000)]);
    const lo = p.find(m => m.type === '5');
    ok(lo && /Application error/.test(lo.fields.get('58') || '') && p.done, 'FS8 onApp throws: Logout and disconnect: ' + (lo && lo.fields.get('58')));
    ok(!p.find(m => m.type === '8') && sA.seqs(k).out === out1 + 1 && out1 === out0 + 1, 'FS8 the report sent before the throw is neither written nor stored (only the Logout took a seq)');
    ok(sA.seqs(k).in === 1 && !apps.includes('P4:boom'), 'FS8 in_seq stays at the Logon: ' + sA.seqs(k).in);
    const q = new Peer(PORT, 'P4'); q.seq = 2; await q.up; q.logon(30); // seq 3
    const rr = await until(() => q.find(m => m.type === '2'));
    ok(rr && rr.fields.get('7') === '2', 'FS8 on the next Logon the acceptor asks from 2');
    D(q, 'boom', { seq: 2, possDup: true }); q.send('4', [[123, 'Y'], [36, 4]], { seq: 3, possDup: true });
    ok(await until(() => q.find(m => m.type === '8' && m.fields.get('17') === 'E-boom')), 'FS8 the resent message is processed and answered');
    ok(apps.filter(a => a === 'P4:boom').length === 1 && !q.find(m => m.fields.get('17') === 'E-boom-lost'), 'FS8 exactly once, the rolled-back report never appears');
    // an async onApp: its rejection is logged, the session goes on
    D(q, 'async'); D(q, 'after');
    ok(await until(() => apps.includes('P4:after')) && logs.some(l => /async onApp failed/.test(l)), 'FS8 a rejected promise from onApp is logged, the session continues');
    // GapFill whose NewSeqNo is not above its MsgSeqNum: Reject, the seq is consumed
    q.send('4', [[123, 'Y'], [36, 6]], { seq: 6 }); q.seq = 6;
    const rj = await until(() => q.find(m => m.type === '3'));
    ok(rj && rj.fields.get('45') === '6' && rj.fields.get('371') === '36', 'GapFill with NewSeqNo <= MsgSeqNum gets a Reject');
    D(q, 'after-rj'); ok(await until(() => apps.includes('P4:after-rj')), 'the rejected GapFill consumed its seq');
    // a garbled message is ignored: no Reject, no seq consumed
    const g = encode('D', [[11, 'garbled'], [55, 'EURUSD']], { sender: 'P4', target: 'TB-BROKER', seq: 8, sendingTime: fixTime() }).toString('latin1');
    q.sock.write(Buffer.from(g.replace(/10=(\d{3})\x01$/, (x, c) => `10=${c === '000' ? '001' : '000'}\x01`), 'latin1'));
    await sleep(200); D(q, 'after-garbled', { seq: 8 });
    ok(await until(() => apps.includes('P4:after-garbled')) && q.msgs.filter(m => m.type === '3').length === 1 && !apps.includes('P4:garbled'), 'a garbled message is ignored: no Reject, its seq taken by the next one');
    q.send('5', []); await Promise.race([q.closed, sleep(1500)]);
  }
  // FS9: the acceptor sends to a counterparty that is down: stored, delivered after its Logon; requireLive refuses
  {
    const k = 'TB-BROKER>P9', r = A.send('P9', '8', [[11, 'late'], [17, 'E-late'], [150, 'F'], [39, '2']]);
    ok(r.seq === 1 && r.live === false, 'FS9 send to a session that is down: stored, not live: ' + JSON.stringify(r));
    let threw = false; try { A.send('P9', '8', [[11, 'x']], { requireLive: true }); } catch (e) { threw = true; }
    ok(threw && sA.seqs(k).out === 1, 'FS9 requireLive throws and stores nothing');
    const p = new Peer(PORT, 'P9'); await p.up; p.logon(30);
    const lg = await until(() => p.find(m => m.type === 'A'));
    ok(lg && lg.seq === 2, 'FS9 the Logon answer comes after the stored report: seq ' + (lg && lg.seq));
    p.send('2', [[7, 1], [16, 0]]);
    const er = await until(() => p.find(m => m.type === '8' && m.seq === 1));
    ok(er && er.fields.get('17') === 'E-late' && er.fields.get('43') === 'Y', 'FS9 the stored report is delivered by resend');
    const l = A.send('P9', '8', [[11, 'now'], [17, 'E-now'], [150, 'F'], [39, '2']]);
    ok(l.live && await until(() => p.find(m => m.fields.get('17') === 'E-now')), 'FS9 send while logged on is live');
    p.send('5', []); await Promise.race([p.closed, sleep(1500)]);
  }
  // FS4: the acceptor is killed in the middle of 50 orders, restarted on the same store; every order arrives exactly once
  {
    const port = await freePort(), file = join(DIR, 'child.db'), env = { ...process.env, TB_FIX_USER: USER, TB_FIX_PASS: PASS };
    let out = '', got = 0;
    const start = () => { const c = spawn(process.execPath, ['tests/server/fixtures/fix-acceptor.mjs', String(port), file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      c.stdout.on('data', d => { out += d; const m = String(d).match(/got (\d+)\s*$/); if (m) got = +m[1]; }); c.stderr.on('data', d => { out += d; }); return c; };
    let child = start(); await until(() => out.includes('ready'));
    const states = [], sI = openStore(join(DIR, 'initiator4.db'));
    const I = createInitiator({ port, compId: 'TB-GW', target: 'TB-BROKER', user: USER, pass: PASS, heartBtInt: 1, store: sI, log, onApp: () => {}, onState: s => states.push(s) });
    await until(() => states.includes('logged-on'));
    let killed = false;
    for (let i = 1; i <= 50; i++) {
      I.send('D', [[11, 'k' + i], [55, 'EURUSD'], [54, 1], [38, 0.1], [40, 1]]);
      await sleep(15);
      if (!killed && got >= 15) { child.kill('SIGKILL'); killed = true; await new Promise(r => child.once('exit', r)); child = start(); }
    }
    ok(killed, 'FS4 the acceptor was killed mid-stream at ' + got);
    ok(await until(() => got >= 50, 8000), 'FS4 after the restart all 50 arrive: ' + got);
    await sleep(300); await I.close(); sI.close(); child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
    const db = new DatabaseSync(file), r = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM got').get(); db.close();
    ok(r.n === 50 && r.d === 50, 'FS4 exactly once: ' + JSON.stringify(r));
    ok(states.filter(s => s === 'logged-on').length >= 2, 'FS4 the initiator reconnected by itself: ' + states);
    logs.push(out);
  }
  // FS4b: the initiator is killed while ExecutionReports stream in; after its restart every report is there once
  {
    const file = join(DIR, 'child-i.db'), env = { ...process.env, TB_FIX_USER: USER, TB_FIX_PASS: PASS };
    let out = '', got = 0;
    const start = () => { const c = spawn(process.execPath, ['tests/server/fixtures/fix-initiator.mjs', String(PORT), file, '50'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      c.stdout.on('data', d => { out += d; const m = String(d).match(/got (\d+)\s*$/); if (m) got = +m[1]; }); c.stderr.on('data', d => { out += d; }); return c; };
    let child = start();
    ok(await until(() => got >= 15, 5000), 'FS4b reports flowing: ' + got);
    child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
    const at = got; await sleep(300); child = start();
    ok(await until(() => got >= 50, 8000), 'FS4b after the restart all 50 reports arrive (killed at ' + at + '): ' + got);
    await sleep(300); child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
    const db = new DatabaseSync(file), r = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM got').get(), miss = db.prepare("SELECT COUNT(*) AS n FROM got WHERE id NOT LIKE 'E-x%'").get(); db.close();
    ok(r.n === 50 && r.d === 50 && miss.n === 0, 'FS4b exactly 50 distinct ExecIDs, none missing: ' + JSON.stringify(r));
    const mine = apps.filter(a => a.startsWith('TB-GW2:'));
    ok(mine.length === 50 && new Set(mine).size === 50, 'FS4b the acceptor got each order once: ' + mine.length);
    logs.push(out);
  }
  // reconnect schedule: 1 s, then 2 s
  {
    const port = await freePort(), at = [], sI = openStore(join(DIR, 'initiator5.db'));
    const I = createInitiator({ port, compId: 'TB-GW', target: 'TB-BROKER', user: USER, pass: PASS, heartBtInt: 1, store: sI, log, onState: s => { if (s === 'connecting') at.push(Date.now()); } });
    await until(() => at.length >= 3, 4500);
    let threw = false; try { I.send('D', [[11, 'n']], { requireLive: true }); } catch (e) { threw = true; }
    ok(threw && sI.seqs('TB-GW>TB-BROKER').out === 0, 'initiator requireLive while down throws, nothing stored (no Logon ever left)');
    const d = I.send('D', [[11, 'q']]); ok(d.live === false && d.seq === 1, 'initiator send while down is stored, not live: ' + JSON.stringify(d));
    await I.close(); sI.close();
    const g = at.slice(1).map((t, i) => t - at[i]);
    ok(g.length >= 2 && Math.abs(g[0] - 1000) < 300 && Math.abs(g[1] - 2000) < 300, 'reconnect after 1 s, then 2 s: ' + g);
  }
  // FS7: the credentials appear in no log and never in clear in a store
  {
    await A.close(); sA.close();
    const text = logs.join('\n');
    ok(logs.length > 0 && !text.includes(PASS) && !text.includes(USER), 'FS7 no credential in the logs (' + logs.length + ' lines)');
    for (const f of ['acceptor.db', 'initiator.db', 'initiator4.db', 'child.db', 'child-i.db']) {
      const all = ['', '-wal'].map(x => join(DIR, f + x)).filter(existsSync).map(x => readFileSync(x).toString('latin1')).join('');
      ok(all.length && !all.includes(PASS), 'FS7 no password in the store ' + f);
    }
    const st = openStore(join(DIR, 'initiator.db')), lg = st.range('TB-GW>TB-BROKER', 1, 1)[0]; st.close();
    ok(lg && /\x01554=\*+\x01/.test(Buffer.from(lg.raw).toString('latin1')), 'FS7 the stored Logon has 554 masked');
  }
} catch (e) { fail++; console.log('  ABORT', e.stack); } finally { await A.close().catch(() => {}); rmSync(DIR, { recursive: true, force: true }); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
