'use strict';
/* ============ utilities ============ */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFmt = (v, sign = false) => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + nf2.format(Math.abs(v));
const pct = (v, d = 2, sign = true) => !isFinite(v) ? '—' : (v < 0 ? '−' : sign && v > 0 ? '+' : '') + Math.abs(v).toFixed(d) + '%';
const nfx = (v, d = 1) => { if (v == null || !isFinite(v)) return '—'; const s = Math.abs(v).toFixed(d); return (v < 0 && +s !== 0 ? '−' : '') + s; }; // no '−0.00'
const sgn = (v, d = 1) => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(d);
const M = s => Engine.META[s];
// for display only: a v14 CFD retired in v15 still names and formats its rows in the trade history
const MH = s => Engine.META[s] || (Engine.LEGACY_META || {})[s];
const fp = (s, v) => v == null || !isFinite(v) ? '—' : v.toFixed(MH(s) ? MH(s).digits : 5);
// display name: 'EUR/USD' for a pair, the short name of a CFD ('GER40')
const pretty = s => MH(s) && MH(s).kind === 'cfd' ? MH(s).short : s.slice(0, 3) + '/' + s.slice(3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hhmm = t => new Date(t * 1000).toISOString().slice(11, 16);
const dts = t => { const d = new Date(t * 1000).toISOString(); return d.slice(5, 10) + ' ' + d.slice(11, 16); };
const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
const LOT = 100000;
const escHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function bigPx(sym, v) {
  const s = v.toFixed(M(sym).digits);
  return `<span>${s.slice(0, -3)}</span><b>${s.slice(-3, -1)}</b><sup>${s.slice(-1)}</sup>`;
}

/* ============ state ============ */
const INIT_BAL = 100000;
const DEF = {
  balance: INIT_BAL, positions: [], orders: [], history: [], alerts: [], hlines: {}, nextId: 1, peak: INIT_BAL,
  // jur: optional cap ('none' = each instrument at its sheet leverage); lev: null = the sheet default, a number = the
  // choice (capped at the sheet maximum); fav: favourite symbols (≤ 50); wlOpen: watchlist group key → open (empty = nothing chosen yet: Favourites and FX open, on a phone with
  // favourites only Favourites; once chosen, a missing key is closed)
  set: { sym: 'EURUSD', tf: 15, type: 'candles', ind: { ema20: true, ema50: true, bb: false, rsi: true }, theme: 'dark', jur: 'none', lev: null, sound: true, strLb: 240, corrLb: 1440, oneClick: false, wl: 'all', fav: [], wlOpen: {} },
  tk: { side: 'buy', ot: 'market', sm: 'lots', lots: 1, risk: 1, sl: 20, tp: 40, trail: 15, useSL: true, useTP: true, useTrail: false, price: null }
};
DEF.catv = 1; // instrument catalog version of the account: 1 = v15 (the 265 instruments of the sheet)
const KEY = 'meridian-fx-v1';
let memStore = null; // session-only state (preview host disallows browser storage)
const store = {
  get() { return memStore ? JSON.parse(memStore) : null; },
  set(v) { memStore = JSON.stringify(v); },
  clear() { memStore = null; }
};
/* Every state that comes from outside the running session (an imported file, the memory store) passes through
   sanitizeState(): objects are rebuilt without __proto__/constructor/prototype keys (so nothing can swap a
   prototype), core records get type and range checks, and ids stay unique. A bad record is dropped, never thrown.
   What is dropped or repaired is listed in opts.dropped (loadState tells the user); a state refused as a whole says
   why in opts.reason. Limits: money beyond ±1e12 USD or a size beyond the order cap (MAX_LOTS) is not an account this
   app produced, so the record is refused rather than turned into 0. Free text stays free (it is escaped where it is
   shown) but is capped: reason 120, setup 60, note 2000 characters, pre-mortem own/kill 160 (the form's maxlength);
   a news tag is a string of at most 80 characters, at most 20 per trade. */
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const plainData = (v, depth = 0) => depth > 40 ? undefined : Array.isArray(v) ? v.map(x => plainData(x, depth + 1))
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !BAD_KEYS.has(k)).map(k => [k, plainData(v[k], depth + 1)]))
  : typeof v === 'number' && !isFinite(v) ? null : v;
const finite = v => typeof v === 'number' && isFinite(v);
const numOr = (v, d) => finite(v) ? v : d;
const pxOrNull = v => finite(v) && v > 0 ? v : null;
const isSide = v => v === 'buy' || v === 'sell';
const okSym = v => typeof v === 'string' && Object.prototype.hasOwnProperty.call(Engine.META, v);
// the trade history also keeps the rows of the v14 CFDs retired in v15 (Engine.LEGACY_META)
const okSymH = v => okSym(v) || (typeof v === 'string' && !!Engine.LEGACY_META && Object.prototype.hasOwnProperty.call(Engine.LEGACY_META, v));
const MONEY_MAX = 1e12, TXT_MAX = { reason: 120, setup: 60, note: 2000, pm: 160 }, NEWS_MAX = 20, NEWS_LEN = 80;
const lotsCap = () => typeof MAX_LOTS === 'number' ? MAX_LOTS : 100;
// a size within the instrument sheet's volume [min, max] on its step (EURUSD 0.01–400 lots, whole shares on stocks)
const volRange = sym => { const m = Engine.META[sym]; return m && m.p && Array.isArray(m.p.vol) ? m.p.vol : null; };
const okLots = (sym, v) => {
  const r = volRange(sym); if (!r || !finite(v)) return false;
  const [mn, mx, st] = r, k = v / st;
  return v >= mn - 1e-9 && v <= mx + 1e-9 && Math.abs(k - Math.round(k)) < 1e-6;
};
// a closed trade keeps the size it had: any positive size up to the largest sheet maximum (v14 rows included)
const okHistLots = v => finite(v) && v > 0 && v <= lotsCap();
const lotsRangeTxt = sym => { const r = volRange(sym); return r ? `${r[0]}–${r[1]} (step ${r[2]})` : `0–${lotsCap()}`; };
const okMoney = v => finite(v) && Math.abs(v) <= MONEY_MAX;
const okCount = v => Number.isInteger(v) && v >= 0 && v <= 1e9;
const plainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const capTxt = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const newsOf = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x && x.length <= NEWS_LEN).slice(0, NEWS_MAX) : [];
const okMood = v => typeof MOODS !== 'undefined' && Array.isArray(MOODS) ? MOODS.includes(v) : typeof v === 'string' && v.length <= 20;
const strs = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
const arr0 = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
const jsonBit = (v, n = 24) => String(JSON.stringify(v)).slice(0, n);
// set.lev may also be null (the sheet default): sanitizeState keeps it; SET_ENUM.lev is the list of leverage choices.
// wl: 'all', 'fav' or a catalog group (fx, metal, energy, agri, index, rates, crypto, stock)
const SET_ENUM = { jur: ['none', 'eu', 'uk', 'au', 'us'], lev: [30, 50, 100, 200, 500], speed: [1, 10, 60, 300], tf: [1, 5, 15, 60, 240], type: ['candles', 'ha', 'it'], theme: ['dark', 'light'], wlCols: ['basic', 'full'],
  wl: ['all', 'fav', ...new Set(Engine.INSTR.map(m => m.group))] };
const FAV_MAX = 50, WLOPEN_KEY = /^[\w.:-]{1,40}$/, WLOPEN_MAX = 80;
// why a position / order / history row cannot be used ('' = fine); money fields that are present must be valid amounts
function recWhy(x, kind) {
  if (!(kind === 'hist' ? okSymH(x.sym) : okSym(x.sym))) return `unknown instrument ${jsonBit(x.sym, 16)}`;
  if (!(kind === 'hist' && x.nbp === true)) {
    if (!isSide(x.side)) return 'no buy/sell side';
    if (kind === 'hist' ? !okHistLots(x.lots) : !okLots(x.sym, x.lots)) return `size ${jsonBit(x.lots, 16)} lots outside ${kind === 'hist' ? '0–' + lotsCap() : lotsRangeTxt(x.sym)}`;
  }
  if (kind === 'ord' ? !pxOrNull(x.price) : !pxOrNull(x.entry)) return kind === 'ord' ? 'no valid price' : 'no valid entry price';
  if (kind === 'hist' && !pxOrNull(x.exit)) return 'no valid exit price';
  if (kind === 'hist' && !okMoney(x.pnl)) return `P&L ${jsonBit(x.pnl)} is not a valid amount`;
  for (const k of ['swap', 'comm', 'risk']) if (k in x && x[k] != null && !okMoney(x[k])) return `${k} ${jsonBit(x[k])} is not a valid amount`;
  for (const k of ['swap', 'comm']) if (k in x && x[k] === null) return `${k} is not a number`;
  return '';
}
/* SHAPES: the type of every field of the module state that comes from outside (S.bt of bt.js, S.set.obs of
   obs.js/lab.js/basket.js, S.set.pm and S.set.tilt of behav.js, the basket rows of basket.js). The defaults live in
   the modules (BT_DEF/btCfg, obsCfg/labCfg/bkCfg, pmCfg/tiltCfg): sanitizeState removes a value that is not valid
   and reports it, so the module puts its default back (loadState fills pm/tilt, whose modules only default a missing
   object). Keys the table does not know are dropped. A validator returns true for a valid value; SV.obj and SV.list
   also carry the shape, so the kept value holds only known keys. */
const SV = {
  bool: v => typeof v === 'boolean',
  num: (lo, hi) => v => finite(v) && v >= lo && v <= hi,
  pos: hi => v => finite(v) && v > 0 && v <= hi,
  int: (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi,
  one: (...a) => v => a.includes(v),
  str: n => v => typeof v === 'string' && v.length <= n,
  id: v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v),
  nul: v => v === null,
  or: (...f) => v => f.some(g => g(v)),
  // a fixed-key object: every key in req present, every known key valid
  obj: (shape, req = Object.keys(shape)) => Object.assign(v => plainObj(v) && req.every(k => k in v) && Object.keys(v).every(k => !Object.hasOwn(shape, k) || shape[k](v[k])), { shape }),
  list: (f, lo, hi) => Object.assign(v => Array.isArray(v) && v.length >= lo && v.length <= hi && v.every(f), { each: f }),
  map: (kf, vf) => v => plainObj(v) && Object.entries(v).every(([k, x]) => kf(k) && vf(x))
};
const svKeep = (v, f) => f.shape ? Object.fromEntries(Object.keys(v).filter(k => Object.hasOwn(f.shape, k)).map(k => [k, svKeep(v[k], f.shape[k])])) : f.each ? v.map(x => svKeep(x, f.each)) : v;
const svCcy = k => Engine.ALL.includes(k), svW = SV.map(svCcy, SV.pos(1e9)), svOptPx = SV.or(SV.nul, SV.num(0, 1e7)), svAmt = SV.or(SV.nul, okMoney);
const BT_OPS = ['close', 'emaF', 'emaS', 'rsi', 'bbU', 'bbM', 'bbL', 'dcH', 'dcL', 'value'], BT_SWEEP = ['emaF', 'emaS', 'rsiN', 'bbN', 'bbK', 'dcN', 'slK', 'tpR', 'trailK', 'trailAct'];
const svRule = SV.obj({ a: SV.one(...BT_OPS), c: SV.one('xa', 'xb', 'gt', 'lt'), b: SV.one(...BT_OPS), v: SV.or(SV.nul, finite), on: SV.bool });
const svPm = v => v === null || plainObj(v);
const SHAPES = {
  // bt.js BT_DEF (C3: costMode 'account' | 'declared', the declared costs, trials)
  bt: { tpl: SV.one('ema', 'rsi', 'bb', 'dc', 'pull', 'custom'), sym: okSym, tf: SV.one(5, 15, 30, 60), dir: SV.one('both', 'long', 'short'),
    p: SV.obj({ emaF: SV.int(0, 1e4), emaS: SV.int(0, 1e4), rsiN: SV.int(0, 1e4), bbN: SV.int(0, 1e4), bbK: SV.num(0, 100), dcN: SV.int(0, 1e4) }),
    long: SV.list(svRule, 2, 2), short: SV.list(svRule, 2, 2),
    slMode: SV.one('atr', 'pips'), slK: SV.num(.2, 1e3), slPips: SV.num(1, 1e7), tpR: SV.num(0, 1e3), opp: SV.bool, maxBars: SV.int(0, 1e7),
    trail: SV.one('off', 'atr', 'pips'), trailK: SV.num(.25, 1e3), trailPips: SV.num(1, 1e7), trailAct: SV.num(0, 1e3), beR: SV.num(0, 1e3),
    wf: SV.obj({ folds: SV.int(2, 10), ratio: SV.int(1, 10), mode: SV.one('rolling', 'anchored'), obj: SV.one('ret', 'pf', 'sharpe', 'expR'), pick: SV.one('plateau', 'best'),
      x: SV.or(SV.nul, SV.one(...BT_SWEEP)), y: SV.or(SV.nul, SV.one(...BT_SWEEP)) }),
    risk: SV.num(.05, 10), slip: SV.num(0, 1e6), oos: SV.num(0, 60), costV: finite, hist: SV.one(1, 4, 8, 12),
    costMode: SV.one('account', 'declared'), dSpread: SV.num(0, 1e6), dComm: SV.num(0, 1000), dSwapL: SV.num(-1e4, 1e4), dSwapS: SV.num(-1e4, 1e4),
    slPts: plainObj, trailPts: plainObj, trials: Array.isArray },
  // obs.js obsCfg, lab.js labCfg, basket.js bkCfg
  obs: { view: SV.one('const', 'regime', 'dc', 'deja', 'rp', 'drv', 'clock', 'tap', 'bask', 'scan', 'cone', 'exit'),
    lb: SV.one(240, 1440, 4320), dcTh: SV.one(.05, .1, .2, .5), dvTf: SV.one(5, 15, 60), dvW: SV.one(16, 32, 64), dvH: SV.one(6, 12, 24), rpTf: SV.one(5, 15, 60),
    rpMode: SV.one('grad', 'bin'), tapLb: SV.one(240, 1440, 4320), tapSort: SV.one('ret', 'abc', 'clu'), clkAll: SV.bool,
    scH: SV.one(4, 8, 16), scF: SV.one('live', 'all'), scAlert: SV.bool, cnH: SV.one(60, 240, 480, 1440), cnMode: SV.one('model', 'conf'), exR: SV.one('stop', 'vol'), exSrc: SV.one('mine', 'sample'),
    baskets: Array.isArray, bkSel: SV.id, bkTf: SV.one(5, 15, 60, 240), bkLots: SV.num(.1, 20), bkMode: SV.one('risk', 'lots'), bkRisk: SV.num(.05, 5),
    bkSl: SV.or(SV.one('auto'), SV.num(0, 1e6)), bkTp: SV.or(SV.one('auto'), SV.num(0, 1e6)), bkCmp: SV.one('none', 'ccy', 'bask'), bkTrail: SV.num(0, 1e6), bkBe: SV.num(0, 1e6),
    bkEntry: SV.one('market', 'limit', 'stop'), bkPend: SV.int(1, 2000), bkAn: SV.one('attr', 'sess', 'corr'), bkAnW: SV.one(60, 240, 1440, 4320), bkAl: SV.int(1, 2000), bkPane: SV.one('an', 'tr') },
  // behav.js pmCfg / tiltCfg (C3)
  pm: { on: SV.bool, minRisk: SV.num(0, 100), noSL: SV.bool, until: SV.num(0, 1e13), skips: okCount },
  tilt: { on: SV.bool, streak: SV.int(1, 100), dayLoss: SV.pos(100), cool: SV.pos(1e5) },
  // rows: req must be present and valid, opt valid when present (basket.js bkExec, bkFinish, bkPlace, the alert button, a custom basket)
  basket: { req: { id: SV.id, name: SV.str(80), long: svW, short: svW }, opt: { note: SV.str(200) } },
  bkPos: { req: { gid: SV.id, bid: SV.id, name: SV.str(80), side: isSide, lots: v => okHistLots(v), v0: SV.num(-1e6, 1e6), t0: finite },
    opt: { sl: svOptPx, tp: svOptPx, trail: SV.num(0, 1e7), be: SV.num(0, 1e7), pk: finite, mae: finite, risk: svAmt, pm: svPm, timeStop: SV.num(0, 1e13), beSet: SV.bool,
      // the composition at the open (normalised weights), the entry cost in bp, the legs as opened, a close still pending
      long: svW, short: svW, cost: SV.num(0, 1e6), legs: SV.list(SV.obj({ id: SV.int(0, 1e12), lots: v => okHistLots(v) }), 0, 64),
      closing: SV.str(TXT_MAX.reason), pendWhy: SV.str(300) } },
  bkHist: { req: { gid: SV.id, name: SV.str(80), side: isSide, t0: finite, t1: finite, pnl: okMoney },
    opt: { mv: finite, mfe: finite, mae: finite, sl: svOptPx, reason: SV.str(TXT_MAX.reason), risk: svAmt } },
  bkAlerts: { req: { bid: SV.id, name: SV.str(80), bp: SV.pos(1e6), t: finite, up: finite, dn: finite }, opt: { long: svW, short: svW } },
  bkOrders: { req: { bid: SV.id, name: SV.str(80), side: isSide, type: SV.one('limit', 'stop'), bp: SV.pos(1e6), dir: SV.one(1, -1), trig: finite, t: finite,
      sz: SV.obj({ sl: svOptPx, tp: svOptPx, lots: v => okHistLots(v), risk: svAmt, pct: SV.or(SV.nul, finite), cost: SV.or(SV.nul, SV.num(0, 1e9)) }, ['lots']) },
    opt: { pm: svPm, flags: SV.list(SV.list(SV.str(300), 2, 2), 0, 50), long: svW, short: svW } }
};
// a fixed-key object: the valid known keys kept, the names of the invalid ones in bad (unknown keys dropped)
function shapeObj(v, shape) {
  const r = {}, bad = [];
  for (const [k, x] of Object.entries(v)) { const f = Object.hasOwn(shape, k) ? shape[k] : null; if (!f || x === undefined) continue; if (f(x)) r[k] = svKeep(x, f); else bad.push(k); }
  return { r, bad };
}
// a list of rows: a row whose required fields are missing or invalid (or an optional one invalid) is left out with a note
function shapeRows(list, spec, label, idKey, note) {
  if (!Array.isArray(list)) { note(`${label}s: not a list, emptied`); return []; }
  const all = { ...spec.req, ...spec.opt }, out = [];
  list.forEach((x, i) => {
    const id = plainObj(x) && SV.id(x[idKey]) ? x[idKey] : '#' + (i + 1);
    if (!plainObj(x)) { note(`${label} ${id} left out: not a record`); return; }
    const miss = Object.keys(spec.req).filter(k => x[k] === undefined), { r, bad } = shapeObj(x, all);
    if (miss.length || bad.length) { note(`${label} ${id} left out: ${[...bad.map(k => `${k} ${jsonBit(x[k], 16)}`), ...miss.map(k => k + ' missing')].join(', ')} not valid`); return; }
    out.push(r);
  });
  return out;
}
// a module's settings object: invalid keys removed and reported in one note, a non-object removed whole
function shapeCfg(holder, k, shape, label, note) {
  if (!(k in holder) || holder[k] === undefined) return;
  if (!plainObj(holder[k])) { delete holder[k]; note(`${label}: not an object, back to the defaults`); return; }
  const v = holder[k], { r, bad } = shapeObj(v, shape);
  holder[k] = r;
  if (bad.length) note(`${label}: ${bad.map(x => `${x} ${jsonBit(v[x], 16)}`).join(', ')} not valid, back to the default`);
  return v;
}
/* Catalog v15 (rule 5 of .mace/design/catalog.md): the six simulated CFDs of v14 are retired. In a state from before
   v15 (no catv) XAUUSD, US500, GER40, UK100, WTI and BTCUSD are the old instruments (BTCUSD is a new one in v15, with
   another price, so only an account with catv keeps it); the five others are never valid again. Their positions are
   closed at the last saved price (the v14 market snapshot keeps the log price under the symbol), else at the entry with
   P&L 0, the swap kept; orders are cancelled; alerts, lines and drawings are removed. Each step is reported in
   opts.dropped (and opts.migrated, so loadState can say it is a retirement, not bad data). Returns the closed rows. */
const RETIRED_REASON = 'Instrument retired (catalog v15)', RETIRED_5 = ['XAUUSD', 'US500', 'GER40', 'UK100', 'WTI'];
// the saved market at boot (persist.js keeps the raw snapshot); null when there is none or it is still loading
function savedMarket() {
  try { const m = typeof store.getMarket === 'function' ? store.getMarket() : null; return m && typeof m.then !== 'function' ? m : null; } catch (e) { return null; }
}
function retireLegacy(s, o, opts, note) {
  const LM = Engine.LEGACY_META || {}, old = new Set(RETIRED_5.filter(k => LM[k]));
  if (!(finite(s.catv) && s.catv >= 1) && LM.BTCUSD) old.add('BTCUSD');
  const rows = []; if (!old.size) return rows;
  const say = m => { note(m); (opts.migrated = opts.migrated || []).push(m); };
  const mk = opts.market !== undefined ? opts.market : savedMarket(), L = mk && mk.L && typeof mk.L === 'object' ? mk.L : {};
  // a v15 snapshot has a BTCUSD of the new catalog: only a market that still holds the v14 CFDs prices the old ones
  const v14 = RETIRED_5.some(k => finite(L[k]));
  const usdOf = c => { try { const v = Engine.usd(c); return finite(v) && v > 0 ? v : null; } catch (e) { return null; } };
  const now = numOr(Engine.simTime, 0);
  o.positions = arr0(o.positions).filter(p => {
    if (!old.has(p.sym)) return true;
    const m = LM[p.sym], where = `open position${finite(p.id) ? ' #' + p.id : ''} on ${p.sym}`;
    if (!isSide(p.side) || !okHistLots(p.lots) || !pxOrNull(p.entry)) { say(`${where} removed: instrument retired (catalog v15), the record was not valid`); return false; }
    const d = p.side === 'buy' ? 1 : -1, swap = okMoney(p.swap) ? p.swap : 0, comm = okMoney(p.comm) ? p.comm : 0, u = usdOf(m.quote);
    const lv = v14 && finite(L[p.sym]) && Math.abs(L[p.sym] - Math.log(p.entry)) <= 5 ? Math.exp(L[p.sym]) : null;
    const exit = lv && u ? +lv.toFixed(m.digits) : p.entry, px = (exit - p.entry) * d * p.lots * m.size * (u || 0), pnl = px + swap;
    if (!okMoney(pnl)) { say(`${where} removed: instrument retired (catalog v15), its P&L is not a valid amount`); return false; }
    o.balance += pnl;
    const risk = finite(p.risk) && p.risk > 0 ? p.risk : null;
    rows.push({ id: numOr(p.id, 0), sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, exit, open: numOr(p.open, now), close: now, pnl, pips: (exit - p.entry) * d / m.pip,
      r: risk ? pnl / risk : null, reason: RETIRED_REASON, note: '', setup: '', swap, comm, retired: true, pm: p.pm, ctx: p.ctx, news: p.news });
    say(`${where} closed: instrument retired (catalog v15), ${lv && u ? 'at the last saved price ' + exit : 'at its entry (no saved price), P&L 0'}${swap ? ', swap kept' : ''}: ${usdFmt(pnl, true)}`);
    return false;
  });
  o.orders = arr0(o.orders).filter(x => { if (!old.has(x.sym)) return true; say(`pending order${finite(x.id) ? ' #' + x.id : ''} on ${x.sym} cancelled: instrument retired (catalog v15)`); return false; });
  o.alerts = arr0(o.alerts).filter(a => { if (!old.has(a.sym)) return true; say(`alert on ${a.sym} removed: instrument retired (catalog v15)`); return false; });
  for (const k of ['hlines', 'drawings']) if (plainObj(o[k])) for (const sym of Object.keys(o[k])) if (old.has(sym)) {
    if (Array.isArray(o[k][sym]) && o[k][sym].length) say(`${k === 'hlines' ? 'price lines' : 'drawings'} on ${sym} removed: instrument retired (catalog v15)`);
    delete o[k][sym];
  }
  return rows;
}
// opts.repairBalance (the boot path, the browser's own saved copy): an invalid balance is replaced by INIT_BAL and
// reported in opts.repaired instead of discarding positions, history and settings. An import keeps rejecting it.
function sanitizeState(raw, opts = {}) {
  const s = plainData(raw);
  if (!s || typeof s !== 'object' || Array.isArray(s)) { opts.reason = 'it is not an account object'; return null; }
  // an account without a valid balance is not an account: reject it rather than invent $100,000. A negative balance
  // is only possible while positions are open (negative balance protection zeroes a flat account before every save)
  const flat = !arr0(s.positions).length, okBal = okMoney(s.balance), badBal = !okBal || (s.balance < 0 && flat);
  if (badBal && !opts.repairBalance) { opts.reason = !okBal ? `the balance ${jsonBit(s.balance)} is not a valid amount (at most ±$1,000,000,000,000)` : 'a negative balance with no open positions'; return null; }
  const o = { ...s }, now = Engine.simTime, arr = arr0, dropped = [], note = m => { if (dropped.length < 200) dropped.push(m); };
  // at boot a flat negative balance is a real loss: keep it, negative balance protection zeroes it on the first tick
  // (with its history row); only a non-numeric balance falls back to the starting balance
  o.balance = okBal ? s.balance : INIT_BAL;
  if (!okBal) opts.repaired = { balance: s.balance };
  o.peak = Math.max(okMoney(s.peak) ? s.peak : o.balance, o.balance);
  // the retired v14 CFDs are closed before the records are checked (okSym no longer knows them)
  const bal0 = o.balance, retired = retireLegacy(s, o, opts, note);
  const pm = (x, where) => {
    if (!plainObj(x)) return undefined;
    const r = { ...x, flags: strs(x.flags), codes: strs(x.codes), mine: strs(x.mine), broke: strs(x.broke), own: capTxt(x.own, TXT_MAX.pm), kill: capTxt(x.kill, TXT_MAX.pm),
      conf: null, mood: null, timeStop: finite(x.timeStop) && x.timeStop >= 0 ? x.timeStop : 0 };
    if (x.conf != null) { if (Number.isInteger(x.conf) && x.conf >= 10 && x.conf <= 90) r.conf = x.conf; else note(`${where}: pre-mortem confidence ${jsonBit(x.conf, 16)} is not a whole number from 10 to 90, cleared`); }
    if (x.mood != null) { if (okMood(x.mood)) r.mood = x.mood; else note(`${where}: unknown pre-mortem mood ${jsonBit(x.mood)}, cleared`); }
    return r;
  };
  const keep = (list, kind, label) => arr(list).filter(x => { const w = recWhy(x, kind); if (w) note(`${label}${finite(x.id) ? ' #' + x.id : ''} left out: ${w}`); return !w; });
  o.positions = keep(o.positions, 'pos', 'open position').map(p => ({
    ...p, id: numOr(p.id, 0), sl: pxOrNull(p.sl), tp: pxOrNull(p.tp), trail: Math.max(0, numOr(p.trail, 0)), open: numOr(p.open, now),
    risk: finite(p.risk) && p.risk > 0 ? p.risk : null, sl0: pxOrNull(p.sl0), tp0: pxOrNull(p.tp0), pm: pm(p.pm, 'position #' + p.id), ctx: strs(p.ctx), news: newsOf(p.news),
    swap: numOr(p.swap, 0), trailed: p.trailed === true
  }));
  // C4: the initial margin of a position (trade.js posMargin) is a finite amount > 0; any other is removed (and the
  // position margined at its entry price again)
  for (const p of o.positions) if ('im' in p) {
    if (p.im !== undefined && !(finite(p.im) && p.im > 0 && p.im <= MONEY_MAX)) note(`open position #${p.id}: initial margin (im) ${jsonBit(p.im, 16)} is not a valid amount, removed (margined at its entry price)`);
    if (!(finite(p.im) && p.im > 0 && p.im <= MONEY_MAX)) delete p.im;
  }
  o.orders = keep(o.orders, 'ord', 'pending order').filter(x => x.ot === 'limit' || x.ot === 'stop').map(x => ({
    ...x, id: numOr(x.id, 0), slPips: Math.max(0, numOr(x.slPips, 0)), tpPips: Math.max(0, numOr(x.tpPips, 0)), trail: Math.max(0, numOr(x.trail, 0)), created: numOr(x.created, now), pm: pm(x.pm, 'order #' + x.id)
  }));
  // a protection row (nbp) is a balance credit, not a trade: side 'nbp', 0 lots (older saves stored a trade side and size)
  o.history = keep([...retired, ...arr(s.history)], 'hist', 'closed trade').slice(0, 500).map(h => h.nbp === true ? { ...h, side: 'nbp', lots: 0 } : h).map(h => ({
    ...h, id: numOr(h.id, 0), open: numOr(h.open, now), close: numOr(h.close, now), pips: numOr(h.pips, 0), r: finite(h.r) ? h.r : null,
    reason: typeof h.reason === 'string' && h.reason ? capTxt(h.reason, TXT_MAX.reason) : 'Manual', note: capTxt(h.note, TXT_MAX.note), setup: capTxt(h.setup, TXT_MAX.setup),
    pm: pm(h.pm, 'trade #' + h.id), ctx: strs(h.ctx), news: newsOf(h.news), swap: numOr(h.swap, 0), nbp: h.nbp === true
  }));
  o.alerts = arr(o.alerts).filter(a => okSym(a.sym) && pxOrNull(a.price) && (a.cond === 'above' || a.cond === 'below')).map(a => ({ ...a, id: numOr(a.id, 0), done: !!a.done }));
  o.hlines = {};
  if (plainObj(s.hlines)) for (const [k, v] of Object.entries(s.hlines)) if (okSym(k) && Array.isArray(v)) o.hlines[k] = v.filter(pxOrNull);
  if ('drawings' in s) {
    o.drawings = {};
    if (s.drawings && typeof s.drawings === 'object') for (const [k, v] of Object.entries(s.drawings)) if (okSym(k) && Array.isArray(v))
      o.drawings[k] = arr(v).filter(d => (typeof DRAW_TOOLS !== 'object' || Object.prototype.hasOwnProperty.call(DRAW_TOOLS, d.type)) && Array.isArray(d.pts) && d.pts.length && d.pts.every(p => p && finite(p.t) && finite(p.p)));
  }
  // basket rows (basket.js): each row checked against SHAPES; a pre-mortem on a row goes through pm()
  for (const [k, lab, idk] of [['bkPos', 'basket position', 'gid'], ['bkHist', 'closed basket', 'gid'], ['bkAlerts', 'basket alert', 'bid'], ['bkOrders', 'pending basket', 'bid']]) if (k in s)
    o[k] = shapeRows(s[k], SHAPES[k], lab, idk, note).map(r => r.pm ? { ...r, pm: pm(r.pm, `${lab} ${r[idk]}`) } : r);
  // backtester settings (bt.js): btCfg() puts back the default of a removed key; trials keep the btTrials rules
  shapeCfg(o, 'bt', SHAPES.bt, 'backtester settings (bt)', note);
  if (plainObj(o.bt)) {
    const b = o.bt;
    if (b.trials) {
      const ok = b.trials.filter(x => plainObj(x) && typeof x.key === 'string' && typeof x.h === 'string' && [x.t, x.n, x.expR, x.sharpe].every(finite));
      if (ok.length < b.trials.length) note(`backtester settings (bt): ${b.trials.length - ok.length} trial record(s) left out`);
      b.trials = ok.slice(-500).map(x => ({ key: x.key, h: x.h, t: x.t, n: x.n, expR: x.expR, sharpe: x.sharpe }));
    }
    for (const k of ['slPts', 'trailPts']) if (b[k]) {
      const e = Object.entries(b[k]), ok = e.filter(([x, v]) => okSym(x) && Engine.META[x].kind === 'cfd' && finite(v) && v > 0 && v <= 1e7);
      if (ok.length < e.length) note(`backtester settings (bt): ${e.length - ok.length} ${k} override(s) left out`);
      b[k] = Object.fromEntries(ok);
    }
  }
  /* behaviour state (behav.js): a field that is not the expected shape is rebuilt from its valid parts or removed
     (bhState() then starts it fresh), and the repair is reported. dispoSale and the tilt guard read these on every close. */
  if ('dispo' in s) {
    const d = s.dispo;
    if (!plainObj(d)) { delete o.dispo; note('disposition record (dispo) is not an object: started fresh'); }
    else {
      const r = { rg: 0, rl: 0, pg: 0, pl: 0, ev: [] }, bad = [];
      for (const k of ['rg', 'rl', 'pg', 'pl']) { if (okCount(d[k])) r[k] = d[k]; else if (d[k] !== undefined) bad.push(k); }
      if (d.ev !== undefined && !Array.isArray(d.ev)) bad.push('ev');
      const ev = arr(d.ev).filter(e => finite(e.t) && (e.sym == null || okSymH(e.sym)) && ['pg', 'pl'].every(k => okCount(e[k]))
        && (typeof e.gain === 'boolean' || ['rg', 'rl'].every(k => okCount(e[k]))));
      if (Array.isArray(d.ev) && ev.length < d.ev.length) bad.push(`${d.ev.length - ev.length} event(s)`);
      r.ev = ev.slice(0, 300);
      o.dispo = r;
      if (bad.length) note(`disposition record (dispo): ${bad.join(', ')} not valid, reset`);
    }
  }
  if ('tiltSt' in s) {
    const x = s.tiltSt;
    if (!plainObj(x)) { delete o.tiltSt; note('tilt guard state (tiltSt) is not an object: started fresh'); }
    else {
      const r = { until: 0, trips: 0, overrides: 0, lastTrip: null }, bad = [];
      if (finite(x.until) && x.until >= 0) r.until = x.until; else if (x.until !== undefined) bad.push('until');
      for (const k of ['trips', 'overrides']) { if (okCount(x[k])) r[k] = x[k]; else if (x[k] !== undefined) bad.push(k); }
      if ('ruleBreaks' in x) { if (okCount(x.ruleBreaks)) r.ruleBreaks = x.ruleBreaks; else bad.push('ruleBreaks'); }
      if ((typeof x.lastTrip === 'string' && x.lastTrip.length <= 40) || finite(x.lastTrip)) r.lastTrip = x.lastTrip; else if (x.lastTrip != null) bad.push('lastTrip');
      o.tiltSt = r;
      if (bad.length) note(`tilt guard state (tiltSt): ${bad.join(', ')} not valid, reset`);
    }
  }
  if ('bhScoreHist' in s) {
    const v = Array.isArray(s.bhScoreHist) ? s.bhScoreHist : [], ok = arr(v).filter(p => Number.isInteger(p.h) && finite(p.s) && p.s >= 0 && p.s <= 100).slice(-240).map(p => ({ h: p.h, s: p.s }));
    if (!Array.isArray(s.bhScoreHist) || ok.length < v.length) note(`behaviour score history (bhScoreHist): ${Array.isArray(s.bhScoreHist) ? v.length - ok.length + ' point(s)' : 'not a list'} left out`);
    o.bhScoreHist = ok;
  }
  if ('pmSkip' in s) {
    const amt = v => v == null || okMoney(v), lvl = v => v == null || !!pxOrNull(v), legs = v => plainObj(v) && Object.entries(v).every(([k, w]) => okSym(k) && finite(w));
    const okSkip = x => x.type === 'basket'
      ? finite(x.t) && isSide(x.side) && legs(x.long) && legs(x.short) && [x.sl, x.tp].every(v => v == null || (finite(v) && v >= 0)) && (x.v0 == null || finite(x.v0)) && amt(x.risk) && amt(x.reward)
      : (x.type == null || x.type === 'trade') && finite(x.t) && okSym(x.sym) && isSide(x.side) && okLots(x.sym, x.lots) && !!pxOrNull(x.entry) && lvl(x.sl) && lvl(x.tp) && amt(x.risk) && amt(x.reward);
    const v = Array.isArray(s.pmSkip) ? s.pmSkip : [], ok = arr(v).filter(okSkip).slice(0, 100).map(x => ({ ...x, flags: strs(x.flags), ...(x.type === 'basket' ? { name: capTxt(x.name, 60) } : {}) }));
    if (!Array.isArray(s.pmSkip) || ok.length < v.length) note(`skipped pre-mortem trades (pmSkip): ${Array.isArray(s.pmSkip) ? v.length - ok.length + ' record(s)' : 'not a list'} left out`);
    o.pmSkip = ok;
  }
  const set = s.set && typeof s.set === 'object' && !Array.isArray(s.set) ? { ...s.set } : {};
  // v14 'pro' / 'sim' → no cap, the leverage kept as the choice; eu/uk/au/us stay, so the margin of an open position
  // does not rise at load (a state from before the leverage profiles, without jur: loadState)
  if (set.jur === 'pro' || set.jur === 'sim') set.jur = 'none';
  const levNull = set.lev === null;
  for (const [k, ok] of Object.entries(SET_ENUM)) if (!ok.includes(set[k])) delete set[k];
  if (levNull) set.lev = null; // the sheet default
  if ('fav' in set) {
    if (Array.isArray(set.fav)) set.fav = [...new Set(set.fav.filter(okSym))].slice(0, FAV_MAX);
    else delete set.fav;
  }
  if ('wlOpen' in set) {
    if (plainObj(set.wlOpen)) set.wlOpen = Object.fromEntries(Object.entries(set.wlOpen).filter(([k, v]) => WLOPEN_KEY.test(k) && typeof v === 'boolean').slice(0, WLOPEN_MAX));
    else delete set.wlOpen;
  }
  // module settings (obs.js/lab.js/basket.js, behav.js): see SHAPES
  shapeCfg(set, 'obs', SHAPES.obs, 'Observatory settings (set.obs)', note);
  if (plainObj(set.obs) && set.obs.baskets) set.obs.baskets = shapeRows(set.obs.baskets, SHAPES.basket, 'custom basket', 'id', note);
  shapeCfg(set, 'pm', SHAPES.pm, 'pre-mortem settings (set.pm)', note);
  shapeCfg(set, 'tilt', SHAPES.tilt, 'tilt guard settings (set.tilt)', note);
  if (!okSym(set.sym)) delete set.sym;
  if (typeof set.oneClick !== 'boolean') delete set.oneClick;
  for (const k of ['strLb', 'corrLb']) if (!(Number.isInteger(set[k]) && set[k] > 0 && set[k] <= 10080)) delete set[k];
  if (set.ind && (typeof set.ind !== 'object' || Array.isArray(set.ind))) delete set.ind;
  o.set = set;
  // ticket fields keep the type of their default (numbers stay finite numbers, flags stay booleans)
  o.tk = {};
  if (s.tk && typeof s.tk === 'object') for (const [k, d] of Object.entries(DEF.tk)) {
    const v = s.tk[k];
    if (d === null ? pxOrNull(v) : typeof v === typeof d && (typeof v !== 'number' || (finite(v) && v >= 0))) o.tk[k] = v;
  }
  // per instrument (ticket.js tkFollowSymbol), keyed 'FX' or a known instrument: the stop/target/trail distances
  // (bySym) and the size (lotsBy); before, sanitizeState dropped both, so a reload forgot them
  const tkKeyOk = k => k === 'FX' || okSym(k);
  if (s.tk && plainObj(s.tk.bySym)) {
    const okD = v => plainObj(v) && ['sl', 'tp', 'trail'].every(k => finite(v[k]) && v[k] >= 0);
    o.tk.bySym = Object.fromEntries(Object.entries(s.tk.bySym).filter(([k, v]) => tkKeyOk(k) && okD(v)).map(([k, v]) => [k, { sl: v.sl, tp: v.tp, trail: v.trail }]));
  }
  if (s.tk && plainObj(s.tk.lotsBy)) o.tk.lotsBy = Object.fromEntries(Object.entries(s.tk.lotsBy).filter(([k, v]) => tkKeyOk(k) && okHistLots(v)));
  if (o.tk.side && !isSide(o.tk.side)) delete o.tk.side;
  if (o.tk.ot && !['market', 'limit', 'stop'].includes(o.tk.ot)) delete o.tk.ot;
  if (o.tk.sm && !['lots', 'risk'].includes(o.tk.sm)) delete o.tk.sm;
  // ids must stay unique, otherwise closing one position could close another
  const all = [o.positions, o.orders, o.history, o.alerts].flat();
  let next = Math.max(Math.floor(numOr(s.nextId, 1)), 1 + all.reduce((m, x) => Math.max(m, x.id), 0));
  for (const list of [o.positions, o.orders, o.alerts]) { const seen = new Set(); for (const x of list) { if (!(Number.isInteger(x.id) && x.id > 0) || seen.has(x.id)) x.id = next++; seen.add(x.id); } }
  o.nextId = next;
  o.catv = 1;
  // import: reject; boot: negative balance protection zeroes it
  // (a retirement close that leaves a flat negative balance is a real loss: protection zeroes it, like at boot)
  if (bal0 < 0 && !o.positions.length && !retired.length && !opts.repairBalance) { opts.reason = 'a negative balance with no valid open positions'; return null; }
  if (dropped.length) opts.dropped = dropped;
  return o;
}
let S;
// an explicit state that fails sanitizeState throws (the import reports it) and leaves the running account alone
function loadState(src) {
  const boot = src === undefined, opts = { repairBalance: boot }, s = sanitizeState(boot ? store.get() : src, opts);
  if (!boot && !s) throw new Error('Not a valid tradeBerry account state' + (opts.reason ? ': ' + opts.reason : ''));
  // the retirement of the v14 CFDs is a migration, not bad data: it gets its own message
  const mig = s && opts.migrated ? opts.migrated : [], bad = s && opts.dropped ? opts.dropped.filter(x => !mig.includes(x)) : [];
  if (mig.length) {
    console.info('[Meridian] catalog v15 migration:', mig);
    const n = mig.filter(x => / closed: /.test(x)).length;
    setTimeout(() => { try { toast('Retired instruments', `The v14 simulated CFDs (gold, US 500, Germany 40, UK 100, WTI, the old Bitcoin) are not in the v15 catalog. ${n ? nOf(n, 'position') + ' closed (in the trade history with the reason); ' : ''}${mig.length - n} order, alert or chart item${mig.length - n === 1 ? '' : 's'} removed.${mig.length > 1 ? ' Full list in the browser console.' : ''}`, 'info'); } catch (e) { console.error(e); } }, 0);
  }
  if (bad.length) {
    const d = bad; console.warn('[Meridian] state repaired on load:', d);
    setTimeout(() => { try { toast('Some saved data was not valid', `${d.length} item${d.length === 1 ? '' : 's'} repaired or left out: ${d.slice(0, 2).join('; ')}${d.length > 2 ? '; …(full list in the browser console)' : ''}.`, 'info'); } catch (e) { console.error(e); } }, 0);
  }
  if (s && opts.repaired) {
    const was = opts.repaired.balance, n = arr0(s.history).length;
    setTimeout(() => { try { toast('Balance reset', `The saved balance (${finite(was) ? usdFmt(was) : 'not a number'}) was not valid, so it was reset to ${usdFmt(INIT_BAL)}. Positions, orders, ${n} closed trade${n === 1 ? '' : 's'} and settings were kept.`, 'info'); } catch (e) { console.error(e); } }, 0);
  }
  S = JSON.parse(JSON.stringify(DEF));
  if (s) {
    Object.assign(S, s);
    S.set = { ...DEF.set, ...(s.set || {}), ind: { ...DEF.set.ind, ...((s.set || {}).ind || {}) } };
    S.tk = { ...DEF.tk, ...(s.tk || {}) };
    if (!Engine.META[S.set.sym]) S.set.sym = 'EURUSD';
    // pmCfg/tiltCfg (behav.js) default only a missing object: a key sanitizeState removed takes the module's default
    for (const [k, f] of [['pm', typeof pmCfg === 'function' && pmCfg], ['tilt', typeof tiltCfg === 'function' && tiltCfg]])
      if (f && plainObj(S.set[k])) { const own = S.set[k]; delete S.set[k]; Object.assign(f(), own); }
    // a state from before the leverage profiles has no jur and ran at one leverage on every pair (default 1:100). Its
    // open positions keep that leverage as the choice, with no jurisdiction cap (a cap could multiply their margin and
    // stop them out on the next tick), and the user is told; without positions it takes the defaults.
    if (!s.set || !Object.prototype.hasOwnProperty.call(JUR, s.set.jur)) {
      // (old versions always saved set.lev; a missing or invalid one is not evidence of a higher leverage)
      const lev = s.set && LEV_CHOICES.includes(s.set.lev) ? s.set.lev : 0;
      if (S.positions.length && lev) {
        S.set.jur = 'none'; S.set.lev = lev;
        setTimeout(() => { try { syncLevSel(); toast('Leverage kept at 1:' + lev, `This account was saved before leverage profiles existed. Its ${nOf(S.positions.length, 'open position')} ${S.positions.length > 1 ? 'keep' : 'keeps'} 1:${lev} with no jurisdiction cap (never above an instrument's sheet maximum). A retail cap can be set under Settings › Jurisdiction cap (you will see the resulting margin level first).`, 'info'); } catch (e) { console.error(e); } }, 0);
      } else { S.set.jur = DEF.set.jur; S.set.lev = DEF.set.lev; }
    }
  }
  if (!jurOf(S.set).choice) S.set.lev = jurOf(S.set).cap['fx-major'];
  // an instrument the profile does not offer stays on the chart only while a position or an order is open on it
  if (!isAvailable(S.set.sym) && !S.positions.some(p => p.sym === S.set.sym) && !S.orders.some(o => o.sym === S.set.sym)) S.set.sym = 'EURUSD';
  if (typeof normalizeOrders === 'function') normalizeOrders(S); // order-model fields (trade.js)
  // pending orders on instruments the profile does not offer are cancelled right after the state is in (trade.js)
  setTimeout(() => safe('pending orders', dropUnavailableOrders), 0);
}
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { safe('negative balance protection', negativeBalanceProtection); store.set(S); }, 400); };
/* Persistence hooks (the store may be replaced by a persistent one): the market snapshot and the account are
   written together every 20 loop ticks and when the page is hidden or closed. Without store.setMarket only the
   account is flushed. */
function persistNow() {
  try { if (typeof store.setMarket === 'function') store.setMarket(Engine.snapshot()); } catch (e) { console.error('[Meridian] market save failed:', e); }
  clearTimeout(saveT); safe('negative balance protection', negativeBalanceProtection); store.set(S);
}
const dirty = { pos: true, ord: true, hist: true, al: true, lines: true, markers: true };
function changed(...k) { k.forEach(x => dirty[x] = true); dirty.lines = true; dirty.markers = true; save(); }

/* ============ sound ============ */
let actx = null;
function beep(kind) {
  if (!S.set.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = { fill: [660, 880], win: [700, 1050], loss: [420, 300], alert: [880, 660, 880], err: [220], news: [520, 520] }[kind] || [600];
    seq.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * .09;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.08, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .08);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .1);
    });
  } catch (e) { }
}
function toast(title, body = '', kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind;
  t.innerHTML = `<b></b><span></span>`; t.querySelector('b').textContent = title; t.querySelector('span').textContent = body;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 3800);
  const all = $$('#toasts .toast'); if (all.length > 4) all[0].remove();
}

/* ============ manual actions ============
   Each one does what its label says or says why not; mass and destructive ones ask first, with what would be lost. */
const nOf = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const listText = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const floatingOf = ps => ps.reduce((s, p) => s + posPnl(p).pnl, 0);
const EXPORT_FIRST = 'Export first (Help › Export account) to keep a copy.';
// break-even by hand only tightens, like the automatic one (trade.js): the stop moves to the entry when the price is
// past the entry (the price, not the P&L, which carries swap) and the entry is tighter than the current stop
const BE_WHY = { at: ['Stop is already at break-even', 'Nothing to move'], tighter: ['Stop is already tighter than break-even', 'Break-even would loosen it, so it stays'], early: ['Price is not past entry yet', 'Break-even needs the price beyond the entry'] };
function manualBe(p) {
  const q = Engine.quote(p.sym), d = p.side === 'buy' ? 1 : -1;
  if (p.sl != null && p.sl === p.entry) return 'at';
  if (p.sl != null && d * (p.sl - p.entry) > 0) return 'tighter';
  if (!(d > 0 ? q.bid > p.entry : q.ask < p.entry)) return 'early';
  p.sl = p.entry; p.trailed = false; changed('pos');
  return '';
}
function confirmCloseAll() {
  const n = S.positions.length; if (!n) { toast('Nothing to close', 'No open positions', 'info'); return; }
  askConfirm({ title: `Close all ${nOf(n, 'position')}?`, body: `Floating P&L ${usdFmt(floatingOf(S.positions), true)} is booked at the market (simulated fills, which can slip). This cannot be undone.`,
    ok: 'Close all', kind: 'sell', onOk: () => closeWhere(() => true) });
}
// what a reset or a demo load would erase (empty: nothing to lose, no question)
function acctAtStake() {
  const a = [], np = S.positions.length, no = S.orders.length, nh = S.history.filter(h => !h.nbp).length, na = S.alerts.filter(x => !x.done).length;
  if (np) a.push(`${nOf(np, 'open position')} (floating ${usdFmt(floatingOf(S.positions), true)})`);
  if (no) a.push(nOf(no, 'pending order'));
  if (nh) a.push(nOf(nh, 'closed trade'));
  if (na) a.push(nOf(na, 'active alert'));
  if (S.balance !== INIT_BAL) a.push(`the balance of ${usdFmt(S.balance)}`);
  return a;
}
function confirmWipe(title, ok, what, onOk) {
  const at = acctAtStake(); if (!at.length) { onOk(); return; }
  askConfirm({ title, body: `${what} This erases ${listText(at)}. ${EXPORT_FIRST}`, ok, kind: 'sell', onOk });
}
function confirmClearChart() {
  const sym = S.set.sym, nl = (S.hlines[sym] || []).length, na = S.alerts.filter(a => a.sym === sym && !a.done).length, nd = S.drawings && S.drawings[sym] ? S.drawings[sym].length : 0;
  if (!nl && !na && !nd) { toast('Nothing to clear', `No levels, alerts or drawings on ${pretty(sym)}`, 'info'); return; }
  const what = [nl && nOf(nl, 'level'), na && nOf(na, 'alert'), nd && nOf(nd, 'drawing')].filter(Boolean);
  askConfirm({ title: `Clear ${pretty(sym)}?`, body: `This removes ${listText(what)} on ${pretty(sym)}. ${EXPORT_FIRST}`, ok: 'Clear', kind: 'sell', onOk: () => {
    S.hlines[sym] = []; if (S.drawings) S.drawings[sym] = []; if (typeof selectDrawing === 'function') selectDrawing(null); S.alerts = S.alerts.filter(a => a.sym !== sym || a.done);
    changed('al'); toast('Cleared', `Levels, alerts and drawings on ${pretty(sym)}`, 'info');
  } });
}
// Rev: close at market, then open the other side at market with no stop or target (the confirmation says so). When the
// second leg is refused (margin, profile, a gate) the first is already closed: the toast says so and why.
function confirmRev(p) {
  const { id, sym, lots, side } = p, opp = side === 'buy' ? 'sell' : 'buy';
  askConfirm({ title: `Reverse ${pretty(sym)} #${id}?`, body: `Closes the ${side} ${lots.toFixed(2)} at the market (floating ${usdFmt(posPnl(p).pnl, true)}) and opens a ${opp} ${lots.toFixed(2)} at the market. The new position starts without a stop loss or take profit.`,
    ok: 'Reverse', kind: opp, onOk: () => {
      if (!S.positions.some(x => x.id === id)) { toast('Not reversed', `#${id} is no longer open`, 'info'); return; }
      closePosition(id, 'Reversed');
      const np = openPosition({ sym, side: opp, lots, auto: true, dupOk: true });
      if (!np) toast('Reverse incomplete', `#${id} was closed, but the ${opp} position was not opened: ${lastReject || 'see the message before this one'}.${S.positions.some(x => x.sym === sym) ? '' : ` You are flat on ${pretty(sym)}.`}`, 'dn');
    } });
}
// an inline stop edit keeps the trail (as dragging the line does); when the trail would override the new level, or the
// stop was the trail itself, the user is told what happens next
function trailNote(p, v, q) {
  if (!(p.trail > 0)) return;
  const m = M(p.sym), d = p.side === 'buy' ? 1 : -1, n = trailNext(d, null, d > 0 ? q.bid : q.ask, p.trail * m.pip), un = unitWord(p.sym);
  if (d * (n - p.entry) >= 0 && d * (n - v) > 0) toast('Trailing stop is tighter', `The ${p.trail} ${un} trail moves the stop to ${fp(p.sym, n)} on the next check. Clear the SL field to remove the stop and the trail.`, 'info');
  else if (p.trailNow) toast('Trailing stop kept', `Your stop at ${fp(p.sym, v)} applies now; the ${p.trail} ${un} trail takes over once it can lock in the entry.`, 'info');
}

/* ============ misc controls ============ */
function setTF(tf) { S.set.tf = tf; $$('#tfSeg button').forEach(b => b.classList.toggle('on', +b.dataset.tf === tf)); fullChart(true); if (typeof mcOnMainTf === 'function') mcOnMainTf(tf); save(); }
function setSpeed(v) { Engine.speed = v; S.set.speed = v; $('#speedSel').value = v; save(); }

/* ============ lazy tool modules ============
   Backtester, Observatory (with Baskets, Intrinsic time, Edge check, Range cone, Exit lab) load right
   after the first screen is ready, or immediately when one of their tabs is opened. */
const LAZY_SRC = window.MFX_LAZY || ['bt.js', 'obs.js', 'basket.js', 'itime.js', 'lab.js'];
const LAZY_TABS = new Set(['bt', 'obs']);
let lazyP = null, lazyReady = false;
function loadLazy() {
  if (lazyP) return lazyP;
  lazyP = LAZY_SRC.reduce((p, src) => p.then(() => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src)); document.body.appendChild(s);
  })), Promise.resolve()).then(() => {
    for (const f of ['bindBt', 'bindObs', 'bindBasket']) { try { if (typeof window[f] === 'function') window[f](); } catch (err) { console.error(f, err); } }
    lazyReady = true; document.documentElement.dataset.lazy = 'ready';
    if (LAZY_TABS.has(activeTab)) setTab(activeTab);
  }).catch(err => { lazyP = null; toast('Could not load the analysis tools', 'Check your connection and try again.', 'dn'); console.error(err); });
  return lazyP;
}
function setTab(name) {
  if (LAZY_TABS.has(name) && !lazyReady) { loadLazy().then(() => { if (activeTab === name) setTab(name); }); }
  $$('#tabs button[data-tab][data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.pane === name));
  activeTab = name;
  if (name === 'journal') renderJournal();
  if (name === 'lab') requestAnimationFrame(runLab);
  if (name === 'corr') renderCorr();
  if (name === 'vol') renderVol();
  if (name === 'calc') renderCalcs();
  if (name === 'behav' && typeof renderBehav === 'function') renderBehav();
  if (name === 'obs' && typeof renderObs === 'function') requestAnimationFrame(renderObs);
  if (name === 'calendar') renderCalendar();
  if (name === 'bt' && typeof openBacktester === 'function') openBacktester();
  if (name === 'brief' && typeof generateBrief === 'function' && BR.sym !== S.set.sym) generateBrief(S.set.sym);
}
let activeTab = 'positions';

function bind() {
  $('#wl').addEventListener('click', e => { const r = e.target.closest('.wl-row'); if (r) setSymbol(r.dataset.sym); });
  $('#wl').addEventListener('keydown', e => { if (e.key === 'Enter') { const r = e.target.closest('.wl-row'); if (r) setSymbol(r.dataset.sym); } });
  $('#wlSearch').addEventListener('input', () => { buildWatch(); renderWatch(); renderSparks(); });
  $('#tfSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTF(+b.dataset.tf); });
  $('#typeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const wasIt = S.set.type === 'it'; S.set.type = b.dataset.type; $$('#typeSeg button').forEach(x => x.classList.toggle('on', x === b)); fullChart(wasIt || S.set.type === 'it'); if (S.set.type === 'it') toast('Intrinsic-time candles', 'One candle per move of δ instead of per time period. Timeframe buttons now set δ.', 'info'); save(); });
  $('#indSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.ind; S.set.ind[k] = !S.set.ind[k]; b.classList.toggle('on', S.set.ind[k]); applyIndVis(); legend(null); save(); });
  $('#toolSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool === 'clear') { confirmClearChart(); return; }
    setTool(tool === b.dataset.tool ? null : b.dataset.tool);
  });
  $('#qBuy').addEventListener('click', () => quickTrade('buy')); $('#qSell').addEventListener('click', () => quickTrade('sell'));
  $('#sideSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tk.side = b.dataset.side; if (S.tk.ot !== 'market') S.tk.price = defaultPendingPrice(); syncTicketInputs(); });
  $('#otSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tk.ot = b.dataset.ot; S.tk.price = S.tk.ot === 'market' ? null : defaultPendingPrice(); syncTicketInputs(); });
  $('#sizeMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tk.sm = b.dataset.sm; syncTicketInputs(); });
  const inp = (id, key, fn = v => +v) => $(id).addEventListener('input', e => { const v = fn(e.target.value); if (isFinite(v)) { S.tk[key] = v; dirty.lines = true; save(); } });
  inp('#tkLots', 'lots'); inp('#tkRisk', 'risk'); inp('#tkSL', 'sl'); inp('#tkTP', 'tp'); inp('#tkTrail', 'trail'); inp('#tkPrice', 'price');
  ['#tkLots', '#tkRisk', '#tkSL', '#tkTP', '#tkTrail', '#tkPrice'].forEach(id => $(id).addEventListener('blur', syncTicketInputs));
  $('#useSL').addEventListener('change', e => { S.tk.useSL = e.target.checked; syncTicketInputs(); });
  $('#useTP').addEventListener('change', e => { S.tk.useTP = e.target.checked; syncTicketInputs(); });
  $('#useTrail').addEventListener('change', e => { S.tk.useTrail = e.target.checked; syncTicketInputs(); });
  $('.ticket').addEventListener('click', e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    const [k, dir] = b.dataset.step.split(':'), d = +dir, t = S.tk, m = M(S.set.sym);
    // lots on the sheet's step (10 steps at a time from 100 steps up), within its [min, max]
    if (k === 'lots') { const [mn, mx, st] = m.p.vol; t.lots = normLots(S.set.sym, clamp(t.lots + d * (t.lots >= 100 * st - 1e-9 ? 10 * st : st), mn, mx)); }
    if (k === 'risk') t.risk = Math.max(.05, Math.round((t.risk + d * .25) * 100) / 100);
    if (k === 'sl') t.sl = Math.max(.5, +(t.sl + d * (t.sl >= 10 ? 1 : .5)).toFixed(1));
    if (k === 'tp') t.tp = Math.max(.5, +(t.tp + d * (t.tp >= 10 ? 1 : .5)).toFixed(1));
    if (k === 'trail') t.trail = Math.max(1, t.trail + d);
    if (k === 'price') t.price = +((t.price ?? defaultPendingPrice()) + d * m.pip).toFixed(m.digits);
    syncTicketInputs();
  });
  $('#tkSubmit').addEventListener('click', () => submitTicket());
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('#closeAll').addEventListener('click', confirmCloseAll);
  document.addEventListener('click', e => { const s = e.target.closest('td.sym, .vcard'); if (s && s.dataset.sym) setSymbol(s.dataset.sym); });
  document.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const s = e.target.closest && e.target.closest('.vcard'); if (s && s.dataset.sym) { e.preventDefault(); setSymbol(s.dataset.sym); } });
  $('#posBody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return; const id = +tr.dataset.id, p = S.positions.find(x => x.id === id); if (!p) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closePosition(id);
    if (act === 'half') closePosition(id, 'Partial close', .5);
    if (act === 'be') { const why = manualBe(p); if (why) toast(BE_WHY[why][0], `${pretty(p.sym)} #${p.id} · ${BE_WHY[why][1]}`, 'info'); else toast('Stop at break-even', `${pretty(p.sym)} #${p.id} · SL ${fp(p.sym, p.sl)}`, 'info'); }
    if (act === 'rev') confirmRev(p);
    const ed = e.target.closest('[data-edit]');
    if (ed && !ed.querySelector('input')) {
      const f = ed.dataset.edit, inpt = document.createElement('input'); inpt.className = 'edit-in'; inpt.type = 'number'; inpt.step = 'any'; inpt.value = p[f] != null ? fp(p.sym, p[f]) : '';
      ed.textContent = ''; ed.appendChild(inpt); inpt.focus(); inpt.select();
      const commit = () => {
        const v = parseFloat(inpt.value), q = Engine.quote(p.sym);
        // clearing the stop removes the trail too (a trail alone would put a stop back)
        if (inpt.value === '') { if (f === 'sl' && p.trail > 0 && p.sl != null) toast('Stop loss and trailing stop removed', `${pretty(p.sym)} #${p.id} has no stop now`, 'info'); p[f] = null; if (f === 'sl') { p.trail = 0; p.trailed = false; } }
        else if (isFinite(v)) {
          const okSl = p.side === 'buy' ? v < q.bid : v > q.ask, okTp = p.side === 'buy' ? v > q.bid : v < q.ask;
          const d = p.side === 'buy' ? 1 : -1, m = M(p.sym);
          if (f === 'sl' && okSl) { p.sl = v; p.trailed = false; trailNote(p, v, q); }
          else if (f === 'tp' && okTp) {
            p.tp = v;
            // a target on the losing side of the entry is allowed (it caps a loss) but it is not a profit: say so
            if (d * (v - p.entry) <= 0) toast(`Take profit ${d > 0 ? 'below' : 'above'} entry`, `If it fills at ${fp(p.sym, v)}, #${p.id} closes at a loss of about ${usdFmt(Math.abs((v - p.entry) * p.lots * m.size * Engine.usd(m.quote)))} before swap and commission.`, 'dn');
          } else toast('Invalid level', `${f.toUpperCase()} is on the wrong side of price`, 'dn');
        }
        inpt.remove(); changed('pos');
      };
      inpt.addEventListener('blur', commit); inpt.addEventListener('keydown', ev => { if (ev.key === 'Enter') inpt.blur(); if (ev.key === 'Escape') { inpt.value = p[f] != null ? fp(p.sym, p[f]) : ''; inpt.blur(); } });
    }
  });
  $('#ordBody').addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr && e.target.closest('[data-act=cancel]')) { cancelOrder(+tr.dataset.id); toast('Order cancelled', '', 'info'); } });
  $('#alBody').addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr && e.target.closest('[data-act=del]')) { S.alerts = S.alerts.filter(a => a.id !== +tr.dataset.id); changed('al'); } });
  $('#alertForm').addEventListener('submit', e => { e.preventDefault(); const px = parseFloat($('#alPx').value); if (!px) return; addAlert($('#alSym').value, px, $('#alCond').value); $('#alPx').value = ''; });
  $('#alSym').addEventListener('change', () => { $('#alPx').value = fp($('#alSym').value, Engine.quote($('#alSym').value).mid); });
  $('#jList').addEventListener('change', e => { const it = e.target.closest('.jitem'); if (!it) return; const h = S.history[+it.dataset.i]; h[e.target.dataset.j] = e.target.value; save(); });
  $('#labForm').addEventListener('submit', e => { e.preventDefault(); runLab(); });
  $('#labFromJ').addEventListener('click', () => {
    const s = journalStats();
    if (s.rN < 5 || !s.avgLossR) { toast('Not enough data', 'Close at least 5 trades with stop losses first', 'info'); return; }
    $('#lWin').value = s.winRate.toFixed(0); $('#lRR').value = (s.avgWinR / s.avgLossR || 1).toFixed(2); $('#lRisk').value = S.tk.risk; runLab();
    toast('Loaded journal stats', `${s.winRate.toFixed(0)}% win · ${(s.avgWinR / s.avgLossR || 1).toFixed(2)} R:R`, 'info');
  });
  $$('.calc input, .calc select').forEach(x => x.addEventListener('input', renderCalcs));
  $('#strSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.set.strLb = +b.dataset.lb; $$('#strSeg button').forEach(x => x.classList.toggle('on', x === b)); renderStrength(); save(); });
  $('#corrSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.set.corrLb = +b.dataset.lb; $$('#corrSeg button').forEach(x => x.classList.toggle('on', x === b)); renderCorr(); save(); });
  $('#strIdea').addEventListener('click', e => { const d = e.currentTarget.dataset; if (d.sym) setSymbol(d.sym, d.side); });
  $('#speedSel').addEventListener('change', e => setSpeed(+e.target.value));
  $('#levSel').addEventListener('change', e => requestProfile(e.target.value));
  $('#themeBtn').addEventListener('click', () => { S.set.theme = S.set.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); });
  $('#soundBtn').addEventListener('click', () => { S.set.sound = !S.set.sound; $('#soundBtn').classList.toggle('off', !S.set.sound); save(); if (S.set.sound) beep('fill'); });
  $('#helpBtn').addEventListener('click', () => $('#help').hidden = false);
  $('#symName').addEventListener('click', openCmd);
  $('#help').addEventListener('click', e => { if (e.target.id === 'help' || e.target.closest('[data-close]')) $('#help').hidden = true; });
  $('#oneClickSet').addEventListener('change', e => { S.set.oneClick = e.target.checked; syncOneClick(); save(); toast(S.set.oneClick ? 'One-click trading on' : 'One-click trading off', S.set.oneClick ? 'Quick-trade buttons, chart-pane B/S and Shift+B/S send market orders immediately.' : 'Quick-trade buttons fill in the ticket; you send the order from there.', 'info'); });
  $('#resetAcct').addEventListener('click', () => confirmWipe('Reset the account?', 'Reset account', `The account goes back to a fresh ${usdFmt(INIT_BAL)} balance.`, resetAccount));
  const resetAccount = () => { const theme = S.set.theme; store.clear(); loadState(); S.set.theme = theme; delete document.documentElement.dataset.demo; lastSent = null; changed('pos', 'ord', 'hist', 'al'); syncTicketInputs(); syncOneClick(); fullChart(true); $('#help').hidden = true; toast('Account reset', 'Fresh $100,000 demo balance', 'info'); };
  $('#cmdBtn').addEventListener('click', openCmd);
  $('#cmd').addEventListener('click', e => { if (e.target.id === 'cmd') closeCmd(); const it = e.target.closest('.cmd-item'); if (it) { if (it.dataset.fill) { $('#cmdInput').value = it.dataset.fill; renderCmd(); $('#cmdInput').focus(); } else execCmd(); } });
  $('#cmdInput').addEventListener('input', () => { cmdSel = -1; cmdArm = null; renderCmd(); });
  $('#cmdInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCmd();
    // preventDefault: closing the bar returns focus to the element that opened it (often the order button), and the
    // rest of this Enter keystroke must not press that button
    if (e.key === 'Enter') { e.preventDefault(); const on = $('#cmdList .cmd-item.on'); if (on && on.dataset.fill) { $('#cmdInput').value = on.dataset.fill; cmdSel = -1; renderCmd(); } else execCmd(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = $$('#cmdList .cmd-item').length; cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; renderCmd(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#cmd').hidden ? openCmd() : closeCmd(); return; }
    if (e.key === 'Escape') { measure = null; reqOverlay(); setTool(null); closeCmd(); $('#help').hidden = true; return; }
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.shiftKey && (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 's')) { const sd = e.key.toLowerCase() === 'b' ? 'buy' : 'sell'; if (S.set.oneClick) submitTicket(sd); else prefillTicket(S.set.sym, sd, null); }
    else if (e.shiftKey && e.key.toLowerCase() === 'x') confirmCloseAll();
    else if (!e.shiftKey && '12345'.includes(e.key) && e.key.length === 1) setTF([1, 5, 15, 60, 240][+e.key - 1]);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const ps = Engine.PAIRS.map(p => p.sym), i = ps.indexOf(S.set.sym); setSymbol(ps[(i + (e.key === 'ArrowDown' ? 1 : -1) + ps.length) % ps.length]); }
    else if (e.key === '?') $('#help').hidden = false;
    else if (e.key.toLowerCase() === 'i' && !e.metaKey && !e.ctrlKey) openBrief();
    else if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.shiftKey) setTab('bt');
    else if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey) setTool(tool === 'measure' ? null : 'measure');
  });
  window.addEventListener('resize', () => { if (activeTab === 'journal') renderJournal(); if (activeTab === 'lab') runLab(); });
}

/* ============ boot & loop ============ */
async function boot() {
  if (store.ready) await store.ready;
  if (!window.LightweightCharts) { $('.boot-msg').textContent = 'Charting library failed to load. Check your connection and reload.'; return; }
  await Engine.init(typeof store.getMarket === 'function' ? store.getMarket() : null);
  loadState();
  // real prices from the broker platform when the server has them (livefeed.js); otherwise the simulated market
  if (typeof LiveFeed === 'object' && await LiveFeed.start()) {
    const bm = $('.boot-msg'); if (bm) bm.textContent = 'Loading live prices…';
    await LiveFeed.prime([S.set.sym], 8000); // the chart's history first; the pairs (strength, analytics) follow
    LiveFeed.prime(Engine.PAIRS.map(p => p.sym));
  }
  Engine.speed = S.set.speed || 1; $('#speedSel').value = Engine.speed; buildLevSel();
  rolloverTick(); // sets the first rollover after the (possibly resumed) clock
  $('#soundBtn').classList.toggle('off', !S.set.sound);
  applyTheme();
  if (typeof LiveFeed === 'object' && LiveFeed.on) LiveFeed.decorate();
  else { const f = $('#feedPill'); f.textContent = 'SIM · platform snapshot'; f.title = Engine.SNAP_LABEL; } // provenance of the starting levels (rule 7)
  const opts = Engine.PAIRS.map(p => `<option value="${p.sym}">${pretty(p.sym)}</option>`).join('');
  ['#alSym', '#cpSym', '#pvSym'].forEach(id => $(id).innerHTML = opts);
  $('#alPx').value = fp('EURUSD', Engine.quote('EURUSD').mid);
  $$('#tfSeg button').forEach(b => b.classList.toggle('on', +b.dataset.tf === S.set.tf));
  $$('#typeSeg button').forEach(b => b.classList.toggle('on', b.dataset.type === S.set.type));
  $$('#indSeg button').forEach(b => b.classList.toggle('on', !!S.set.ind[b.dataset.ind]));
  $$('#strSeg button').forEach(b => b.classList.toggle('on', +b.dataset.lb === S.set.strLb));
  $$('#corrSeg button').forEach(b => b.classList.toggle('on', +b.dataset.lb === S.set.corrLb));
  initChart(); buildWatch(); bind(); for (const f of ['bindPro', 'bindBrief', 'initDraw', 'initMC', 'bindBehav']) { try { if (typeof window[f] === 'function') window[f](); else console.warn('Module not loaded:', f); } catch (err) { console.error(f, err); } } $('#dockBtn').addEventListener('click', () => toggleDock()); renderSparks();
  $('#symName').textContent = pretty(S.set.sym); $('#tkSym').textContent = S.set.sym;
  syncTicketInputs(); syncOneClick(); fullChart(true);
  calTick();
  frame(true);
  $('#boot').classList.add('done'); setTimeout(() => $('#boot').remove(), 500);
  (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => loadLazy(), { timeout: 1200 });
  window.addEventListener('pagehide', () => safe('saving', persistNow));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') safe('saving', persistNow); });
  let last = performance.now(), n = 0;
  setInterval(() => {
    const now = performance.now(), dt = Math.min(1000, now - last); last = now;
    safe('market', () => Engine.tick(dt)); safe('calendar', calTick); safe('swap', rolloverTick); safe('order and stop checks', checkTriggers);
    if (typeof checkDrawAlerts === 'function') safe('drawing alerts', checkDrawAlerts);
    n++;
    if (n % 20 === 0) safe('saving', persistNow);
    frame(n % 8 === 0, n % 20 === 0);
  }, 250);
}
/* One failing part (a renderer, a module, a bad record) must not freeze the rest of the screen or the market:
   each step runs on its own, and the first error of each step is reported once. */
const failed = new Set();
function safe(tag, f) {
  try { return f(); } catch (e) {
    if (!failed.has(tag)) { failed.add(tag); console.error(`[Meridian] ${tag} failed:`, e); toast('Something went wrong', `${tag} stopped working — the market keeps running. Details in the browser console.`, 'dn'); }
  }
}
function frame(slow, slower) {
  safe('chart', chartTick);
  safe('watchlist', renderWatch); safe('account bar', renderAccount);
  const k = safe('ticket', renderTicket);
  safe('chart lines', () => { if (dirty.lines) rebuildLines(); linesTick(k); });
  safe('chart markers', () => { if (dirty.markers) { setMarkers(); dirty.markers = false; } });
  safe('positions', renderPositions); safe('close all', () => { const b = $('#closeAll'); if (b) b.disabled = !S.positions.length; }); safe('orders list', renderOrders); safe('history', renderHistory); safe('alerts', renderAlerts);
  safe('depth of market', renderDom); safe('chart overlay', reqOverlay); if (typeof mcTick === 'function') safe('multi-chart', () => mcTick(slow));
  if (slow) {
    safe('strength', renderStrength); safe('exposure', renderExposure); safe('sessions', renderSessions);
    if (activeTab === 'calendar') safe('calendar', renderCalendar); if (activeTab === 'calc') safe('calculators', renderCalcs);
    if (!drag && !hovering) safe('legend', () => legend(null));
  }
  if (slower) {
    if (activeTab === 'corr') safe('correlation', renderCorr); if (activeTab === 'vol') safe('volatility', renderVol);
    safe('sparklines', renderSparks); safe('brief', briefTick); if (typeof obsTick === 'function') safe('observatory', obsTick);
    if (activeTab === 'behav' && typeof renderBehav === 'function') safe('behaviour', renderBehav);
    if (activeTab === 'journal' && dirty.journal && !document.activeElement?.closest('.jitem')) safe('journal', renderJournal);
  }
}
// dev mode loads modules as separate scripts: wait until all of them have run before booting
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
