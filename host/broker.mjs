/* The temporary broker: its own process on the Mac mini (launchd com.victor.tradeberry-broker), the FIX 4.4 acceptor the
   tradeBerry gateway talks to, standing in for the real server until tradeBerry connects to it. It holds the accounts
   (data/broker.db, host/broker/db.mjs) and executes them on the live ticks it reads itself (host/broker/feed.mjs), with
   the account core's rules (core/account.js) on the market core (core/market.js). It only does what a standard broker
   does: market, limit, stop and stop-limit orders (DAY / GTC / GTD), OCO groups, stop loss and take profit orders linked
   to a position (reduce-only), positions by id (721), the stop-out, swap and the negative balance protection.
   Exactly-once: the FIX store and the accounts share one SQLite connection. A message from the gateway is handled inside
   the session's transaction (onApp is synchronous and writes on that connection), and what a tick does is written with
   store.tx: the account, the executions and the ExecutionReports commit together, then go on the wire (stored for
   resend when the gateway is away). If a handler throws, the database rolls back and the accounts are read again from it.
   - D: deduped by ClOrdID (a repeat gets the same answer again); refused, never executed, when it was sent more than 10 s
     before it arrives (52, or 122 on a resend) and is not a ClOrdID already known; a linked order (5002) sets the
     position's stop loss (leg SL, a stop) or one of its targets (TP1–TP4, limits, partial sizes);
     a market D on a position (721) without net (5004) is close only: its size is capped at what the position holds
     (no reversal remainder), the same side is refused (CLOSE_ONLY), a position gone is NO_POS; with 5004 it may reverse;
   - F / G: cancel / replace a working order or a linked one (9 when refused); H, AF: order status; AN (263=1: AP on every
     change of a position), BB (BA on every change, at most once a second), AD (AE, the history since the account's
     created: a demo Reset starts a new history, nothing is deleted); U1 SET creates the account on demand (type demo
     unless said) and sets its settings, U1 RESET resets a demo account (j NOT_DEMO on a live one).
   Reset (Claude's call, 02.11.2026): everything is removed without fills, at any market state: positions and orders
   go (their reports: cancels, flat APs), the balance is 100000 and the history starts again. A fill would be booked
   only to vanish with the history, and it could not happen while a market is closed.
   No live feed (feedAlive false): nothing executes and nothing is stopped out; market orders get NO_FEED.
   Failures: a tick, sweep or rollover that throws on one account rolls back and reloads that account only (the others go
   on); after 3 failures in a row the account is quarantined (nothing executes on it, its D are refused, one log line)
   until the broker restarts. A gateway message whose handler throws is rolled back and comes again by resend (one log
   line per attempt, by the session); a message other than D that fails 3 times on the same seq is consumed with a j
   (dead letter); a D that keeps failing is consumed with a reject 8 (DEAD_LETTER) once it is past the stale limit.
   H on a ClOrdID that a later G or F named in 41 answers replaced or cancelled. fix_out keeps 7 days (pruned daily; a resend over a pruned range is gap-filled by the session).
   ExecID: '<account>:<fid>' for a fill (fill ids count per account), 'X<n>' for the other reports.
   Recovery after downtime (host/broker/recover.mjs): at start every account waits while the feed and the sweep already
   run; the live ticks heard meanwhile are buffered. Each account with something open is played over the 1-minute bars
   of the time it missed, from meta ran:<account> (the last moment it really ran: a tick or a sweep that evaluated its
   book, a change it committed, the end of its last recovery; not advanced while it waits, is pending or quarantined;
   for a database without it: its last execution), then over the buffered ticks, and released in the same synchronous
   step, so no moment is left unplayed but the part of a minute before the first tick (< 1 min, no complete bar). Its
   fills and reports go the way a tick's do (store.tx, acceptor.send: stored for the gateway when it is away); D / F / G
   on a waiting account are refused (RECOVERY). The bars have a time budget (budgetMs, 150 s); an account with nothing
   open, or whose gap holds no complete minute, is released at once. A round that took a minute or more without a tick
   (a dead feed) is followed by another one. Over 14 days down, bars not available, or a failed recovery: nothing
   executes on that account; it is pending (meta pending:<account> { from, why, at }, kept across restarts, logged),
   its D / F / G are refused and no tick, sweep or rollover touches it. It is tried again every 10 minutes (retryMs);
   the operator ends it with node host/broker.mjs --clear-recovery <account> (the account then trades again from now,
   the missed time is not played); a demo Reset ends it too.
   A D or G may carry 5016: the reason of a fill and of the close it makes, or of a stop loss when it fills.
   Exits (final review I5): a D carries the exits of the position it opens (5050-5056); a market D opens the position with
   its stop loss and targets linked at once (ensureLinks: SL a stop, TP limits, partial legs, reduce-only, cancelled
   with the position), a pending D keeps them on the order and its fill does the same, also while the gateway is away
   and in the recovery from bars. A pending fill through a gap whose stop is already past keeps it, and the stop closes
   the position in the same step ('Stop loss', gap): never a naked position. A G of a working order replaces its exits.
   The order log (orders that left the book) is kept with the executions ({ type, order }); U2 answers the newest fills
   and order-log rows (U3) since the last demo Reset (meta reset:<account>). AD answers a window of the history (AQ total).
   The peak equity is followed once a second and carried in the BA (PEAK); a demo Reset sets it back to 100000. A BA also carries
   the account's type and settings (5030-5036).
   Trailing and break-even are not here: the gateway (Task 9) moves the stop with G; the fields stay on the positions.
   Credentials (TB_FIX_USER / TB_FIX_PASS) and LEGACY_API_KEY are never logged. */
import { fileURLToPath } from 'node:url';
import { MarketCore, CATALOG } from '../core/market.mjs';
import { AccountCore } from '../core/account.mjs';
import { createAcceptor } from './fix/session.mjs';
import * as FX from './fix/dialect.mjs';
import { openBrokerDb } from './broker/db.mjs';
import { createFeed } from './broker/feed.mjs';
import { recover, barSource } from './broker/recover.mjs';

const START = 100000, STALE_MS = 10000, SWEEP_MS = 1000, ROLL_MS = 60000, KEEP_MS = 7 * 86400000;
const DEF_SET = Object.freeze({ jur: 'none', lev: null, slip: 'sym', slipSd: .2, latMs: 120, comm: 0 });
const SET_KEYS = ['jur', 'lev', 'slip', 'slipSd', 'latMs', 'comm'];
const NOT_DEMO = 'Reset is available on demo accounts only';
const parseFixTime = s => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?$/.exec(s || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0) : NaN; };
// account ids of the migration are u<user>[-<device>]; any other id belongs to no tradeBerry user (0)
const uidOf = id => { const m = /^u(\d+)(?:-(.+))?$/.exec(id); return m ? { user_id: +m[1], device: m[2] || '' } : { user_id: 0, device: '' }; };
const one = (m, t) => { const v = m.fields.get(String(t)); return Array.isArray(v) ? v[0] : v; };
const opp = s => (s === 'buy' ? 'sell' : 'buy');

export async function startBroker({ db: file, port = 9878, host = '127.0.0.1', compId = 'TB-BROKER', gwCompId = 'TB-GW', user, pass, feed = true, now = () => Date.now(),
  seed = null, rng, log = s => console.log(new Date().toISOString(), 'broker: ' + s), staleMs = STALE_MS, hooks = {}, fetchBars = feed ? barSource() : null, retryMs = 600000, budgetMs = 150000 } = {}) {
  if (!user || !pass) throw new Error('broker: TB_FIX_USER / TB_FIX_PASS are not set');
  const B = openBrokerDb(file), { store } = B;
  const market = MarketCore.create({ catalog: CATALOG, now });
  const core = AccountCore.create({ market, rng: rng || (seed != null ? AccountCore.seeded(seed) : Math.random), now: () => now() / 1000, live: () => true, gapStops: true });
  const M = s => market.META[s];
  const OPTS = { digits: s => (M(s) ? M(s).digits : 5), lotDigits: s => (M(s) ? core.lotDec(s) : 2) };
  const tsec = () => now() / 1000;

  const accts = new Map();
  for (const A of B.load()) accts.set(A.id, A);
  // after a rollback: that account as committed
  const reloadOne = id => { const A = id != null && B.loadOne(id); if (A) accts.set(id, A); else if (id != null) accts.delete(id); };
  const fails = new Map(), quarantined = new Set(), logAt = new Map();
  // the recovery: wait = the accounts being recovered (buf: the ticks heard meanwhile); pending: account -> { from, why, at }
  const recov = { wait: new Set(), buf: [], busy: false, retryAt: -Infinity, pending: new Map(), run: null };
  for (const { k, v } of B.metaLike('pending:')) { try { recov.pending.set(k.slice(8), JSON.parse(v)); } catch { recov.pending.set(k.slice(8), { from: 0, why: 'unreadable mark' }); } }
  const held = id => recov.wait.has(id) || recov.pending.has(id);
  const heldWhy = id => (recov.pending.has(id) ? 'Not executed: this account waits for the recovery of the executions missed while the broker was down' : 'Not executed: the broker is recovering the executions missed while it was down; try again in a moment');
  function failed(id, what, e) {
    const n = (fails.get(id) || 0) + 1; fails.set(id, n);
    if (n >= 3) { quarantined.add(id); log(`account ${id} quarantined after ${n} failures in a row (${what}: ${e.name}): nothing executes on it until the broker restarts`); return; }
    const t = Date.now(); if (!(t - (logAt.get(id) || -Infinity) < 60000)) { logAt.set(id, t); log(`${what} failed on account ${id} (${e.name})`); }
  }
  // fn(A) on every account not quarantined, over a snapshot of the ids; a failure reloads only that account, after the loop.
  // fn returns true when it did real work (and it committed): only that clears the account's failure count, so passes
  // that skip an account (a tick on other instruments, an idle rollover) never save a failing one from the quarantine
  function eachAccount(what, fn, all = false) { // all: the waiting / pending accounts too (the start's pass)
    const bad = [];
    for (const id of [...accts.keys()]) {
      const A = accts.get(id); if (!A || quarantined.has(id) || (!all && held(id))) continue;
      try { if (fn(A) === true) fails.delete(id); } catch (e) { bad.push(id); failed(id, what, e); }
    }
    for (const id of bad) reloadOne(id);
  }

  let acceptor = null;
  const live = () => !!acceptor?.session(gwCompId)?.on;
  const tickCtx = { send: (t, f) => acceptor.send(gwCompId, t, f) };
  const subs = { pos: new Set(), coll: new Set(), lastBA: new Map() };

  /* ---------- reports ---------- */
  let statusN = 0;
  // an ExecutionReport for an event: stored in executions (append-only) and sent in the caller's transaction
  function report(A, ctx, ev, ids) {
    const execId = ev.kind === 'fill' ? `${A.id}:${ev.receipt.fid}` : 'X' + B.nextExecSeq();
    const fields = FX.execToReport(ev, { execId, account: A.id, ...ids }, { ...OPTS, now: now() });
    B.addExec(A.id, tsec(), { cl: ids.clOrdId, kind: ev.kind, fields });
    ctx.send('8', fields);
  }
  // an order that left the book: its order-log row, kept with the executions ({ type, order }, the migrated rows' shape)
  const logRow = (A, type, order) => { if (order) B.addExec(A.id, tsec(), { type, order: { ...order } }); };
  // an answer to H / AF: not an event, not stored as an execution
  const status = (account, ctx, ordStatus, ids, order, extra = {}) =>
    ctx.send('8', FX.execToReport({ kind: 'status', ordStatus, order, text: extra.text }, { execId: `S${Date.now()}-${++statusN}`, account, ...ids, ...extra.ids }, { ...OPTS, now: now() }));

  const ordIds = o => ({ orderId: String(o.id), clOrdId: o.clOrdId, sym: o.sym, side: o.side, lots: o.lots });
  // the exits a working order brings to its position (dialect 5050-5056): prices (slPx, tpPx, tpsPx) or offsets from the fill
  const rowsOf = rs => (Array.isArray(rs) && rs.length ? rs.slice(0, 4).map(r => (r.price > 0 ? { price: +r.price, lots: +r.lots } : { pips: +r.pips, pct: +r.pct })) : undefined);
  const exitTerms = o => ({ sl: o.slPx > 0 ? o.slPx : undefined, tp: o.tpPx > 0 ? o.tpPx : undefined, slPips: o.slPips > 0 ? o.slPips : undefined,
    tpPips: o.tpPips > 0 && !o.tps && !o.tpsPx ? o.tpPips : undefined, trail: o.trail > 0 ? o.trail : undefined, tps: rowsOf(o.tpsPx || o.tps),
    be: o.be && typeof o.be === 'object' ? { at: Number.isFinite(o.be.at) ? o.be.at : null, off: +o.be.off || 0, onTp: !!o.be.onTp } : undefined });
  const ordTerms = o => ({ ot: o.limit != null ? 'stoplimit' : o.ot, price: o.price, limit: o.limit ?? undefined, tif: o.tif, expires: o.tif === 'GTD' ? o.expires : undefined,
    posId: o.posId ?? undefined, oca: o.ocaKey ?? undefined, net: o.net || undefined, ...exitTerms(o) });
  // the exits of a D or a G -> the order's fields (core.place keeps them; core.onTick hands them to the fill), or a refusal
  const priceRows = rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.price > 0 && r.lots > 0);
  function exitFields(req, o) {
    const f = { slPips: req.slPips > 0 ? req.slPips : 0, tpPips: req.tpPips > 0 ? req.tpPips : 0, trail: req.trail > 0 ? req.trail : 0, slPx: req.sl > 0 ? req.sl : null, tpPx: req.tp > 0 ? req.tp : null, be: req.be || null, tps: null, tpsPx: null };
    if (Array.isArray(req.tps) && req.tps.length) {
      if (priceRows(req.tps)) { const b = core.buildTps(o.sym, o.side, o.price, o.lots, req.tps); if (b.err) return { ok: false, code: b.code, why: b.err }; f.tpsPx = req.tps.map(r => ({ price: r.price, lots: r.lots })); }
      else f.tps = req.tps.map(r => ({ pips: +r.pips, pct: +r.pct }));
    }
    const q = market.quote(o.sym);
    if (f.slPips > 0 && q && f.slPips <= q.spread) { const r = core.rej('SL_SPREAD', { spread: q.spread.toFixed(1), unit: core.unitWord(o.sym) }); return { ok: false, code: r.code, why: r.why }; }
    return { ok: true, f };
  }
  const setExits = (o, f) => { for (const k of ['slPips', 'tpPips', 'trail', 'slPx', 'tpPx', 'tpsPx']) { if (f[k]) o[k] = f[k]; else delete o[k]; } };
  const slIds = p => ({ orderId: String(p.slLink.oid), clOrdId: p.slLink.cl, sym: p.sym, side: opp(p.side), lots: p.slLink.lots });
  const slTerms = p => ({ ot: 'stop', price: p.sl, tif: 'GTC', linkPos: p.id, leg: 'SL' });
  const legIds = (p, l) => ({ orderId: String(l.oid), clOrdId: l.cl, sym: p.sym, side: opp(p.side), lots: l.lots });
  const legTerms = (p, l) => ({ ot: 'limit', price: l.price, tif: 'GTC', linkPos: p.id, leg: l.gleg || l.leg });
  const posOf = p => ({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, swap: p.swap || 0, comm: p.comm || 0, im: p.im, open: p.open });
  const TRADE_KEYS = ['id', 'sym', 'side', 'lots', 'entry', 'exit', 'open', 'close', 'pnl', 'pips', 'r', 'note', 'setup', 'nbp', 'reason', 'swap', 'leg', 'comm', 'slip', 'gap'];
  // a history row for AE: its tagged keys; a number that is not finite (an NBP row with no price known) is left out
  const tradeOf = t => Object.fromEntries(TRADE_KEYS.filter(k => t[k] !== undefined && !(typeof t[k] === 'number' && !Number.isFinite(t[k]))).map(k => [k, t[k]]));
  function sumOf(A) {
    const s = core.summary(A.acct), v = x => (typeof x === 'number' && !Number.isNaN(x) ? x : null);
    const set = A.acct.set;
    return { balance: v(s.balance), equity: v(s.equity), margin: v(s.margin), free: v(s.free), level: v(s.level), fl: v(s.fl), peak: v(A.acct.peak),
      type: A.type, set: { jur: set.jur, lev: set.lev ?? null, slip: set.slip, slipSd: set.slipSd, latMs: set.latMs, comm: set.comm } };
  }
  // every change ends here: the negative balance protection of a flat account (a close by D, a reset, a start), then the rows
  // meta ran:<account>: the last moment its book really ran (in the caller's transaction; at most once a second unless forced)
  const ranW = new Map();
  function markRan(id, t, force) {
    if (held(id) || quarantined.has(id) || (!force && t - (ranW.get(id) ?? -Infinity) < 1)) return;
    ranW.set(id, t); B.metaSet('ran:' + id, t);
  }
  function persist(A) {
    markRan(A.id, tsec(), true);
    const e = core.nbp(A.acct, tsec());
    if (e) { B.addTrade(A.id, e.trade); subs.lastBA.delete(A.id); } // the BA follows within a second
    A.acct.peak = Math.max(A.acct.peak, A.acct.balance); B.save(A);
  }
  function pushPos(A, touched) {
    if (!touched.size || !live() || !(subs.pos.has(A.id) || subs.pos.has('*'))) return;
    for (const [id, sym] of touched) {
      const p = A.acct.positions.find(x => x.id === id);
      acceptor.send(gwCompId, 'AP', p ? FX.posToAP(posOf(p), A.id, OPTS) : FX.flatToAP({ id, sym }, A.id, OPTS));
    }
  }

  /* ---------- linked orders ----------
     The position's stop loss (p.sl, p.slLink) and its target: one plain target for the whole position (p.tp, p.tpLink,
     resized with the position as the core closes all of it), or partial targets (p.tps legs, each with cl / oid). */
  const tpIds = p => ({ orderId: String(p.tpLink.oid), clOrdId: p.tpLink.cl, sym: p.sym, side: opp(p.side), lots: p.tpLink.lots });
  const tpTerms = p => ({ ot: 'limit', price: p.tp, tif: 'GTC', linkPos: p.id, leg: p.tpLink.gleg || 'TP1' });
  const legsOf = p => (p.tps || []).map(l => ({ price: l.price, lots: l.lots, cl: l.cl, oid: l.oid, gleg: l.gleg }));
  // the targets of p become legs (validated by the core: sizes, minimum, at most 4, never more than the position); each
  // leg keeps its ClOrdID by price (two targets never share a price)
  function setLegs(A, p, legs) {
    const r = core.modify(A.acct, legs.length ? { posId: p.id, tps: legs.map(l => ({ price: l.price, lots: l.lots })) } : { posId: p.id, tp: null, tps: null });
    if (!r.ok) return r;
    for (const l of p.tps || []) { const k = legs.find(x => !x.used && Math.abs(x.price - l.price) < 1e-12); if (k) { k.used = true; Object.assign(l, { cl: k.cl, oid: k.oid, gleg: k.gleg }); } }
    return r;
  }
  // a stop or a target the broker did not receive as an order (a migrated position, a pending order's own exits): it gets
  // a broker ClOrdID, and the gateway hears of it
  function ensureLinks(A, ctx) {
    for (const p of A.acct.positions) {
      if (p.tp != null && !p.tps && !p.tpLink) { p.tpLink = { cl: `bk-${A.id}-${p.id}-TP`, oid: A.acct.nextId++, lots: p.lots }; report(A, ctx, { kind: 'new', order: tpTerms(p) }, tpIds(p)); }
      if (p.sl != null && !p.slLink) { p.slLink = { cl: `bk-${A.id}-${p.id}-SL`, oid: A.acct.nextId++, lots: p.lots }; report(A, ctx, { kind: 'new', order: slTerms(p) }, slIds(p)); }
      for (const l of p.tps || []) if (!l.cl) { Object.assign(l, { cl: `bk-${A.id}-${p.id}-${l.leg}`, oid: A.acct.nextId++ }); report(A, ctx, { kind: 'new', order: legTerms(p, l) }, legIds(p, l)); }
    }
  }
  // pending orders on an instrument the account's jurisdiction does not offer leave the book (trade.js dropUnavailableOrders)
  function unavailableNote(sym, set) {
    const w = core.unavailableWhy(sym, set), j = core.jurOf(set), m = M(sym);
    const r = w && m && core.tradeStatus(sym, set) === 'off' && j.why ? j.why[m.cls] || (m.kind === 'cfd' ? j.why.cfd : '') : '';
    return r ? `${w} (${r})` : w;
  }
  function dropUnavailable(A, ctx) {
    for (const o of A.acct.orders.filter(x => !core.isAvailable(x.sym, A.acct.set))) { const r = core.endOrder(A.acct, o, 'cancelled', unavailableNote(o.sym, A.acct.set), tsec()); logRow(A, 'cancel', r); report(A, ctx, { kind: 'cancel', text: r.why }, ordIds(o)); }
  }
  function find(A, cl) {
    if (!A || !cl) return null;
    const o = A.acct.orders.find(x => x.clOrdId === cl); if (o) return { o };
    for (const p of A.acct.positions) {
      if (p.slLink && p.slLink.cl === cl) return { p, sl: true };
      if (p.tpLink && p.tpLink.cl === cl) return { p, tp: true };
      const l = (p.tps || []).find(x => x.cl === cl); if (l) return { p, l };
    }
    return null;
  }
  // a D linked to a position (5002): its stop loss (leg SL, a stop on the other side) or a target (TP1–TP4, a limit,
  // part of the size); a second SL replaces the first (cancelled)
  function linkNew(A, rec, req, ids) {
    const p = A.acct.positions.find(x => x.id === req.linkPos);
    const no = (code, text) => report(A, rec, { kind: 'reject', code, text }, ids);
    if (!p || p.sym !== req.sym) return no('NO_POS', core.rej('NO_POS').why);
    if (req.side !== opp(p.side)) return no('LINK_SIDE', 'A stop loss or a target closes the position: it must be on the other side');
    if (req.leg === 'SL') {
      if (req.ot !== 'stop') return no('LINK_TYPE', 'A stop loss is a stop order');
      const r = core.modify(A.acct, { posId: p.id, sl: req.price });
      if (!r.ok) return no(r.code, r.why);
      if (p.slLink) report(A, rec, { kind: 'cancel', text: `Replaced by ${ids.clOrdId}` }, slIds(p));
      p.slLink = { cl: ids.clOrdId, oid: A.acct.nextId++, lots: p.lots };
      slReason(p, req.reason);
      report(A, rec, { kind: 'new', order: slTerms(p) }, slIds(p));
    } else if (/^TP[1-4]$/.test(req.leg || '')) {
      if (req.ot !== 'limit') return no('LINK_TYPE', 'A take profit is a limit order');
      const q = market.quote(p.sym), buy = p.side === 'buy';
      if (!(buy ? req.price > q.bid : req.price < q.ask)) { const r = core.rej('MOD_TP_SIDE', { dir: buy ? 'above' : 'below', ref: buy ? 'bid' : 'ask' }); return no(r.code, r.why); }
      const oid = A.acct.nextId++;
      if (!p.tps && req.lots >= p.lots - 1e-9) { // the whole position: a plain target (a second one replaces the first)
        const r = core.modify(A.acct, { posId: p.id, tp: req.price });
        if (!r.ok) return no(r.code, r.why);
        if (p.tpLink) report(A, rec, { kind: 'cancel', text: `Replaced by ${ids.clOrdId}` }, tpIds(p));
        p.tpLink = { cl: ids.clOrdId, oid, lots: p.lots, gleg: req.leg };
        report(A, rec, { kind: 'new', order: tpTerms(p) }, tpIds(p));
      } else {
        const base = p.tpLink ? [{ price: p.tp, lots: p.lots, cl: p.tpLink.cl, oid: p.tpLink.oid, gleg: p.tpLink.gleg }] : legsOf(p); // a part next to a plain target covers too much
        const r = setLegs(A, p, [...base, { price: req.price, lots: req.lots, cl: ids.clOrdId, oid, gleg: req.leg }]);
        if (!r.ok) return no(r.code, r.why);
        delete p.tpLink;
        const l = p.tps.find(x => x.cl === ids.clOrdId);
        report(A, rec, { kind: 'new', order: legTerms(p, l) }, legIds(p, l));
      }
    } else return no('LINK_LEG', 'A linked order is a stop loss (SL) or a target (TP1 to TP4)');
    persist(A);
  }
  // the reason a stop loss order carries (5016: 'Trailing stop', 'Stop loss (break-even)'): the history row's when it fills
  const slReason = (p, r) => { if (r) p.slReason = String(r).slice(0, 80); else delete p.slReason; };
  function working(A) {
    const out = A.acct.orders.map(o => [ordIds(o), ordTerms(o)]);
    for (const p of A.acct.positions) {
      if (p.slLink) out.push([slIds(p), slTerms(p)]);
      if (p.tpLink) out.push([tpIds(p), tpTerms(p)]);
      for (const l of p.tps || []) if (l.cl) out.push([legIds(p, l), legTerms(p, l)]);
    }
    return out;
  }

  /* ---------- events of the core → reports ----------
     sn: the book before the operation (snap), so a fill finds its order (a pending order's id, a stop's or a target's
     link) and the links of a position that closed or shrank are cancelled or restated. ctx.cl: the ClOrdID of the D
     that caused the fills, if any. */
  function snap(A) {
    return {
      pos: new Map(A.acct.positions.map(p => [p.id, { sym: p.sym, side: p.side, lots: p.lots, sl: p.slLink ? { ...p.slLink } : null, tp: p.tpLink ? { ...p.tpLink } : null, legs: (p.tps || []).filter(l => l.cl).map(l => ({ ...l })) }])),
      ords: new Map(A.acct.orders.map(o => [o.id, o.clOrdId])),
    };
  }
  function reportEvents(A, ctx, events, sn) {
    const used = new Set(), touched = new Map();
    for (const e of events) {
      if (e.type === 'fill') {
        const f = e.fill; touched.set(f.pos, f.sym);
        let cl = null, orderId;
        if (f.order != null && sn.ords.has(f.order)) { cl = sn.ords.get(f.order); orderId = String(f.order); }
        else if (ctx.cl) { cl = ctx.cl; orderId = ctx.orderId; }
        else if (e.trade) {
          const s = sn.pos.get(f.pos), leg = e.trade.leg;
          const link = s && (leg === 'SL' ? s.sl : s.tp && leg === 'TP1' ? s.tp : s.legs.find(l => l.leg === leg));
          if (link) { cl = link.cl; orderId = String(link.oid); }
        }
        if (!cl) cl = `bk-${A.id}-${f.fid}`; // the broker's own: a stop-out
        used.add(cl);
        report(A, ctx, { kind: 'fill', receipt: f }, { clOrdId: cl, orderId });
        if (e.trade) B.addTrade(A.id, e.trade);
      } else if (e.type === 'filled') logRow(A, 'filled', e.order);
      else if (e.type === 'cancel' || e.type === 'expire' || e.type === 'reject') {
        const o = e.order; if (!o || !o.clOrdId) continue;
        logRow(A, e.type, o);
        used.add(o.clOrdId);
        report(A, ctx, e.type === 'reject' ? { kind: 'reject', code: e.code || 'NOT_FILLED', text: e.text || o.why || 'could not be filled' } : { kind: 'cancel', text: o.why }, ordIds(o));
      } else if (e.type === 'trigger') { const o = e.order; if (o && o.clOrdId) report(A, ctx, { kind: 'restated', order: ordTerms(o), text: 'Triggered: working as a limit' }, ordIds(o)); }
      else if (e.type === 'nbp') B.addTrade(A.id, e.trade);
      else if (e.type === 'swap') for (const r of e.rows) { const p = A.acct.positions.find(x => x.id === r.pos); if (p) touched.set(p.id, p.sym); }
    }
    // the links of what closed or shrank
    for (const [id, s] of sn.pos) {
      const p = A.acct.positions.find(x => x.id === id), gone = (l, text) => { if (!used.has(l.cl)) report(A, ctx, { kind: 'cancel', text }, { orderId: String(l.oid), clOrdId: l.cl, sym: s.sym, side: opp(s.side), lots: l.lots }); };
      if (!p) { touched.set(id, s.sym); if (s.sl) gone(s.sl, 'Position closed'); if (s.tp) gone(s.tp, 'Position closed'); for (const l of s.legs) gone(l, 'Position closed'); continue; }
      if (s.tp && !p.tpLink) gone(s.tp, 'Position reduced');
      for (const l of s.legs) {
        const c = (p.tps || []).find(x => x.cl === l.cl);
        if (!c) gone(l, 'Position reduced');
        else if (c.lots !== l.lots) report(A, ctx, { kind: 'restated', order: legTerms(p, c), text: 'Cut to the position size' }, legIds(p, c));
      }
      if (s.sl && p.slLink && p.lots !== s.lots) { p.slLink.lots = p.lots; report(A, ctx, { kind: 'restated', order: slTerms(p), text: 'Resized to the position' }, slIds(p)); }
      if (s.tp && p.tpLink && p.lots !== s.lots) { p.tpLink.lots = p.lots; report(A, ctx, { kind: 'restated', order: tpTerms(p), text: 'Resized to the position' }, tpIds(p)); }
      if (p.lots !== s.lots) touched.set(id, p.sym);
    }
    ensureLinks(A, ctx);
    persist(A);
    pushPos(A, touched);
  }

  /* ---------- ticks, the 1 s sweep, the rollover ---------- */
  const runTick = (A, t) => store.tx(() => { hooks.tick?.(A.id); const sn = snap(A), ev = core.onTick(A.acct, t); if (ev.length) reportEvents(A, tickCtx, ev, sn); markRan(A.id, t); return true; });
  const lastQ = new Map();
  function tick(rows) {
    market.setQuotes(rows);
    if (!Array.isArray(rows) || !market.feedAlive()) return;
    if (recov.wait.size) recov.buf.push({ t: tsec(), rows: rows.filter(Array.isArray).map(r => [r[0], r[1], r[2], r[3]]) }); // for the accounts still waiting
    const ch = new Set();
    for (const r of rows) { if (!Array.isArray(r)) continue; const k = `${r[1]},${r[2]},${r[3]}`; if (lastQ.get(r[0]) !== k) { lastQ.set(r[0], k); ch.add(r[0]); } }
    if (!ch.size) return;
    const t = tsec();
    eachAccount('tick', A => (A.acct.positions.some(p => ch.has(p.sym)) || A.acct.orders.some(o => ch.has(o.sym))) && runTick(A, t));
  }
  let rollAt = -Infinity, pruneAt = -Infinity, paused = false;
  function sweep() {
    if (paused) return;
    if (fetchBars && !recov.busy) {
      // an operator's --clear-recovery removed the mark: the account trades again
      const marks = new Set(B.metaLike('pending:').map(r => r.k.slice(8)));
      for (const id of [...recov.pending.keys()]) if (!marks.has(id)) { recov.pending.delete(id); log(`account ${id}: recovery cleared by the operator, it trades again from now (the missed time is not played)`); }
      if (recov.pending.size && now() - recov.retryAt >= retryMs) {
        recov.retryAt = now();
        recov.run = recoverNow([...recov.pending.keys()]).catch(e => log(`recovery retry failed (${e.name})`));
      }
    }
    // the whole book once a second (expiries, and anything a tick did not reach); never on a dead feed
    if (market.feedAlive()) { const t = tsec(); eachAccount('tick', A => (A.acct.positions.length > 0 || A.acct.orders.length > 0) && runTick(A, t)); }
    if (now() - rollAt >= ROLL_MS) {
      rollAt = now(); const t = tsec();
      eachAccount('rollover', A => store.tx(() => { const sn = snap(A), ev = core.rollover(A.acct, t); if (ev.length) reportEvents(A, tickCtx, ev, sn); return ev.length > 0; }));
    }
    if (Date.now() - pruneAt >= 86400000) {
      pruneAt = Date.now();
      try { const n = B.pruneFixOut(pruneAt - KEEP_MS); if (n) log(`fix_out: ${n} messages older than 7 days pruned`); } catch (e) { log(`fix_out prune failed (${e.name})`); }
    }
    // the account's peak equity (the drawdown readout, the same on every device): followed once a second, live feed only
    if (market.feedAlive()) eachAccount('peak', A => {
      if (!A.acct.positions.length) return false;
      const e = core.summary(A.acct).equity;
      if (!(Number.isFinite(e) && e > A.acct.peak + .005)) return false;
      store.tx(() => { A.acct.peak = e; B.setPeak(A.id, e); }); return true;
    });
    if (live()) for (const id of [...subs.coll]) {
      const A = accts.get(id); if (!A) continue;
      const s = sumOf(A), k = JSON.stringify(s);
      if (subs.lastBA.get(id) !== k) { subs.lastBA.set(id, k); acceptor.send(gwCompId, 'BA', FX.summaryToBA(s, id)); }
    }
  }

  /* ---------- the gateway's messages ---------- */
  // the answer to a ClOrdID already handled, again (true), or nothing (false)
  // the answer to a ClOrdID already handled (true): again, unchanged, for the same account; a j DUP_CLORD for another
  const repeat = (cl, ctx, m, account) => {
    const r = B.clordGet(cl); if (!r) return false;
    if (r.account != null && r.account !== account) { jRej(ctx, m, 'DUP_CLORD', 'ClOrdID already used by another account', account); return true; }
    for (const [t, f] of r.out) ctx.send(t, f);
    return true;
  };
  const recorder = (ctx, cl) => { const out = []; return { cl, out, send: (t, f) => { out.push([t, f]); ctx.send(t, f); } }; };
  // FIX time is the wall clock (SendingTime), whatever the market clock says
  const stale = m => { const pd = one(m, 43) === 'Y', ts = parseFixTime(pd ? one(m, 122) || one(m, 52) : one(m, 52)); return !(Date.now() - ts <= staleMs); };
  const jRej = (ctx, m, code, text, account, reason = 0) => ctx.send('j', FX.rejectToJ({ refSeq: m.seq, refMsgType: m.type, reason, account, code, text }));

  const H = {
    D(m, ctx) {
      const { req, clOrdId: cl, account } = FX.dToOrder(m);
      if (!cl || !account) return jRej(ctx, m, 'MISSING', 'ClOrdID and Account are required', account);
      if (repeat(cl, ctx, m, account)) return;
      if (hooks.afterCommit) store.afterCommit(() => hooks.afterCommit(cl)); // tests: before any report reaches the wire
      const rec = recorder(ctx, cl), A = accts.get(account);
      const ids = { clOrdId: cl, sym: req.sym, side: req.side in { buy: 1, sell: 1 } ? req.side : undefined, lots: Number.isFinite(req.lots) ? req.lots : undefined };
      const refuse = (code, text) => report(A || { id: account }, rec, { kind: 'reject', code, text }, ids);
      if (stale(m)) refuse('STALE', `Not executed: the order reached the broker more than ${staleMs / 1000} s after it was sent`);
      else if (!A) refuse('NO_ACCOUNT', 'Unknown account');
      else if (held(account)) refuse('RECOVERY', heldWhy(account));
      else if (quarantined.has(account)) refuse('SUSPENDED', 'This account is suspended by the broker after repeated errors: nothing is executed on it');
      else if (!M(req.sym)) refuse('UNKNOWN_SYM', core.rej('UNKNOWN_SYM').why);
      else if (!ids.side) refuse('SIDE', 'Side must be buy or sell');
      else if (req.linkPos != null) linkNew(A, rec, req, ids);
      else if (req.ot === 'market' && req.posId != null && !req.net && A.acct.positions.some(p => p.id === req.posId && p.sym === req.sym && p.side === req.side))
        refuse('CLOSE_ONLY', 'An order on a position (721) without net (5004) closes it: it must be on the other side');
      else if (req.ot === 'market') {
        const sn = snap(A), oid = A.acct.nextId++;
        // 721 without 5004: close only, never more than the position holds now (no reversal remainder); gone → NO_POS.
        // 5016: the reason of the fill and of the close it makes (the gateway's 'Basket stop', 'Time stop', …); without
        // 721 or 5004 the new position is hedged (a basket leg): it never nets with a later order
        const tgt = req.posId != null && !req.net ? A.acct.positions.find(p => p.id === req.posId && p.sym === req.sym) : null;
        // the exits (5050-5056) go with the position it opens, in this same step: its stop loss and targets are linked
        // orders at once (ensureLinks); a close-only D (721 without 5004) opens nothing and carries none
        const ex = tgt ? {} : Object.fromEntries(FX.EXIT_KEYS.filter(k => req[k] != null).map(k => [k, req[k]]));
        const r = core.openMarket(A.acct, { sym: req.sym, side: req.side, lots: tgt ? Math.min(req.lots, tgt.lots) : req.lots, posId: req.posId ?? undefined, net: req.net || undefined,
          hedge: req.posId == null && !req.net ? true : undefined, reason: req.reason || 'Market order', closeReason: req.reason || undefined, refKind: 'quote at the click', ...ex });
        const c = { ...rec, orderId: String(oid) };
        if (r.events && r.events.length) reportEvents(A, c, r.events, sn);
        if (!r.ok) report(A, rec, { kind: 'reject', code: r.code, text: r.why }, { ...ids, orderId: String(oid) });
        else if (r.restRej) report(A, rec, { kind: 'reject', code: r.restRej.code, text: `Reversal remainder not opened: ${r.restRej.why}` }, { ...ids, orderId: String(oid) });
        persist(A);
      } else if (['limit', 'stop', 'stoplimit'].includes(req.ot)) {
        const o = { sym: req.sym, side: req.side, ot: req.ot === 'stoplimit' ? 'stop' : req.ot, price: req.price, lots: req.lots, tif: req.tif || 'GTC', clOrdId: cl };
        if (req.ot === 'stoplimit') o.limit = req.limit;
        if (req.tif === 'GTD') o.expires = req.expires;
        if (req.posId != null) o.posId = req.posId;
        if (req.net) o.net = true; else if (req.posId == null) o.hedge = true;
        if (req.oca) { o.ocaKey = req.oca; const peer = A.acct.orders.find(x => x.ocaKey === req.oca); if (peer) o.oca = peer.id; }
        // its exits: offsets (slPips, tpPips, tps rows, trail, be: checked by core.place) or prices (slPx, tpPx, tpsPx)
        const xf = exitFields(req, o);
        if (xf.ok) { Object.assign(o, { slPips: xf.f.slPips, tpPips: xf.f.tpPips, trail: xf.f.trail }); if (xf.f.tps) o.tps = xf.f.tps; if (xf.f.be) o.be = xf.f.be; setExits(o, xf.f); }
        const r = xf.ok ? core.place(A.acct, o) : xf;
        if (!r.ok) refuse(r.code, r.why);
        else { report(A, rec, { kind: 'new', order: ordTerms(r.order) }, ordIds(r.order)); persist(A); }
      } else refuse('ORD_TYPE', 'Unsupported order type');
      B.clordPut(cl, account, rec.out);
    },
    F(m, ctx) {
      const x = FX.fToCancel(m), cl = x.clOrdId;
      if (!cl) return jRej(ctx, m, 'MISSING', 'ClOrdID is required', x.account);
      if (repeat(cl, ctx, m, x.account)) return;
      const rec = recorder(ctx, cl), A = accts.get(x.account), f = find(A, x.origClOrdId), more = { clOrdId: cl, origClOrdId: x.origClOrdId };
      const no = (code, text, orderId) => rec.send('9', FX.cxlRejectTo9({ orderId, clOrdId: cl, origClOrdId: x.origClOrdId || 'NONE', account: x.account || 'NONE', responseTo: 'F', code, text }));
      if (!f) no('NO_ORDER', core.rej('NO_ORDER').why);
      else if (held(x.account)) no('RECOVERY', heldWhy(x.account));
      else {
        const [ids, r] = f.o ? [ordIds(f.o), core.cancel(A.acct, f.o.id, 'Cancelled')]
          : f.sl ? [slIds(f.p), core.modify(A.acct, { posId: f.p.id, sl: null })]
          : f.tp ? [tpIds(f.p), core.modify(A.acct, { posId: f.p.id, tp: null })]
          : [legIds(f.p, f.l), setLegs(A, f.p, legsOf(f.p).filter(l => l.cl !== x.origClOrdId))];
        if (!r.ok) no(r.code, r.why, ids.orderId);
        else {
          if (f.sl) delete f.p.slLink; if (f.tp) delete f.p.tpLink;
          if (f.o) for (const e of r.events || []) if (e.type === 'cancel') logRow(A, 'cancel', e.order);
          report(A, rec, { kind: 'cancel', text: 'Cancelled' }, { ...ids, ...more }); persist(A);
        }
      }
      B.clordPut(cl, x.account, rec.out);
    },
    G(m, ctx) {
      const x = FX.gToReplace(m), req = x.req, cl = x.clOrdId;
      if (!cl) return jRej(ctx, m, 'MISSING', 'ClOrdID is required', x.account);
      if (repeat(cl, ctx, m, x.account)) return;
      const rec = recorder(ctx, cl), A = accts.get(x.account), f = find(A, x.origClOrdId);
      const no = (code, text, orderId) => rec.send('9', FX.cxlRejectTo9({ orderId, clOrdId: cl, origClOrdId: x.origClOrdId || 'NONE', account: x.account || 'NONE', responseTo: 'G', code, text }));
      const inj = hooks.refuseG?.(m); if (inj) return no('INJECTED', inj); // tests only: a G refused on purpose
      if (!f) no('NO_ORDER', core.rej('NO_ORDER').why);
      else if (held(x.account)) no('RECOVERY', heldWhy(x.account));
      else if (f.o) {
        if (Math.abs(req.lots - f.o.lots) > 1e-9) no('SIZE', 'The size of a working order cannot be changed: cancel it and send a new one', String(f.o.id));
        else if (req.tif === 'GTD' && !(req.expires >= tsec() + 60)) no('EXPIRY', core.rej('EXPIRY').why, String(f.o.id));
        else {
          const ch = { orderId: f.o.id, price: req.price }; if (f.o.limit != null || req.ot === 'stoplimit') ch.limit = req.limit ?? null;
          // a G is the order in full: its exits replace the order's (none on the G: none any more)
          const xf = exitFields(req, { ...f.o, price: req.price ?? f.o.price });
          if (xf.ok) { ch.tps = xf.f.tps; ch.trail = xf.f.trail; ch.be = xf.f.be; }
          const r = xf.ok ? core.modify(A.acct, ch) : xf;
          if (r.ok) setExits(f.o, xf.f);
          // the time in force may change too (GTC / DAY / GTD and its expiry)
          if (r.ok && req.tif && (req.tif !== f.o.tif || (req.tif === 'GTD' && req.expires !== f.o.expires))) {
            f.o.tif = req.tif;
            if (req.tif === 'GTD') f.o.expires = req.expires; else if (req.tif === 'DAY') f.o.expires = core.dayEnd(tsec()); else delete f.o.expires;
          }
          // the OCO group (5001) may change on a G: a working order joins the group a new order will carry, or leaves it
          if (r.ok && (req.oca ?? null) !== (f.o.ocaKey ?? null)) {
            if (req.oca) { const peer = A.acct.orders.find(y => y !== f.o && y.ocaKey === req.oca); f.o.ocaKey = req.oca; f.o.oca = peer ? peer.oca || 'o' + peer.id : 'o' + f.o.id; if (peer && !peer.oca) peer.oca = f.o.oca; }
            else { delete f.o.ocaKey; f.o.oca = null; }
          }
          if (!r.ok) no(r.code, r.why, String(f.o.id));
          else { f.o.clOrdId = cl; report(A, rec, { kind: 'replaced', order: ordTerms(f.o) }, { ...ordIds(f.o), origClOrdId: x.origClOrdId }); persist(A); }
        }
      } else if (f.sl) {
        const r = core.modify(A.acct, { posId: f.p.id, sl: req.price });
        if (!r.ok) no(r.code, r.why, String(f.p.slLink.oid));
        else { f.p.slLink.cl = cl; slReason(f.p, req.reason); report(A, rec, { kind: 'replaced', order: slTerms(f.p) }, { ...slIds(f.p), origClOrdId: x.origClOrdId }); persist(A); }
      } else if (f.tp && req.lots >= f.p.lots - 1e-9) {
        const r = core.modify(A.acct, { posId: f.p.id, tp: req.price });
        if (!r.ok) no(r.code, r.why, String(f.p.tpLink.oid));
        else { f.p.tpLink.cl = cl; report(A, rec, { kind: 'replaced', order: tpTerms(f.p) }, { ...tpIds(f.p), origClOrdId: x.origClOrdId }); persist(A); }
      } else if (f.tp) { // the plain target becomes a part of the position
        const r = setLegs(A, f.p, [{ price: req.price, lots: req.lots, cl, oid: f.p.tpLink.oid, gleg: f.p.tpLink.gleg }]);
        const l = r.ok && (f.p.tps || []).find(y => y.cl === cl);
        if (!l) no(r.code || 'NOT_APPLIED', r.why || 'Not applied', String(f.p.tpLink.oid));
        else { delete f.p.tpLink; report(A, rec, { kind: 'replaced', order: legTerms(f.p, l) }, { ...legIds(f.p, l), origClOrdId: x.origClOrdId }); persist(A); }
      } else {
        const r = setLegs(A, f.p, legsOf(f.p).map(l => (l.cl === x.origClOrdId ? { ...l, price: req.price, lots: req.lots, cl } : l)));
        const l = r.ok && (f.p.tps || []).find(y => y.cl === cl);
        if (!l) no(r.code || 'NOT_APPLIED', r.why || 'Not applied', String(f.l.oid));
        else { report(A, rec, { kind: 'replaced', order: legTerms(f.p, l) }, { ...legIds(f.p, l), origClOrdId: x.origClOrdId }); persist(A); }
      }
      B.clordPut(cl, x.account, rec.out);
    },
    H(m, ctx) {
      const cl = one(m, 11), account = one(m, 1), A = accts.get(account), f = find(A, cl);
      if (f) { const [ids, order] = f.o ? [ordIds(f.o), ordTerms(f.o)] : f.sl ? [slIds(f.p), slTerms(f.p)] : f.tp ? [tpIds(f.p), tpTerms(f.p)] : [legIds(f.p, f.l), legTerms(f.p, f.l)]; return status(account, ctx, 'working', ids, order); }
      // a ClOrdID no longer working that a later report names in 41 (a G replaced it, an F cancelled it): that report says
      const by = A && cl ? B.lastByOrig(account, cl) : null;
      const bx = by && FX.reportToExec({ fields: new Map(by.fields.map(([t, v]) => [String(t), String(v)])), groups: new Map() }), bst = bx && { replaced: 'replaced', cancel: 'cancelled' }[bx.kind];
      if (bst) {
        const x = bx;
        return status(account, ctx, bst, { orderId: x.ids.orderId === 'NONE' ? undefined : x.ids.orderId, clOrdId: cl, sym: x.ids.sym, side: x.ids.side, lots: x.ids.lots }, undefined, { text: x.text });
      }
      // a finished order: its state from its last report
      const last = A && cl ? B.lastExec(account, cl) : null;
      if (last) {
        const x = FX.reportToExec({ fields: new Map(last.fields.map(([t, v]) => [String(t), String(v)])), groups: new Map() }), r = x.receipt || {};
        const st = { fill: 'filled', cancel: /expiry/.test(x.text || '') ? 'expired' : 'cancelled', reject: 'rejected' }[x.kind] || 'working';
        return status(account, ctx, st, { orderId: x.ids.orderId === 'NONE' ? undefined : x.ids.orderId, clOrdId: cl, sym: r.sym ?? x.ids.sym, side: r.side ?? x.ids.side, lots: r.lots ?? x.ids.lots }, undefined, { text: x.text });
      }
      status(account || 'NONE', ctx, 'rejected', { clOrdId: cl || 'NONE' }, undefined, { text: 'Unknown order' });
    },
    AF(m, ctx) {
      const account = one(m, 1), massId = one(m, 584), list = [];
      for (const A of account ? [accts.get(account)].filter(Boolean) : accts.values()) for (const [ids, order] of working(A)) list.push([A.id, ids, order]);
      if (!list.length) return status(account || 'NONE', ctx, 'rejected', { clOrdId: 'NONE' }, undefined, { text: 'No working orders', ids: { massId, total: 0 } });
      for (const [a, ids, order] of list) status(a, ctx, 'working', ids, order, { ids: { massId, total: list.length } });
    },
    AN(m, ctx) {
      const reqId = one(m, 710) ?? 'NONE', account = one(m, 1), sub = one(m, 263), list = [];
      for (const A of account ? [accts.get(account)].filter(Boolean) : accts.values()) for (const p of A.acct.positions) list.push([A.id, p]);
      ctx.send('AO', FX.posAckToAO({ reqId, account, total: list.length }));
      for (const [a, p] of list) ctx.send('AP', FX.posToAP(posOf(p), a, { ...OPTS, reqId }));
      if (sub === '1') subs.pos.add(account || '*'); else if (sub === '2') subs.pos.delete(account || '*');
    },
    BB(m, ctx) {
      const account = one(m, 1), A = accts.get(account);
      if (!A) return jRej(ctx, m, 'NO_ACCOUNT', 'Unknown account', account);
      const s = sumOf(A);
      ctx.send('BA', FX.summaryToBA(s, account, { inquiryId: one(m, 909) }));
      const sub = one(m, 263); // 1: BA on every change from now on; 2: no more; absent: this snapshot only
      if (sub === '1') { subs.coll.add(account); subs.lastBA.set(account, JSON.stringify(s)); } else if (sub === '2') subs.coll.delete(account);
    },
    // the history window: the newest max rows after skip (5060 / 5061; none: all of it), AQ with the total first
    AD(m, ctx) {
      const { account, reqId, max, skip } = FX.adToHist(m), A = accts.get(account);
      if (!A) return jRej(ctx, m, 'NO_ACCOUNT', 'Unknown account', account);
      const total = B.tradeCount(account, A.created), rows = B.tradesPage(account, A.created, max || total || 1, skip);
      ctx.send('AQ', FX.histAckToAQ({ reqId, account, total }));
      for (const t of rows) ctx.send('AE', FX.tradeToAE(tradeOf(t), account, OPTS));
    },
    // the newest fill receipts and order-log rows (U3), from the executions since the last demo Reset (the migrated too)
    U2(m, ctx) {
      const x = FX.u2ToRecords(m), A = accts.get(x.account);
      if (!A) return jRej(ctx, m, 'NO_ACCOUNT', 'Unknown account', x.account);
      const from = +(B.metaGet('reset:' + A.id) || 0), fills = [], log = [];
      for (const e of B.records(A.id, from, x.fills, x.log)) {
        if (e.kind === 'fill' && Array.isArray(e.fields)) { const r = FX.reportToExec({ fields: new Map(e.fields.map(([t, v]) => [String(t), String(v)])), groups: new Map() }).receipt; if (r) fills.push(r); }
        else if (e.type === 'fill' && e.fill) fills.push(e.fill);
        else if (e.order && ['filled', 'cancel', 'expire', 'reject'].includes(e.type)) log.push(e.order);
      }
      for (const f of FX.recordsToU3('fill', fills.slice(0, x.fills), A.id, x.reqId)) ctx.send('U3', f);
      for (const f of FX.recordsToU3('log', log.slice(0, x.log), A.id, x.reqId)) ctx.send('U3', f);
    },
    U1(m, ctx) {
      const op = FX.u1Op(m), account = one(m, 1);
      if (!account) return jRej(ctx, m, 'MISSING', 'Account is required');
      if (recov.wait.has(account)) return jRej(ctx, m, 'RECOVERY', heldWhy(account), account); // its book is being played: no change now
      if (op === 'SET') {
        const st = FX.u1ToSettings(m).settings, no = (code, text) => jRej(ctx, m, code, text, account);
        let A = accts.get(account);
        const type = A ? A.type : st.type || 'demo', range = (k, lo, hi) => st[k] != null && !(Number.isFinite(st[k]) && st[k] >= lo && st[k] <= hi);
        if (st.jur != null && !AccountCore.JUR[st.jur]) return no('JUR', 'Unknown jurisdiction');
        if (st.lev != null && !(Number.isFinite(st.lev) && st.lev >= 1 && st.lev <= 1000)) return no('LEV', 'Leverage must be 1 to 1000 (or the sheet default)');
        if (st.slip != null && st.slip !== 'sym' && st.slip !== 'off') return no('SLIP', 'Slippage must be sym or off');
        if (range('slipSd', 0, 5) || range('latMs', 0, 2000) || range('comm', 0, 50)) return no('EXEC_RANGE', 'Execution settings out of range (slip σ 0–5 pips, latency 0–2000 ms, commission 0–50 USD a lot)');
        if (st.type != null && st.type !== 'demo' && st.type !== 'live') return no('ACCT_TYPE', 'Account type must be demo or live');
        if (A && st.type != null && st.type !== A.type) return no('ACCT_TYPE', 'The account type cannot be changed');
        if (type === 'live' && (st.slip === 'off' || st.slipSd === 0 || st.latMs === 0 || (st.comm != null && st.comm < (A ? A.acct.set.comm || 0 : 0))))
          return no('LIVE_EXEC', "A live account executes with the broker's slippage, latency and commission");
        if (!A) {
          A = { id: account, type, ...uidOf(account), created: tsec(), acct: { balance: START, peak: START, positions: [], orders: [], set: { ...DEF_SET }, nextId: 1, nextFill: 1, rollLast: null } };
          accts.set(account, A);
        }
        // trade.js applyProfile: a jurisdiction with no leverage choice takes its FX-major cap, and the initial margin of
        // the open positions follows the new leverage
        const set = A.acct.set, was = A.acct.positions.filter(p => M(p.sym)).map(p => [p, core.posMargin(p, set), core.effLev(p.sym, set)]);
        for (const k of SET_KEYS) if (st[k] !== undefined) set[k] = st[k];
        { const j = core.jurOf(set); if (!j.choice) set.lev = j.cap['fx-major']; }
        for (const [p, im, l0] of was) p.im = im * l0 / core.effLev(p.sym, set);
        dropUnavailable(A, ctx);
        persist(A);
        return ctx.send('BA', FX.summaryToBA(sumOf(A), account));
      }
      if (op === 'RESET') {
        const A = accts.get(account);
        if (!A) return jRej(ctx, m, 'NO_ACCOUNT', 'Unknown account', account);
        if (A.type !== 'demo') return jRej(ctx, m, 'NOT_DEMO', NOT_DEMO, account);
        for (const o of A.acct.orders) report(A, ctx, { kind: 'cancel', text: 'Account reset' }, ordIds(o));
        const touched = new Map();
        for (const p of A.acct.positions) {
          touched.set(p.id, p.sym);
          if (p.slLink) report(A, ctx, { kind: 'cancel', text: 'Account reset' }, slIds(p));
          if (p.tpLink) report(A, ctx, { kind: 'cancel', text: 'Account reset' }, tpIds(p));
          for (const l of p.tps || []) if (l.cl) report(A, ctx, { kind: 'cancel', text: 'Account reset' }, legIds(p, l));
        }
        Object.assign(A.acct, { positions: [], orders: [], balance: START, peak: START });
        A.created = tsec(); // the history starts again (trades closed before stay in the table)
        B.metaSet('reset:' + A.id, B.nextExecSeq()); // and the fills and the order log (U2) with it
        if (recov.pending.delete(account)) { B.metaDel('pending:' + account); log(`account ${account}: reset, its pending recovery is dropped`); }
        persist(A); pushPos(A, touched);
        return ctx.send('BA', FX.summaryToBA(sumOf(A), account));
      }
      if (op === 'UNHEDGE') { // a basket split: the leg is an ordinary position of the net book from now on
        const A = accts.get(account), id = Number(one(m, FX.TAG.POS_ID)), p = A && A.acct.positions.find(x => x.id === id);
        if (!p) return jRej(ctx, m, 'NO_POS', 'Position not found', account);
        if (p.hedge) { delete p.hedge; persist(A); }
        return pushPos(A, new Map([[p.id, p.sym]]));
      }
      jRej(ctx, m, 'U1_OP', 'Unknown account operation', account);
    },
  };
  const appFails = new Map(); // MsgType:seq -> failures in a row
  function onApp(m, s) {
    const ctx = { send: (t, f) => s.send(t, f) }, key = `${m.type}:${m.seq}`, account = one(m, 1);
    try {
      store.savepoint(() => {
        hooks.onApp?.(m);
        if (Object.hasOwn(H, m.type)) H[m.type](m, ctx);
        else jRej(ctx, m, 'UNSUPPORTED', 'Unsupported message type', account, 3);
      });
      appFails.delete(key);
    } catch (e) {
      // the savepoint rolled the writes back: the account as committed again
      if (account != null && accts.has(account)) reloadOne(account); else { accts.clear(); for (const A of B.load()) accts.set(A.id, A); }
      if (process.env.TB_BROKER_DEBUG) console.error(e.stack);
      const n = (appFails.get(key) || 0) + 1; appFails.set(key, n);
      // a D that keeps throwing (a malformed one, a broken stored answer) and is now past the stale limit can no longer be
      // executed anyway: refused with a reject 8 and consumed, so it does not block the session
      if (m.type === 'D' && stale(m)) {
        try {
          const cl = one(m, 11) || 'NONE', rec = recorder(ctx, cl);
          store.savepoint(() => { // the report, its stored answer and its wire write: all or nothing
            report({ id: account || 'NONE' }, rec, { kind: 'reject', code: 'DEAD_LETTER', text: `Not executed: the broker could not process this order, and it is now more than ${staleMs / 1000} s old` }, { clOrdId: cl });
            if (cl !== 'NONE' && account) B.clordPut(cl, account, rec.out);
          });
          appFails.delete(key);
          log(`dead letter: D seq ${m.seq} failed ${n} times and is stale, refused with a reject 8 and consumed`);
          return;
        } catch (e2) { if (process.env.TB_BROKER_DEBUG) console.error(e2.stack); }
      }
      if (m.type !== 'D' && n >= 3) { // dead letter: refused and consumed (a D keeps coming back: an order is never dropped silently)
        appFails.delete(key);
        log(`dead letter: ${m.type} seq ${m.seq} failed ${n} times, refused with j and consumed`);
        return jRej(ctx, m, 'DEAD_LETTER', 'The broker could not process this message', account);
      }
      // the session logs one line (MsgType, seq), logs out, and the message comes again by resend
      throw new Error(`broker error (${e.name})`);
    }
  }

  acceptor = createAcceptor({ port, host, compId, store, log, onApp, auth: (u, p, c) => u === user && p === pass && c === gwCompId });
  const bound = await acceptor.ready;
  // when each account last ran (meta ran:<account>, else its last execution), read before the start's own reports below
  const lastRun = id => +(B.metaGet('ran:' + id) || 0) || B.lastExecT(id) || 0;
  const ranAt = new Map([...accts.keys()].map(id => [id, lastRun(id)]));
  if (fetchBars) for (const id of accts.keys()) recov.wait.add(id); // nothing runs on them until their recovery
  // at start: orders the jurisdiction no longer offers leave, and exits without a ClOrdID get one (a migrated account)
  // and a flat account with a negative balance gets its negative balance protection (the last trade gives its price)
  eachAccount('start', A => store.tx(() => {
    const n = B.nextExecSeq(), bal = A.acct.balance;
    dropUnavailable(A, tickCtx); ensureLinks(A, tickCtx);
    if (!A.acct.positions.length && bal < 0) A.acct.history = B.trades(A.id, A.created).slice(-1);
    if (B.nextExecSeq() !== n || A.acct.history) { persist(A); delete A.acct.history; }
    return true;
  }), true);
  const release = id => { recov.wait.delete(id); if (!recov.wait.size) recov.buf = []; };
  function markPending(p) {
    const was = recov.pending.get(p.id), v = { from: p.from, why: p.why, at: was ? was.at : Date.now() };
    recov.pending.set(p.id, v); B.metaSet('pending:' + p.id, JSON.stringify(v));
    if (!was || was.why !== p.why) log(`account ${p.id}: recovery pending, ${p.why}: nothing executes on it until it completes or node host/broker.mjs --clear-recovery ${p.id}`);
  }
  /* the recovery of ids (null: every account): see the header. Each account's events are reported inside its own
     transaction with its ran:<account> mark (the end of what was played), and it is released right after. */
  async function recoverNow(ids, fromOf = lastRun) {
    recov.busy = true;
    const ids0 = (ids || [...accts.keys()]).filter(id => accts.has(id) && !quarantined.has(id)), fromAt = id => recov.pending.get(id)?.from ?? fromOf(id);
    for (const id of ids0) recov.wait.add(id); // a retry: the ticks are buffered from now
    let fills = 0;
    const noted = new Set();
    try {
      let list = [];
      for (const id of ids0) { const from = fromAt(id); if (from > 0) list.push({ A: accts.get(id), from }); else release(id); } // a new database: nothing known, nothing to play
      for (let round = 0; list.length && round < 10; round++) {
        hooks.recover?.(round);
        const to = tsec(), again = [];
        const each = (A, run) => {
          try {
            return store.tx(() => { const sn = snap(A), r = run(); if (r.events.length) reportEvents(A, tickCtx, r.events, sn); B.metaSet('ran:' + A.id, r.end); fills += r.events.filter(e => e.type === 'fill').length; return r; });
          } catch (e) { reloadOne(A.id); throw e; }
        };
        const done = (id, end) => {
          if (tsec() - end >= 60 && round < 9) { again.push({ A: accts.get(id), from: end }); return; } // a minute or more unplayed (no tick): one more round
          if (recov.pending.delete(id)) { B.metaDel('pending:' + id); log(`account ${id}: recovery completed`); }
          release(id);
        };
        const r = await recover({ market, core: AccountCore, fetchBars, to, accounts: list, each, done, ticks: () => recov.buf, deadline: Date.now() + budgetMs, log, noted });
        for (const p of r.pending) { markPending(p); release(p.id); }
        list = again.filter(x => x.A);
      }
      for (const { A } of list) release(A.id);
    } catch (e) {
      log(`recovery failed (${e.name}): the accounts still waiting with something open are pending`);
      for (const id of ids0) if (recov.wait.has(id)) {
        const A = accts.get(id);
        // from what is committed: a round that ended wrote ran:<account> (the original from otherwise)
        if (A && (A.acct.positions.length || A.acct.orders.length)) markPending({ id, from: recov.pending.get(id)?.from ?? (+B.metaGet('ran:' + id) || fromOf(id)), why: 'recovery failed' });
        release(id);
      }
    } finally { recov.busy = false; }
    if (fills) log(`recovery: ${fills} fills`);
  }
  const timer = setInterval(sweep, SWEEP_MS);
  const fd = feed ? createFeed({ onQuotes: tick, log }).start() : null;
  const recovering = fetchBars ? recoverNow(null, id => ranAt.get(id) ?? lastRun(id)) : Promise.resolve();
  return {
    port: bound, market, core, tick, sweep, quarantined,
    pause: on => { paused = !!on; }, // tests: hold the sweep
    pruneFixOut: ms => B.pruneFixOut(ms),
    account: id => accts.get(id) || null,
    recovery: id => recov.pending.get(id) || null,
    waiting: id => recov.wait.has(id),
    recovering, // resolves when the start's recovery is over (tests)
    history: id => (accts.get(id) ? B.trades(id, accts.get(id).created) : []),
    async close() { clearInterval(timer); await recovering; await recov.run; if (fd) await fd.stop(); await acceptor.close(); B.close(); },
  };
}

// launchd: node host/broker.mjs (host/broker.sh sets the environment)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env, file = env.TB_BROKER_DB || new URL('../.data/broker.db', import.meta.url).pathname;
  if (process.argv[2] === '--clear-recovery') { // the operator: the account trades again from now (a running broker sees it within a second)
    const id = process.argv[3], X = id ? openBrokerDb(file) : null, n = X ? X.metaDel('pending:' + id) : 0;
    if (X) X.close();
    console.log(!id ? 'usage: node host/broker.mjs --clear-recovery <account>' : n ? `broker: recovery of ${id} cleared` : `broker: ${id} has no pending recovery`);
    process.exit(id ? 0 : 1);
  }
  if (!env.LEGACY_API_KEY) { console.error('broker: LEGACY_API_KEY is not set'); process.exit(1); }
  const b = await startBroker({ db: file, port: +(env.TB_FIX_PORT || 9878), user: env.TB_FIX_USER, pass: env.TB_FIX_PASS, feed: true });
  console.log(new Date().toISOString(), `broker: FIX on 127.0.0.1:${b.port}, accounts in ${file}`);
  let closing = false;
  const end = async () => { if (closing) return; closing = true; await b.close(); console.log(new Date().toISOString(), 'broker: stopped'); process.exit(0); };
  process.on('SIGTERM', end); process.on('SIGINT', end);
}
