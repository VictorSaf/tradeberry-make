// FIX 4.4 session layer over host/fix/codec.mjs: Logon, Heartbeat/TestRequest, sequence checks, ResendRequest and
// resend with SequenceReset-GapFill, Logout. Sequences and outbound messages live in host/fix/store.mjs; every outbound
// message is committed there before its bytes go to the socket, and every inbound application message is handed to
// onApp inside the transaction that advances in_seq (an app writing to store.db gets exactly-once). onApp must be
// synchronous: if it throws, its writes and sends are rolled back, in_seq stays, and the session logs out so the message
// comes back by resend; a promise it returns is not awaited (a rejection is only logged). Admin messages
// (A 0 1 2 3 4 5) never reach onApp. Both ends are loopback only. Logs carry message types, seqs and reasons, never
// fields: a Logon carries 553/554, which are also masked in the store (a Logon is never resent, always gap-filled).
import net from 'node:net';
import { encode, Parser, SOH } from './codec.mjs';
import { SESSION } from './dict.mjs';

const RECONNECT = [1, 2, 5, 10]; // seconds between attempts, then 10 s forever
const HEADER = new Set(['8', '9', '35', '49', '56', '34', '43', '52', '122', '97', '10']);
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const defLog = s => console.log('[fix] ' + s);
export const fixTime = (d = new Date()) => { const s = d.toISOString(); return s.slice(0, 10).replaceAll('-', '') + '-' + s.slice(11, 23); };
// the ordered tag=value pairs of a stored wire message (repeating groups keep their order)
const pairs = raw => Buffer.from(raw).toString('latin1').split(SOH).slice(0, -1).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; });
const loopback = h => { if (!LOOPBACK.has(h)) throw new Error('FIX sessions are loopback only: ' + h); return h; };

class Session {
  constructor(o) {
    Object.assign(this, { store: o.store, sender: o.sender, target: o.target || null, hb: o.hb || 30, onApp: o.onApp || (() => {}), log: o.log || defLog,
      acceptor: !!o.acceptor, auth: o.auth, busy: o.busy, user: o.user, pass: o.pass, logonTimeout: o.logonTimeout || 10000, onUp: o.onUp, onDown: o.onDown });
    this.sock = null; this.on = false;
  }
  get key() { return `${this.sender}>${this.target}`; }
  expected() { return this.store.seqs(this.key).in + 1; }

  attach(sock) {
    Object.assign(this, { sock, parser: new Parser(), on: false, closing: false, queue: new Map(), resendTo: 0, testReq: null, loggingOut: false, lastIn: Date.now(), lastOut: Date.now() });
    sock.setNoDelay(true);
    sock.on('data', d => { for (const m of this.parser.push(d)) { if (this.sock !== sock || this.closing) return; try { this.recv(m); } catch (e) { this.log(`${this.key}: ${e.message}`); } } });
    sock.on('error', () => {}); // 'close' follows
    sock.on('close', () => this.down(sock));
    this.lt = setTimeout(() => { if (this.sock === sock && !this.on) this.drop('no valid Logon in time'); }, this.logonTimeout);
    this.timer = setInterval(() => this.tick(), Math.max(50, Math.min(1000, this.hb * 200)));
  }
  down(sock) {
    if (this.sock !== sock) return;
    clearTimeout(this.lt); clearInterval(this.timer);
    const was = this.on; Object.assign(this, { sock: null, on: false, queue: new Map(), resendTo: 0 });
    if (was) this.log(`${this.key}: disconnected`);
    this.onDown?.(this, was);
  }
  drop(reason) { this.log(`${this.target ? this.key : this.sender}: ${reason}`); this.closing = true; this.sock?.destroy(); }
  write(buf) { if (this.sock && !this.sock.destroyed) { this.sock.write(buf); this.lastOut = Date.now(); } }
  wire(buf) { this.store.afterCommit(() => this.write(buf)); }

  // application and admin sends: persisted, then written if the session is up (else resent after the next Logon).
  // -> { seq, live }; with { requireLive: true } a session that is not logged on throws and nothing is stored.
  send(type, fields = [], o = {}) {
    if (o.requireLive && !this.on) throw new Error(`FIX session ${this.key} is not logged on`);
    const live = this.on; return { seq: this.out(type, fields, live), live };
  }
  out(type, fields, onWire) {
    if (!this.target) throw new Error('FIX send before the counterparty is known');
    const key = this.key, sendingTime = fixTime();
    let raw;
    this.store.tx(() => {
      const seq = this.store.seqs(key).out + 1, h = { sender: this.sender, target: this.target, seq, sendingTime };
      raw = encode(type, fields, h);
      this.store.addOut(key, seq, type === 'A' ? encode(type, fields.map(([t, v]) => t == 553 || t == 554 ? [t, '***'] : [t, v]), h) : raw);
      if (onWire) this.wire(raw);
    });
    return +this.store.seqs(key).out;
  }
  // an unauthenticated refusal: written, not stored, no sequence consumed (a stranger must not move our numbers)
  refuse(text) {
    this.write(encode('5', [[58, text]], { sender: this.sender, target: this.target || 'UNKNOWN', seq: this.store.seqs(this.key).out + 1, sendingTime: fixTime() }));
    this.log(`${this.key}: Logon refused (${text})`); this.closing = true; this.end();
  }
  end() { const s = this.sock; this.store.afterCommit(() => s?.end()); } // after any write still waiting for its commit
  fatal(text) { this.log(`${this.key}: Logout (${text})`); this.out('5', [[58, text]], true); this.closing = true; this.on = false; this.end(); }
  logonOut() { this.out('A', [[98, 0], [108, this.hb], ...(this.user != null ? [[553, this.user]] : []), ...(this.pass != null ? [[554, this.pass]] : [])], true); }
  logout(text = '') {
    return new Promise(r => {
      const s = this.sock; if (!s) return r();
      s.once('close', r);
      if (this.on) { this.loggingOut = true; this.out('5', text ? [[58, text]] : [], true); }
      this.closing = !this.on; this.end();
      setTimeout(() => s.destroy(), 2000).unref();
    });
  }

  recv(m) {
    this.lastIn = Date.now(); this.testReq = null; // any message proves the peer is alive
    if (m.error) {
      // FIX 4.4: a garbled message is ignored (no Reject, no seq consumed; a gap brings it back). Never logged: it may be a Logon
      this.log(`${this.target ? this.key : this.sender}: garbled message ignored (${m.error})`);
      return;
    }
    if (!this.on) return this.logon(m);
    const f = m.fields;
    if (f.get('49') !== this.target || f.get('56') !== this.sender) return this.fatal('CompID problem');
    const exp = this.expected();
    if (m.type === '4' && f.get('123') !== 'Y') { // SequenceReset-Reset: the seq is not checked
      const n = +f.get('36');
      if (n > exp) this.store.setIn(this.key, n - 1); else if (n < exp) this.send('3', [[45, m.seq], [371, 36], [372, '4'], [373, 5], [58, `NewSeqNo ${n} below expected ${exp}`]]);
      return this.drain();
    }
    if (m.seq < exp) { if (f.get('43') === 'Y') return; return this.fatal(`MsgSeqNum too low, expecting ${exp} but received ${m.seq}`); }
    if (m.seq > exp) {
      if (m.type === '2') { this.resend(m); m.served = true; } // a ResendRequest is served even across a gap
      if (m.type === '5') return this.fatal(`Logout with a sequence gap, expecting ${exp} but received ${m.seq}`);
      this.queue.set(m.seq, m);
      if (!this.resendTo) this.askResend(exp, m.seq);
      return;
    }
    this.process(m); this.drain();
  }
  logon(m) {
    const f = m.fields;
    if (!this.acceptor) { // the initiator waits for the Logon answer
      if (m.type === '5') { this.log(`${this.key}: Logon refused by the counterparty (${f.get('58') || 'no reason'})`); this.closing = true; return this.end(); }
      if (m.type !== 'A' || f.get('49') !== this.target || f.get('56') !== this.sender) return this.drop('unexpected answer to Logon');
      return this.loggedOn(m);
    }
    if (m.type !== 'A') return this.drop('first message is not a Logon');
    if (f.get('56') !== this.sender || !f.get('49')) return this.drop('Logon for another CompID');
    this.target = f.get('49');
    const hb = +f.get('108');
    if (!Number.isInteger(hb) || hb < 1 || hb > 300) return this.refuse('HeartBtInt must be 1-300');
    if (!this.auth?.(f.get('553'), f.get('554'), this.target)) return this.refuse('Logon refused');
    if (this.busy?.(this.target, this)) return this.refuse('Session already active');
    this.hb = hb; clearInterval(this.timer); this.timer = setInterval(() => this.tick(), Math.max(50, Math.min(1000, hb * 200)));
    this.loggedOn(m);
  }
  loggedOn(m) {
    const exp = this.expected();
    if (m.seq < exp && m.fields.get('43') !== 'Y') return this.fatal(`MsgSeqNum too low, expecting ${exp} but received ${m.seq}`);
    this.on = true; clearTimeout(this.lt);
    if (this.acceptor) this.out('A', [[98, 0], [108, this.hb]], true);
    if (m.seq === exp) this.store.setIn(this.key, m.seq); else if (m.seq > exp) this.askResend(exp, m.seq);
    this.log(`${this.key}: logged on`); this.onUp?.(this);
  }
  askResend(from, upto) { this.resendTo = upto; this.log(`${this.key}: gap, ResendRequest from ${from}`); this.send('2', [[7, from], [16, 0]]); }
  // one inbound message whose seq is the expected one (or a GapFill at it)
  process(m) {
    const f = m.fields, key = this.key;
    this.store.tx(() => {
      if (m.type === '4') { // GapFill
        const n = +f.get('36');
        if (n > m.seq) return this.store.setIn(key, n - 1);
        this.store.setIn(key, m.seq); // a rejected message still consumes its seq
        return this.send('3', [[45, m.seq], [371, 36], [372, '4'], [373, 5], [58, `GapFill NewSeqNo ${n} not above MsgSeqNum ${m.seq}`]]);
      }
      if (!SESSION.has(m.type)) {
        try {
          this.store.savepoint(() => {
            const r = this.onApp(m, this);
            if (r && typeof r.then === 'function') r.then(null, e => this.log(`${key}: async onApp failed on ${m.type} ${m.seq}: ${e?.message}`));
          });
        } catch (e) { this.log(`${key}: onApp failed on ${m.type} ${m.seq}: ${e?.message}`); return this.fatal(`Application error on MsgSeqNum ${m.seq}`); }
        return this.store.setIn(key, m.seq);
      }
      this.store.setIn(key, m.seq);
      if (m.type === '1') this.send('0', [[112, f.get('112') ?? '']]);
      else if (m.type === '2') { if (!m.served) this.resend(m); }
      else if (m.type === '3') this.log(`${key}: Reject from the counterparty for seq ${f.get('45')} (${f.get('58') || ''})`);
      else if (m.type === '5') { this.log(`${key}: Logout received`); if (!this.loggingOut) this.out('5', [], true); this.on = false; this.closing = true; this.end(); }
    });
  }
  drain() {
    for (const s of [...this.queue.keys()]) if (s < this.expected()) this.queue.delete(s);
    for (let m; this.on && (m = this.queue.get(this.expected())); ) { this.queue.delete(m.seq); this.process(m); for (const s of [...this.queue.keys()]) if (s < this.expected()) this.queue.delete(s); }
    if (this.resendTo && this.expected() > this.resendTo) this.resendTo = 0;
    if (this.on && this.queue.size && !this.resendTo) this.askResend(this.expected(), Math.max(...this.queue.keys()));
  }
  // resend [7, 16] (16=0: through the last sent): application messages again with 43=Y and 122, runs of admin
  // messages (or seqs missing from the store) as one SequenceReset-GapFill each
  resend(m) {
    const last = this.store.seqs(this.key).out, from = +m.fields.get('7'), end = +m.fields.get('16'), to = end === 0 || end > last ? last : end;
    if (!(from >= 1) || from > to) return;
    this.log(`${this.key}: resending ${from}-${to}`);
    const rows = new Map(this.store.range(this.key, from, to).map(r => [r.seq, r.raw])), now = fixTime();
    const h = seq => ({ sender: this.sender, target: this.target, seq, sendingTime: now, possDup: true, origSendingTime: now });
    let gap = 0;
    const fill = upto => { if (gap) this.wire(encode('4', [[123, 'Y'], [36, upto]], h(gap))); gap = 0; };
    for (let s = from; s <= to; s++) {
      const p = rows.has(s) ? pairs(rows.get(s)) : null, type = p?.find(([t]) => t === '35')?.[1];
      if (!p || SESSION.has(type)) { if (!gap) gap = s; continue; }
      fill(s);
      this.wire(encode(type, p.filter(([t]) => !HEADER.has(t)), { ...h(s), origSendingTime: p.find(([t]) => t === '52')?.[1] || now }));
    }
    fill(to + 1);
  }
  tick() {
    if (!this.on) return;
    const now = Date.now(), H = this.hb * 1000;
    if (now - this.lastOut >= H) this.send('0', []);
    if (now - this.lastIn >= H * 1.2 + 100) {
      if (!this.testReq) { this.testReq = 'TR' + now; this.testAt = now; this.send('1', [[112, this.testReq]]); }
      else if (now - this.testAt >= H) this.drop('no answer to TestRequest');
    }
  }
}

// createAcceptor({ port, host, compId, auth(user, pass, senderCompId) -> bool, store, onApp(msg, session), log?, logonTimeout? })
// -> { ready: Promise<port>, session(target), send(target, type, fields, o?) -> { seq, live }, close() }. One live
// session per counterparty CompID; send() to a counterparty that is down is stored and delivered after its next Logon.
export function createAcceptor({ port, host = '127.0.0.1', compId, auth, store, onApp, log = defLog, logonTimeout = 10000 }) {
  const live = new Map(), conns = new Set();
  const server = net.createServer(sock => {
    const s = new Session({ store, sender: compId, onApp, log, acceptor: true, auth, logonTimeout, busy: t => live.has(t),
      onUp: x => live.set(x.target, x), onDown: x => { if (live.get(x.target) === x) live.delete(x.target); conns.delete(x); } });
    conns.add(s); s.attach(sock);
  });
  const ready = new Promise((res, rej) => { server.once('error', rej); server.listen(port, loopback(host), () => res(server.address().port)); });
  const send = (t, type, fields, o = {}) => (live.get(t) || new Session({ store, sender: compId, target: t, log })).send(type, fields, o);
  return { ready, session: t => live.get(t) || null, send,
    close: () => new Promise(r => { for (const s of conns) s.logout('Acceptor closing'); server.close(() => r()); }) };
}

// createInitiator({ port, host, compId, target, user, pass, heartBtInt, store, onApp, onState(state, session), log?, logonTimeout? })
// -> { send(type, fields, o?) -> { seq, live }, close(), state }. States: connecting | logged-on | down; reconnects after 1, 2, 5, 10, 10… s.
export function createInitiator({ port, host = '127.0.0.1', compId, target, user, pass, heartBtInt = 30, store, onApp, onState = () => {}, log = defLog, logonTimeout = 10000 }) {
  loopback(host);
  let stopped = false, tries = 0, timer = null, state = null;
  const set = st => { if (st !== state) { state = st; onState(st, s); } };
  const s = new Session({ store, sender: compId, target, hb: heartBtInt, onApp, log, user, pass, logonTimeout,
    onUp: () => { tries = 0; set('logged-on'); },
    onDown: () => { set('down'); if (!stopped) timer = setTimeout(connect, RECONNECT[Math.min(tries++, RECONNECT.length - 1)] * 1000); } });
  function connect() {
    timer = null; if (stopped) return;
    set('connecting');
    const sock = net.connect({ port, host }); s.attach(sock);
    sock.once('connect', () => { if (s.sock === sock) s.logonOut(); });
  }
  connect();
  return { send: (type, fields, o) => s.send(type, fields, o), get state() { return state; }, session: s,
    close: async () => { stopped = true; clearTimeout(timer); await s.logout(); set('down'); } };
}
