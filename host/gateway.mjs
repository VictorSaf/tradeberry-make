/* The execution gateway: its own process on the Mac mini (launchd com.victor.tradeberry-gateway), between the browsers
   and the broker. A restart of the web server (deploy:ui) does not stop it.
   - Browsers: WebSocket on 127.0.0.1:8797 (host/gateway/ws.mjs), reached only through host/server.mjs's /api/trade proxy,
     which signs them in and forwards the user, the device and the shared secret TB_GW_SECRET.
   - Broker: ONE FIX 4.4 initiator session (host/fix/session.mjs) carrying every account (tag 1), credentials
     TB_FIX_USER / TB_FIX_PASS (never logged). Accounts: u<user_id>, u<user_id>-<device> on a shared login
     (host/gateway/db.mjs); one the broker does not hold yet is created there on demand (U1 SET, type demo).
   - Mirror (host/gateway/mirror.mjs): every account as the broker reports it (8, AP, BA), rebuilt at every logon with
     AF + AN + BB; the browsers get it whole (snapshot) at every connection and after every logon, then live events.
   Exactly-once: the gateway's tables and its FIX store share tradeberry.db's connection. An inbound report is handled in
   the session's transaction (onApp is synchronous, never its own BEGIN): an ExecutionReport is recorded once per
   (account, ExecID) in gw_exec (seen again: ignored), and a command's result lands in its gw_cid row in the same commit
   as in_seq. A command is one transaction: its ClOrdIDs (gw_clord), its gw_cid row and the messages that carry them
   commit together, and only on a live session (send requireLive): with the broker unreachable it is refused ("Execution
   server unreachable"), nothing waits to go out minutes later. A cid sent again (a reconnect) gets the same ClOrdIDs
   and the same reply, never a second order. Browser messages: replies and events after the commit that caused them.
   WS protocol: commands { op, cid, … }, op ∈ order | close | modify | cancel | closeAll | basket | settings | alert | meta |
   reset | history; replies { cid, ok, id?, code?, text? } (refusals carry the account core's texts; history adds page,
   pages, total, rows: 200 a page, newest first); events { ev: snapshot | exec | pos | ord | acct | gw | link, … }.
   The temporary broker's AD answer has no end marker: every request answered by a list (history) and every U1 is
   followed by a CollateralInquiry (909 = a fence id) whose BA closes it (the session delivers in order).
   OMS (host/gateway/oms.mjs): netting choice, exits attached at the fill, multi-TP, trailing, break-even, baskets, time
   stops, challenge, alerts, on the gateway's own feed (host/broker/feed.mjs, as the broker's); their state is gw_state
   (sent as `gw` in the snapshot, then `gw` events { key, value }), what the browser only tells the user comes as `notice`.
   The snapshot also carries account { type, set } (the broker's BA), sent again with every `acct` event.
   Final review (03.11.2026): an OMS step that throws on a broker report is rolled back alone (oms.guard, a savepoint):
   the report is recorded, the mirror and the browsers' events go on, the link stays up; an account whose OMS keeps
   failing is suspended there (host/gateway/oms.mjs). history { page, size ≤ 500 } asks the broker for that window only
   (AD 5060 / 5061, AQ total). records { fills ≤ 500, log ≤ 300 } answers the newest fill receipts and order-log rows the
   broker holds (U2 / U3, migrated ones included). Every ~30 s each socket's sign-in is checked again (the session row,
   not expired, the user not disabled): a revoked one is closed (4401).
   History: one AD in flight per account (the temporary broker does not echo 568 on its AE; a broker that does is
   collected by 568). Retention: gw_exec 30 days, the journal of a position closed 90 days ago (host/gateway/db.mjs). */
import { fileURLToPath } from 'node:url';
import { MarketCore, CATALOG } from '../core/market.mjs';
import { AccountCore } from '../core/account.mjs';
import { createInitiator } from './fix/session.mjs';
import * as FX from './fix/dialect.mjs';
import { openGatewayDb, META_KEYS } from './gateway/db.mjs';
import { createMirror } from './gateway/mirror.mjs';
import { createWsServer } from './gateway/ws.mjs';
import { createOms } from './gateway/oms.mjs';
import { createFeed } from './broker/feed.mjs';

const PAGE = 200, FENCE_MS = 15000;
const UNREACHABLE = Object.freeze({ ok: false, code: 'LINK_DOWN', text: 'Execution server unreachable' });
const SET_KEYS = ['jur', 'lev', 'slip', 'slipSd', 'latMs', 'comm'];
const opp = s => (s === 'buy' ? 'sell' : 'buy');
const fin = v => typeof v === 'number' && Number.isFinite(v);
const one = (m, t) => { const v = m.fields.get(String(t)); return Array.isArray(v) ? v[0] : v; };

export async function startGateway({ db: file, port = 8797, host = '127.0.0.1', fixPort = 9878, fixHost = '127.0.0.1', compId = 'TB-GW', target = 'TB-BROKER',
  user, pass, secret, heartBtInt = 30, log = s => console.log(new Date().toISOString(), 'gateway: ' + s), hooks = {}, now = () => Date.now(), feed = false, bars, dataDir } = {}) {
  if (!user || !pass) throw new Error('gateway: TB_FIX_USER / TB_FIX_PASS are not set');
  if (!secret) throw new Error('gateway: TB_GW_SECRET is not set');
  const G = openGatewayDb(file), { store } = G;
  const market = MarketCore.create({ catalog: CATALOG, now });
  const core = AccountCore.create({ market, now: () => now() / 1000 });
  const M = s => (typeof s === 'string' && Object.hasOwn(market.META, s) ? market.META[s] : null);
  const OPTS = { digits: s => (M(s) ? M(s).digits : 5), lotDigits: s => (M(s) ? core.lotDec(s) : 2) };
  const rej = (code, a) => ({ ok: false, code, text: core.rej(code, a).why });
  const mirror = createMirror();
  let link = 'down', told = 'down', sync = null, syncGen = 0, ws = null, ini = null, nId = 0;
  const uid = p => `${p}${Date.now().toString(36)}-${++nId}`;
  const linkOn = () => !!ini?.session?.on;
  // commands go out only when the browsers are shown 'up': logged on AND the mirror rebuilt (the rebuild's own sends are not gated)
  const up = () => link === 'up' && linkOn();

  /* ---------- replies: waiters by (account, cid); ClOrdID → its command ---------- */
  const waiters = new Map(), pendCl = new Map();
  const key = (a, cid) => a + '\n' + cid;
  // (a basket opening is the OMS's: gw_state bkOpening resolves it, and its reply)
  for (const { account, cid, row } of G.openCids()) if (row.op !== 'basket') for (const cl of row.cls || []) if (!row.res?.[cl]) pendCl.set(cl, { account, cid });
  function reply(account, cid, r) {
    store.afterCommit(() => { const k = key(account, cid), set = waiters.get(k); waiters.delete(k); for (const s of set || []) s.send({ cid, ...r }); });
  }
  const push = (account, o) => store.afterCommit(() => ws.to(account, o));
  // the result of one ClOrdID; the command's reply once all of its ClOrdIDs have one (inside the caller's transaction)
  function decide(cl, r) {
    const p = pendCl.get(cl); if (!p) return;
    pendCl.delete(cl);
    const row = G.cid(p.account, p.cid); if (!row || row.res?.[cl]) return;
    row.res = { ...row.res, [cl]: r };
    if (row.cls.every(c => row.res[c])) {
      // an order sent as several D (the offsets of a net book, M7): the last one is the order that opens
      const main = row.op === 'order' ? row.cls[row.cls.length - 1] : row.cls[0];
      const bad = row.cls.map(c => row.res[c]).find(x => !x.ok), first = row.res[main];
      row.reply = bad ? { ok: false, code: bad.code, text: bad.text } : { ok: true, id: main, ...(first.pos != null ? { pos: first.pos } : {}), ...(row.cls.length > 1 ? { ids: row.cls } : {}) };
    }
    G.putCid(p.account, p.cid, row);
    if (row.reply) reply(p.account, p.cid, row.reply);
  }

  /* ---------- fences: a BB whose BA (909) closes what was sent before it; a j for one of its messages is its refusal ---------- */
  const fences = new Map(), jWait = new Map(), hist = new Map(), histWait = new Map(), recs = new Map();
  function fenced(account, msgs, finish) {
    if (!up()) return finish(UNREACHABLE);
    const fid = uid('F'), seqs = [];
    try {
      store.tx(() => {
        for (const [t, f] of msgs) seqs.push(ini.send(t, f, { requireLive: true }).seq);
        seqs.push(ini.send('BB', [[909, fid], [1, account], [263, 1]], { requireLive: true }).seq);
      });
    } catch (e) { if (!up()) return finish(UNREACHABLE); throw e; }
    const f = { fail: null, seqs, finish };
    f.timer = setTimeout(() => complete(fid, { ok: false, code: 'TIMEOUT', text: 'No answer from the execution server' }), FENCE_MS);
    fences.set(fid, f); for (const s of seqs) jWait.set(s, fid);
    return fid;
  }
  function complete(fid, fail) {
    const f = fences.get(fid); if (!f) return;
    fences.delete(fid); clearTimeout(f.timer); for (const s of f.seqs) jWait.delete(s);
    f.finish(fail || f.fail || null);
  }
  function onReject(j) {
    // a G or an F refused with a j (dead letter, unsupported): its chained replace is forgotten, the next one uses the mirror
    if ((j.refMsgType === 'G' || j.refMsgType === 'F') && j.account) oms.unrepl(j.account, null, null, true);
    const fid = jWait.get(j.refSeq);
    if (fid) { const f = fences.get(fid), r = { ok: false, code: j.code || 'REJECTED', text: j.text || 'Refused by the execution server' }; if (j.refMsgType === 'BB') complete(fid, r); else if (f && !f.fail) f.fail = r; return; }
    // an account the broker does not hold yet: open it there (demo), then subscribe
    if (j.refMsgType === 'BB' && j.code === 'NO_ACCOUNT' && j.account) ensure(j.account, true);
  }
  function ensure(account, create) {
    if (create) ini.send('U1', FX.settingsToU1({ type: 'demo' }, account));
    ini.send('BB', [[1, account], [263, 1]]);
  }

  /* ---------- the logon rebuild ---------- */
  function startSync() {
    sync = { gen: ++syncGen, posReq: uid('P'), massId: uid('M'), pos: [], posTotal: null, ord: [], ordTotal: null, posDone: false, ordDone: false };
    store.tx(() => {
      ini.send('AF', [[584, sync.massId], [585, 7]]);
      ini.send('AN', [[710, sync.posReq], [724, 0], [263, 1]]);
      for (const a of new Set([...G.accounts(), ...ws.accounts()])) ensure(a, false);
    });
  }
  function step() {
    if (!sync) return;
    if (!sync.ordDone && sync.ordTotal != null && sync.ord.length >= sync.ordTotal) { sync.ordDone = true; mirror.replaceOrders(sync.ord); }
    if (!sync.posDone && sync.posTotal != null && sync.pos.length >= sync.posTotal) { sync.posDone = true; mirror.replacePositions(sync.pos); }
    if (!sync.ordDone || !sync.posDone) return;
    const gen = sync.gen; sync = null;
    const finish = () => {
      if (gen !== syncGen || !linkOn()) return; // the link dropped meanwhile: the next logon rebuilds again
      link = 'up';
      log('linked to the broker, mirror rebuilt');
      oms.linked();
      for (const s of ws.sessions()) s.send(snapshot(s.account));
      told = 'up'; ws.all({ ev: 'link', state: 'up' });
    };
    store.afterCommit(() => (hooks.beforeUp ? hooks.beforeUp(finish) : finish())); // tests: hold the window between the rebuild and 'up'
  }
  function onState(st) {
    if (st === 'logged-on') return startSync();
    link = 'down'; sync = null; syncGen++;
    if (told !== 'down') { told = 'down'; ws?.all({ ev: 'link', state: 'down' }); log('broker link down'); }
  }

  /* ---------- the broker's messages (in the session's transaction) ---------- */
  function onExec(ev) {
    if (ev.kind === 'status') {
      if (sync && ev.massId === sync.massId) { if (ev.ordStatus === 'working') sync.ord.push([ev.ids.account, ev.ids, ev.order]); sync.ordTotal = ev.total ?? 0; step(); }
      return;
    }
    const a = ev.ids.account; if (!a) return;
    if (!G.addExec(a, ev.ids.execId, ev.receipt?.t ?? Date.now() / 1000, ev)) return; // seen before: nothing changes
    hooks.exec?.(ev);
    const cl = ev.ids.clOrdId, before = mirror.get(a)?.orders.get(cl) || null;
    // a reject after a fill of the same ClOrdID: the remainder of a reversal was refused, the fill stands
    const remainder = ev.kind === 'reject' && G.hasFill(a, cl);
    oms.guard(a, 'report', () => { hooks.omsExec?.(a, ev); oms.onExec(a, ev, before); }); // a throw here never stops the link (I4)
    for (const ch of mirror.exec(ev)) push(a, { ev: 'ord', ...ch });
    push(a, { ev: 'exec', exec: ev, ...(remainder ? { remainder: true } : {}) });
    if (ev.kind === 'fill') decide(cl, { ok: true, pos: ev.receipt.pos });
    else if (ev.kind === 'new' || ev.kind === 'replaced' || ev.kind === 'cancel') decide(cl, { ok: true });
    else if (ev.kind === 'reject') decide(cl, { ok: false, code: ev.code || 'REJECTED', text: ev.text || 'Refused by the execution server' });
  }
  function onApp(m) {
    switch (m.type) {
      case '8': return onExec(FX.reportToExec(m));
      case 'AP': {
        const { account, pos, reqId } = FX.apToPos(m);
        if (sync && reqId === sync.posReq) { sync.pos.push([account, pos]); return step(); }
        if (reqId !== undefined) return; // an answer to an earlier session's request
        const x = mirror.pos(account, pos);
        if (!x.lots) oms.guard(account, 'flat position', () => oms.onFlat(account, x.id));
        return push(account, { ev: 'pos', pos: x, ...(x.lots ? { meta: G.meta(account, x.id) } : {}) });
      }
      case 'AO': { const a = FX.aoToAck(m); if (sync && a.reqId === sync.posReq) { sync.posTotal = a.total; step(); } return; }
      case 'BA': {
        const { account, summary, info } = FX.baToSummary(m);
        mirror.summary(account, summary); if (info) mirror.info(account, info);
        push(account, { ev: 'acct', acct: summary, info: mirror.get(account).info || null });
        const fid = one(m, 909); if (fid && fences.has(fid)) complete(fid);
        return;
      }
      case 'AQ': { const x = FX.aqToAck(m), q = hist.get(x.account), col = q && (x.reqId !== undefined ? q.find(c => c.rid === x.reqId) : q[0]); if (col) col.total = x.total; return; }
      case 'U3': { const x = FX.u3ToRecords(m), col = recs.get(x.reqId); if (col && x.kind) col[x.kind === 'fill' ? 'fills' : 'log'].push(...x.rows); return; }
      case 'AE': {
        const { account, trade } = FX.aeToTrade(m), q = hist.get(account), rid = one(m, 568);
        const col = q && (rid !== undefined ? q.find(x => x.rid === rid) : q[0]); if (col) col.rows.push(trade); return;
      }
      case '9': {
        const r = FX.nineToCxlReject(m); let again = null;
        oms.guard(r.account, 'cancel reject', () => { again = oms.onCxlReject(r) || null; });
        if (again) { // sent once more (chained on a refused G): the browser's command now waits for the new ClOrdID
          const p = pendCl.get(r.clOrdId);
          if (p) { pendCl.delete(r.clOrdId); pendCl.set(again, p); const row = G.cid(p.account, p.cid); if (row) { row.cls = row.cls.map(c => c === r.clOrdId ? again : c); G.putCid(p.account, p.cid, row); } }
          return;
        }
        return decide(r.clOrdId, { ok: false, code: r.code || 'REJECTED', text: r.text || 'Refused by the execution server' }); }
      case 'j': return onReject(FX.jToReject(m));
    }
  }

  /* ---------- browser commands ---------- */
  // send the messages of a command (one ClOrdID each) with its gw_cid row, in one transaction on a live session.
  // -> a reply now (refused), or null (the reply comes with the broker's reports)
  function orders(account, cid, op, list, inTx) {
    if (!list.length) return { ok: true, id: null };
    if (!up()) return UNREACHABLE;
    let cls;
    try {
      store.tx(() => {
        cls = [];
        for (const [type, build] of list) { const cl = G.nextClOrdId(account); ini.send(type, build(cl), { requireLive: true }); cls.push(cl); }
        G.putCid(account, cid, { op, cls, res: {}, reply: null });
        if (inTx) inTx(cls); // the OMS's rows for these ClOrdIDs (exits, journal), in the same commit
      });
    } catch (e) { if (!up()) return UNREACHABLE; if (/^FIX dialect/.test(e.message)) return { ok: false, code: 'BAD_REQUEST', text: e.message.replace(/^FIX dialect: /, '') }; throw e; }
    for (const cl of cls) pendCl.set(cl, { account, cid });
    return null;
  }
  // what the OMS sends on its own (closes, linked legs, replaces): ClOrdIDs, no cid; null when the link is not up
  function sysSend(account, list) {
    if (!linkOn() || !list.length) return null;
    const cls = [];
    // in a savepoint: inside the session's transaction too, a failure takes back what this call wrote and queued
    try { store.tx(() => store.savepoint(() => { for (const [type, build] of list) { const cl = G.nextClOrdId(account); ini.send(type, build(cl), { requireLive: true }); cls.push(cl); } })); }
    catch (e) { cls.length = 0; if (!linkOn()) return null; log(`oms: send failed (${e.message})`); return null; }
    return cls;
  }
  // the OMS's answer to a kept command (a basket opening): its gw_cid row and the reply, in the caller's transaction
  function finishCid(account, cid, r) {
    const row = G.cid(account, cid) || { op: 'basket', cls: [], res: {} };
    row.reply = r; G.putCid(account, cid, row); reply(account, cid, r);
  }
  // the ClOrdIDs of an account's commands not answered yet
  const inflightOf = account => [...pendCl].filter(([, p]) => p.account === account).map(([cl]) => cl);
  function orderReq(c) {
    if (!M(c.sym)) return rej('UNKNOWN_SYM');
    if (c.side !== 'buy' && c.side !== 'sell') return { ok: false, code: 'SIDE', text: 'Side must be buy or sell' };
    const lots = Number(c.lots), v = core.volCheck(c.sym, lots); if (v) return rej(...v);
    const ot = c.ot ?? 'market'; if (!['market', 'limit', 'stop', 'stoplimit'].includes(ot)) return { ok: false, code: 'ORD_TYPE', text: 'Unsupported order type' };
    const tif = c.tif ?? 'GTC'; if (!['GTC', 'DAY', 'GTD'].includes(tif)) return { ok: false, code: 'TIF', text: 'Time in force must be GTC, DAY or GTD' };
    const req = { sym: c.sym, side: c.side, lots, ot, tif };
    if (ot !== 'market') { if (!fin(c.price) || !(c.price > 0)) return rej('PRICE_INVALID'); req.price = c.price; }
    if (ot === 'stoplimit') { if (!fin(c.limit) || !(c.limit > 0)) return rej('LIMIT_INVALID'); req.limit = c.limit; }
    if (tif === 'GTD') { if (!fin(c.expires)) return rej('EXPIRY'); req.expires = c.expires; }
    if (c.posId != null) { if (!Number.isInteger(c.posId)) return rej('NO_POS'); req.posId = c.posId; }
    if (c.oca != null && c.oca !== '') req.oca = String(c.oca).slice(0, 40);
    if (c.net === true) req.net = true;
    return { req };
  }
  const D = (req, account) => ['D', cl => FX.orderToD(req, cl, account, OPTS)];
  const posOf = (account, id) => mirror.get(account)?.positions.get(Number(id)) || null;
  const cancelOf = (account, o) => ['F', cl => FX.cancelToF({ clOrdId: cl, origClOrdId: oms.eff(account, o.clOrdId), account, sym: o.sym, side: o.side, lots: o.lots }, OPTS)];
  const closeOf = (account, p, lots = p.lots, reason = 'Manual') => D({ sym: p.sym, side: opp(p.side), lots, ot: 'market', tif: 'GTC', posId: p.id, reason }, account);
  const reasonOf = c => (typeof c.reason === 'string' && c.reason.trim() ? c.reason.trim().slice(0, 60) : 'Manual');

  const OPS = {
    order(a, c) { const r = orderReq(c); if (!r.req) return r; if (!up()) return UNREACHABLE; return oms.order(a, c, r.req, (list, inTx) => orders(a, c.cid, 'order', list, inTx)); },
    // reason: the close's own words (trade.js closePosition: 'Manual' unless said), on the fill and the history row
    close(a, c) {
      const p = posOf(a, c.posId); if (!p) return rej('NO_POS');
      const lots = c.lots == null ? p.lots : Math.min(Number(c.lots), p.lots), v = core.volCheck(p.sym, lots); if (v) return rej(...v);
      return orders(a, c.cid, 'close', [closeOf(a, p, lots, reasonOf(c))]);
    },
    closeAll(a, c) {
      const ps = [...(mirror.get(a)?.positions.values() || [])].filter(p => !c.sym || p.sym === c.sym);
      return orders(a, c.cid, 'closeAll', ps.map(p => closeOf(a, p, p.lots, reasonOf(c))));
    },
    cancel(a, c) { const o = mirror.get(a)?.orders.get(c.id); return o ? orders(a, c.cid, 'cancel', [cancelOf(a, o)]) : rej('NO_ORDER'); },
    modify(a, c) { return oms.modify(a, c, (list, inTx) => orders(a, c.cid, 'modify', list, inTx)); },
    settings(a, c, done) {
      // the challenge (gw_state chal) travels with the settings: { chal: { do: start | stop | cfg, … } }
      if (c.chal && typeof c.chal === 'object') { const r = oms.chal(a, c.chal); if (!r.ok || !SET_KEYS.some(k => c[k] !== undefined)) return r; }
      const set = {}; for (const k of SET_KEYS) if (c[k] !== undefined) set[k] = c[k];
      let f; try { f = FX.settingsToU1(set, a); } catch (e) { return { ok: false, code: 'BAD_REQUEST', text: e.message.replace(/^FIX dialect: /, '') }; }
      fenced(a, [['U1', f]], fail => done(fail || { ok: true }));
      return null;
    },
    reset(a, c, done) {
      store.tx(() => G.putCid(a, c.cid, { op: 'reset', cls: [], reply: null }));
      // unreachable / no answer: not the reset's result, so not kept (the cid may be sent again)
      fenced(a, [['U1', FX.resetToU1(a)]], fail => {
        const r = fail || { ok: true };
        store.tx(() => (r.code === 'LINK_DOWN' || r.code === 'TIMEOUT' ? G.delCid(a, c.cid) : G.putCid(a, c.cid, { op: 'reset', cls: [], reply: r })));
        done(r);
      });
      return null;
    },
    history(a, c, done) {
      const page = Number.isInteger(c.page) && c.page >= 0 ? c.page : 0, size = Number.isInteger(c.size) && c.size >= 1 && c.size <= 500 ? c.size : PAGE;
      // one request in flight per account: an AE without 568 belongs to the oldest open request, so a second one waits
      const run = () => {
        const col = { rows: [], rid: uid('H') };
        let q = hist.get(a); if (!q) hist.set(a, q = []);
        q.push(col);
        const end = () => { const i = q.indexOf(col); if (i >= 0) q.splice(i, 1); if (!q.length) hist.delete(a); const nx = histWait.get(a)?.shift(); if (nx) nx(); else histWait.delete(a); };
        // only the window asked for travels (M6): the broker skips page × size rows and sends size (AQ: the total)
        const fid = fenced(a, [['AD', FX.histToAD({ reqId: col.rid, account: a, max: size, skip: page * size })]], fail => {
          end();
          if (fail) return done(fail);
          const rows = col.rows.map((r, i) => [r, i]).sort((x, y) => (y[0].close ?? 0) - (x[0].close ?? 0) || y[1] - x[1]).map(x => x[0]);
          // each row carries its position's journal (gw_meta: the META_KEYS, not the OMS's own prot / closedAt), as the
          // browser's history rows always did
          const metas = G.metaAll(a), jr = id => { const m = metas.get(id); if (!m) return null; const o = {}; for (const k of META_KEYS) if (m[k] !== undefined) o[k] = m[k]; return Object.keys(o).length ? o : null; };
          const total = Number.isInteger(col.total) ? col.total : rows.length, win = Number.isInteger(col.total) ? rows : rows.slice(page * size, (page + 1) * size); // a broker without AQ sends all of it
          const out = win.map(r => { const m = r.id != null ? jr(r.id) : null; return m ? { ...r, meta: m } : r; });
          done({ ok: true, page, size, pages: Math.max(1, Math.ceil(total / size)), total, rows: out });
        });
        if (!fid) end();
      };
      if (hist.get(a)?.length) { let w = histWait.get(a); if (!w) histWait.set(a, w = []); w.push(run); } else run();
      return null;
    },
    // the newest fill receipts (≤ 500) and order-log rows (≤ 300) of the account, as the broker holds them (I7)
    records(a, c, done) {
      const n = (v, d, mx) => (Number.isInteger(v) && v >= 0 ? Math.min(v, mx) : d), rid = uid('R'), col = { fills: [], log: [] };
      recs.set(rid, col);
      const fid = fenced(a, [['U2', FX.recordsToU2({ account: a, reqId: rid, fills: n(c.fills, 500, 500), log: n(c.log, 300, 300) })]], fail => {
        recs.delete(rid);
        done(fail || { ok: true, fills: col.fills, ordLog: col.log });
      });
      if (!fid) recs.delete(rid);
      return null;
    },
    meta(a, c) {
      const id = Number(c.posId); if (!Number.isInteger(id) || !c.meta || typeof c.meta !== 'object') return { ok: false, code: 'BAD_REQUEST', text: 'meta needs posId and meta' };
      const m = { ...(G.meta(a, id) || {}) };
      for (const k of META_KEYS) if (Object.hasOwn(c.meta, k)) { if (c.meta[k] === null) delete m[k]; else m[k] = c.meta[k]; }
      const s = JSON.stringify(m); if (s.length > 16000) return { ok: false, code: 'BAD_REQUEST', text: 'Journal fields too large' };
      store.tx(() => G.putMeta(a, id, m));
      const p = posOf(a, id); if (p) push(a, { ev: 'pos', pos: p, meta: m });
      return { ok: true, id };
    },
    basket(a, c, done) { if (!up() && ['open', 'close', 'half', 'edit'].includes(c.do)) return UNREACHABLE; return oms.basket(a, c, done); },
    alert(a, c) { return oms.alert(a, c); },
  };
  // ops whose cid is kept in gw_cid (a repeat after a reconnect must not act twice)
  const KEPT = new Set(['order', 'close', 'closeAll', 'cancel', 'modify', 'reset', 'basket', 'alert']); // basket / alert: the OMS keeps the ones that create something

  /* Commands per account, over all its sockets (security audit 09.11.2026, F07): a bucket of RATE_BURST that refills
     RATE_PER_S a second. A person trading by hand, a closeAll or a basket stays far below it; a script flooding the broker
     is refused with RATE (nothing sent, the cid may be sent again later). */
  const buckets = new Map();
  function allowed(a) {
    const RATE_BURST = hooks.rateBurst ?? 40, RATE_PER_S = hooks.ratePerS ?? 10; // tests: hooks change them
    const t = now() / 1000, b = buckets.get(a) || { n: RATE_BURST, t };
    b.n = Math.min(RATE_BURST, b.n + (t - b.t) * RATE_PER_S); b.t = t;
    if (buckets.size > 5000) buckets.clear();
    buckets.set(a, b);
    if (b.n < 1) return false;
    b.n -= 1; return true;
  }
  function onCommand(sess, cmd) {
    const a = sess.account, raw = cmd.cid, cid = typeof raw === 'string' || (typeof raw === 'number' && Number.isFinite(raw)) ? String(raw) : '';
    if (!cid || cid.length > 80) return sess.send({ cid: raw ?? null, ok: false, code: 'NO_CID', text: 'A command needs a cid (at most 80 characters)' });
    if (!allowed(a)) return sess.send({ cid, ok: false, code: 'RATE', text: 'Too many commands at once: wait a moment and try again' });
    const op = typeof cmd.op === 'string' && Object.hasOwn(OPS, cmd.op) ? OPS[cmd.op] : null;
    if (!op) return sess.send({ cid, ok: false, code: 'BAD_OP', text: 'Unknown command' });
    const k = key(a, cid);
    if (waiters.has(k)) { waiters.get(k).add(sess); return; } // the same command still in flight
    if (KEPT.has(cmd.op)) {
      const row = G.cid(a, cid);
      if (row) {
        if (row.reply) return sess.send({ cid, ...row.reply });
        if (row.cls.some(cl => pendCl.has(cl) || oms.busy(a, cl))) { waiters.set(k, new Set([sess])); return; }
        return sess.send({ cid, ok: false, code: 'UNKNOWN', text: 'The result of this command was lost in a gateway restart: check the account' });
      }
    }
    waiters.set(k, new Set([sess]));
    let r;
    try { hooks.command?.(cmd); r = op(a, { ...cmd, cid }, x => reply(a, cid, x)); }
    catch (e) { waiters.delete(k); throw e; } // ws.mjs answers 'Gateway error'; the same cid may be sent again
    if (r) reply(a, cid, r);
  }
  function snapshot(account) {
    const v = mirror.view(account), meta = G.metaAll(account);
    return { ev: 'snapshot', account, link: link === 'up' ? 'up' : 'down', acct: v.acct, info: mirror.get(account)?.info || null, positions: v.positions.map(p => ({ ...p, meta: meta.get(p.id) || null })),
      orders: v.orders, execs: G.recentExecs(account, 200), gw: G.state(account) };
  }
  function onOpen(sess) {
    sess.send(snapshot(sess.account));
    if (link !== 'up') sess.send({ ev: 'link', state: 'down' });
    else if (!mirror.get(sess.account)?.summary) store.tx(() => ensure(sess.account, sess.created));
  }

  const oms = createOms({ G, store, mirror, core, market, FX, OPTS, send: sysSend, finish: finishCid, push, log, now, up, bars, dataDir, inflight: inflightOf, resumeS: () => hooks.resumeS ?? 600 });
  // the gateway's own feed (the platform every 100 ms, as the broker's): each batch is an OMS tick
  const tick = rows => { market.setQuotes(rows); oms.tick(); };
  /* I8: a socket's sign-in, checked again every ~30 s (host/gateway/db.mjs sessionAlive: its session row, by the token's
     hash x-tb-session when the proxy sends it, not expired, the user not disabled; accountOpen: the account still
     belongs to that user); the open sockets per account feed the administration's "on a device now" (setLive). */
  const check = s => G.sessionAlive(s.user, s.token) && (typeof G.accountOpen !== 'function' || G.accountOpen(s.account));
  const setLive = (account, user, n) => { try { G.setLive?.(account, user, n); } catch (e) { log(`ws: live count not written (${e.name})`); } };
  ws = createWsServer({ port, host, secret, log, onOpen, onCommand, resolve: (u, d) => G.account(u, d), check, setLive, checkMs: hooks.checkMs });
  const bound = await ws.ready;
  ini = createInitiator({ port: fixPort, host: fixHost, compId, target, user, pass, heartBtInt, store, onApp, onState, log });
  const fd = feed ? createFeed({ onQuotes: tick, log: s => log(s) }).start() : null;
  return {
    port: bound, mirror, market, oms, tick, get link() { return link; }, get fixOn() { return linkOn(); },
    async close() { if (fd) await fd.stop(); await ws.close(); await ini.close(); for (const f of fences.values()) clearTimeout(f.timer); G.close(); },
  };
}

// launchd: node host/gateway.mjs (host/gateway.sh sets the environment)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env, file = env.TB_DB || new URL('../.data/tradeberry.db', import.meta.url).pathname;
  if (!env.LEGACY_API_KEY) { console.error('gateway: LEGACY_API_KEY is not set (the OMS needs the live feed)'); process.exit(1); }
  const g = await startGateway({ db: file, port: +(env.TB_GW_PORT || 8797), fixPort: +(env.TB_FIX_PORT || 9878), user: env.TB_FIX_USER, pass: env.TB_FIX_PASS, secret: env.TB_GW_SECRET, feed: true, dataDir: env.TB_DATA });
  console.log(new Date().toISOString(), `gateway: WS on 127.0.0.1:${g.port}, FIX to 127.0.0.1:${env.TB_FIX_PORT || 9878}, db ${file}`);
  let closing = false;
  const end = async () => { if (closing) return; closing = true; await g.close(); console.log(new Date().toISOString(), 'gateway: stopped'); process.exit(0); };
  process.on('SIGTERM', end); process.on('SIGINT', end);
  // a bug in one handler must not stop every account's link: logged (name and message, never fields), the process goes on
  process.on('uncaughtException', e => console.error(new Date().toISOString(), 'gateway: uncaught', e && e.stack || e));
  process.on('unhandledRejection', e => console.error(new Date().toISOString(), 'gateway: unhandled rejection', e && e.stack || e));
}
