/* The gateway's OMS: tradeBerry's own order features, run 24/7 on the server and sent to the broker as standard orders
   (host/fix/dialect.mjs). The broker sees only D / F / G; everything here is the gateway's (and stays when the temporary
   broker gives way to the real server).
   - Netting: an order on an instrument with a position in the net book (no basket leg: no bgid in gw_meta) carries that
     position's 721; every order of the net book carries 5004 (a pending one nets when it fills). Basket legs carry
     neither: the broker keeps them as hedged positions. A reversal is one D with 721: the broker closes the position
     and opens the remainder as a new one; a reject after its fill (same ClOrdID) is "remainder refused", never an undo.
   - Exits of an order (sl / tp prices, slPips / tpPips, trail, tps legs, be): carried on the D itself (dialect
     5050-5056; a G of a working order carries them in full), so the BROKER creates the position's stop loss and targets
     at the fill, in the same step, also while the gateway is away (final review I5): nothing is attached here after a
     fill, so there are never two sets of legs. They are also kept with the ClOrdID in gw_state ordMeta (the browser's
     view of a working order, the challenge's risk); at the opening fill the gateway only writes the position's journal
     (pm, ctx, timeStop, sl0, tp0, news, basket, bgid) and its prot (trail, break-even) in gw_meta; an add brings none.
   - A market order of the net book with several positions on the other side offsets each of them (721, close only, the
     core's 'Offset by … order'), oldest first, and what is left opens or adds with the order's exits (M7).
   - Replaces: a G on a leg or an order whose previous G is not answered yet goes against that G's ClOrdID (eff), so two
     quick moves of one stop never see "Order not found"; the last one confirmed wins.
   - Failures: an OMS step that throws on a broker report is rolled back alone (savepoint: the report, the mirror and the
     browsers' events are kept); after 3 in a row the account is suspended in the OMS (one log line, a notice): its order
     features are refused (tried again every 10 minutes: a clean pass lifts it), the broker keeps executing its book. A failing tick is logged at
     most once a minute per account; 100 in a row suspend it too. The FIX session is never logged out for this.
   - Trailing stop and break-even (gw_meta prot: trail, trailNow, trailSl, trailed, be, beSl; trade.js checkTriggers
     before the core, core.trailNext / core.beLevel rules): G on the SL leg, only when the stop tightens and is past the
     quote, at most once a second per position, one in flight; break-even after TP1 is armed by the TP1 fill.
   - Baskets (basket.js bkExec / bkMonitor / bkCloseGroup / bkHalf / bkEditApply), time stops (behav.js bhTick),
     challenge rules and the breach flatten (challenge.js chTick / chFlatten / chOrderBlock), price and basket alerts
     (trade.js checkTriggers, basket.js): their state in gw_state (chal, bkPos, bkOrders, bkHist, bkAlerts, alerts),
     evaluated on the gateway's own feed; closes are market D on the position's 721 with the reason of today (5016):
     'Basket stop', 'Basket trail', 'Break-even', 'Basket target', 'Basket rollback', 'Basket close', 'Time stop',
     'Stop-out (challenge breach)'. What the browser only shows (toasts, panels) stays there: it gets `gw` events
     ({ key, value }) and `notice` events ({ kind, text, … }).
   - Nothing happens on a stale feed (market.feedAlive) or while the broker link is not up.
   - Restart: the clock (gw_state '*' omsAt, every 10 s) says how long the gateway was away. Back up, the first ticks
     evaluate baskets, time stops, the challenge and alerts on the current prices; the trailing and break-even missed in
     the pause (up to 14 days) are recovered from its 1-minute bars (the archive data/bars/1/SYM/YYYY-MM.csv.gz first,
     else the platform's /datafeed/history; bars are bid, ask = bid + the current spread), only in the direction that
     tightens the stop and only to a level still past the current quote; an alert crossed in the pause is marked then.
   Commands (host/gateway.mjs routes them here):
     order   + exits sl, tp (prices), slPips, tpPips, trail (pips), tps [{price, lots} | {pips, pct}] (≤ 4), be {at, off, onTp},
             journal pm, ctx; refused CHAL_BLOCK when its stop-out would breach a running challenge attempt
     modify  { posId, sl?, tp?, tps?, trail?, be? } | { id, price?, limit?, tif?, expires?, sl?, tp?, slPips?, tpPips?, trail?, tps?, be? }
     basket  { do: open (bid, name, long, short, side, lots, sl, tp bp, trail, be, risk, pm, ctx) | place (+ type limit|stop, bp) |
             cancel (id) | edit (gid, sl, tp) | be (gid) | half (gid) | close (gid) | alert (bid, name, long, short, bp) | alertDel (id) }
     alert   { do: add (sym, price, cond?) | edit (id, price, cond?) | del (id) }
     settings { chal: { do: start (id, rules) | stop | cfg (sel, opt, custom) } } (beside the account settings) */
import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF', 'EURAUD', 'GBPCHF', 'CADJPY', 'AUDNZD']; // engine.js G8
const TRAIL_MS = 1000, RETRY_S = 3, CLOCK_S = 10, MAE_MS = 1000, PAUSE_MIN = 60, PAUSE_MAX = 14 * 86400, ORD_KEEP = 7 * 86400;
const BK_WHY = { 'Basket close': 'closed', 'Basket stop': 'basket stop', 'Basket trail': 'trailing stop', 'Break-even': 'break-even stop', 'Basket target': 'basket target', 'Time stop': 'time stop' };
const CH_TZ = ['Europe/Prague', 'Europe/London', 'America/New_York', 'America/Chicago', 'UTC'];
const opp = s => (s === 'buy' ? 'sell' : 'buy');
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const norm = w => { const e = Object.entries(w || {}).filter(([, x]) => +x > 0), t = e.reduce((s, [, x]) => s + +x, 0); return t ? Object.fromEntries(e.map(([k, x]) => [k, x / t])) : {}; };
const ccyOk = w => w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length > 0 && Object.keys(w).length <= 16 && Object.entries(w).every(([k, v]) => /^[A-Z]{3}$/.test(k) && fin(v) && v >= 0);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');

export function createOms({ G, store, mirror, core, market, FX, OPTS, send, finish, push, log, now, up, bars, dataDir, inflight = () => [], resumeS = 600 }) {
  const nowS = () => now() / 1000;
  const M = s => (typeof s === 'string' && Object.hasOwn(market.META, s) ? market.META[s] : null);
  const rd = (s, v) => +v.toFixed(M(s).digits);
  const rej = (code, a) => ({ ok: false, code, text: core.rej(code, a).why });
  const no = (code, text) => ({ ok: false, code, text });
  const getBars = bars || archiveBars(dataDir);

  /* ---------- state: gw_state per account (written in the caller's transaction), gw_meta per position ---------- */
  const S = (a, k, d = null) => G.state1(a, k) ?? d;
  function W(a, k, v) { G.putState(a, k, v); push(a, { ev: 'gw', key: k, value: v ?? null }); }
  const meta = (a, id) => G.meta(a, id) || {};
  function putMeta(a, id, m) { G.putMeta(a, id, m); const p = posOf(a, id); if (p) push(a, { ev: 'pos', pos: p, meta: m }); }
  const notice = (a, o) => push(a, { ev: 'notice', ...o });
  // a command whose result is kept with its cid (a repeat after a reconnect gets it again, nothing is done twice)
  const kept = (a, cid, op, reply) => { if (cid) G.putCid(a, cid, { op, cls: [], res: {}, reply }); };
  const posOf = (a, id) => mirror.get(a)?.positions.get(Number(id)) || null;
  const positions = a => [...(mirror.get(a)?.positions.values() || [])];
  const orders = a => [...(mirror.get(a)?.orders.values() || [])];
  const linkOf = (a, posId, leg) => orders(a).find(o => o.linkPos === posId && o.leg === leg) || null;
  const netBook = (a, sym) => positions(a).filter(p => p.sym === sym && !meta(a, p.id).bgid && !meta(a, p.id).basket).sort((x, y) => x.id - y.id);
  const info = a => mirror.get(a)?.info || null;
  const setOf = a => info(a)?.set || { jur: 'none', lev: null, comm: 0 };
  const balance = a => mirror.get(a)?.summary?.balance ?? null;
  const pnlOf = p => { try { const v = core.posPnl(p).pnl; return fin(v) ? v : 0; } catch { return 0; } };
  const equity = a => { const b = balance(a); return b == null ? null : b + positions(a).reduce((s, p) => s + (M(p.sym) ? pnlOf(p) : 0), 0); };
  const qOk = sym => { const q = M(sym) && market.quote(sym); return q && q.bid > 0 && q.ask > 0 ? q : null; };

  /* ---------- sending: market closes, linked legs, replaces (each a ClOrdID; results come back by onExec) ---------- */
  const wait = new Map(); // ClOrdID -> fn(event) for what the OMS sent itself
  const D = (req, a) => ['D', cl => FX.orderToD(req, cl, a, OPTS)];
  // a G not answered yet: account\nOrigClOrdID -> its ClOrdID; the next G or F on that order goes against the newest
  const repl = new Map();
  const eff = (a, cl) => { let c = cl; for (let n = 0; n < 20 && repl.has(a + '\n' + c); n++) c = repl.get(a + '\n' + c); return c; };
  // pendT: the terms of such a G (a working order's next modify builds on them, not on the mirror's older ones)
  const pendT = new Map();
  // sentOn: account\nClOrdID of a G -> the ClOrdID it was sent against; refused: G's the broker refused (9 / reject / j).
  // A G chained on one that is then refused is answered NO_ORDER by the broker: it is sent once more against the order's
  // ClOrdID before that one (no false "Order not found")
  const sentOn = new Map(), refused = new Set();
  const Gr = (t, orig, a) => ['G', cl => { const o = eff(a, orig); store.afterCommit(() => { repl.set(a + '\n' + o, cl); pendT.set(a + '\n' + cl, { ...t }); sentOn.set(a + '\n' + cl, o); }); return FX.replaceToG(t, cl, o, a, OPTS); }];
  const F = (o, a) => ['F', cl => FX.cancelToF({ clOrdId: cl, origClOrdId: eff(a, o.clOrdId), account: a, sym: o.sym, side: o.side, lots: o.lots }, OPTS)];
  // answered (replaced: orig; refused: cl, by 9, a reject or a j), or every one of the account (a j names no ClOrdID)
  const unrepl = (a, orig, cl, all = false) => {
    if (orig) repl.delete(a + '\n' + orig);
    if (cl) { pendT.delete(a + '\n' + cl); for (const [k, v] of repl) if (v === cl && k.startsWith(a + '\n')) repl.delete(k); }
    if (cl) refused.add(a + '\n' + cl);
    if (all) { for (const k of pendT.keys()) if (k.startsWith(a + '\n')) refused.add(k); for (const m of [repl, pendT]) for (const k of [...m.keys()]) if (k.startsWith(a + '\n')) m.delete(k); }
    if (refused.size > 2000) refused.clear(); if (sentOn.size > 5000) sentOn.clear(); // bounded: they matter only for seconds
  };
  // the exits an order carries on its D / G (dialect 5050-5056), from the OMS's exits or a reported order's terms
  const dExits = x => { const o = {}; for (const k of FX.EXIT_KEYS) if (x && x[k] != null && !(k === 'trail' && !(x[k] > 0))) o[k] = x[k]; return o; };

  /* ---------- suspension (I4): an account whose OMS steps keep failing ---------- */
  const resumeAfter = typeof resumeS === 'function' ? resumeS : () => resumeS; // a suspended account is tried again after this (s)
  const off = new Map(), fails = { report: new Map(), tick: new Map() }, logAt = new Map(); // reports and ticks counted apart
  const OFF_TEXT = 'Order features of this account are suspended on the execution server after repeated errors: new orders and changes are refused for now (tried again every 10 minutes); the stops, targets and pending orders already at the broker still execute.';
  const offReply = () => no('OMS_SUSPENDED', OFF_TEXT);
  function failLog(a, what, e) { const t = Date.now(); if (!(t - (logAt.get(a) ?? -Infinity) < 60000)) { logAt.set(a, t); log(`oms: ${what} failed on account ${a} (${e && e.message})`); } }
  function failed(a, what, e, limit, kind) {
    const n = (fails[kind].get(a) || 0) + 1; fails[kind].set(a, n); failLog(a, what, e);
    if (n >= limit && !off.has(a)) { off.set(a, nowS()); log(`oms: account ${a} suspended after ${n} failures in a row (${what}): its order features are refused, tried again every 10 minutes`); notice(a, { kind: 'oms', text: 'Execution server · ' + OFF_TEXT }); }
  }
  // fn in a savepoint of the caller's transaction (a broker report): a throw takes back only what fn wrote and queued
  function guard(a, what, fn) {
    if (!a || off.has(a)) return;
    try { store.savepoint(fn); fails.report.delete(a); } catch (e) { failed(a, what, e, 3, 'report'); }
  }
  function sys(a, list, fns = []) {
    const cls = send(a, list); if (!cls) return null;
    cls.forEach((cl, i) => { if (fns[i]) wait.set(cl, fns[i]); });
    return cls;
  }
  const closing = new Map(); // account:pos -> sec of the last close sent
  function closePos(a, p, reason, lots = p.lots, fn) {
    const k = a + ':' + p.id, t = nowS();
    if (t - (closing.get(k) ?? -Infinity) < RETRY_S) return null;
    closing.set(k, t);
    return sys(a, [D({ sym: p.sym, side: opp(p.side), lots, ot: 'market', tif: 'GTC', posId: p.id, reason }, a)], [ev => { if (ev.kind !== 'fill') closing.delete(k); if (fn) fn(ev); }]);
  }

  /* ---------- exits: what an order carries for the position it opens ---------- */
  // c: the browser's order -> { exits } | refusal (the core's texts). est: the entry it is checked at (quote or price)
  function exitsOf(c, req, est) {
    const sym = req.sym, m = M(sym), q = qOk(sym), d = req.side === 'buy' ? 1 : -1, x = {};
    const n = (k, pos) => { if (c[k] == null) return true; if (!fin(c[k]) || (pos && !(c[k] > 0))) return false; x[k] = c[k]; return true; };
    if (!n('sl', true) || !n('tp', true)) return rej('PRICE_INVALID');
    if (!n('slPips', true) || !n('tpPips', true)) return no('PIPS', 'Stop and target distances must be positive pips');
    if (c.trail != null) { if (!fin(c.trail) || c.trail < 0) return no('TRAIL', 'Trailing distance must be positive pips'); if (c.trail > 0) x.trail = c.trail; }
    if (c.tps != null) { if (!Array.isArray(c.tps) || c.tps.length > 4) return rej('TPS_MAX', { max: 4 }); if (c.tps.length) x.tps = c.tps.map(r => ({ price: +r.price || undefined, lots: +r.lots || undefined, pips: +r.pips || undefined, pct: +r.pct || undefined })); }
    if (c.be != null) { const b = core.beSpec(c.be, q ? q.spread : m.spread, sym); if (b.err) return rej(b.code, b.a); if (b.be) x.be = b.be; }
    if (!q) return { exits: x };
    const sl = x.sl ?? (x.slPips ? est - d * x.slPips * m.pip : null), sa = { spread: q.spread.toFixed(1), unit: core.unitWord(sym) };
    if (req.ot === 'market' && sl != null && (d > 0 ? sl >= q.bid : sl <= q.ask)) return (d > 0 ? sl < est : sl > est) ? rej('SL_SPREAD', sa) : rej('SL_SIDE');
    if (x.trail && sl == null && x.trail <= q.spread) return rej('TRAIL_SPREAD', sa);
    if (x.tps) { const b = core.buildTps(sym, req.side, est, req.lots, x.tps.map(r => (r.price ? { price: r.price, lots: r.lots } : { pips: r.pips, pct: r.pct }))); if (b.err) return rej(b.code, b.a); }
    const tp = x.tp ?? (x.tpPips ? est + d * x.tpPips * m.pip : null);
    if (req.ot === 'market' && tp != null && !x.tps && (d > 0 ? tp <= q.bid : tp >= q.ask)) return rej('TP_SIDE');
    return { exits: x };
  }
  // a new position, from its opening fill: its journal and its prot (the broker created its stop loss and targets
  // from the exits the order carried; the gateway sends nothing here)
  function opened(a, pos, r, ent) {
    const x = ent.exits || {}, sym = r.sym, m = M(sym); if (!m) return;
    const d = r.side === 'buy' ? 1 : -1, entry = r.px, lots = r.lots;
    let sl = x.sl ?? (x.slPips ? entry - d * x.slPips * m.pip : null);
    const prot = {};
    if (x.trail) { prot.trail = x.trail; if (sl == null) { sl = core.trailNext(d, null, entry, x.trail * m.pip); prot.trailNow = true; prot.trailSl = rd(sym, sl); } }
    if (x.be) prot.be = { ...x.be, done: false };
    if (sl != null) sl = rd(sym, sl);
    let tp = x.tp ?? (x.tpPips ? entry + d * x.tpPips * m.pip : null);
    if (x.tps) {
      let rows = x.tps.map(t => (t.price ? { price: t.price, lots: t.lots } : { pips: t.pips, pct: t.pct }));
      if (rows[0].price && rows.reduce((s, t) => s + t.lots, 0) > lots + 1e-9) { const pp = { sym, lots, tps: rows.map(t => ({ ...t })) }; core.trimTps(pp); rows = pp.tps || []; }
      const b = rows.length ? core.buildTps(sym, r.side, entry, lots, rows) : { tps: null };
      if (!b.err && b.tps) tp = b.tps[0].price;
    }
    // the journal of a new position (behav.js openPosition): its stop and target at the open, context, pre-mortem
    const mt = { ...(ent.meta || {}), sl0: sl, tp0: tp != null ? rd(sym, tp) : null, news: [], mae: 0, mfe: 0 };
    if (mt.pm && mt.pm.timeStop > 0) mt.timeStop = mt.pm.timeStop;
    if (Object.keys(prot).length) mt.prot = prot;
    G.putMeta(a, pos, mt);
  }

  /* ---------- orders from the browser ---------- */
  // pmRisk (behav.js): the risk of an order at its stop, USD
  function riskOf(sym, side, lots, price, sl, slPips) {
    const m = M(sym), q = qOk(sym); if (!m || !q) return null;
    const d = side === 'buy' ? 1 : -1, entry = price ?? (d > 0 ? q.ask : q.bid), s = sl ?? (slPips ? entry - d * slPips * m.pip : null);
    return s == null ? null : Math.abs(entry - s) / m.pip * core.pipValue(sym, 1) * lots;
  }
  // chOpenRisk: open positions from the price to their stop (a stop in profit counts 0) and pending orders to theirs
  function openRisk(a) {
    let r = 0;
    for (const p of positions(a)) {
      const sl = linkOf(a, p.id, 'SL'), m = M(p.sym); if (!sl || !m || !qOk(p.sym)) continue;
      const d = p.side === 'buy' ? 1 : -1, x = core.posPnl(p).exit;
      r += Math.max(0, (x - sl.price) * d / m.pip * core.pipValue(p.sym, 1) * p.lots);
    }
    const om = S(a, 'ordMeta', {});
    for (const o of orders(a)) { if (o.linkPos != null) continue; const e = om[o.clOrdId]; if (!e || !e.exits) continue; const k = riskOf(o.sym, o.side, o.lots, o.price, e.exits.sl, e.exits.slPips); if (k != null) r += k; }
    return r;
  }
  // order(account, command, req (gateway orderReq), go(list, inTx)) -> reply | null
  function order(a, c, req, go) {
    if (off.has(a)) return offReply();
    let offs = null; // M7: several positions of the net book on the other side: each is offset, oldest first
    if (req.posId == null && !c.basket) {
      const book = netBook(a, req.sym), opps = book.filter(p => p.side !== req.side);
      if (req.ot === 'market' && opps.length > 1) {
        offs = []; let rem = req.lots;
        for (const p of opps) { if (!(rem > 1e-9)) break; const l = Math.min(p.lots, rem); offs.push([p, l]); rem = core.normLots(req.sym, rem - l); }
        const same = book.find(p => p.side === req.side);
        req.lots = rem; if (same) req.posId = same.id;
      } else {
        const o = opps[0] || book.find(p => p.side === req.side);
        if (o && req.ot === 'market') req.posId = o.id;
      }
      req.net = true;
    }
    const left = !offs || req.lots >= core.volOf(req.sym)[0] - 1e-9; // what is left after the offsets opens or adds
    const target = req.posId != null ? posOf(a, req.posId) : null;
    const closeOnly = !left || (target && target.side !== req.side && target.lots >= req.lots - 1e-9);
    const q = qOk(req.sym), est = req.ot === 'market' ? (q ? (req.side === 'buy' ? q.ask : q.bid) : null) : req.price;
    const ex = left ? exitsOf(c, req, est) : { exits: {} }; if (!ex.exits) return ex; // nothing opens: no exits to check
    const chal = S(a, 'chal');
    if (!closeOnly && chal?.att?.status === 'active') {
      const r = riskOf(req.sym, req.side, req.lots, req.ot === 'market' ? null : req.price, ex.exits.sl, ex.exits.slPips);
      if (r != null) {
        const eq = equity(a), f = eq == null ? null : floors(chal.att, eq), other = openRisk(a);
        if (f && r + other >= f.room) return no('CHAL_BLOCK', other > 0
          ? `Challenge: a stop-out here would breach the ${f.which} limit — ${core.usdFmt(r)} at risk on this order plus ${core.usdFmt(other)} on open positions and pending orders, ${core.usdFmt(f.room)} of room left.`
          : `Challenge: a stop-out here would breach the ${f.which} limit — ${core.usdFmt(r)} at risk, ${core.usdFmt(f.room)} of room left.`);
      }
    }
    const jm = {};
    if (c.pm && typeof c.pm === 'object' && !Array.isArray(c.pm)) jm.pm = c.pm;
    if (Array.isArray(c.ctx)) jm.ctx = c.ctx.filter(s => typeof s === 'string').slice(0, 20).map(s => s.slice(0, 40));
    if (JSON.stringify(jm).length > 8000) return no('BAD_REQUEST', 'Journal fields too large');
    const ent = { t: nowS(), sym: req.sym, side: req.side, lots: req.lots, ot: req.ot, exits: ex.exits, meta: jm };
    const list = (offs || []).map(([p, l]) => ['D', cl => FX.orderToD({ sym: req.sym, side: req.side, lots: l, ot: 'market', tif: 'GTC', posId: p.id }, cl, a, OPTS)]);
    if (left) list.push(['D', cl => FX.orderToD({ ...req, ...dExits(ex.exits) }, cl, a, OPTS)]); // the exits go with the order (I5)
    return go(list, cls => { if (!left) return; const om = S(a, 'ordMeta', {}); om[cls[cls.length - 1]] = ent; G.putState(a, 'ordMeta', om); });
  }

  /* ---------- modify: a position's stop, target, legs, trail, break-even; a working order's price, expiry, exits ---------- */
  /* the rules of today's level editor (core.modify: a stop below the bid / above the ask, a target on the other side, a
     pending price on its side of the market and past the sheet's minimum distance, a stop-limit's limit beyond its stop,
     every target leg on the profit side), checked on a copy of the mirror's position or order before anything goes out:
     a refused level comes back with today's text. Nothing is applied here (the copy is thrown away). */
  function levelCheck(a, c) {
    const fx = v => (v === undefined ? undefined : v);
    if (c.id != null) {
      const o = mirror.get(a)?.orders.get(c.id); if (!o || o.linkPos != null || !qOk(o.sym)) return null;
      const x = { orderId: 1 };
      if (c.price !== undefined) x.price = fx(c.price);
      if (c.limit !== undefined && o.ot === 'stoplimit') x.limit = fx(c.limit);
      for (const k of ['slPips', 'tpPips']) if (c[k] !== undefined) x[k] = fx(c[k]); // the exits of a pending order: the same checks as the browser's
      if (!('price' in x) && !('limit' in x) && !('slPips' in x) && !('tpPips' in x)) return null;
      const r = core.modify({ positions: [], orders: [{ id: 1, sym: o.sym, side: o.side, lots: o.lots, ot: o.ot === 'stoplimit' ? 'stop' : o.ot, price: o.price, limit: o.ot === 'stoplimit' ? o.limit : null }] }, x);
      return r.ok ? null : { ok: false, code: r.code, text: r.why };
    }
    const p = posOf(a, c.posId); if (!p || !qOk(p.sym)) return null;
    const x = { posId: p.id };
    for (const k of ['sl', 'tp']) if (c[k] !== undefined && c[k] !== null) x[k] = c[k];
    if (Array.isArray(c.tps) && c.tps.length && c.tps.every(r => r && r.pips != null)) x.tps = c.tps.map(r => ({ pips: +r.pips, pct: +r.pct }));
    if (Object.keys(x).length === 1) return null;
    const r = core.modify({ positions: [{ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, sl: null, tp: null, trail: 0 }], orders: [] }, x);
    return r.ok ? null : { ok: false, code: r.code, text: r.why };
  }
  function modify(a, c, go) {
    if (off.has(a)) return offReply();
    { const bad = levelCheck(a, c); if (bad) return bad; }
    if (c.id != null) {
      const m0 = mirror.get(a)?.orders.get(c.id); if (!m0) return rej('NO_ORDER');
      // a G of this order not answered yet: this one builds on its terms and goes against its ClOrdID (Gr / eff)
      const cur = eff(a, m0.clOrdId), pt = pendT.get(a + '\n' + cur), o = pt ? { ...m0, ...pt, clOrdId: m0.clOrdId } : m0;
      const t = { sym: o.sym, side: o.side, lots: o.lots, ot: o.ot, price: o.price, tif: o.tif || 'GTC' };
      for (const k of ['posId', 'linkPos', 'leg', 'oca', 'net']) if (o[k] != null) t[k] = o[k];
      if (o.tif === 'GTD') t.expires = o.expires;
      if (o.ot === 'stoplimit') t.limit = o.limit;
      let ch = false;
      if (c.price !== undefined) { if (!fin(c.price) || !(c.price > 0)) return rej('PRICE_INVALID'); t.price = c.price; ch = true; }
      if (c.limit !== undefined && o.ot === 'stoplimit') { if (!fin(c.limit) || !(c.limit > 0)) return rej('LIMIT_INVALID'); t.limit = c.limit; ch = true; }
      // the OCO group: an order placed to cancel this one (the ticket's OCO with an order already working) joins it here
      if (c.oca !== undefined) { const g = c.oca == null || c.oca === '' ? null : String(c.oca).slice(0, 40); if (g) t.oca = g; else delete t.oca; if (g !== (o.oca ?? null)) ch = true; }
      if (c.tif !== undefined || c.expires !== undefined) {
        const tif = c.tif ?? t.tif; if (!['GTC', 'DAY', 'GTD'].includes(tif)) return no('TIF', 'Time in force must be GTC, DAY or GTD');
        if (tif === 'GTD') { if (!fin(c.expires ?? t.expires) || !((c.expires ?? t.expires) >= nowS() + 60)) return rej('EXPIRY'); t.expires = c.expires ?? t.expires; } else delete t.expires;
        t.tif = tif; ch = true;
      }
      // the exits it brings to its position (kept here, sent when it fills)
      const om = S(a, 'ordMeta', {}), omKey = om[cur] ? cur : o.clOrdId, ent = om[omKey] || { t: nowS(), sym: o.sym, side: o.side, lots: o.lots, ot: o.ot, exits: {}, meta: {} };
      let ex = null;
      if (['sl', 'tp', 'slPips', 'tpPips', 'trail', 'tps', 'be'].some(k => c[k] !== undefined)) {
        const merged = { ...ent.exits }; for (const k of ['sl', 'tp', 'slPips', 'tpPips', 'trail', 'tps', 'be']) if (c[k] !== undefined) { if (c[k] === null) delete merged[k]; else merged[k] = c[k]; }
        const r = exitsOf(merged, { sym: o.sym, side: o.side, lots: o.lots, ot: o.ot }, t.price); if (!r.exits) return r;
        ex = r.exits;
      }
      // a G is the order in full: it carries the exits (changed, or as they are), else the broker would drop them
      Object.assign(t, dExits(ex || (om[omKey] ? ent.exits : o)));
      if (ex) ch = true;
      const keep = cls => { if (!ex) return; const m = S(a, 'ordMeta', {}), e = { ...ent, exits: ex }; if (cls && cls[0]) { delete m[o.clOrdId]; delete m[cur]; m[cls[0]] = e; } else m[omKey] = e; G.putState(a, 'ordMeta', m); };
      if (!ch) return { ok: true, id: o.clOrdId };
      return go([Gr(t, o.clOrdId, a)], keep);
    }
    const p = posOf(a, c.posId); if (!p) return rej('NO_POS');
    const m = M(p.sym), q = qOk(p.sym), d = p.side === 'buy' ? 1 : -1, list = [], mt = meta(a, p.id), prot = { ...(mt.prot || {}) };
    let protCh = false;
    const leg = l => linkOf(a, p.id, l);
    const put = (lg, ot, price, lots, reason) => { const l = leg(lg), t = { sym: p.sym, side: opp(p.side), lots: lots ?? (l ? l.lots : p.lots), ot, price, tif: 'GTC', linkPos: p.id, leg: lg, ...(reason ? { reason } : {}) }; list.push(l ? Gr(t, l.clOrdId, a) : D(t, a)); };
    if ('sl' in c) {
      if (c.sl === null) { const l = leg('SL'); if (l) list.push(F(l, a)); delete prot.trailNow; protCh = true; }
      else { if (!fin(c.sl) || !(c.sl > 0)) return rej('PRICE_INVALID'); put('SL', 'stop', c.sl); delete prot.beSl; prot.trailed = false; protCh = true; }
    }
    if ('tp' in c && !('tps' in c)) {
      if (c.tp === null) { for (const o of orders(a).filter(o => o.linkPos === p.id && /^TP/.test(o.leg || ''))) list.push(F(o, a)); }
      else { if (!fin(c.tp) || !(c.tp > 0)) return rej('PRICE_INVALID'); put('TP1', 'limit', c.tp); }
    }
    if ('tps' in c) {
      const have = orders(a).filter(o => o.linkPos === p.id && /^TP/.test(o.leg || '')).sort((x, y) => x.leg.localeCompare(y.leg));
      if (c.tps === null || (Array.isArray(c.tps) && !c.tps.length)) for (const o of have) list.push(F(o, a));
      else {
        if (!Array.isArray(c.tps)) return rej('TPS_ROWS');
        const b = core.buildTps(p.sym, p.side, p.entry, p.lots, c.tps.map(r => (r && r.price ? { price: +r.price, lots: +r.lots } : { pips: +(r && r.pips), pct: +(r && r.pct) })));
        if (b.err) return rej(b.code, b.a);
        for (const l of b.tps) if (q && !(d > 0 ? l.price > q.bid : l.price < q.ask)) return rej('MOD_TP_SIDE', { dir: d > 0 ? 'above' : 'below', ref: d > 0 ? 'bid' : 'ask' });
        // the legs in order: the first ones replace what is there (a plain target becomes TP1 of the set), the rest are new
        // the legs no longer wanted go first, so the sizes never add up past the position at the broker
        for (const o of have.slice(b.tps.length)) list.push(F(o, a));
        // then the replaces that shrink a leg, the ones that grow it, the new legs
        b.tps.map((l, i) => [l, have[i]]).sort(([x, o], [y, q]) => (o ? 0 : 1) - (q ? 0 : 1) || (o ? x.lots - o.lots : 0) - (q ? y.lots - q.lots : 0)).forEach(([l, o]) => {
          const t = { sym: p.sym, side: opp(p.side), lots: l.lots, ot: 'limit', price: rd(p.sym, l.price), tif: 'GTC', linkPos: p.id, leg: o ? o.leg : l.leg }; list.push(o ? Gr(t, o.clOrdId, a) : D(t, a));
        });
      }
    }
    if ('trail' in c) {
      const v = Math.max(0, +c.trail || 0);
      if (v > 0 && q && v <= q.spread) return rej('TRAIL_SPREAD', { spread: q.spread.toFixed(1), unit: core.unitWord(p.sym) });
      prot.trail = v; protCh = true;
      if (!v) { delete prot.trailNow; delete prot.trailSl; }
      else if (!leg('SL') && !('sl' in c) && q) { // a trail without a stop is the stop at once
        const s = rd(p.sym, core.trailNext(d, null, d > 0 ? q.bid : q.ask, v * m.pip)); put('SL', 'stop', s, p.lots); prot.trailNow = true; prot.trailSl = s;
      }
    }
    if ('be' in c) {
      if (c.be === null) delete prot.be;
      else { const b = core.beSpec(c.be, q ? q.spread : m.spread, p.sym); if (b.err) return rej(b.code, b.a); if (b.be) prot.be = b.be; else delete prot.be; }
      protCh = true;
    }
    const keep = () => { if (protCh) putMeta(a, p.id, { ...meta(a, p.id), prot }); };
    if (!list.length) { if (protCh) store.tx(keep); return { ok: true, id: null }; }
    return go(list, keep);
  }

  /* ---------- the broker's reports (in the session's transaction, before the mirror applies them) ---------- */
  function onExec(a, ev, before) {
    const cl = ev.ids.clOrdId, fn = wait.get(cl);
    if (fn && ev.kind !== 'restated') { wait.delete(cl); try { fn(ev); } catch (e) { log(`oms: result handler failed (${e.message})`); } }
    if (ev.kind === 'replaced' || ev.kind === 'cancel') { unrepl(a, ev.ids.origClOrdId); pendT.delete(a + '\n' + cl); } else if (ev.kind === 'reject') unrepl(a, null, cl);
    const om = S(a, 'ordMeta');
    // an order with no ordMeta (migrated before I6, or sent elsewhere): its reported terms say its exits
    let ent = om && om[cl];
    if (!ent && ev.kind === 'fill' && ev.receipt.kind === 'open' && before && before.linkPos == null) { const x = dExits(before); if (Object.keys(x).length) ent = { exits: x, meta: {} }; }
    if (ev.kind === 'fill') {
      const r = ev.receipt, chal = S(a, 'chal'), att = chal?.att;
      if (att?.status === 'active') { att.day.n++; G.putState(a, 'chal', chal); }
      // an order in flight when the attempt breached: what it opened is flattened with the rest
      else if (att?.status === 'breached' && att.end?.inflight?.includes(cl) && (r.kind === 'open' || r.kind === 'add') && !att.end.wait?.includes(r.pos)) { (att.end.wait = att.end.wait || []).push(r.pos); W(a, 'chal', chal); }
      // a target leg filled part of the position: break-even after TP1 is armed
      if (before && before.linkPos != null && /^TP/.test(before.leg || '') && r.kind === 'reduce') protect(a, before.linkPos, true);
      // a basket leg closed: its realised P/L joins the group's record
      if (r.kind === 'close' || r.kind === 'reduce') bkReal(a, r);
      if (r.kind === 'close') closing.delete(a + ':' + r.pos);
      if (ent && om) {
        if (r.kind === 'open') { opened(a, r.pos, r, ent); delete om[cl]; }
        // a reversal (a market order on the 721, or a pending one netting on the book) waits for its remainder
        else if (!((r.kind === 'close' || r.kind === 'reduce') && r.lots < ent.lots - 1e-9)) delete om[cl];
        G.putState(a, 'ordMeta', om);
      } else if (ent && r.kind === 'open') opened(a, r.pos, r, ent);
    } else if (ev.kind === 'replaced' && ev.ids.origClOrdId && om && om[ev.ids.origClOrdId]) { om[cl] = om[ev.ids.origClOrdId]; delete om[ev.ids.origClOrdId]; G.putState(a, 'ordMeta', om); }
    else if ((ev.kind === 'reject' || ev.kind === 'cancel') && om && (ent || om[ev.ids.origClOrdId])) { delete om[cl]; if (ev.ids.origClOrdId) delete om[ev.ids.origClOrdId]; G.putState(a, 'ordMeta', om); }
    if (ev.kind === 'fill' || ev.kind === 'reject') {
      // a basket leg (after its exits are attached), a ½ close
      bkResolve(a, cl, ev.kind === 'fill' ? { ok: true, pos: ev.receipt.pos } : { ok: false, text: ev.text || 'refused' });
      const list = bkList(a, 'bkPos'), g = list.find(x => x.halving?.cls?.includes(cl));
      if (g) { if (g.halving.plan?.[cl]) g.halving.plan[cl].res = ev.kind === 'fill';
        if (ev.kind === 'reject') notice(a, { kind: 'basket', gid: g.gid, text: `Half close of a leg was refused: ${ev.text || 'refused'} — that leg keeps its size` }); g.halving.cls = g.halving.cls.filter(c => c !== cl); if (!g.halving.cls.length) bkHalfDone(a, list, g); bkSave(a, 'bkPos', list); }
    }
  }
  // at every logon (the mirror rebuilt): baskets opening when the gateway stopped, journals of positions gone meanwhile
  function rebuilt() {
    const t = Math.floor(nowS());
    for (const a of accounts()) {
      try {
        store.tx(() => {
          bkReconcile(a);
          for (const [id, m] of G.metaAll(a)) if (m.closedAt == null && !posOf(a, id)) G.putMeta(a, id, { ...m, closedAt: t });
        });
      } catch (e) { log(`oms: reconcile of ${a} failed (${e.message})`); }
    }
  }
  function onCxlReject(r) {
    const a = r.account, k = a + '\n' + r.clOrdId, on = sentOn.get(k), t = pendT.get(k);
    if (r.code === 'NO_ORDER' && on && t && refused.has(a + '\n' + on)) { // chained on a G the broker refused: once more, against its root
      const root = sentOn.get(a + '\n' + on) ?? on; unrepl(a, null, r.clOrdId); refused.delete(k);
      const fn = wait.get(r.clOrdId); wait.delete(r.clOrdId);
      const cls = sys(a, [Gr(t, root, a)], [fn]); if (cls) return cls[0]; // the caller moves the command to the new ClOrdID
      if (fn) { try { fn({ kind: 'cxlReject', code: r.code, text: r.text }); } catch (e) {} } return null;
    }
    unrepl(a, null, r.clOrdId); const fn = wait.get(r.clOrdId); if (fn) { wait.delete(r.clOrdId); try { fn({ kind: 'cxlReject', code: r.code, text: r.text }); } catch (e) { log(`oms: result handler failed (${e.message})`); } } }
  // a flat AP: the journal stays 90 days (history rows keep their own copy), then G.prune drops it
  function onFlat(a, id) { const m = G.meta(a, id); if (m && m.closedAt == null) G.putMeta(a, id, { ...m, closedAt: Math.floor(nowS()) }); }

  /* ---------- trailing and break-even ---------- */
  const lastG = new Map(), pending = new Set(); // per position: the last move sent, one in flight
  // the stop a position should have now (trade.js checkTriggers), sent when it tightens; byTp: a target just filled.
  // rec: { hi, lo } from the bars of a pause (recovery: no throttle, the extremes instead of the quote)
  function protect(a, posId, byTp = false, rec = null) {
    const p = posOf(a, posId); if (!p) return;
    const mt = G.meta(a, p.id); if (!mt || !mt.prot) return;
    const prot = mt.prot, m = M(p.sym), q = qOk(p.sym); if (!m || !q || !q.open) return;
    const k = a + ':' + p.id, d = p.side === 'buy' ? 1 : -1, cur = d > 0 ? q.bid : q.ask, px = rec ? (d > 0 ? rec.hi : rec.lo) : cur;
    const l = linkOf(a, p.id, 'SL'), sl = l ? l.price : null;
    let ch = false, n = null, why = null;
    if (byTp && prot.be && !prot.be.done && prot.be.onTp && !prot.be.tpHit) { prot.be.tpHit = true; ch = true; }
    // no move on a stale feed or a link that is not up (the TP fill only arms the rule then)
    if (!market.feedAlive() || !up() || pending.has(k) || (!rec && Date.now() - (lastG.get(k) ?? -Infinity) < TRAIL_MS)) { if (ch) G.putMeta(a, p.id, mt); return; }
    if (prot.trail > 0) {
      const dist = prot.trail * m.pip;
      if (prot.trailNow && sl != null && rd(p.sym, sl) !== rd(p.sym, prot.trailSl ?? NaN)) { delete prot.trailNow; ch = true; } // the stop was moved: it is the user's now
      if (prot.trailNow) { const x = core.trailNext(d, sl, px, dist); if (sl == null || d * (x - sl) > 0) { n = x; why = 'trail'; } }
      else { const x = core.trailNext(d, null, px, dist); if (d * (x - p.entry) >= 0 && (sl == null || d * (x - sl) > 0)) { n = x; why = 'trail'; } }
    }
    const b = prot.be;
    if (b && !b.done) {
      const lvl = core.beLevel(b, d, p.entry, px, m.pip);
      if (lvl != null) {
        const at = n ?? sl;
        if (at != null && d * (lvl - at) <= 0) { b.done = true; ch = true; }
        else if (d > 0 ? lvl < q.bid : lvl > q.ask) { n = lvl; why = 'be'; }
      }
    }
    if (n != null) {
      n = rd(p.sym, n);
      // only tighter, and past the current quote (else the broker would refuse it, or fill it at once)
      if ((sl != null && d * (n - sl) <= 0) || !(d > 0 ? n < q.bid : n > q.ask)) { if (rec && why) log(`oms: ${a} #${p.id} recovered ${why} stop ${n} is past the price, kept ${sl}`); n = null; }
    }
    if (n == null) { if (ch) G.putMeta(a, p.id, mt); return; }
    const was = clone(prot), reason = why === 'be' ? 'Stop loss (break-even)' : 'Trailing stop';
    const t = { sym: p.sym, side: opp(p.side), lots: l ? l.lots : p.lots, ot: 'stop', price: n, tif: 'GTC', linkPos: p.id, leg: 'SL', reason };
    if (why === 'be') { b.done = true; prot.beSl = n; prot.trailed = false; } else { prot.trailed = true; if (prot.trailNow) prot.trailSl = n; }
    const cls = sys(a, [l ? Gr(t, l.clOrdId, a) : D(t, a)], [ev => { // the replace, or the new leg's acknowledgement
      pending.delete(k);
      if (ev.kind === 'reject' || ev.kind === 'cxlReject') { const x = G.meta(a, p.id); if (x) G.putMeta(a, p.id, { ...x, prot: was }); }
      else if (why === 'be') notice(a, { kind: 'be', pos: p.id, text: `Stop moved to break-even · ${p.sym} #${p.id} · SL ${n}` }); // on the broker's ack
    }]);
    if (!cls) return;
    pending.add(k); lastG.set(k, Date.now());
    putMeta(a, p.id, mt);
  }

  /* ---------- baskets (basket.js) ---------- */
  const idx = b => { const L = norm(b.long), Sx = norm(b.short); let v = 0; for (const [k, w] of Object.entries(L)) v += w * Math.log(market.usd(k)); for (const [k, w] of Object.entries(Sx)) v -= w * Math.log(market.usd(k)); return v; };
  function legMap(b, lots, side) {
    const L = norm(b.long), Sx = norm(b.short), legs = {}, sg = side === 'buy' ? 1 : -1, P = PAIRS.map(M).filter(Boolean);
    const add = (x, y, w) => {
      let p = P.find(m => m.base === x && m.quote === y); if (p) { legs[p.sym] = (legs[p.sym] || 0) + w / market.usd(x); return true; }
      p = P.find(m => m.base === y && m.quote === x); if (p) { legs[p.sym] = (legs[p.sym] || 0) - w / market.usd(y); return true; }
      return false;
    };
    for (const [x, wa] of Object.entries(L)) for (const [y, wc] of Object.entries(Sx)) { if (x === y) continue; const w = wa * wc * lots * sg; if (!add(x, y, w)) { add(x, 'USD', w); add('USD', y, w); } }
    return legs;
  }
  const legsOf = (b, lots, side) => Object.entries(legMap(b, lots, side)).map(([sym, v]) => ({ sym, side: v > 0 ? 'buy' : 'sell', lots: Math.round(Math.abs(v) * 100) / 100 })).filter(l => l.lots >= .01).sort((x, y) => y.lots - x.lots);
  function costOf(a, legs, lots) {
    const set = setOf(a), usd = legs.reduce((s, l) => { const q = qOk(l.sym); return s + (q ? q.spread * core.pipValue(l.sym, 1) * l.lots : 0) + core.commOf(set, l.lots, l.sym); }, 0);
    return lots ? usd / (lots * 1e5) * 1e4 : 0;
  }
  const groupLegs = (a, g) => positions(a).filter(p => meta(a, p.id).bgid === g.gid);
  function groupState(a, g) { const legs = groupLegs(a, g); return { n: legs.length, legs, pnl: legs.reduce((s, p) => s + pnlOf(p), 0), mv: g.long && g.short ? (g.side === 'buy' ? 1 : -1) * (idx(g) - g.v0) * 1e4 : null }; }
  const stopParts = g => { const cost = g.cost || 0; return { sl: g.sl ? -g.sl : -Infinity, be: g.beSet || (g.be && g.pk >= g.be && g.pk > cost) ? cost : -Infinity, tr: g.trail ? g.pk - g.trail : -Infinity }; };
  const stopMv = g => { const p = stopParts(g), s = Math.max(p.sl, p.be, p.tr); return Number.isFinite(s) ? s : null; };
  const stopKind = g => { const p = stopParts(g), s = Math.max(p.sl, p.be, p.tr); return !Number.isFinite(s) ? null : s === p.tr && s > p.be && s > p.sl ? 'trail' : s === p.be && s > p.sl ? 'be' : 'sl'; };
  const bkList = (a, k) => S(a, k, []);
  function bkSave(a, k, list) { W(a, k, list); }
  // a closing fill of a basket leg: its P/L net of its share of the commission (bkFinish counts h.pnl − h.comm)
  function bkReal(a, r) {
    const p = posOf(a, r.pos); if (!p) return;
    const mt = G.meta(a, p.id); if (!mt || !mt.bgid) return;
    const list = bkList(a, 'bkPos'), g = list.find(x => x.gid === mt.bgid), m = M(p.sym); if (!g || !m) return;
    const d = p.side === 'buy' ? 1 : -1, fr = Math.min(1, r.lots / p.lots), u = market.usd(m.quote);
    const pnl = (r.px - p.entry) * d * r.lots * m.size * (fin(u) ? u : 1) + (p.swap || 0) * fr - (p.comm || 0) * fr;
    g.real = (g.real || 0) + pnl; G.putState(a, 'bkPos', list);
  }
  function bkFinish(a, list, g, reason) {
    const hist = bkList(a, 'bkHist'), row = { gid: g.gid, name: g.name, side: g.side, t0: g.t0, t1: nowS(), pnl: g.real || 0, mfe: g.pk || 0, mae: g.mae || 0, sl: g.sl, reason, risk: g.risk };
    if (g.long && g.short) row.mv = (g.side === 'buy' ? 1 : -1) * (idx(g) - g.v0) * 1e4;
    const i = list.indexOf(g); if (i >= 0) list.splice(i, 1);
    if (g.rollback) return notice(a, { kind: 'basket', gid: g.gid, reason, text: `${g.name}: the filled legs are closed (rollback)` }); // never opened: no record
    hist.unshift(row); if (hist.length > 60) hist.length = 60;
    bkSave(a, 'bkHist', hist);
    notice(a, { kind: 'basket', gid: g.gid, reason, text: `${g.name}: ${BK_WHY[reason] || reason.toLowerCase()}`, pnl: row.pnl, mv: row.mv ?? null });
  }
  function bkCloseGroup(a, g, reason, ps = groupLegs(a, g)) {
    g.closing = reason; g.retryAt = nowS();
    for (const p of ps) closePos(a, p, reason, p.lots, ev => {
      if (ev.kind === 'reject' || ev.kind === 'cxlReject') { const list = bkList(a, 'bkPos'), x = list.find(y => y.gid === g.gid); if (x) { x.pendWhy = String(ev.text || 'a leg was not closed').slice(0, 300); bkSave(a, 'bkPos', list); } }
    });
  }
  /* A basket order: N legs, each its own position (no 721, no net) with a disaster stop; all or nothing (rollback).
     Restart-safe: the leg D's, gw_state bkOpening[gid] { cid, cls, legs, … } and the command's gw_cid row commit
     together; each leg's ER resolves it by ClOrdID (onExec, after the leg's exits are attached), and a logon
     reconciles what is left from gw_exec (a ClOrdID with no report there was never executed). */
  function bkOpen(a, b, side, sz, extra, cid = null) {
    const q0 = qOk('EURUSD');
    if (!q0 || !q0.open) return no('MARKET_CLOSED', `${b.name}: ${q0 ? q0.why || 'market closed' : 'no quote'}. No leg was sent.`);
    const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), snap = { long: norm(b.long), short: norm(b.short) }, legs = legsOf(snap, sz.lots, side);
    if (!legs.length) return no('BASKET_EMPTY', `${b.name}: no leg at this size`);
    const v0 = idx(snap), cost = costOf(a, legs, sz.lots), dsl = sz.sl ? 3 * sz.sl / 1e4 : 0;
    if (!fin(v0)) return no('NO_QUOTE', `${b.name}: no quote for every currency of the basket. No leg was sent.`);
    const ents = legs.map(l => { const q = qOk(l.sym), ref = q ? (l.side === 'buy' ? q.ask : q.bid) : 0; return { t: nowS(), sym: l.sym, side: l.side, lots: l.lots, ot: 'market', exits: dsl && q ? { slPips: Math.max(dsl * ref, 3 * (q.ask - q.bid)) / M(l.sym).pip } : {}, meta: { basket: b.id, bgid: gid, ctx: extra.ctx || [] } }; });
    let cls = null;
    store.tx(() => {
      cls = sys(a, legs.map((l, i) => D({ sym: l.sym, side: l.side, lots: l.lots, ot: 'market', tif: 'GTC', reason: 'Basket order', ...dExits(ents[i].exits) }, a))); // the disaster stop goes with the leg
      if (!cls) return;
      const om = S(a, 'ordMeta', {}); cls.forEach((cl, i) => { om[cl] = ents[i]; }); G.putState(a, 'ordMeta', om);
      const op = S(a, 'bkOpening', {});
      op[gid] = { gid, cid, t: nowS(), cls, res: {}, legs, b: { id: b.id, name: b.name }, side, sz, extra: { pm: extra.pm || null, trail: +extra.trail || 0, be: +extra.be || 0 }, snap, v0, cost };
      G.putState(a, 'bkOpening', op);
      if (cid) G.putCid(a, cid, { op: 'basket', cls, res: {}, reply: null });
    });
    return cls ? null : no('LINK_DOWN', 'Execution server unreachable');
  }
  // the result of one leg (a fill, a refusal); the basket settles once every leg has one
  function bkResolve(a, cl, r) {
    const op = S(a, 'bkOpening'); if (!op) return;
    const e = Object.values(op).find(x => x.cls.includes(cl)); if (!e || e.res[cl]) return;
    e.res[cl] = r;
    if (e.cls.every(c => e.res[c])) { delete op[e.gid]; bkSettle(a, e); }
    G.putState(a, 'bkOpening', Object.keys(op).length ? op : null);
  }
  function bkSettle(a, e) {
    const rs = e.cls.map((c, i) => ({ ...e.res[c], leg: e.legs[i] })), opened = rs.filter(r => r.ok), why = (rs.find(r => !r.ok) || {}).text || '', name = e.b.name;
    const done = r => (e.cid ? finish(a, e.cid, r) : notice(a, { kind: 'basket', text: r.ok ? `${name}: ${e.side} basket filled` : r.text, ok: !!r.ok }));
    if (!opened.length) return done(no('NOT_FILLED', `${name}: none of the ${e.legs.length} legs filled${why ? ` (${why})` : ''}.`));
    const g = { gid: e.gid, bid: e.b.id, name, side: e.side, lots: e.sz.lots, v0: e.v0, t0: nowS(), sl: e.sz.sl || null, tp: e.sz.tp || null, trail: e.extra.trail, be: e.extra.be, pk: 0, mae: 0,
      risk: e.sz.risk ?? null, pm: e.extra.pm, timeStop: e.extra.pm?.timeStop || 0, long: e.snap.long, short: e.snap.short, cost: e.cost, legs: opened.map(r => ({ id: r.pos, lots: r.leg.lots })), real: 0 };
    const list = bkList(a, 'bkPos'); list.push(g);
    // not every leg filled: the filled ones close again; the group stays in the book as "closing" until none is left
    if (opened.length < e.legs.length) { g.rollback = true; bkCloseGroup(a, g, 'Basket rollback', opened.map(r => ({ id: r.pos, sym: r.leg.sym, side: r.leg.side, lots: r.leg.lots }))); }
    bkSave(a, 'bkPos', list);
    done(opened.length < e.legs.length ? no('PARTIAL', `Not opened: ${opened.length} of ${e.legs.length} legs filled, the filled legs are being closed${why ? ` · ${why}` : ''}`) : { ok: true, id: e.gid, legs: g.legs.length });
  }
  // after a logon: a leg the broker never reported is a leg never executed (its D was lost or refused as stale)
  function bkReconcile(a) {
    const op = S(a, 'bkOpening'); if (!op) return;
    for (const e of Object.values(op)) for (const cl of e.cls) {
      if (e.res[cl]) continue;
      const x = G.lastExec(a, cl);
      bkResolve(a, cl, x && x.kind === 'fill' ? { ok: true, pos: x.receipt.pos } : { ok: false, text: x?.text || 'not executed (gateway restart)' });
    }
  }
  // ½ of a basket: its closes (ClOrdIDs) kept in the group, done when each has a result, or 30 s after (a restart)
  // the legs as each close left them (an answer: its planned size; none, after a restart: the position as it is)
  function bkHalfDone(a, list, g) {
    const plan = g.halving.plan || {}, by = new Map(Object.values(plan).map(x => [x.id, x]));
    g.legs = (g.legs || []).map(l => { const x = by.get(l.id), p = posOf(a, l.id); return x && x.res != null ? { id: l.id, lots: x.res ? x.left : l.lots } : { id: l.id, lots: p ? p.lots : 0 }; }).filter(l => l.lots > 0);
    delete g.halving; g.lots /= 2; if (g.risk) g.risk /= 2;
  }
  function bkMonitor(a, t) {
    const q0 = qOk('EURUSD'), open = !!(q0 && q0.open);
    const al = bkList(a, 'bkAlerts');
    if (al.length) {
      const left = al.filter(x => { if (!x.long || !x.short) return true; const v = idx(x); if (!(v >= x.up || v <= x.dn)) return true; notice(a, { kind: 'bkAlert', text: `${x.name} ${v >= x.up ? 'up' : 'down'} ${x.bp} bp`, alert: x }); return false; });
      if (left.length !== al.length) bkSave(a, 'bkAlerts', left);
    }
    const bo = bkList(a, 'bkOrders');
    if (open && bo.length) {
      const left = [];
      for (const o of bo) {
        if (!o.long || !o.short || o.dir * (idx(o) - o.trig) < 0) { left.push(o); continue; }
        // no cid: the result is told as a notice (bkSettle); the order leaves the book in the commit of its legs
        const r = bkOpen(a, { id: o.bid, name: o.name, long: o.long, short: o.short }, o.side, o.sz, { pm: o.pm, ctx: (o.flags || []).map(f => (Array.isArray(f) ? f[0] : f)), trail: o.trail, be: o.be });
        if (r) notice(a, { kind: 'basket', text: r.text, ok: false });
      }
      if (left.length !== bo.length) bkSave(a, 'bkOrders', left);
    }
    const list = bkList(a, 'bkPos'); if (!list.length) return;
    let ch = false, soft = false;
    for (const g of [...list]) {
      const st = groupState(a, g);
      if (g.closing) {
        if (!st.n) { bkFinish(a, list, g, g.closing); ch = true; }
        else if (open && t - (g.retryAt ?? -Infinity) >= RETRY_S) { bkCloseGroup(a, g, g.closing); ch = true; }
        continue;
      }
      if (g.halving) { if (t - g.halving.t > 30) { bkHalfDone(a, list, g); ch = true; } continue; } // a restart lost some answers
      if (!st.n) { bkFinish(a, list, g, 'Legs closed'); ch = true; continue; }
      if (!Array.isArray(g.legs) || !g.legs.length) { g.legs = st.legs.map(p => ({ id: p.id, lots: p.lots })); ch = true; }
      if (g.legs.some(l => !st.legs.some(p => p.id === l.id && p.lots >= l.lots - 1e-9))) { // bkSplit
        for (const p of st.legs) { const x = { ...meta(a, p.id) }; delete x.bgid; delete x.basket; putMeta(a, p.id, x); }
        send(a, st.legs.map(p => ['U1', () => FX.unhedgeToU1(a, p.id)])); // the broker nets them with the net book again
        list.splice(list.indexOf(g), 1); ch = true;
        notice(a, { kind: 'basket', gid: g.gid, text: `${g.name}: basket split`, split: true });
        continue;
      }
      if (st.mv == null || !open) continue;
      // best and worst move: kept in memory every tick, written at most once a second (a close writes at once)
      const mem = pkMem.get(g.gid) || {}, pk = Math.max(g.pk || 0, mem.pk ?? -Infinity, st.mv), mae = Math.min(g.mae || 0, mem.mae ?? Infinity, st.mv);
      if (pk !== g.pk || mae !== g.mae) { g.pk = pk; g.mae = mae; pkMem.set(g.gid, { pk, mae }); soft = true; }
      const sm = stopMv(g);
      if (sm != null && st.mv <= sm) { const k = stopKind(g); bkCloseGroup(a, g, k === 'trail' ? 'Basket trail' : k === 'be' ? 'Break-even' : 'Basket stop'); ch = true; }
      else if (g.tp && st.mv >= g.tp) { bkCloseGroup(a, g, 'Basket target'); ch = true; }
      else if (g.timeStop && t - g.t0 >= g.timeStop) { if (st.pnl <= 0) bkCloseGroup(a, g, 'Time stop'); else g.timeStop = 0; ch = true; }
    }
    if (ch || (soft && Date.now() - (bkWritten.get(a) ?? 0) >= 1000)) { bkSave(a, 'bkPos', list); bkWritten.set(a, Date.now()); }
  }
  const pkMem = new Map(), bkWritten = new Map();
  // the basket command: do = open | place | cancel | edit | be | half | close | alert | alertDel
  function basket(a, c, done) {
    if (off.has(a)) return offReply();
    const list = bkList(a, 'bkPos'), g = c.gid != null ? list.find(x => x.gid === c.gid) : null;
    const comp = () => (ccyOk(c.long) && ccyOk(c.short) ? { id: str(c.bid, 40) || 'custom', name: str(c.name, 40) || 'Basket', long: c.long, short: c.short } : null);
    const side = c.side === 'buy' || c.side === 'sell' ? c.side : null;
    const sz = () => (fin(c.lots) && c.lots > 0 && c.lots <= 100 ? { lots: c.lots, sl: fin(c.sl) && c.sl > 0 ? Math.round(c.sl) : null, tp: fin(c.tp) && c.tp > 0 ? Math.round(c.tp) : null, risk: fin(c.risk) ? c.risk : null, pct: fin(c.pct) ? c.pct : null, cost: fin(c.cost) ? c.cost : null } : null);
    const bad = no('BAD_REQUEST', 'basket needs a composition (long, short), a side and lots');
    switch (c.do) {
      case 'open': {
        const b = comp(), s = sz(); if (!b || !side || !s) return bad;
        return bkOpen(a, b, side, s, { pm: c.pm && typeof c.pm === 'object' ? c.pm : null, ctx: Array.isArray(c.ctx) ? c.ctx.filter(x => typeof x === 'string').slice(0, 20) : [], trail: c.trail, be: c.be }, c.cid);
      }
      case 'place': {
        const b = comp(), s = sz(); if (!b || !side || !s) return bad;
        if (c.type !== 'limit' && c.type !== 'stop') return no('BAD_REQUEST', 'A pending basket is a limit or a stop');
        const bp = Math.round(+c.bp); if (!(bp >= 1 && bp <= 2000)) return no('BAD_REQUEST', 'Distance: 1 to 2000 bp');
        const snap = { long: norm(b.long), short: norm(b.short) }, v = idx(snap), d = side === 'buy' ? 1 : -1, dir = c.type === 'limit' ? -d : d;
        if (!fin(v)) return no('NO_QUOTE', 'No quote for the basket currencies');
        const o = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), bid: b.id, name: b.name, side, type: c.type, bp, dir, trig: v + dir * bp / 1e4, t: nowS(), sz: s, pm: c.pm || null, flags: Array.isArray(c.ctx) ? c.ctx.slice(0, 20) : [], trail: +c.trail || 0, be: +c.be || 0, ...snap };
        const r = { ok: true, id: o.id };
        store.tx(() => { bkSave(a, 'bkOrders', [...bkList(a, 'bkOrders'), o]); kept(a, c.cid, 'basket', r); });
        return r;
      }
      case 'cancel': { const bo = bkList(a, 'bkOrders'), left = bo.filter(o => o.id !== c.id); if (left.length === bo.length) return rej('NO_ORDER'); store.tx(() => bkSave(a, 'bkOrders', left)); return { ok: true, id: c.id }; }
      case 'alert': {
        const b = comp(), bp = Math.round(+c.bp); if (!b || !(bp >= 1 && bp <= 2000)) return no('BAD_REQUEST', 'A basket alert needs a composition and 1 to 2000 bp');
        const snap = { long: norm(b.long), short: norm(b.short) }, v = idx(snap); if (!fin(v)) return no('NO_QUOTE', 'No quote for the basket currencies');
        const x = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), bid: b.id, name: b.name, bp, t: nowS(), up: v + bp / 1e4, dn: v - bp / 1e4, ...snap };
        const r = { ok: true, id: x.id };
        store.tx(() => { bkSave(a, 'bkAlerts', [...bkList(a, 'bkAlerts'), x]); kept(a, c.cid, 'basket', r); });
        return r;
      }
      case 'alertDel': { const al = bkList(a, 'bkAlerts'), left = al.filter(x => x.id !== c.id); if (left.length === al.length) return no('NO_ALERT', 'No such alert'); store.tx(() => bkSave(a, 'bkAlerts', left)); return { ok: true, id: c.id }; }
    }
    if (!g) return no('NO_BASKET', 'This basket is no longer open.');
    switch (c.do) {
      case 'close': if (g.closing) return no('CLOSING', 'Close pending on this basket'); store.tx(() => { bkCloseGroup(a, g, 'Basket close'); bkSave(a, 'bkPos', list); }); return { ok: true, id: g.gid };
      case 'be': {
        const st = groupState(a, g);
        if (g.beSet || g.closing || st.mv == null || !(st.mv > (g.cost || 0))) return no('BE_NOT_YET', `Break-even is available once the basket is more than ${(g.cost || 0).toFixed(1)} bp in profit.`);
        g.beSet = true; store.tx(() => bkSave(a, 'bkPos', list)); return { ok: true, id: g.gid };
      }
      case 'edit': {
        if (g.closing) return no('CLOSING', 'Close pending on this basket: its stop and target cannot be changed until it completes.');
        const st = groupState(a, g); if (st.mv == null) return no('NO_COMP', 'This basket has no saved composition: its stop and target are suspended.');
        const okN = (x, mx) => x == null || (Number.isInteger(x) && x >= 1 && x <= mx), sl = c.sl ?? null, tp = c.tp ?? null;
        if (!okN(sl, 2000)) return no('BK_SL', 'Stop: a whole number of bp from 1 to 2000 below the entry (the losing side), or empty for none.');
        if (!okN(tp, 4000)) return no('BK_TP', 'Target: a whole number of bp from 1 to 4000 above the entry (the winning side), or empty for none.');
        if (sl != null && st.mv <= -sl) return no('BK_SL', `The index is already ${st.mv.toFixed(1)} bp from the entry: a stop at −${sl} bp would close the basket at once.`);
        if (tp != null && st.mv >= tp) return no('BK_TP', `The index is already ${st.mv.toFixed(1)} bp from the entry: a target at +${tp} bp would close the basket at once.`);
        const out = [];
        for (const p of st.legs) {
          const l = linkOf(a, p.id, 'SL');
          if (!sl) { if (l) out.push(F(l, a)); continue; }
          const q = qOk(p.sym), d = p.side === 'buy' ? 1 : -1; if (!q) continue;
          const lvl = rd(p.sym, p.entry - d * Math.max(3 * sl / 1e4 * p.entry, 3 * (q.ask - q.bid)));
          if (d > 0 ? lvl < q.bid : lvl > q.ask) { const t = { sym: p.sym, side: opp(p.side), lots: p.lots, ot: 'stop', price: lvl, tif: 'GTC', linkPos: p.id, leg: 'SL' }; out.push(l ? Gr(t, l.clOrdId, a) : D(t, a)); }
        }
        let ok = true;
        store.tx(() => {
          if (out.length && !sys(a, out)) { ok = false; return; }
          g.sl = sl; g.tp = tp; g.risk = sl ? g.lots * 1e5 * (sl + (g.cost || 0)) / 1e4 : null; bkSave(a, 'bkPos', list);
        });
        return ok ? { ok: true, id: g.gid } : no('LINK_DOWN', 'Execution server unreachable');
      }
      case 'half': {
        if (g.closing || g.halving) return no('CLOSING', 'Close pending on this basket');
        const q0 = qOk('EURUSD'); if (!q0 || !q0.open) return no('MARKET_CLOSED', `${g.name}: market closed.`);
        const legs = groupLegs(a, g), plan = [], badL = [];
        for (const p of legs) {
          const mn = core.volOf(p.sym)[0]; let l = Math.max(mn, core.normLots(p.sym, p.lots * .5));
          if (l >= p.lots - 1e-9 || p.lots - l < mn - 1e-9) l = p.lots;
          const f = l / p.lots; if (Math.abs(f - .5) > .1 + 1e-9) badL.push(`${p.sym} ${p.lots} → ${l} (${Math.round(f * 100)}%)`);
          plan.push([p, l]);
        }
        if (badL.length) return no('HALF_ROUNDS', `Half of a leg rounds more than 20% away from half: ${badL.join(', ')}. Close the whole basket instead.`);
        let sent = true;
        store.tx(() => {
          const cls = [], pl = {}; for (const [p, l] of plan) { const x = closePos(a, p, 'Basket close', l); if (x) { cls.push(...x); pl[x[0]] = { id: p.id, left: core.normLots(p.sym, p.lots - l), res: null }; } }
          if (!cls.length) { sent = false; return; }
          g.halving = { cls, t: nowS(), plan: pl }; bkSave(a, 'bkPos', list);
        });
        return sent ? { ok: true, id: g.gid } : no('LINK_DOWN', 'Execution server unreachable');
      }
    }
    return no('BAD_REQUEST', 'Unknown basket action');
  }

  /* ---------- price alerts (trade.js addAlert / checkTriggers) ---------- */
  function alert(a, c) {
    if (off.has(a)) return offReply();
    const list = S(a, 'alerts', []);
    if (c.do === 'del') { const left = list.filter(x => x.id !== c.id); if (left.length === list.length) return no('NO_ALERT', 'No such alert'); store.tx(() => W(a, 'alerts', left)); return { ok: true, id: c.id }; }
    if (c.do === 'add' || c.do === 'edit') {
      const sym = c.sym ?? list.find(x => x.id === c.id)?.sym, q = qOk(sym); if (!M(sym)) return rej('UNKNOWN_SYM');
      if (!fin(c.price) || !(c.price > 0)) return rej('PRICE_INVALID');
      if (!q) return no('NO_QUOTE', 'No quote for this instrument');
      const mid = q.mid; let cond = c.cond; if (cond !== 'above' && cond !== 'below') cond = c.price >= mid ? 'above' : 'below';
      if (cond === 'above' ? mid >= c.price : mid <= c.price) return no('ALERT_MET', `${sym} is already ${cond} ${c.price} (now ${rd(sym, mid)}). An alert fires when the price crosses its level.`);
      const id = c.do === 'edit' ? c.id : 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      if (c.do === 'edit' && !list.some(x => x.id === id)) return no('NO_ALERT', 'No such alert');
      if (list.length >= 200 && c.do === 'add') return no('ALERT_MAX', 'At most 200 alerts');
      const al = { id, sym, price: c.price, cond, from: cond === 'above' ? 'below' : 'above', done: false, t: nowS() };
      store.tx(() => { W(a, 'alerts', c.do === 'edit' ? list.map(x => (x.id === id ? al : x)) : [...list, al]); kept(a, c.cid, 'alert', { ok: true, id }); });
      return { ok: true, id };
    }
    return no('BAD_REQUEST', 'alert needs do: add | edit | del');
  }
  // one check on mids (a pause: the bars' range, rec = { hi, lo } on bid + the current spread)
  function alertsCheck(a, t, rec = null, only = null) {
    const list = S(a, 'alerts', []); if (!list.length) return;
    let ch = false;
    for (const al of list) {
      if (al.done || (only && al.sym !== only)) continue;
      const q = qOk(al.sym); if (!q) continue;
      const other = al.cond === 'above' ? 'below' : 'above';
      const met = rec ? (al.cond === 'above' ? rec.hi + q.spread * M(al.sym).pip / 2 >= al.price : rec.lo + q.spread * M(al.sym).pip / 2 <= al.price) : al.cond === 'above' ? q.mid >= al.price : q.mid <= al.price;
      if (!met) { if (!rec && al.from !== other) { al.from = other; ch = true; } continue; }
      if (al.from === other) { al.done = true; al.at = rec ? rec.t : t; ch = true; notice(a, { kind: 'alert', alert: al, text: `Alert · ${al.sym} crossed ${al.cond} ${al.price}` }); }
    }
    if (ch) W(a, 'alerts', list);
  }

  /* ---------- challenge (challenge.js: pure rules, the live evaluation, the breach flatten) ---------- */
  const fmts = {};
  function local(t, tz) {
    const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
    const p = {}; for (const x of f.formatToParts(new Date(t * 1000))) p[x.type] = x.value;
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24 };
  }
  function dayKey(t, reset) {
    const tz = reset && CH_TZ.includes(reset.tz) ? reset.tz : 'UTC', hour = reset && Number.isInteger(reset.hour) && reset.hour >= 0 && reset.hour <= 23 ? reset.hour : 0, L = local(t, tz);
    return new Date(Date.UTC(L.y, L.mo - 1, L.d, L.h) - hour * 3600e3).toISOString().slice(0, 10);
  }
  const maxFloor = (mx, e0, hw, cap = e0) => { const amt = mx.pct / 100 * cap; if (mx.mode === 'static') return e0 - amt; const f = hw - amt; return mx.lock ? Math.min(f, e0) : f; };
  const capOf = att => (att.phase > 0 && att.b0 > 0 ? att.b0 : att.e0);
  function floors(att, eq) {
    const R = att.rules, d = att.day, e0 = att.e0, cap = capOf(att);
    let dailyFloor = -Infinity, dailyAmt = Infinity, dailyUsed = 0;
    if (R.daily) { const anchor = R.daily.anchor === 'balance' ? d.bal0 : Math.max(d.bal0, d.eq0); dailyAmt = R.daily.pct / 100 * (R.daily.base === 'initial' ? cap : anchor - (e0 - cap)); dailyFloor = anchor - dailyAmt; dailyUsed = Math.max(0, (anchor - eq) / dailyAmt); }
    const maxAmt = R.max.pct / 100 * cap, mf = maxFloor(R.max, e0, att.hw, cap), maxUsed = Math.max(0, (mf + maxAmt - eq) / maxAmt);
    const floor = Math.max(dailyFloor, mf);
    return { dailyFloor, dailyUsed, maxFloor: mf, maxUsed, floor, which: dailyFloor >= mf ? 'daily' : 'max', room: eq - floor };
  }
  const phaseDays = (att, bal) => (att.day.n > 0 ? [{ k: att.day.k, pnl: bal - att.day.bal0, n: att.day.n }] : []).concat(att.days);
  function phaseDone(att, bal, flat) {
    const R = att.rules, days = phaseDays(att, bal), n = days.length, e0 = att.e0, cap = capOf(att), target = R.phases[att.phase].target;
    const tgtOk = bal >= e0 + target / 100 * cap, profit = bal - e0, best = days.reduce((m, d) => Math.max(m, d.pnl), 0);
    const pDays = R.profitDays ? days.filter(d => d.pnl >= R.profitDays.minPct / 100 * cap).length : 0;
    const consOk = !R.consistency || (profit > 0 && best <= R.consistency / 100 * profit);
    const pending = n < R.minDays || pDays < (R.profitDays ? R.profitDays.n : 0) || (R.consistency && !consOk && profit > 0) || !flat;
    return { done: tgtOk && !pending, tgtOk, days: n };
  }
  function chSummary(att, bal) {
    const daysAll = att.phases.reduce((s, p) => s + p.days, 0) + (att.status === 'passed' ? 0 : phaseDays(att, bal).length);
    return { id: att.id, pid: att.rules.id, pv: att.rules.pv, label: att.rules.label, start: att.start, end: att.end ? att.end.t : nowS(), status: att.status, phase: att.phase, why: att.end ? att.end.why : null, days: daysAll, ret: (bal / att.b0 - 1) * 100 };
  }
  function chFinish(c, att, status, why, eq, floor, bal) { att.status = status; att.end = { t: nowS(), why, eq, floor, closed: 0 }; c.log = c.log || []; c.log.unshift(chSummary(att, bal)); if (c.log.length > 20) c.log.length = 20; }
  // the breach stop-out: what can close closes now, a closed market's position waits in end.wait for its open
  function chFlatten(a, c, att) {
    const e = att.end; if (!e || !Array.isArray(e.wait) || !e.wait.length) return;
    for (const id of e.wait.slice()) {
      const p = posOf(a, id);
      if (!p) { e.wait.splice(e.wait.indexOf(id), 1); e.closed = (e.closed || 0) + (e.sent?.includes(id) ? 1 : 0); continue; }
      const q = qOk(p.sym); if (!q || !q.open) continue;
      if (closePos(a, p, 'Stop-out (challenge breach)')) (e.sent = e.sent || []).includes(id) || e.sent.push(id);
    }
    if (c.log && c.log[0] && c.log[0].id === att.id) c.log[0] = chSummary(att, balance(a) ?? 0);
  }
  function chTick(a, t) {
    const c = S(a, 'chal'); if (!c || !c.att) return;
    const att = c.att;
    if (att.status === 'breached' && att.end && att.end.wait && att.end.wait.length) {
      const before = JSON.stringify(att.end); chFlatten(a, c, att); if (JSON.stringify(att.end) !== before) W(a, 'chal', c);
      return;
    }
    if (att.status !== 'active') return;
    const R = att.rules, eq = equity(a), bal = balance(a); if (eq == null || bal == null) return;
    const before = JSON.stringify(att), k = dayKey(t, R.reset);
    if (k !== att.day.k) { // chRoll
      if (att.day.n > 0) { att.days.unshift({ k: att.day.k, pnl: bal - att.day.bal0, n: att.day.n }); if (att.days.length > 400) att.days.length = 400; }
      if (R.max.mode === 'eod') att.hw = Math.max(att.hw, R.max.trailOn === 'equity' ? eq : bal);
      att.day = { k, bal0: bal, eq0: eq, n: 0, low: eq }; att.warn = { k, d: 0, m: 0 };
    }
    if (R.max.mode === 'intraday') att.hw = Math.max(att.hw, R.max.trailOn === 'equity' ? eq : bal);
    att.day.low = Math.min(att.day.low, eq);
    const f = floors(att, eq), hitD = eq <= f.dailyFloor, hitM = eq <= f.maxFloor;
    if (hitD || hitM) {
      const why = hitD && (!hitM || f.dailyFloor >= f.maxFloor) ? 'daily' : 'max', floor = why === 'daily' ? f.dailyFloor : f.maxFloor;
      chFinish(c, att, 'breached', why, eq, floor, bal); att.end.day = phaseDays(att, bal).length || 1; att.end.wait = positions(a).map(p => p.id);
      // orders sent and not answered yet, the browser's and the basket legs being opened: what they open is flattened too (onExec)
      att.end.inflight = [...inflight(a), ...Object.values(S(a, 'bkOpening') || {}).flatMap(e => e.cls || [])];
      chFlatten(a, c, att); W(a, 'chal', c);
      notice(a, { kind: 'chal', what: 'breach', text: `Challenge breached — ${why === 'daily' ? 'daily loss limit' : 'max loss limit'}`, eq, floor });
      return;
    }
    for (const [rule, used, key] of [['daily', f.dailyUsed, 'd'], ['max', f.maxUsed, 'm']]) {
      if (rule === 'daily' && !R.daily) continue;
      const lv = used >= .8 ? 80 : used >= .5 ? 50 : 0;
      if (lv > att.warn[key]) { att.warn[key] = lv; if (rule === 'daily' && lv === 80) att.coolUntil = t + 15 * 60; notice(a, { kind: 'chal', what: 'warn', rule, level: lv, room: f.room }); }
    }
    const pd = phaseDone(att, bal, !positions(a).length);
    if (pd.tgtOk && !att.tgtAt) { att.tgtAt = t; notice(a, { kind: 'chal', what: 'target' }); }
    if (pd.done) {
      att.phases.push({ e0: att.e0, start: att.ph0, end: t, days: pd.days, ret: (bal - att.e0) / capOf(att) * 100 });
      if (att.phase < R.phases.length - 1) { att.phase++; att.e0 = att.hw = bal; att.ph0 = t; att.days = []; att.day = { k, bal0: bal, eq0: eq, n: 0, low: eq }; att.warn = { k, d: 0, m: 0 }; att.tgtAt = 0; att.coolUntil = 0; notice(a, { kind: 'chal', what: 'phase', phase: att.phase }); }
      else { chFinish(c, att, 'passed', 'target', eq, null, bal); notice(a, { kind: 'chal', what: 'pass' }); }
    }
    if (JSON.stringify(att) !== before) W(a, 'chal', c);
  }
  const rulesOk = r => r && typeof r === 'object' && Array.isArray(r.phases) && r.phases.length >= 1 && r.phases.length <= 3 && r.phases.every(p => fin(p.target) && p.target > 0 && p.target <= 100)
    && (r.daily === null || (r.daily && fin(r.daily.pct) && r.daily.pct > 0 && r.daily.pct <= 50 && ['initial', 'anchor'].includes(r.daily.base ?? 'initial') && ['balance', 'maxBalEq'].includes(r.daily.anchor)))
    && r.max && fin(r.max.pct) && r.max.pct > 0 && r.max.pct <= 50 && ['static', 'eod', 'intraday'].includes(r.max.mode) && ['balance', 'equity'].includes(r.max.trailOn)
    && Number.isInteger(r.minDays ?? 0) && (r.consistency == null || (fin(r.consistency) && r.consistency > 0 && r.consistency <= 100)) && r.reset && CH_TZ.includes(r.reset.tz) && Number.isInteger(r.reset.hour)
    && JSON.stringify(r).length < 4000;
  // settings { chal: { do: start (id, rules) | stop | cfg (sel, opt, custom) } } -> reply (chStart / chStop of challenge.js)
  function chal(a, x) {
    if (off.has(a)) return offReply();
    const c = S(a, 'chal') || { v: 1, custom: null, sel: '2s-static', opt: { risk: 'asis', horizon: 60 }, att: null, log: [] };
    const active = c.att && c.att.status === 'active';
    if (x.do === 'stop') { if (!active) return no('CHAL_NONE', 'No attempt is running.'); chFinish(c, c.att, 'stopped', 'user', equity(a), null, balance(a) ?? 0); store.tx(() => W(a, 'chal', c)); return { ok: true }; }
    if (x.do === 'cfg') { if (typeof x.sel === 'string') c.sel = x.sel.slice(0, 40); if (x.opt && typeof x.opt === 'object') c.opt = clone(x.opt); if (x.custom !== undefined) { if (x.custom !== null && !rulesOk(x.custom)) return no('CHAL_RULES', 'Invalid rules'); c.custom = clone(x.custom); } store.tx(() => W(a, 'chal', c)); return { ok: true }; }
    if (x.do !== 'start') return no('BAD_REQUEST', 'chal needs do: start | stop | cfg');
    if (active) return no('CHAL_RUNNING', 'An attempt is already running.');
    const np = positions(a).length, nO = orders(a).filter(o => o.linkPos == null).length, bal = balance(a);
    if (np) return no('CHAL_FLAT', `Close your ${np} open position${np === 1 ? '' : 's'} to start — an attempt starts flat.`);
    if (nO) return no('CHAL_FLAT', `Cancel your ${nO} pending order${nO === 1 ? '' : 's'} to start.`);
    if (!(bal > 0)) return no('CHAL_BAL', 'The balance is zero: reset the account in Help to start.');
    if (!rulesOk(x.rules)) return no('CHAL_RULES', 'Unknown rules.');
    const rules = clone(x.rules), t = nowS(), k = dayKey(t, rules.reset);
    c.att = { id: 'A' + Math.round(t), rules, status: 'active', phase: 0, start: t, e0: bal, ph0: t, hw: bal, b0: bal, day: { k, bal0: bal, eq0: bal, n: 0, low: bal }, days: [], warn: { k, d: 0, m: 0 }, coolUntil: 0, tgtAt: 0, phases: [], end: null, demoAt: null };
    if (typeof x.id === 'string') c.sel = x.id.slice(0, 40);
    store.tx(() => W(a, 'chal', c));
    return { ok: true, id: c.att.id };
  }

  /* ---------- the tick: every account, on a live feed and an up link ---------- */
  const maeAt = new Map();
  let clockAt = 0, recover = null, accts = { at: 0, list: [] };
  function accounts() {
    if (Date.now() - accts.at > 5000) accts = { at: Date.now(), list: G.stateAccounts() };
    return new Set([...accts.list, ...[...(mirror.accounts?.() || [])]]);
  }
  function evalAccount(a, t) {
    alertsCheck(a, t);
    for (const p of positions(a)) {
      if (!M(p.sym)) continue;
      const mt = G.meta(a, p.id); if (!mt) continue;
      if (mt.prot && recover !== 'running') protect(a, p.id); // after a pause the bars go first
      const q = qOk(p.sym);
      // time stop (behav.js bhTick): at the deadline a loser closes, a winner stays and the time stop is dropped
      if (mt.timeStop && !mt.basket && q && q.open && t - (p.open ?? t) >= mt.timeStop) {
        if (pnlOf(p) <= 0) closePos(a, p, 'Time stop');
        else { const x = { ...G.meta(a, p.id), timeStop: 0 }; putMeta(a, p.id, x); notice(a, { kind: 'timeStop', pos: p.id, text: `${p.sym} #${p.id} passed its time stop`, kept: true }); }
      }
      // MAE / MFE of every position (challenge.js chTick), at most once a second
      const k = a + ':' + p.id; if (Date.now() - (maeAt.get(k) ?? 0) >= MAE_MS && q) {
        const pl = pnlOf(p), x = G.meta(a, p.id) || {}, mae = Math.min(x.mae || 0, pl), mfe = Math.max(x.mfe || 0, pl);
        if (mae !== (x.mae || 0) || mfe !== (x.mfe || 0)) { G.putMeta(a, p.id, { ...x, mae, mfe }); maeAt.set(k, Date.now()); }
      }
    }
    bkMonitor(a, t);
    chTick(a, t);
  }
  function tick() {
    if (!up() || !market.feedAlive()) return; // a stale feed or no broker: nothing acts
    const t = nowS();
    if (recover === 'due') { recover = 'running'; runRecovery(t).catch(e => log(`oms: recovery failed (${e.message})`)).finally(() => { recover = null; }); }
    for (const a of accounts()) {
      if (off.has(a)) {
        // a suspended account is tried again every 10 minutes: a pass that runs clean lifts the suspension
        if (t - off.get(a) < resumeAfter()) continue;
        off.set(a, t);
        try { store.tx(() => evalAccount(a, t)); } catch (e) { failLog(a, 'retry after suspension', e); continue; }
        off.delete(a); fails.tick.delete(a); fails.report.delete(a);
        log(`oms: account ${a} resumed (a clean pass after the suspension)`); notice(a, { kind: 'oms', text: 'Execution server · order features of this account work again' });
        continue;
      }
      try { store.tx(() => evalAccount(a, t)); fails.tick.delete(a); } catch (e) { failed(a, 'tick', e, 100, 'tick'); } // the log at most once a minute (M2)
    }
    if (t - clockAt >= CLOCK_S) { clockAt = t; store.tx(() => G.putState('*', 'omsAt', t)); }
    if (Date.now() - pruneAt > 86400000) { pruneAt = Date.now(); try { const r = G.prune(Math.floor(Date.now() / 1000)); pruneOrdMeta(t); if (r.exec || r.meta) log(`retention: ${r.exec} executions, ${r.meta} journals pruned`); } catch (e) { log(`oms: prune failed (${e.message})`); } }
  }
  let pruneAt = 0; // retention on the first live tick, then once a day
  // ordMeta of orders no longer working (lost in a restart between the D and its answer) after a week
  function pruneOrdMeta(t) {
    for (const a of accounts()) {
      const om = S(a, 'ordMeta'); if (!om) continue;
      const live = new Set(orders(a).map(o => o.clOrdId)); let ch = false;
      for (const [cl, e] of Object.entries(om)) if (!live.has(cl) && t - (e.t || 0) > ORD_KEEP) { delete om[cl]; ch = true; }
      if (ch) store.tx(() => G.putState(a, 'ordMeta', om));
    }
  }

  /* ---------- after a pause: trailing, break-even and alerts from the 1-minute bars ---------- */
  // the gateway is up again (the first 'up' after the start): one recovery, on the first live tick
  function linked() { rebuilt(); if (recover === null && !linked.done) { linked.done = true; recover = 'due'; } }
  async function runRecovery(t) {
    const from = G.state1('*', 'omsAt');
    if (!fin(from) || t - from < PAUSE_MIN) return;
    if (t - from > PAUSE_MAX) { log(`oms: away ${Math.round((t - from) / 86400)} days, no recovery from bars`); return; }
    const want = new Map(); // sym -> [account, …]
    for (const a of accounts()) {
      for (const p of positions(a)) { const mt = G.meta(a, p.id); if (mt?.prot && (mt.prot.trail > 0 || (mt.prot.be && !mt.prot.be.done))) (want.get(p.sym) || want.set(p.sym, new Set()).get(p.sym)).add(a); }
      for (const al of S(a, 'alerts', [])) if (!al.done) (want.get(al.sym) || want.set(al.sym, new Set()).get(al.sym)).add(a);
    }
    for (const [sym, as] of want) {
      let bs; try { bs = await getBars(sym, Math.floor(from), Math.ceil(t)); } catch (e) { log(`oms: bars for ${sym} failed (${e.message})`); continue; }
      if (!Array.isArray(bs) || !bs.length || !up()) continue;
      const q = qOk(sym); if (!q || !market.feedAlive()) continue;
      const sp = q.ask - q.bid;
      for (const a of as) store.tx(() => {
        // a position only from the bars after its own open
        for (const p of positions(a).filter(x => x.sym === sym)) {
          const own = bs.filter(b => b[0] >= (p.open ?? 0)); if (!own.length) continue;
          protect(a, p.id, false, { hi: Math.max(...own.map(b => b[2])), lo: Math.min(...own.map(b => b[3])) + sp });
        }
        // an alert: the first bar that crosses it; the bars cover the side it was armed on
        for (const b of bs) alertsCheck(a, t, { hi: b[2], lo: b[3], t: b[0] }, sym);
      });
      log(`oms: ${sym} recovered from ${bs.length} bars of the pause`);
    }
  }

  // a ClOrdID whose basket is still opening (a repeated cid waits for it)
  const busy = (a, cl) => Object.values(S(a, 'bkOpening', {})).some(e => e.cls.includes(cl) && !e.res[cl]);
  return { order, modify, basket, alert, chal, onExec, onCxlReject, onFlat, tick, linked, busy, guard, eff, unrepl, suspended: a => off.has(a) };
}

/* The 1-minute bars of [from, to) for an instrument: [[t, o, h, l, c], …] in time order, bid. The archive
   (host/bars-import.mjs: <data>/bars/1/SYM/YYYY-MM.csv.gz) first; when it does not reach `to` (the archive runs daily),
   the platform's /datafeed/history for the rest, its ticker from /datafeed/symbol_info as bars-import does. */
export function archiveBars(dataDir = process.env.TB_DATA || new URL('../../.data', import.meta.url).pathname, host = process.env.TB_PLATFORM || 'https://trade.capitalsvision.com/gcp') {
  let tickers = null;
  return async (sym, from, to) => {
    const out = new Map();
    for (let y = new Date(from * 1000).getUTCFullYear(), m = new Date(from * 1000).getUTCMonth(); ; m++) {
      if (m > 11) { m = 0; y++; }
      const key = `${y}-${String(m + 1).padStart(2, '0')}`, f = join(dataDir, 'bars', '1', sym, key + '.csv.gz');
      if (existsSync(f)) for (const l of gunzipSync(readFileSync(f)).toString().split('\n').slice(1)) { const v = l.split(',').map(Number); if (v.length === 5 && v[0] >= from && v[0] < to) out.set(v[0], v); }
      if (Date.UTC(y, m + 1, 1) / 1000 >= to) break;
    }
    const last = Math.max(from - 60, ...out.keys());
    if (last < to - 120) {
      if (!tickers) {
        const r = await fetch(`${host}/datafeed/symbol_info?group=Main`, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`platform symbol list answered ${r.status}`);
        const j = await r.json(); tickers = new Map(); j.symbol.forEach((s, i) => { if (j.ticker[i] && !tickers.has(s)) tickers.set(s, String(j.ticker[i])); });
      }
      const tk = tickers.get(sym); if (!tk) throw new Error(`${sym} is not on the platform`);
      const r = await fetch(`${host}/datafeed/history?symbol=${encodeURIComponent(tk)}&resolution=1&from=${last + 60}&to=${to}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`platform answered ${r.status}`);
      const j = await r.json();
      if (j && j.s === 'ok' && Array.isArray(j.t)) for (let i = 0; i < j.t.length; i++) { const t = +j.t[i]; if (t >= from && t < to) out.set(t, [t, +j.o[i], +j.h[i], +j.l[i], +j.c[i]]); }
    }
    return [...out.values()].sort((x, y) => x[0] - y[0]);
  };
}
