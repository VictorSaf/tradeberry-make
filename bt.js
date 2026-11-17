'use strict';
/* tradeBerry — Strategy Backtester.
   Runs rule-based strategies over the terminal's own price history (1 week of 1-minute bars
   at boot, growing as the simulation runs). Signals are evaluated on bar close and filled at
   the next bar's open; stops and targets are resolved on the underlying 1-minute bars
   (stop first when both are touched in the same minute). Costs: the account's (spread, swap, commission) or declared
   ones, plus slippage. */

// show: BT markers on the Trade chart stay off until asked for, so they do not crowd the live chart
const BT = { res: null, show: false, view: 'trades', sweep: null, all: null, wf: null, pbo: null, running: false };
const BT_START = 100000;
const OPERANDS = [['close', 'Price (close)'], ['emaF', 'EMA fast'], ['emaS', 'EMA slow'], ['rsi', 'RSI'], ['bbU', 'Bollinger upper'], ['bbM', 'Bollinger mid'], ['bbL', 'Bollinger lower'], ['dcH', 'Donchian high'], ['dcL', 'Donchian low'], ['value', 'Value']];
const CONDS = [['xa', 'crosses ↑'], ['xb', 'crosses ↓'], ['gt', 'is above'], ['lt', 'is below']];
const BT_DEF = {
  tpl: 'ema', sym: 'EURUSD', tf: 15, dir: 'both',
  p: { emaF: 9, emaS: 21, rsiN: 14, bbN: 20, bbK: 2, dcN: 20 },
  long: [{ a: 'emaF', c: 'xa', b: 'emaS', v: 0, on: true }, { a: 'close', c: 'gt', b: 'emaS', v: 0, on: false }],
  short: [{ a: 'emaF', c: 'xb', b: 'emaS', v: 0, on: true }, { a: 'close', c: 'lt', b: 'emaS', v: 0, on: false }],
  slMode: 'atr', slK: 2, slPips: 20, tpR: 0, opp: true, maxBars: 0,
  trail: 'off', trailK: 2, trailPips: 15, trailAct: 1, beR: 0,
  wf: { folds: 5, ratio: 3, mode: 'rolling', obj: 'ret', pick: 'plateau', x: null, y: null },
  risk: 1, slip: .2, oos: 30, costV: 16, hist: 8,
  // costs: 'account' = costModel(sym) of trade.js (the sheet + the account's extra commission); 'declared' = the values
  // below, in the instrument's unit (spread: pips on FX, points otherwise) and USD per lot (commission round turn, swap
  // a night, negative = the position pays)
  costMode: 'account', dSpread: 1, dComm: 0, dSwapL: 0, dSwapS: 0
};
const TEMPLATES = {
  ema: { name: 'EMA crossover', desc: 'Trend-following: go with the fast EMA crossing the slow one; ride until the opposite cross.',
    p: { emaF: 9, emaS: 21 }, long: [['emaF', 'xa', 'emaS'], null], short: [['emaF', 'xb', 'emaS'], null], slK: 2, tpR: 0, opp: true },
  rsi: { name: 'RSI mean reversion', desc: 'Buy when RSI recovers from oversold, sell when it rolls over from overbought. Fixed 1.5R target.',
    p: { rsiN: 14 }, long: [['rsi', 'xa', 'value', 30], null], short: [['rsi', 'xb', 'value', 70], null], slK: 1.5, tpR: 1.5, opp: false },
  bb: { name: 'Bollinger reversion', desc: 'Fade moves outside the bands: buy back inside the lower band, sell back inside the upper band.',
    p: { bbN: 20, bbK: 2 }, long: [['close', 'xa', 'bbL'], null], short: [['close', 'xb', 'bbU'], null], slK: 1.5, tpR: 1.5, opp: false },
  dc: { name: 'Donchian breakout', desc: 'Classic turtle-style breakout of the prior N-bar high/low, filtered by the slow EMA trend.',
    p: { dcN: 20, emaS: 50 }, long: [['close', 'xa', 'dcH'], ['close', 'gt', 'emaS']], short: [['close', 'xb', 'dcL'], ['close', 'lt', 'emaS']], slK: 2, tpR: 2, opp: false },
  pull: { name: 'Trend pullback', desc: 'Trade with the slow-EMA trend after RSI pulls back and turns: buy dips in uptrends, sell rallies in downtrends.',
    p: { emaS: 50, rsiN: 14 }, long: [['close', 'gt', 'emaS'], ['rsi', 'xa', 'value', 40]], short: [['close', 'lt', 'emaS'], ['rsi', 'xb', 'value', 60]], slK: 1.5, tpR: 2, opp: false },
  custom: { name: 'Custom rules', desc: 'Build your own: up to two conditions per side, all must be true on the signal bar.' }
};
function btCfg() {
  if (!S.bt) S.bt = JSON.parse(JSON.stringify(BT_DEF));
  for (const k in BT_DEF) if (S.bt[k] === undefined) S.bt[k] = JSON.parse(JSON.stringify(BT_DEF[k]));
  // v16: the backtester has no commission of its own (the old $5 per lot, the % of notional, the v15 extra): the
  // account's costs or declared ones replace it, once
  if (S.bt.costV !== 16) { delete S.bt.comm; delete S.bt.commPct; S.bt.costV = 16; }
  if (S.bt.costMode !== 'account' && S.bt.costMode !== 'declared') S.bt.costMode = 'account';
  const num = (k, lo, hi) => { const v = S.bt[k]; if (!(typeof v === 'number' && isFinite(v) && v >= lo && v <= hi)) S.bt[k] = BT_DEF[k]; };
  num('dSpread', 0, 1e6); num('dComm', 0, 1000); num('dSwapL', -1e4, 1e4); num('dSwapS', -1e4, 1e4);
  // per-instrument overrides: only known keys with sane values survive (state can come from an import)
  for (const k of ['slPts', 'trailPts']) {
    const o = S.bt[k];
    S.bt[k] = o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([x, v]) => btPtsKey(x) && typeof v === 'number' && isFinite(v) && v > 0 && v <= 1e7)) : {};
  }
  return S.bt;
}
/* Costs of the backtester (decision 37; design wave1-honest-stats.md, v1-bt), one of two modes:
   - 'account' (default): costModel(sym) of trade.js, the costs the account pays live: the sheet's spread Default or
     Night (23:00–01:00 server time, Monday to Friday) at the fill, the swap of every 17:00 New York rollover the
     position is held over (×3 on the triple day), the sheet's commission plus the account's extra per lot round turn.
     The News spread is live only (the calendar of the past is not kept): it is not in the backtest, and that is said;
   - 'declared': the user's own spread (instrument unit), commission and swap (USD per lot), triple day kept.
   Prices are bids (PIVOT ON BID): a buy fills at the ask (bid + spread), a sell at the bid; longs exit on the bid,
   shorts on the ask. Sessions: bars exist only while the market is open, so a signal on the last bar before a close
   fills at the reopening and a stop crossed by the gap fills at the reopening price.
   Fixed stop / trail off FX: in points of that instrument, default 2 x the 1-hour volatility of the sheet (seed.sIn)
   at the starting price, at least 4 x the Default spread, rounded to two significant figures. */
const btPtsKey = x => !!(Engine.META[x] && Engine.META[x].kind === 'cfd');
const btIsCfd = sym => !!(M(sym) && M(sym).kind === 'cfd');
const btRound2 = v => { if (!(v > 0)) return 1; const e = 10 ** Math.floor(Math.log10(v) - 1); return Math.max(1, Math.round(v / e) * e); };
function btDefPts(sym) {
  const m = M(sym), s = m.seed || {}, px = s.bid || Engine.mid(sym);
  return btRound2(Math.max(2 * (s.sIn || 0) * px / m.pip, 4 * m.spread));
}
// fixed distance in the instrument's own unit (pips on FX, points otherwise); k: 'sl' | 'trail'
function btFixed(c, sym, k) {
  if (!btIsCfd(sym)) return k === 'sl' ? c.slPips : c.trailPips;
  const v = ((k === 'sl' ? c.slPts : c.trailPts) || {})[sym];
  return typeof v === 'number' && v > 0 ? v : btDefPts(sym);
}
// the rollovers after a, up to and including b, that finance sym
function btRolls(sym, a, b) { const o = []; for (let r = nextRollover(a, sym), i = 0; r <= b && i < 400; r = nextRollover(r, sym), i++) o.push(r); return o; }
/* btCosts(c, sym) → { mode, spreadAt(t): ask − bid in price, commLot: USD per lot round turn, swap(d, lots, px, a, b):
   USD over the rollovers after a up to b (d = +1 long / −1 short; negative = the position pays) } */
function btCosts(c, sym) {
  const m = M(sym);
  if (c.costMode === 'declared') {
    const sp = (+c.dSpread || 0) * m.pip, v = [+c.dSwapL || 0, +c.dSwapS || 0];
    return { mode: 'declared', spreadAt: () => sp, commLot: +c.dComm || 0,
      swap: (d, lots, px, a, b) => { const x = v[d > 0 ? 0 : 1]; return x ? btRolls(sym, a, b).reduce((s, r) => s + rolloverNights(r, sym), 0) * x * lots : 0; } };
  }
  const cm = costModel(sym);
  return { mode: 'account', spreadAt: cm.spreadAt, commLot: cm.commRT(1),
    swap: (d, lots, px, a, b) => btRolls(sym, a, b).reduce((s, r) => s + cm.swapNight(d > 0 ? 'buy' : 'sell', lots, px, r), 0) };
}
// what the costs charge, for the trial hash: other costs are another try
const btCostSig = c => c.costMode === 'declared' ? ['d', c.dSpread, c.dComm, c.dSwapL, c.dSwapS] : ['a', commOf(1, c.sym)];
// the costs in words, for the config and the report
function btCostText(c, sym) {
  const m = M(sym), u = unitWord(sym, true);
  if (c.costMode === 'declared') return `Declared costs (not the account's): spread ${nfx(c.dSpread, 2)} ${u} at every fill, commission $${nfx(c.dComm, 2)} per lot round turn, swap ${usdFmt(c.dSwapL, true)} long / ${usdFmt(c.dSwapS, true)} short per lot a night (${TRIPLE_TEXT(sym)}).`;
  const sp = m.p.spread.map(v => +(v * m.point / m.pip).toFixed(2)), sh = m.p.comm || 0, x = commOf(1, sym) - sh;
  const comm = `${sh ? `$${nfx(sh, 2)} per lot (instrument sheet)` : 'none on the instrument sheet'}${x ? ` + $${nfx(x, 2)} per lot round turn (the account's extra, Settings)` : ''}`;
  return `Account costs, as in live trading: spread ${sp[0]} ${u} (night 23:00–01:00 server time ${sp[1]} ${u}), swap ${swapText(sym)} (${TRIPLE_TEXT(sym)}), commission ${comm}. News widening is live only: not in the backtest.`;
}
// the notional cap of the sizing and its reason: the profile's leverage, or the per-order cap when that is tighter
function btLevText(lev) {
  const j = escHtml(jurOf(S.set).name);
  return lev > MAX_NOTIONAL_X ? `notional at most ${MAX_NOTIONAL_X}× equity: the per-order cap of ${MAX_NOTIONAL_X}× equity is tighter than the 1:${lev} leverage (${j})` : `notional at most ${lev}× equity: the 1:${lev} leverage (${j})`;
}
// bars observed per year: the run's bar count over its span (markets close, so a calendar factor would be wrong)
function btPerYear(bars, from, to, tf) {
  const n = to - from; if (!(n > 0) || !bars[from] || !bars[to - 1]) return 0;
  const span = bars[to - 1].time + tf * 60 - bars[from].time; return span > 0 ? n / (span / (365.25 * 86400)) : 0;
}
const warmOf = p => Math.max(p.emaS, p.emaF, p.bbN, p.dcN + 1, p.rsiN + 1, 15) + 1;
function applyTemplate(key) {
  const c = btCfg(), t = TEMPLATES[key]; c.tpl = key; if (key === 'custom') return;
  c.p = { ...BT_DEF.p, ...t.p };
  const mk = (r, i) => r ? { a: r[0], c: r[1], b: r[2], v: r[3] ?? 0, on: true } : { ...BT_DEF.long[i], on: false };
  c.long = t.long.map(mk); c.short = t.short.map(mk);
  c.slMode = 'atr'; c.slK = t.slK; c.tpR = t.tpR; c.opp = t.opp; c.maxBars = 0;
}

/* ---------- indicators ---------- */
function btSeries(bars, p, tf = 0) {
  const n = bars.length, cl = bars.map(b => b.close);
  const ema = k => { const a = 2 / (k + 1), o = new Array(n); for (let i = 0; i < n; i++) o[i] = i ? o[i - 1] + a * (cl[i] - o[i - 1]) : cl[i]; return o; };
  const rsi = new Array(n).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p.rsiN) { ag += g / p.rsiN; al += l / p.rsiN; } else { ag = (ag * (p.rsiN - 1) + g) / p.rsiN; al = (al * (p.rsiN - 1) + l) / p.rsiN; }
    if (i >= p.rsiN) rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  const bbU = new Array(n).fill(null), bbM = new Array(n).fill(null), bbL = new Array(n).fill(null);
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    s += cl[i]; s2 += cl[i] * cl[i];
    if (i >= p.bbN) { s -= cl[i - p.bbN]; s2 -= cl[i - p.bbN] ** 2; }
    if (i >= p.bbN - 1) { const mu = s / p.bbN, sd = Math.sqrt(Math.max(0, s2 / p.bbN - mu * mu)); bbM[i] = mu; bbU[i] = mu + p.bbK * sd; bbL[i] = mu - p.bbK * sd; }
  }
  const dcH = new Array(n).fill(null), dcL = new Array(n).fill(null);
  for (let i = p.dcN; i < n; i++) { let h = -Infinity, l = Infinity; for (let j = i - p.dcN; j < i; j++) { if (bars[j].high > h) h = bars[j].high; if (bars[j].low < l) l = bars[j].low; } dcH[i] = h; dcL[i] = l; }
  const atr = new Array(n).fill(null); let at = 0;
  // a bar after a closed market: its range only, the reopening jump is not volatility (it would widen every ATR stop for 14 bars)
  const gapAt = i => tf > 0 && bars[i].time - bars[i - 1].time > tf * 60 + GAP_S;
  for (let i = 1; i < n; i++) { const tr = gapAt(i) ? bars[i].high - bars[i].low : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - cl[i - 1]), Math.abs(bars[i].low - cl[i - 1])); at = i <= 14 ? (at * (i - 1) + tr) / i : (at * 13 + tr) / 14; if (i >= 14) atr[i] = at; }
  return { close: cl, emaF: ema(p.emaF), emaS: ema(p.emaS), rsi, bbU, bbM, bbL, dcH, dcL, atr };
}
function ruleFn(rules, X) {
  const act = rules.filter(r => r.on); if (!act.length) return () => false;
  const val = (op, v, i) => op === 'value' ? v : X[op][i];
  return i => act.every(r => {
    const a0 = val(r.a, r.v, i - 1), a1 = val(r.a, r.v, i), b0 = val(r.b, r.v, i - 1), b1 = val(r.b, r.v, i);
    if (a1 == null || b1 == null || a0 == null || b0 == null) return false;
    return r.c === 'xa' ? a0 <= b0 && a1 > b1 : r.c === 'xb' ? a0 >= b0 && a1 < b1 : r.c === 'gt' ? a1 > b1 : a1 < b1;
  });
}

/* ---------- history ----------
   The backtester runs on the platform's own prices only (spec istoric-la-cerere, decision 6). The live week is the
   engine's 1-minute bars of the instrument (the platform's last 7 days plus the ticks); 4, 8 or 12 weeks add the
   platform's 1-minute bars before it, fetched when the run starts (livefeed.js liveRange) and kept for the session.
   Without a feed there is no run, and a platform history that starts later than asked is said, not filled. */
const BT_HIST = [1, 4, 8, 12];
const BT_REAL = new Map(); // sym|weeks -> { st: 'loading' | 'ok' | 'failed', bars, done, total, p, on }
const btRealKey = (sym, w) => sym + '|' + w;
const btFed = sym => typeof liveHas === 'function' && !!liveHas(sym);
// fetch the weeks before the live week once per instrument and span; at most 6 spans kept (the current run's stays)
function btLoad(sym, w, prog) {
  const k = btRealKey(sym, w), e = BT_REAL.get(k);
  if (e && e.st !== 'failed') { if (prog) e.on = prog; return e.p; }
  const live = Engine.candles[sym] || [], now = Engine.simTime, to = live.length ? live[0].time : Math.floor(now / 60) * 60;
  const n = { st: 'loading', bars: [], done: 0, total: Math.max(1, Math.ceil((to - (now - w * 7 * 86400)) / 604800)), on: prog };
  n.p = Promise.resolve().then(() => liveRange(sym, 1, now - w * 7 * 86400, to, { onProgress: (d, t) => { n.done = d; n.total = t; if (n.on) n.on(d, t); } }))
    .then(r => { n.st = 'ok'; n.bars = (r && r.bars) || []; }, err => { n.st = 'failed'; n.err = err; });
  BT_REAL.delete(k); BT_REAL.set(k, n);
  for (const key of BT_REAL.keys()) { if (BT_REAL.size <= 6) break; if (key !== k && !(BT.res && key === btRealKey(BT.res.sym, BT.res.cfg.hist))) BT_REAL.delete(key); }
  return n.p;
}
// the 1-minute history of a run and its bars; the bar still forming is left out (signals act on closed bars, as live
// trading does). why: null | 'no-feed' | 'loading' | 'failed' | 'short' (the platform starts more than a day after `want`)
function btBars(sym, tf, weeks = 1) {
  const live = Engine.candles[sym] || [], w = BT_HIST.includes(weeks) ? weeks : 1, to = Engine.simTime, want = to - w * 7 * 86400;
  const none = why => ({ bars: [], src: [], from: null, to, want, why });
  if (!btFed(sym)) return none('no-feed');
  if (!live.length) return none('loading');
  let src = live;
  if (w > 1) {
    const e = BT_REAL.get(btRealKey(sym, w));
    if (!e || e.st === 'loading') return none('loading');
    if (e.st === 'failed') return none('failed');
    const l0 = live[0].time; src = e.bars.filter(b => b.time < l0).concat(live);
  }
  const step = tf * 60, bars = [];
  for (const c of src) {
    const b = Math.floor(c.time / step) * step, last = bars[bars.length - 1];
    if (!last || last.time !== b) bars.push({ time: b, open: c.open, high: c.high, low: c.low, close: c.close });
    else { if (c.high > last.high) last.high = c.high; if (c.low < last.low) last.low = c.low; last.close = c.close; }
  }
  if (bars.length && bars[bars.length - 1].time + step > Engine.simTime) bars.pop();
  const from = src[0].time;
  return { bars, src, from, to, want, why: w > 1 && from > want + 86400 ? 'short' : null };
}

/* ---------- simulation ---------- */
function minuteIndex(src, t) { let lo = 0, hi = src.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (src[m].time < t) lo = m + 1; else hi = m; } return lo; }
function runBacktest(c, sym, opt = {}) {
  const m = M(sym), tf = opt.tf || c.tf, HB = btBars(sym, tf, opt.hist ?? c.hist), bars = HB.bars, src = HB.src;
  c = { ...c }; for (const k of ['slK', 'tpR', 'trailK', 'trailAct', 'beR']) if (opt[k] != null) c[k] = opt[k];
  const p = { ...c.p, ...(opt.p || {}) }, slK = c.slK, tpR = c.tpR, trail = c.trail || 'off';
  const X = btSeries(bars, p, tf), L = ruleFn(c.long, X), Sx = ruleFn(c.short, X);
  const warm = warmOf(p);
  const n = bars.length, from = Math.max(warm, opt.from ?? warm), to = Math.min(n, opt.to ?? n);
  const slip = c.slip * m.pip, qUsd = Engine.usd(m.quote), K = btCosts(c, sym), sp = K.spreadAt;
  // a bid-level price x at t as the exit side gets it: longs exit on the bid, shorts on the ask (bid + spread)
  const ex = (x, t, d) => d > 0 ? x : x + sp(t);
  // costs and caps: commission per lot round turn and swap per rollover of the cost mode; size on the sheet's volume
  // step within its min / max, equity × effective leverage of the current profile and the ticket's per-order cap
  const commLot = K.commLot, lev = effLev(sym), levX = Math.min(lev, MAX_NOTIONAL_X), slFix = btFixed(c, sym, 'sl') * m.pip;
  const [vMin, vMax, vStep] = m.p.vol, minSteps = Math.max(1, Math.round(vMin / vStep)), dec = lotDec(sym);
  let eq = BT_START, peak = BT_START, mdd = 0, pos = null, pending = 0, sized = 0, capped = 0, skipped = 0;
  const capBy = { lev: 0, x: 0, lots: 0 };
  const trades = [], curve = [], barRet = [];
  let inMkt = 0;
  const close = (exitPx, t, reason) => {
    const d = pos.side, gross = (exitPx - pos.entry) * d * pos.units * qUsd;
    const comm = commLot * pos.lots, swap = K.swap(d, pos.lots, pos.entry, pos.t, t);
    const pnl = gross - comm + swap; eq += pnl;
    trades.push({ side: d > 0 ? 'buy' : 'sell', et: pos.t, ep: pos.entry, xt: t, xp: exitPx, reason, pnl, r: pnl / pos.riskUsd, pips: (exitPx - pos.entry) * d / m.pip, bars: pos.bars, lots: pos.lots, mfe: pos.mfe / pos.dist, mae: pos.mae / pos.dist, stop0: pos.stop0, stopX: pos.stop, comm, swap, capped: pos.capped });
    pos = null;
  };
  const mark = (x, t) => pos ? (ex(x, t, pos.side) - pos.entry) * pos.side * pos.units * qUsd : 0;
  for (let i = from; i < to; i++) {
    const b = bars[i], prevEq = eq + (pos ? mark(bars[i - 1].close, bars[i - 1].time) : 0);
    // 1) execute pending signal at this bar's open (the first bar after a close is the reopening)
    if (pending) {
      if (pos && pos.side !== pending && c.opp) close(ex(b.open, b.time, pos.side) - pos.side * slip, b.time, 'Opposite signal');
      if (!pos) {
        const d = pending, entry = b.open + (d > 0 ? sp(b.time) : 0) + d * slip, atr = X.atr[i - 1] || 0;
        const dist = c.slMode === 'atr' ? atr * slK : slFix;
        if (dist > 0) {
          // whole volume steps of the sheet: what the risk asks for (at least the minimum), then the caps
          const riskUsd = eq * c.risk / 100, perStep = m.size * vStep, perLot = m.size * entry * qUsd;
          const want = Math.max(minSteps, Math.floor(riskUsd / (dist * qUsd * perStep) + 1e-9));
          const capLev = Math.floor(Math.max(0, eq) * lev / perLot / vStep + 1e-9), capX = Math.floor(Math.max(0, eq) * MAX_NOTIONAL_X / perLot / vStep + 1e-9), capL = Math.floor(vMax / vStep + 1e-9);
          const h = Math.min(want, capLev, capX, capL);
          sized++;
          if (h < minSteps) skipped++; // not even the minimum size fits under the caps
          else {
            const cut = h < want;
            if (cut) { capped++; capBy[h === capLev ? 'lev' : h === capX ? 'x' : 'lots']++; }
            const lots = +(h * vStep).toFixed(dec), units = lots * m.size;
            pos = { side: d, entry, t: b.time, stop: entry - d * dist, stop0: entry - d * dist, tp: tpR > 0 ? entry + d * dist * tpR : null, lots, units, riskUsd: dist * qUsd * units, bars: 0, dist, mfe: 0, mae: 0, kind: 'init', capped: cut };
          }
        }
      }
      pending = 0;
    }
    // 2) resolve stop / target on 1-minute data inside this bar
    if (pos) {
      pos.bars++;
      const end = b.time + tf * 60;
      // trailing distance for this bar (ATR uses the last closed bar, so no look-ahead)
      const trD = trail === 'atr' ? (X.atr[i - 1] || 0) * c.trailK : trail === 'pips' ? btFixed(c, sym, 'trail') * m.pip : 0;
      for (let k = minuteIndex(src, b.time); k < src.length && src[k].time < end && pos; k++) {
        const mc = src[k], d = pos.side;
        // exit side of the book: longs exit on bid, shorts on ask
        const o = ex(mc.open, mc.time, d), hi = ex(mc.high, mc.time, d), lo = ex(mc.low, mc.time, d);
        const hitS = d > 0 ? lo <= pos.stop : hi >= pos.stop, hitT = pos.tp != null && (d > 0 ? hi >= pos.tp : lo <= pos.tp);
        if (hitS) { const gap = d > 0 ? o <= pos.stop : o >= pos.stop; close((gap ? o : pos.stop) - d * slip, mc.time, pos.kind === 'trail' ? 'Trailing stop' : pos.kind === 'be' ? 'Break-even' : 'Stop loss'); }
        else if (hitT) { const gap = d > 0 ? o >= pos.tp : o <= pos.tp; close(gap ? o : pos.tp, mc.time, 'Take profit'); }
        if (pos) {
          // track excursions, then ratchet the stop for the NEXT minute (conservative: never same-minute)
          const fav = (d > 0 ? hi : lo) - pos.entry, adv = pos.entry - (d > 0 ? lo : hi);
          if (fav * d > pos.mfe) pos.mfe = fav * d; if (adv * d > pos.mae) pos.mae = adv * d;
          if (c.beR > 0 && pos.mfe >= c.beR * pos.dist && (pos.entry - pos.stop) * d > 0) { pos.stop = pos.entry; pos.kind = 'be'; }
          if (trD > 0 && pos.mfe >= (c.trailAct || 0) * pos.dist) {
            const ns = pos.entry + d * pos.mfe - d * trD;
            if ((ns - pos.stop) * d > 0) { pos.stop = ns; pos.kind = 'trail'; }
          }
        }
      }
      if (pos && c.maxBars > 0 && pos.bars >= c.maxBars) close(ex(b.close, end - 60, pos.side) - pos.side * slip, end, 'Time exit');
    }
    if (pos) inMkt++;
    // 3) evaluate signals on bar close
    const goL = c.dir !== 'short' && L(i), goS = c.dir !== 'long' && Sx(i);
    if (goL && !goS && (!pos || pos.side < 0)) pending = 1;
    else if (goS && !goL && (!pos || pos.side > 0)) pending = -1;
    const mtm = eq + mark(b.close, b.time);
    curve.push({ t: b.time, eq: mtm }); barRet.push(prevEq ? mtm / prevEq - 1 : 0);
    peak = Math.max(peak, mtm); mdd = Math.max(mdd, (peak - mtm) / peak);
  }
  if (pos) close(ex(bars[to - 1].close, bars[to - 1].time, pos.side), bars[to - 1].time + tf * 60, 'End of data');
  const last = curve.length ? curve[curve.length - 1] : null; if (last) last.eq = eq;
  return { sym, tf, trades, curve, ret: barRet, stats: btStats(trades, barRet, mdd, btPerYear(bars, from, to, tf), inMkt / Math.max(1, to - from)), costMode: K.mode, from: bars[from]?.time, to: bars[to - 1]?.time, mkt: bars[to - 1] && bars[from] ? (bars[to - 1].close / bars[from].open - 1) * 100 : 0, nBars: to - from, totalBars: n, warm,
    histFrom: HB.from, histTo: HB.to, histShort: HB.why === 'short', sized, capped, skipped, capBy, lev, levX, commLot, vMax, slFixPts: c.slMode === 'pips' ? slFix / m.pip : null, trailFixPts: trail === 'pips' ? btFixed(c, sym, 'trail') : null };
}
// P(X ≥ k) for X ~ Binomial(K, p): the chance of k+ profitable windows out of K on a coin-flip market
function btBinomTail(K, k, p = .5) { if (k <= 0) return 1; if (k > K) return 0; let c = 1, s = 0; for (let i = 0; i <= K; i++) { if (i >= k) s += c * p ** i * (1 - p) ** (K - i); c = c * (K - i) / (i + 1); } return Math.min(1, s); }
// t-statistic of a sample mean (null when undefined)
function btT(x) { const n = x.length; if (n < 2) return null; const m = x.reduce((a, v) => a + v, 0) / n, sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)); return sd ? m / (sd / Math.sqrt(n)) : null; }
// perYear: bars observed per year (btPerYear), the annualisation of the per-bar Sharpe (decision 37)
function btStats(tr, barRet, mdd, perYear, exposure) {
  const w = tr.filter(t => t.pnl > 0), l = tr.filter(t => t.pnl <= 0);
  const gw = w.reduce((s, t) => s + t.pnl, 0), gl = -l.reduce((s, t) => s + t.pnl, 0), net = gw - gl;
  const mu = barRet.reduce((s, x) => s + x, 0) / Math.max(1, barRet.length);
  const sd = Math.sqrt(barRet.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, barRet.length - 1));
  const ann = Math.sqrt(perYear > 0 ? perYear : 0), srBar = sd ? mu / sd : 0, sharpe = srBar * ann;
  // Lo (2002): SE of the per-bar Sharpe ≈ sqrt((1 + SR²/2) / n), annualised with the same factor
  const sharpeSE = barRet.length > 1 ? Math.sqrt((1 + srBar * srBar / 2) / barRet.length) * ann : null;
  let streak = 0, worst = 0; for (const t of tr) { streak = t.pnl <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  return {
    n: tr.length, net, ret: net / BT_START * 100, win: tr.length ? w.length / tr.length * 100 : 0, pf: gl ? gw / gl : gw ? Infinity : 0,
    expR: tr.length ? tr.reduce((s, t) => s + t.r, 0) / tr.length : 0, avgW: w.length ? gw / w.length : 0, avgL: l.length ? -gl / l.length : 0,
    mdd: mdd * 100, sharpe, sharpeSE, perYear, bars: tr.length ? tr.reduce((s, t) => s + t.bars, 0) / tr.length : 0, exposure: exposure * 100, lossStreak: worst,
    longs: tr.filter(t => t.side === 'buy').length, shorts: tr.filter(t => t.side === 'sell').length,
    ...btTradeSR(tr)
  };
}

/* ---------- honest report: PSR, DSR, PBO ----------
   Per-trade Sharpe (mean R / sd R) with the skew and kurtosis of the same R series.
   PSR: Bailey & López de Prado (2012). DSR: Bailey & López de Prado (2014), the PSR against the Sharpe the
   best of N tries reaches by luck. PBO: Bailey, Borwein, López de Prado & Zhu (2017), CSCV over S blocks. */
const BT_GAMMA = .5772156649015329; // Euler–Mascheroni
// standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7) and its inverse (Acklam)
function btPhi(x) { const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + .3275911 * z), e = 1 - t * (.254829592 + t * (-.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z); return x >= 0 ? (1 + e) / 2 : (1 - e) / 2; }
function btPhiInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572], c = [-.007784894002430293, -.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [.007784695709041462, .3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = .02425, f = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < lo) return f(Math.sqrt(-2 * Math.log(p))); if (p > 1 - lo) return -f(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - .5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// mean, sample sd, skewness and (non-excess) kurtosis
function btMoments(x) {
  const n = x.length; if (!n) return { n: 0, mean: 0, sd: 0, skew: 0, kurt: 3 };
  const m = x.reduce((a, v) => a + v, 0) / n; let m2 = 0, m3 = 0, m4 = 0;
  for (const v of x) { const d = v - m, d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
  m2 /= n; m3 /= n; m4 /= n;
  return { n, mean: m, sd: n > 1 ? Math.sqrt(m2 * n / (n - 1)) : 0, skew: m2 > 0 ? m3 / m2 ** 1.5 : 0, kurt: m2 > 0 ? m4 / (m2 * m2) : 3 };
}
function btTradeSR(tr) { const mo = btMoments(tr.map(t => t.r)); return { srT: mo.sd ? mo.mean / mo.sd : 0, skew: mo.skew, kurt: mo.kurt }; }
// P(true Sharpe > sr0) given the observed per-observation Sharpe over n observations
function btPSR(sr, n, skew, kurt, sr0 = 0) {
  if (!(n > 1)) return null;
  const den = Math.sqrt(Math.max(1e-6, 1 - skew * sr + (kurt - 1) / 4 * sr * sr));
  return btPhi((sr - sr0) * Math.sqrt(n - 1) / den);
}
// expected maximum Sharpe of N independent tries with cross-try Sharpe variance v (zero true edge)
function btSR0(N, v) { if (!(N > 1) || !(v > 0)) return 0; return Math.sqrt(v) * ((1 - BT_GAMMA) * btPhiInv(1 - 1 / N) + BT_GAMMA * btPhiInv(1 - 1 / (N * Math.E))); }
function btDSR(sr, n, skew, kurt, N, v) { return btPSR(sr, n, skew, kurt, btSR0(N, v)); }
// effective number of tries: grid cells that move together (corr > 0.7) count once, never fewer than half the raw count
function btNEff(N, gridCells, clusters) { if (!(N > 0)) return 0; return Math.max(Math.ceil(N / 2), N - Math.max(0, gridCells - clusters)); }
// greedy correlation clusters over aligned return series (flat series form one cluster)
function btClusters(series, thr = .7) {
  const z = series.map(x => { const n = x.length, m = x.reduce((a, v) => a + v, 0) / Math.max(1, n); let s = 0; const d = x.map(v => { const e = v - m; s += e * e; return e; }); return s > 0 ? { d, s: Math.sqrt(s) } : null; });
  const reps = []; let flat = 0;
  for (const a of z) {
    if (!a) { flat = 1; continue; }
    if (!reps.some(b => { let c = 0; for (let i = 0; i < a.d.length; i++) c += a.d[i] * b.d[i]; return c / (a.s * b.s) > thr; })) reps.push(a);
  }
  return reps.length + flat;
}
/* PBO by combinatorially symmetric cross-validation. mat[cell][block] = array of per-bar returns.
   Every half of the blocks is a training set once: the best training cell (by Sharpe) is ranked on the other half.
   PBO = share of splits where it lands at or below the median; logit = ln(w / (1 - w)) of its relative rank. */
function btPBO(mat) {
  const N = mat.length, S = N ? mat[0].length : 0; if (N < 2 || S < 2 || S % 2) return null;
  const agg = mat.map(row => row.map(b => { let s = 0, q = 0; for (const v of b) { s += v; q += v * v; } return [b.length, s, q]; }));
  const sh = (cell, set) => { let n = 0, s = 0, q = 0; for (const j of set) { const a = agg[cell][j]; n += a[0]; s += a[1]; q += a[2]; } if (n < 2) return 0; const m = s / n, v = (q - n * m * m) / (n - 1); return v > 0 ? m / Math.sqrt(v) : 0; };
  const combos = [], pick = (st, cur) => { if (cur.length === S / 2) { combos.push(cur.slice()); return; } for (let j = st; j < S; j++) { cur.push(j); pick(j + 1, cur); cur.pop(); } };
  pick(0, []);
  const logits = [];
  for (const is of combos) {
    const oos = [...Array(S).keys()].filter(j => !is.includes(j));
    let best = 0, bv = -Infinity; for (let i = 0; i < N; i++) { const v = sh(i, is); if (v > bv) { bv = v; best = i; } }
    const ov = mat.map((_, i) => sh(i, oos)), b = ov[best];
    if (ov.every(v => v === ov[0])) continue; // all cells tie out of sample: this split says nothing about overfitting
    const rank = ov.filter(v => v < b).length + (ov.filter(v => v === b).length + 1) / 2; // mid-rank for ties
    const w = rank / (N + 1); logits.push(Math.log(w / (1 - w)));
  }
  if (!logits.length) return null; // flat or identical cells: PBO is not measurable
  const srt = logits.slice().sort((a, b) => a - b), med = srt.length % 2 ? srt[srt.length >> 1] : (srt[srt.length / 2 - 1] + srt[srt.length / 2]) / 2;
  // λ ≤ 0 (Bailey et al. 2017): a best cell that lands exactly on the median out of sample is not a success
  return { pbo: logits.filter(l => l <= 0).length / logits.length, logit: med, splits: logits.length, cells: N, blocks: S };
}
// CSCV input from per-cell bar returns: align on the common tail, cut into S equal blocks
function btBlocks(series, S = 8) {
  const L = Math.min(...series.map(x => x.length)), B = Math.floor(L / S); if (!(B >= 10)) return null;
  return series.map(x => { const a = x.slice(x.length - B * S); return Array.from({ length: S }, (_, j) => a.slice(j * B, (j + 1) * B)); });
}

/* ---------- trial registry ----------
   S.bt.trials lists every configuration tried in the account (key = template + instrument + timeframe, h = the
   settings): single runs, optimizer cells, walk-forward windows, all-pairs runs. It is saved with the state, so it
   persists across sessions. Re-running the same configuration replaces its entry, so N counts distinct tries. sharpe = per-trade Sharpe (mean R / sd R), the unit DSR compares against. */
const BT_TRIALS_MAX = 500;
const btKey = c => `${c.tpl}|${c.sym}|${c.tf}`;
const btCopy = c => { const { trials, ...o } = c; return JSON.parse(JSON.stringify(o)); };
function btHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const BT_PK = { emaF: ['emaF'], emaS: ['emaS'], rsi: ['rsiN'], bbU: ['bbN', 'bbK'], bbM: ['bbN', 'bbK'], bbL: ['bbN', 'bbK'], dcH: ['dcN'], dcL: ['dcN'] };
// hash of what changes the trades: active rules, the indicator lengths they use, exits, sizing, costs
function btCfgHash(c, extra = '') {
  const on = r => (r || []).filter(x => x.on).map(x => [x.a, x.c, x.b, x.a === 'value' || x.b === 'value' ? x.v : 0]);
  const p = {}; (c.long || []).concat(c.short || []).filter(r => r.on).forEach(r => [r.a, r.b].forEach(o => (BT_PK[o] || []).forEach(k => p[k] = c.p[k])));
  const tr = c.trail || 'off';
  return btHash(JSON.stringify([c.dir, Object.keys(p).sort().map(k => [k, p[k]]), on(c.long), on(c.short), c.slMode, c.slMode === 'atr' ? c.slK : btFixed(c, c.sym, 'sl'), c.tpR, c.opp, c.maxBars,
    tr, tr === 'atr' ? c.trailK : tr === 'pips' ? btFixed(c, c.sym, 'trail') : 0, tr === 'off' ? 0 : c.trailAct, c.beR, c.risk, c.slip, btCostSig(c), effLev(c.sym), c.hist || 1]) + extra);
}
function btTrials() {
  const c = btCfg(), ok = x => x && typeof x === 'object' && typeof x.key === 'string' && typeof x.h === 'string' && [x.t, x.n, x.expR, x.sharpe].every(v => typeof v === 'number' && isFinite(v));
  if (!Array.isArray(c.trials)) c.trials = [];
  else if (c.trials.length > BT_TRIALS_MAX || !c.trials.every(ok)) c.trials = c.trials.filter(ok).slice(-BT_TRIALS_MAX);
  return c.trials;
}
function btAddTrial(key, h, st) {
  const L = btTrials(), i = L.findIndex(x => x.key === key && x.h === h); if (i >= 0) L.splice(i, 1);
  L.push({ key, h, t: Date.now(), n: st.n, expR: isFinite(st.expR) ? st.expR : 0, sharpe: isFinite(st.srT) ? st.srT : 0 });
  if (L.length > BT_TRIALS_MAX) L.splice(0, L.length - BT_TRIALS_MAX);
}
const btEff = (c, o) => ({ ...c, ...o, p: { ...c.p, ...(o.p || {}) } });
// PSR / DSR / N effective for a result. N = every try recorded in the account (decision 37): the search across
// templates, instruments and timeframes is part of the selection, so it counts too
function btHonest(R) {
  const key = btKey(R.cfg), L = btTrials(), N = L.length, s = R.stats;
  const pb = BT.pbo && BT.pbo.key === key ? BT.pbo : null;
  const nEff = btNEff(N, pb ? Math.min(pb.cells, N) : 0, pb ? Math.min(pb.clusters, N) : 0);
  // every try counts in N; the cross-try Sharpe variance skips tries under 5 trades, whose Sharpe is mostly noise
  const mo = btMoments(L.filter(x => x.n >= 5).map(x => x.sharpe)), v = mo.n > 1 ? mo.sd * mo.sd : 0, sr0 = btSR0(nEff, v);
  const ok = s.n >= 5;
  return { key, N, nEff, v, sr0, pb, psr: ok ? btPSR(s.srT, s.n, s.skew, s.kurt, 0) : null, dsr: ok ? btDSR(s.srT, s.n, s.skew, s.kurt, nEff, v) : null };
}
// the report's verdict in plain words (statistics only in brackets); p formats a probability
function btVerdict(s, H, p) {
  const tries = `${H.N} tr${H.N === 1 ? 'y' : 'ies'} in this account`;
  if (s.n < 20) return ['dn', `Too few trades to judge: ${s.n}. Below about 20 trades a result, good or bad, is mostly luck. A longer History, a lower timeframe or looser rules give more trades.`];
  if (H.dsr != null && H.dsr >= .95) return ['neutral', `Looks better than luck after ${tries} (DSR ${p(H.dsr)}); check it on new data before trusting it.`];
  if (s.net > 0) return ['neutral', `Made ${usdFmt(s.net, true)} after costs, within what luck gives after ${tries} (DSR ${p(H.dsr)}): no evidence of an edge.`];
  return ['dn', `Lost ${usdFmt(-s.net)} after costs: no evidence of an edge. Costs are what every strategy pays.`];
}
function renderHonest() {
  const el = $('#btHonest'), R = BT.res; if (!el || !R) return;
  const H = btHonest(R), s = R.stats, p = v => v == null ? '—' : (v * 100).toFixed(v > .995 || v < .005 ? 1 : 0) + '%';
  const tfL = R.tf >= 60 ? R.tf / 60 + 'H' : R.tf + 'm', few = s.n < 5 ? `Needs at least 5 trades; this run has ${s.n}.` : '';
  // one muted line per measure (the figures that move); the full explanation is the label's tooltip
  const row = (lab, val, line, tip, c = '') => `<tr><td class="l bt-lk" tabindex="0"${tipAttr(`${lab}|${tip}`)}>${lab}</td><td class="${c}"><b>${val}</b></td><td class="l bt-line">${line}</td></tr>`;
  const pb = H.pb, [vc, vt] = btVerdict(s, H, p);
  const top = $('#btVerdict'); if (top) { top.className = `wf-verdict ${vc}`; top.innerHTML = `<b>Verdict:</b> ${vt}`; }
  const k = pb ? Math.round(pb.pbo * pb.splits) : 0;
  el.innerHTML = `<h3 class="bt-band" tabindex="0"${tipAttr('How much of this could be luck|Every run, optimizer cell, walk-forward window and all-pairs run is recorded and kept between sessions. A high PSR or DSR after many tries can still be luck; PBO near 50% means the optimizer picked noise.')}>How much of this could be luck</h3><table class="tbl sm bt-luck"><tbody>
    ${row('PSR', p(H.psr), few || `From ${s.n} trades · skew ${nfx(s.skew, 2)} · kurtosis ${nfx(s.kurt, 1)}`, few || `Probability the true per-trade Sharpe is above zero, judged from ${s.n} trades with their skew (${nfx(s.skew, 2)}) and fat tails (kurtosis ${nfx(s.kurt, 1)}).`)}
    ${row('DSR', p(H.dsr), few || (H.nEff > 1 ? `Bar: the luckiest of ${H.nEff} tries, ${nfx(H.sr0, 3)} per trade · this run ${nfx(s.srT, 3)}` : `Bar at zero after ${H.nEff ? 'one try' : 'no recorded tries'}: DSR equals PSR`),
      few || (H.nEff > 1 ? `Probability this edge is real after ${H.nEff} tries: the bar is the Sharpe the luckiest of ${H.nEff} tries would reach by chance (${nfx(H.sr0, 3)} per trade; this run ${nfx(s.srT, 3)}).` : `Probability this edge is real after ${H.nEff ? 'one try' : 'no recorded tries'}: with nothing to choose from, the bar stays at zero and DSR equals PSR. Every further setting you try raises it.`))}
    ${row('PBO', pb ? p(pb.pbo) : '—', pb ? `Best cell at or below the median on the other half in ${k} of ${pb.splits} splits · median logit ${nfx(pb.logit, 2)}` : 'Not measured yet: run the Optimizer grid',
      pb ? `Probability the optimizer's best cell is a curve fit: over ${pb.splits} ways to split history into two halves, the best cell on one half finished at or below the median on the other ${k} times. Median logit ${nfx(pb.logit, 2)} (0 or below means overfit).` : 'Not measured yet: it needs the optimizer grid. Open the Optimizer tab to run it.', pb ? (pb.pbo >= .5 ? 'dn' : 'muted') : 'muted')}
    ${row('N effective', `${H.nEff} <small>of ${H.N}</small>`, `${H.N} setting${H.N === 1 ? '' : 's'} tried in this account (this run: ${pretty(R.sym)} ${tfL})${pb ? ` · ${pb.cells} cells in ${pb.clusters} correlated group${pb.clusters === 1 ? '' : 's'}` : ''}`,
      `${H.N} distinct setting${H.N === 1 ? '' : 's'} tried in this account, on every template, instrument and timeframe (this run: ${pretty(R.sym)} ${tfL}). Choosing among them is part of the search, so all count. ${pb ? `The last optimizer grid's ${pb.cells} cells fall into ${pb.clusters} group${pb.clusters === 1 ? '' : 's'} whose returns correlate above 0.7; each group counts as one try (never fewer than half of all tries).` : 'All counted as independent until an optimizer grid shows how correlated they are.'}`)}
    </tbody></table>
    <div class="wf-foot"><p class="small muted">Every try is recorded between sessions.</p><button class="ghost sm" id="btTrialsReset">Reset trials</button></div>`;
}

/* ---------- UI ---------- */
const fmtR = v => isFinite(v) ? v.toFixed(2) : '∞';
function opSel(name, val) { return `<select data-k="${name}">${OPERANDS.map(([k, l]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`; }
function ruleRow(side, i, r) {
  return `<div class="rule ${r.on ? '' : 'off'}" data-side="${side}" data-i="${i}">
    <input type="checkbox" data-k="on" ${r.on ? 'checked' : ''} aria-label="Enable condition" ${i === 0 ? 'disabled' : ''}>
    ${opSel('a', r.a)}<select data-k="c">${CONDS.map(([k, l]) => `<option value="${k}" ${k === r.c ? 'selected' : ''}>${l}</option>`).join('')}</select>${opSel('b', r.b)}
    <input type="number" step="any" data-k="v" value="${r.v}" class="mono" ${r.b === 'value' || r.a === 'value' ? '' : 'hidden'} aria-label="Value">
  </div>`;
}
function renderBtConfig() {
  { const a = document.activeElement, id = a && a.id && a.closest('#btCfg') ? a.id : ''; if (id) requestAnimationFrame(() => { const n = document.getElementById(id); if (n && document.activeElement !== n) n.focus({ preventScroll: true }); }); } // the redraw keeps the keyboard focus (UX-86)
  const c = btCfg(), t = TEMPLATES[c.tpl], sym = M(c.sym) ? c.sym : 'EURUSD', m = M(sym), uw = m.unit === 'pt' ? 'points' : 'pips', cfd = m.kind === 'cfd';
  const slF = btFixed(c, sym, 'sl'), trF = btFixed(c, sym, 'trail'), u1 = unitWord(sym, true), vol = m.p.vol, dec = c.costMode === 'declared';
  const near = v => v <= 2 * m.spread ? `<p class="small dn" style="margin:6px 0 0">A fixed ${v} ${u1} distance is within 2× the ${m.spread}-${u1} spread of ${pretty(sym)}: most of the stop is cost.</p>` : '';
  const num = (k, v, step = 1, min = 1, lab) => `<label>${lab}<input type="number" data-p="${k}" value="${v}" step="${step}" min="${min}" class="mono"></label>`;
  $('#btCfg').innerHTML = `<h3 class="bt-band">Backtest settings</h3>
    <div class="bt-sec"><div class="bt-row3">
      <label>Instrument<select id="btSym">${instrOptions(c.sym, c.sym)}</select></label>
      <label>Timeframe<select id="btTf">${[[5, '5m'], [15, '15m'], [30, '30m'], [60, '1H']].map(([v, l]) => `<option value="${v}" ${v === c.tf ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="w2">Direction<select id="btDir"><option value="both" ${c.dir === 'both' ? 'selected' : ''}>Long &amp; short</option><option value="long" ${c.dir === 'long' ? 'selected' : ''}>Long only</option><option value="short" ${c.dir === 'short' ? 'selected' : ''}>Short only</option></select></label>
      <label${tipAttr('History|Backtests run on the platform\'s own 1-minute prices. The live week is the one the chart shows; 4, 8 or 12 weeks fetch the weeks before it from the platform when you press Run (about 1 to 5 seconds a week), kept for the session.')}>History<select id="btHist">${BT_HIST.map(w => `<option value="${w}" ${w === (c.hist || 1) ? 'selected' : ''}>${w === 1 ? 'Live week' : `${w} weeks`}</option>`).join('')}</select></label>
    </div></div>
    <div class="bt-sec"><h3>Strategy</h3>
      <div class="tpl-grid" role="group" aria-label="Strategy template">${Object.entries(TEMPLATES).map(([k, v]) => `<button class="tpl ${k === c.tpl ? 'on' : ''}" data-tpl="${k}" aria-pressed="${k === c.tpl}">${v.name}</button>`).join('')}</div>
      <p class="bt-desc">${t.desc}</p></div>
    <div class="bt-sec"><h3>Indicators</h3><div class="bt-row3">
      ${num('emaF', c.p.emaF, 1, 2, 'EMA fast')}${num('emaS', c.p.emaS, 1, 3, 'EMA slow')}${num('rsiN', c.p.rsiN, 1, 2, 'RSI period')}
      ${num('bbN', c.p.bbN, 1, 5, 'BB period')}${num('bbK', c.p.bbK, .1, .5, 'BB std dev')}${num('dcN', c.p.dcN, 1, 3, 'Donchian N')}
    </div></div>
    <div class="bt-sec"><h3><span class="up">Long entry</span> <span class="muted small">all conditions true on bar close</span></h3>${c.long.map((r, i) => ruleRow('long', i, r)).join('')}
      <h3 style="margin-top:8px"><span class="dn">Short entry</span></h3>${c.short.map((r, i) => ruleRow('short', i, r)).join('')}</div>
    <div class="bt-sec"><h3>Exits</h3><div class="bt-row3">
      <label class="w2">Stop type<select id="btSlMode"><option value="atr" ${c.slMode === 'atr' ? 'selected' : ''}>ATR × multiple</option><option value="pips" ${c.slMode === 'pips' ? 'selected' : ''}>Fixed ${uw}</option></select></label>
      ${c.slMode === 'atr' ? `<label>Stop (× ATR)<input type="number" id="btSlK" value="${c.slK}" step=".1" min=".2" class="mono"></label>` : `<label${cfd ? ` title="Default for ${escHtml(pretty(sym))}: ${btDefPts(sym)} points (2 × the sheet's 1-hour volatility, at least 4 × the spread)"` : ''}>Stop (${uw})<input type="number" id="btSlPips" data-sym="${sym}" value="${slF}" step="1" min="1" class="mono"></label>`}
      <label>Target (R, 0 = none)<input type="number" id="btTpR" value="${c.tpR}" step=".25" min="0" class="mono"></label>
      <label>Max bars (0 = off)<input type="number" id="btMax" value="${c.maxBars}" step="1" min="0" class="mono"></label>
      <label class="chk"><input type="checkbox" id="btOpp" ${c.opp ? 'checked' : ''}> Exit on opposite signal</label>
    </div>${c.slMode === 'pips' ? near(slF) : ''}
    <div class="bt-row3" style="margin-top:8px">
      <label class="w2">Trailing stop<select id="btTrail"><option value="off" ${c.trail === 'off' ? 'selected' : ''}>Off</option><option value="atr" ${c.trail === 'atr' ? 'selected' : ''}>ATR × multiple</option><option value="pips" ${c.trail === 'pips' ? 'selected' : ''}>Fixed ${uw}</option></select></label>
      ${c.trail === 'pips' ? `<label>Trail (${uw})<input type="number" id="btTrailPips" data-sym="${sym}" value="${trF}" step="1" min="1" class="mono"></label>` : `<label>Trail (× ATR)<input type="number" id="btTrailK" value="${c.trailK}" step=".25" min=".25" class="mono" ${c.trail === 'off' ? 'disabled' : ''}></label>`}
      <label title="The trail only starts once the trade is this many R in profit (0 = from entry)">Trail from (R)<input type="number" id="btTrailAct" value="${c.trailAct}" step=".25" min="0" class="mono" ${c.trail === 'off' ? 'disabled' : ''}></label>
      <label title="Move the stop to entry once the trade is this many R in profit">Break-even at (R)<input type="number" id="btBe" value="${c.beR}" step=".25" min="0" class="mono"></label>
    </div></div>
    <div class="bt-sec"><h3>Sizing &amp; costs</h3><div class="bt-row3">
      <label>Risk / trade %<input type="number" id="btRisk" value="${c.risk}" step=".25" min=".05" class="mono"></label>
      <label>Slippage (${uw})<input type="number" id="btSlip" value="${c.slip}" step=".1" min="0" class="mono"></label>
      <label>Out-of-sample %<input type="number" id="btOos" value="${c.oos}" step="5" min="0" max="60" class="mono"></label>
      <label class="w2" title="Account: the costs this account pays live (instrument sheet + your extra commission in Settings). Declared: your own numbers">Costs<select id="btCost"><option value="account" ${dec ? '' : 'selected'}>Account costs</option><option value="declared" ${dec ? 'selected' : ''}>Declared costs</option></select></label>
    </div>${dec ? `<div class="bt-row3" style="margin-top:8px">
      <label>Spread (${uw})<input type="number" id="btDSp" value="${c.dSpread}" step=".1" min="0" class="mono"></label>
      <label title="USD per lot, round turn">Commission $/lot<input type="number" id="btDComm" value="${c.dComm}" step=".5" min="0" class="mono"></label>
      <label title="USD per lot a night, negative = the position pays; ×3 on the triple day">Swap long $/lot<input type="number" id="btDSwL" value="${c.dSwapL}" step=".1" class="mono"></label>
      <label title="USD per lot a night, negative = the position pays; ×3 on the triple day">Swap short $/lot<input type="number" id="btDSwS" value="${c.dSwapS}" step=".1" class="mono"></label>
    </div>` : ''}<details class="bt-costs bt-cfgcost" open><summary class="small">${dec ? 'Declared costs' : 'Account costs'} · spread ${dec ? nfx(c.dSpread, 2) : +(m.p.spread[0] * m.point / m.pip).toFixed(2)} ${escHtml(u1)} · 1:${Math.min(effLev(sym), MAX_NOTIONAL_X)}</summary><p class="small muted">${escHtml(btCostText(c, sym))} Size in steps of ${escHtml(lotsWord(sym, vol[2]))}, from ${escHtml(lotsWord(sym, vol[0]))} to ${escHtml(lotsWord(sym, vol[1]))} per order, ${btLevText(effLev(sym))}. Fills only while the market is open.</p></details></div>
    <div class="bt-run"><button class="btn-pri" id="btRun">Run backtest</button><button class="ghost sm" id="btAll" title="The same settings on each of the ${Engine.FX.length} FX pairs">Run on all FX pairs</button></div>`;
}
function readBtConfig() {
  const c = btCfg(), v = id => $(id) ? +$(id).value : null;
  c.sym = $('#btSym').value; c.tf = +$('#btTf').value; c.dir = $('#btDir').value; if ($('#btHist')) c.hist = BT_HIST.includes(+$('#btHist').value) ? +$('#btHist').value : 1;
  $$('#btCfg [data-p]').forEach(e => { const x = +e.value; if (isFinite(x) && x > 0) c.p[e.dataset.p] = e.dataset.p === 'bbK' ? x : Math.round(x); });
  $$('#btCfg .rule').forEach(row => {
    const r = c[row.dataset.side][+row.dataset.i];
    row.querySelectorAll('[data-k]').forEach(e => { const k = e.dataset.k; r[k] = k === 'on' ? (row.dataset.i === '0' ? true : e.checked) : k === 'v' ? +e.value : e.value; });
  });
  // fixed distances and the CFD commission belong to the instrument (class) the form was drawn for, not to a newly picked one
  const put = (id, key, fx) => { const e = $(id); if (!e) return; const x = Math.max(1, +e.value || 0), s = e.dataset.sym; if (btIsCfd(s)) c[key] = { ...(c[key] || {}), [s]: x }; else c[fx] = x; };
  c.slMode = $('#btSlMode').value; if ($('#btSlK')) c.slK = Math.max(.2, v('#btSlK')); put('#btSlPips', 'slPts', 'slPips');
  c.tpR = Math.max(0, v('#btTpR')); c.maxBars = Math.max(0, Math.round(v('#btMax'))); c.opp = $('#btOpp').checked;
  c.trail = $('#btTrail').value; if ($('#btTrailK')) c.trailK = Math.max(.25, v('#btTrailK')); put('#btTrailPips', 'trailPts', 'trailPips');
  c.trailAct = Math.max(0, v('#btTrailAct')); c.beR = Math.max(0, v('#btBe'));
  c.risk = clamp(v('#btRisk'), .05, 10); c.slip = Math.max(0, v('#btSlip')); 
  if ($('#btCost')) c.costMode = $('#btCost').value === 'declared' ? 'declared' : 'account';
  const fin = (id, lo, hi, d) => { const x = v(id); return x != null && isFinite(x) ? clamp(x, lo, hi) : d; };
  if ($('#btDSp')) { c.dSpread = fin('#btDSp', 0, 1e6, c.dSpread); c.dComm = fin('#btDComm', 0, 1000, c.dComm); c.dSwapL = fin('#btDSwL', -1e4, 1e4, c.dSwapL); c.dSwapS = fin('#btDSwS', -1e4, 1e4, c.dSwapS); }
  c.oos = clamp(v('#btOos'), 0, 60);
  if (c.p.emaF >= c.p.emaS && (c.long.concat(c.short).some(r => r.on && (r.a === 'emaF' || r.b === 'emaF')))) toast('Check EMA lengths', 'Fast EMA is not shorter than slow EMA', 'info');
  save();
  return c;
}
function btRunAll() {
  const c = readBtConfig(), w = BT_HIST.includes(c.hist) ? c.hist : 1, el = $('#btOut'), nm = escHtml(pretty(c.sym));
  const say = (h, more = '') => { if (el) el.innerHTML = `<div class="bt-empty" role="status"><h3>${h}</h3>${more}</div>`; };
  if (!btFed(c.sym)) { say(`Backtests run on the platform's prices. ${nm} has no live feed right now.`); return Promise.resolve(false); }
  if (w > 1) {
    const k = btRealKey(c.sym, w), e = BT_REAL.get(k), show = (d, t) => say(`Loading ${w} weeks of ${nm} prices from the platform… ${d}/${t}`);
    if (e && e.st === 'failed') BT_REAL.delete(k); // a Run after a failure asks again
    if (!e || e.st !== 'ok') {
      const first = !e || e.st === 'failed', p = btLoad(c.sym, w, show), n = BT_REAL.get(k);
      show(n.done, n.total);
      return first ? p.then(() => {
        const c1 = readBtConfig(); if (c1.sym !== c.sym || (BT_HIST.includes(c1.hist) ? c1.hist : 1) !== w) return false;
        if (n.st === 'failed') { say(`Could not load ${nm} history from the platform.`, '<p><button class="btn-pri" id="btRetry">Retry</button></p>'); return false; }
        return btRunAll();
      }) : p.then(() => false);
    }
  }
  const H = btBars(c.sym, c.tf, c.hist);
  if (H.why && H.why !== 'short') { say(`${nm} prices are still loading from the platform. Run again in a moment.`); return Promise.resolve(false); }
  const bars = H.bars, n = bars.length;
  const split = c.oos > 0 ? Math.floor(n - (n - 0) * c.oos / 100) : n;
  const full = runBacktest(c, c.sym), is = c.oos > 0 ? runBacktest(c, c.sym, { to: split }) : null, oos = c.oos > 0 ? runBacktest(c, c.sym, { from: split }) : null;
  BT.res = { ...full, is, oos, split: bars[split]?.time, cfg: btCopy(c) };
  BT.sweep = null;
  btAddTrial(btKey(c), btCfgHash(c), full.stats); save();
  renderBtResults();
  if (BT.show) { dirty.markers = true; }
  return Promise.resolve(true); // true only with a new BT.res: callers never carry on with an older result as if current
}
function renderBtResults() {
  const R = BT.res, el = $('#btOut');
  if (!R) { el.innerHTML = `<div class="bt-empty"><h3>Test a strategy on tradeBerry's price history</h3><p>Pick a template or build your own rules, then press <b>Run backtest</b>. Signals fire on bar close and fill at the next bar's open, with the account's spread, swap and commission (or costs you declare) plus slippage. Stops and targets are checked minute by minute.</p></div>`; return; }
  const s = R.stats, m = M(R.sym);
  const days = ((R.to - R.from) / 86400).toFixed(1);
  let warn = '';
  // a platform history that starts later than asked: the run covers the real part and says so
  if (R.histShort) warn += `<div class="warn">The platform has 1-minute ${escHtml(pretty(R.sym))} prices only from ${new Date(R.histFrom * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}; this run covers ${Math.round((R.histTo - R.histFrom) / 86400)} days.</div>`;
  // sizing caps and stops near the spread are stated, so the result is not read as a pure 1%-risk run
  const u1 = unitWord(R.sym, true), why = R.capBy ? [R.capBy.lev && `the 1:${R.lev} leverage on ${pretty(R.sym)} (${escHtml(jurOf(S.set).name)}: notional ≤ equity × ${R.lev})`, R.capBy.x && `the per-order cap of ${MAX_NOTIONAL_X}× equity`, R.capBy.lots && `the sheet's maximum of ${lotsWord(R.sym, R.vMax ?? m.p.vol[1])} per order`].filter(Boolean) : [];
  if (R.capped) warn += `<div class="warn">Size capped on ${R.capped} of ${R.sized} entries by ${why.join(' and ')}: those trades risked less than ${R.cfg.risk}% of equity.</div>`;
  if (R.skipped) warn += `<div class="warn">${R.skipped} signal${R.skipped === 1 ? '' : 's'} skipped: not even ${escHtml(lotsWord(R.sym, m.p.vol[0]))} (the sheet's minimum) fit under the leverage cap.</div>`;
  for (const [lab, v] of [['stop', R.slFixPts], ['trailing stop', R.trailFixPts]]) if (v != null && v <= 2 * m.spread) warn += `<div class="warn">The fixed ${lab} of ${v} ${u1} is within 2× the ${m.spread}-${u1} spread: most of it is cost, so exits are mostly noise.</div>`;
  const sw = R.trades.reduce((a, x) => a + (x.swap || 0), 0);
  const costs = `<details class="bt-costs"><summary class="small muted">Costs, sizing and fills of this run</summary><p class="small muted">${escHtml(btCostText(R.cfg, R.sym))} Slippage ${R.cfg.slip} ${u1} per fill. Swap over the run ${usdFmt(sw, true)}. Sizing: ${R.cfg.risk}% risk per trade, ${btLevText(R.lev)}. Fills only while the market is open: a signal before a close fills at the reopening. Signals act on closed bars only: the bar still forming is left out.</p></details>`;
  const ov = R.is && R.oos ? (() => {
    const a = R.is.stats, b = R.oos.stats;
    const decay = a.expR > 0 && b.expR < a.expR * .4, tB = btT(R.oos.trades.map(t => t.r));
    const oosTxt = s.n < 20 ? '' : b.n < 5 ? `Out-of-sample slice has only ${b.n} trade${b.n === 1 ? '' : 's'}; too few to test.` :
      `Out-of-sample expectancy ${sgn(b.expR, 2)}R over ${b.n} trades, t = ${nfx(tB, 2)}${tB == null || Math.abs(tB) < 2 ? ' — not distinguishable from zero.' : ' — |t| ≥ 2, but about 1 test in 20 gets there by luck.'}`;
    const row = (lab, f) => `<tr><td>${lab}</td><td>${f(a)}</td><td>${f(b)}</td></tr>`;
    return `<div class="oos"><h3>In-sample vs out-of-sample</h3><table class="tbl sm"><thead><tr><th><span class="sr-only">Measure</span></th><th>In-sample</th><th>Out-of-sample</th></tr></thead><tbody>
      ${row('Trades', x => x.n)}${row('Return', x => `<span class="${cls(x.ret)}">${pct(x.ret)}</span>`)}${row('Win rate', x => pct(x.win, 0, false))}${row('Profit factor', x => fmtR(x.pf))}${row('Expectancy', x => `<span class="${cls(x.expR)}">${sgn(x.expR, 2)}R</span>`)}
      </tbody></table><p class="small ${decay ? 'dn' : 'muted'}">${decay ? 'The in-sample result fades out of sample — likely curve-fitted. ' : ''}${oosTxt}</p></div>`;
  })() : '';
  el.innerHTML = `
    <div class="bt-head"><div><b>${TEMPLATES[R.cfg.tpl].name}</b> on ${pretty(R.sym)} · ${R.tf >= 60 ? R.tf / 60 + 'H' : R.tf + 'm'} · ${R.nBars} bars · ${days} days <span class="muted small"${tipAttr('History|The platform\'s own 1-minute prices, the whole span of the run, fetched when the run started.')}>(platform prices)</span></div>
      <div class="bt-acts"><label class="chk"><input type="checkbox" id="btShow" ${BT.show ? 'checked' : ''}> Show on chart</label><button class="ghost sm" id="btToLab">Send to Risk Lab</button><button class="ghost sm" id="btCsv">Export CSV</button></div></div>
    <p class="wf-verdict" id="btVerdict"></p>
    ${warn}${costs}
    <div class="bt-kpis">
      ${kpi('Net P&L', usdFmt(s.net, true), cls(s.net), '', 'hero')}
      ${kpi('Return', pct(s.ret), cls(s.ret), '', 'key')}${kpi('Trades', `${s.n} <small>${s.longs}L / ${s.shorts}S</small>`, '', '', 'key')}${kpi('Win rate', pct(s.win, 1, false), '', '', 'key')}${kpi('Profit factor', fmtR(s.pf), s.pf >= 1 ? 'up' : 'dn', '', 'key')}${kpi('Expectancy', sgn(s.expR, 2) + 'R', cls(s.expR), '', 'key')}${kpi('Max drawdown', pct(-s.mdd, 2), 'dn', '', 'key')}
      ${kpi('Market move', pct(R.mkt), 'muted', '', 'sec')}${kpi('Sharpe per trade', nfx(s.srT, 2), '', `Sharpe per trade|Mean R ÷ sd of R over the ${s.n} trades (the figure PSR and DSR judge). Annualised from the per-bar returns of this ${days}-day run it is ${nfx(s.sharpe, 2)}${s.sharpeSE != null ? `, 95% CI ${nfx(s.sharpe - 1.96 * s.sharpeSE, 1)} to ${nfx(s.sharpe + 1.96 * s.sharpeSE, 1)} (Lo 2002)` : ''}: a span this short makes the annual figure mostly noise.`, 'sec')}${kpi('Avg hold', s.bars.toFixed(1) + ' bars', '', '', 'sec')}${kpi('Time in market', pct(s.exposure, 0, false), '', '', 'sec')}${kpi('Worst streak', s.lossStreak + ' losses', '', '', 'sec')}
    </div>
    <div class="bt-mid"><div class="bt-curve"><canvas id="btCanvas"></canvas></div>${ov}</div>
    <div class="oos" id="btHonest" style="margin-bottom:10px"></div>
    <div class="bt-sub"><div class="mini-seg" id="btView"><button data-v="trades" class="${BT.view === 'trades' ? 'on' : ''}">Trades</button><button data-v="opt" class="${BT.view === 'opt' ? 'on' : ''}">Optimizer</button><button data-v="wf" class="${BT.view === 'wf' ? 'on' : ''}">Walk-forward</button><button data-v="all" class="${BT.view === 'all' ? 'on' : ''}">All FX pairs</button></div></div>
    <div id="btView2" tabindex="0" role="region" aria-label="Backtest details"></div>`;
  requestAnimationFrame(() => drawBtCurve());
  renderHonest();
  renderBtView();
}
function drawBtCurve() {
  const R = BT.res, cv = $('#btCanvas'); if (!R || !cv) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const c = chartColors(), pts = R.curve; if (pts.length < 2) return;
  const ddH = 34, top = 8, bot = h - ddH - 18;
  const eqs = pts.map(p => p.eq), mn = Math.min(BT_START, ...eqs), mx = Math.max(BT_START, ...eqs), pad = (mx - mn) * .08 || 100;
  const X = i => 46 + i / (pts.length - 1) * (w - 54), Y = v => top + (1 - (v - mn + pad) / (mx - mn + 2 * pad)) * (bot - top);
  g.font = '10px JetBrains Mono'; g.fillStyle = c.tx; g.strokeStyle = c.grid; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { const v = mn - pad + (mx - mn + 2 * pad) * k / 3, y = Y(v); g.beginPath(); g.moveTo(46, y); g.lineTo(w - 8, y); g.stroke(); g.fillText(((v / BT_START - 1) * 100).toFixed(1) + '%', 2, y + 3); }
  if (R.split) { const si = pts.findIndex(p => p.t >= R.split); if (si > 0) { const x = X(si); g.fillStyle = c.tx2 + '14'; g.fillRect(x, top, w - 8 - x, bot - top); g.setLineDash([3, 3]); g.strokeStyle = c.tx2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke(); g.setLineDash([]); g.fillStyle = c.tx2; g.fillText('out-of-sample →', x + 4, top + 10); } }
  const col = eqs[eqs.length - 1] >= BT_START ? c.up : c.dn;
  // flat 15% fill under the line, no gradient
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(i), Y(p.eq)) : g.moveTo(X(i), Y(p.eq))); g.lineTo(X(pts.length - 1), bot); g.lineTo(X(0), bot); g.fillStyle = col + '26'; g.fill();
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(i), Y(p.eq)) : g.moveTo(X(i), Y(p.eq))); g.strokeStyle = col; g.lineWidth = 1.8; g.stroke();
  // underwater
  let pk = BT_START; const dd = pts.map(p => { pk = Math.max(pk, p.eq); return (pk - p.eq) / pk; }), mdd = Math.max(...dd, .0001);
  const y0 = h - ddH - 4;
  g.beginPath(); g.moveTo(X(0), y0); dd.forEach((d, i) => g.lineTo(X(i), y0 + d / mdd * ddH)); g.lineTo(X(dd.length - 1), y0); g.closePath(); g.fillStyle = c.dn + '55'; g.fill();
  g.fillStyle = c.tx; g.fillText('drawdown', 2, y0 + 12); g.fillText(dts(pts[0].t), 46, h - 2); const lt = dts(pts[pts.length - 1].t); g.fillText(lt, w - 8 - g.measureText(lt).width, h - 2);
}
function renderBtView() {
  const R = BT.res, el = $('#btView2'); if (!R || !el) return;
  if (BT.view === 'trades') {
    const tr = R.trades.slice().reverse().slice(0, 400);
    const ex = {}; R.trades.forEach(t => ex[t.reason] = (ex[t.reason] || 0) + 1);
    const w = R.trades.filter(t => t.r > 0), mfeAvg = R.trades.length ? R.trades.reduce((a, t) => a + t.mfe, 0) / R.trades.length : 0, capt = w.length ? w.reduce((a, t) => a + t.r, 0) / Math.max(1e-9, w.reduce((a, t) => a + t.mfe, 0)) * 100 : 0;
    const exitSum = R.trades.length ? `<div class="bt-exits small"><span class="muted">Exits</span>${Object.entries(ex).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="ex-chip">${k} <b>${v}</b></span>`).join('')}<span class="muted" title="Average best open profit reached, in R">· avg max favourable move <b class="tx">${mfeAvg.toFixed(2)}R</b></span><span class="muted" title="Share of the best open profit that winning trades actually kept">· winners kept <b class="tx">${capt.toFixed(0)}%</b> of it</span></div>` : '';
    el.innerHTML = tr.length ? exitSum + `<table class="tbl sm bt-trades"><thead><tr><th>#</th><th class="l">Side</th><th>Entry time</th><th>Entry</th><th>Exit time</th><th>Exit</th><th>${M(R.sym).lotName === 'contracts' ? 'Contracts' : 'Lots'}</th><th>Bars</th><th>${M(R.sym).unit === 'pt' ? 'Points' : 'Pips'}</th><th title="Max favourable excursion, in R">MFE</th><th>R</th><th>P&amp;L</th><th class="l">Exit reason</th></tr></thead><tbody>
      ${tr.map((t, i) => `<tr class="bt-tr" data-t="${t.et}" data-x="${t.xt}"><td>${R.trades.length - i}</td><td class="l"><span class="tag ${t.side}">${t.side}</span></td><td title="${dts(t.et)}">${dts(t.et)}</td><td>${fp(R.sym, t.ep)}</td><td title="${dts(t.xt)}">${dts(t.xt)}</td><td>${fp(R.sym, t.xp)}</td><td>${t.lots.toFixed(2)}</td><td>${t.bars}</td><td class="${cls(t.pips)}">${sgn(t.pips)}</td><td class="muted">${t.mfe.toFixed(2)}</td><td class="${cls(t.r)}">${sgn(t.r, 2)}</td><td class="${cls(t.pnl)}">${usdFmt(t.pnl, true)}</td><td class="l muted" title="${t.reason}">${t.reason}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No trades were triggered. Loosen the rules or change the timeframe.</div>';
  } else if (BT.view === 'opt') {
    const c = R.cfg, keys = sweepKeys(c);
    const sel = (id, v, lab) => `<select id="${id}" aria-label="${lab}">${keys.map(k => `<option value="${k}" ${k === v ? 'selected' : ''}>${SWEEP[k].label}</option>`).join('')}</select>`;
    const sx = BT.sweep?.x || keys[0], sy = BT.sweep?.y || keys[1] || keys[0];
    el.innerHTML = `<div class="opt-ctrl"><span class="muted small">Sweep</span>${sel('optX', sx, 'Sweep parameter (columns)')}<span class="muted small">against</span>${sel('optY', sy, 'Sweep parameter (rows)')}<span class="muted small">colour by</span><select id="optM" aria-label="Colour cells by"><option value="ret">Return</option><option value="pf">Profit factor</option><option value="sharpe">Sharpe</option><option value="oos">Test-slice return</option></select><button class="btn-pri" id="optRun">Run grid</button></div><div id="optGrid" class="opt-grid"></div>`;
    if (BT.sweep) { $('#optM').value = BT.sweep.metric; drawSweep(); }
    // a grid is run on request only: each cell is one more try in the account, and DSR counts every try
    else $('#optGrid').innerHTML = `<div class="empty">Not run yet. <b>Run grid</b> tests the ${SWEEP[sx].label} × ${SWEEP[sy].label} grid on the current settings: ${SWEEP[sx].vals.length * SWEEP[sy].vals.length} cells, each one more try in the account (DSR counts every try).</div>`;
  } else if (BT.view === 'wf') {
    renderWfView(el);
  } else {
    el.innerHTML = `<div class="opt-ctrl"><button class="btn-pri" id="allRun"${tipAttr(`All FX pairs|Same strategy and settings on each of the ${Engine.FX.length} FX pairs, full period. Each pair is one more try in the account. Other instruments are not part of this run.`)}>${BT.all ? 'Re-run' : 'Run'} all FX pairs</button><span class="muted small">Current settings, full period, FX pairs only · each pair is one more try</span></div><div id="allBody"></div>`;
    if (BT.all) drawAll();
    else $('#allBody').innerHTML = `<div class="empty">Not run yet. The button above runs the current settings on all ${Engine.FX.length} FX pairs: ${Engine.FX.length} more tries in the account.</div>`;
  }
}
const SWEEP = {
  emaF: { label: 'EMA fast', vals: [3, 5, 8, 9, 12, 15, 20], p: true }, emaS: { label: 'EMA slow', vals: [15, 21, 30, 40, 50, 75, 100], p: true },
  rsiN: { label: 'RSI period', vals: [5, 7, 9, 14, 21, 28], p: true }, bbN: { label: 'BB period', vals: [10, 14, 20, 26, 34, 50], p: true },
  bbK: { label: 'BB std dev', vals: [1.5, 1.75, 2, 2.25, 2.5, 3], p: true }, dcN: { label: 'Donchian N', vals: [10, 15, 20, 30, 40, 55], p: true },
  slK: { label: 'Stop × ATR', vals: [.75, 1, 1.5, 2, 2.5, 3, 4] }, tpR: { label: 'Target R', vals: [0, 1, 1.5, 2, 2.5, 3, 4] },
  trailK: { label: 'Trail × ATR', vals: [.5, 1, 1.5, 2, 2.5, 3, 4] }, trailAct: { label: 'Trail starts (R)', vals: [0, .5, 1, 1.5, 2, 3] }
};
function sweepKeys(c) {
  const used = new Set(); c.long.concat(c.short).filter(r => r.on).forEach(r => [r.a, r.b].forEach(o => used.add(o)));
  const k = [];
  if (used.has('emaF')) k.push('emaF'); if (used.has('emaS')) k.push('emaS'); if (used.has('rsi')) k.push('rsiN');
  if (['bbU', 'bbM', 'bbL'].some(x => used.has(x))) k.push('bbN', 'bbK'); if (['dcH', 'dcL'].some(x => used.has(x))) k.push('dcN');
  if (c.slMode === 'atr') k.push('slK'); k.push('tpR');
  if (c.trail === 'atr') k.push('trailK'); if (c.trail && c.trail !== 'off') k.push('trailAct');
  return k;
}
function runSweep(auto) {
  const c = BT.res.cfg, x = $('#optX').value, y = $('#optY').value, metric = $('#optM').value;
  if (x === y) { if (auto) $('#optGrid').innerHTML = '<div class="empty">This strategy has only one parameter to sweep. Add a rule with an indicator, or a stop or trailing setting, to get a grid.</div>'; else toast('Pick two different parameters', '', 'info'); return; }
  if (metric === 'oos' && !(c.oos > 0)) { BT.sweep = null; const g = $('#optGrid'); if (g) g.innerHTML = '<div class="empty">Out-of-sample % is 0, so there is no test slice. Set it above 0 and run the backtest again to colour by Test-slice return.</div>'; return; }
  const bars = btBars(c.sym, c.tf, c.hist).bars, split = Math.floor(bars.length * (1 - c.oos / 100));
  const cells = [], series = [], key = btKey(c);
  for (const vy of SWEEP[y].vals) for (const vx of SWEEP[x].vals) {
    const opt = { p: {} };
    for (const [k, v] of [[x, vx], [y, vy]]) { if (SWEEP[k].p) opt.p[k] = v; else opt[k] = v; }
    const pp = { ...c.p, ...opt.p }; if (pp.emaF >= pp.emaS) { cells.push({ vx, vy, bad: true }); continue; }
    const h = btCfgHash(btEff(c, opt));
    if (metric === 'oos') {
      const is = runBacktest(c, c.sym, { ...opt, to: split }), os = runBacktest(c, c.sym, { ...opt, from: split }), tr = is.trades.concat(os.trades);
      cells.push({ vx, vy, v: os.stats.ret, n: os.stats.n, is: is.stats.ret }); series.push(is.ret.concat(os.ret));
      btAddTrial(key, h, { n: tr.length, expR: tr.length ? tr.reduce((a, t) => a + t.r, 0) / tr.length : 0, ...btTradeSR(tr) });
    } else {
      const r = runBacktest(c, c.sym, opt); cells.push({ vx, vy, v: metric === 'ret' ? r.stats.ret : metric === 'pf' ? Math.min(r.stats.pf, 5) : r.stats.sharpe, n: r.stats.n }); series.push(r.ret);
      btAddTrial(key, h, r.stats);
    }
  }
  save();
  BT.sweep = { x, y, metric, cells, cur: { x: SWEEP[x].p ? c.p[x] : c[x], y: SWEEP[y].p ? c.p[y] : c[y] } };
  // PBO (CSCV on 8 time blocks) and the correlation groups that set N effective
  const blocks = series.length > 1 ? btBlocks(series, 8) : null, pb = blocks && btPBO(blocks);
  if (pb) { const L = blocks[0].length * blocks[0][0].length; BT.pbo = { key, x, y, ...pb, clusters: btClusters(series.map(r => r.slice(r.length - L))) }; }
  else if (BT.pbo && BT.pbo.key === key) BT.pbo = null;
  BT.sweep.pbo = pb ? BT.pbo : null;
  drawSweep(); renderHonest();
}
function drawSweep() {
  const sw = BT.sweep, g = $('#optGrid'); if (!sw || !g) return;
  const xs = SWEEP[sw.x].vals, ys = SWEEP[sw.y].vals, good = sw.cells.filter(c => !c.bad);
  const base = sw.metric === 'pf' ? 1 : 0, span = Math.max(...good.map(c => Math.abs(c.v - base)), 1e-6);
  const fmt = v => sw.metric === 'pf' ? v.toFixed(2) : sw.metric === 'sharpe' ? v.toFixed(1) : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  // no gold cell on the test slice: picking by it would turn that slice into in-sample data
  const best = sw.metric === 'oos' ? null : good.reduce((b, c) => !b || c.v > b.v ? c : b, null);
  g.style.gridTemplateColumns = `90px repeat(${xs.length},minmax(54px,1fr))`;
  let h = `<div class="h">${SWEEP[sw.y].label} ↓ / ${SWEEP[sw.x].label} →</div>` + xs.map(v => `<div class="h">${v}</div>`).join('');
  ys.forEach(vy => {
    h += `<div class="h">${vy}</div>`;
    xs.forEach(vx => {
      const c = sw.cells.find(z => z.vx === vx && z.vy === vy);
      if (!c || c.bad) { h += `<div class="cell na">—</div>`; return; }
      const a = Math.min(1, Math.abs(c.v - base) / span), col = c.v >= base ? `color-mix(in srgb,var(--up) ${Math.round((.12 + a * .43) * 100)}%,transparent)` : `color-mix(in srgb,var(--dn) ${Math.round((.12 + a * .43) * 100)}%,transparent)`;
      const cur = sw.cur.x === vx && sw.cur.y === vy;
      h += `<button class="cell ${cur ? 'cur' : ''} ${c === best ? 'best' : ''}" style="background:${col}" data-x="${vx}" data-y="${vy}" title="${SWEEP[sw.x].label} ${vx}, ${SWEEP[sw.y].label} ${vy}: ${fmt(c.v)} over ${c.n} trades${c.is != null ? ` · train slice ${c.is.toFixed(1)}%` : ''}${cur ? ' · current settings' : ''}${c === best ? ' · best cell' : ''} — click to apply"><b>${fmt(c.v)}</b><small>${c.n}t</small></button>`;
    });
  });
  const pb = sw.pbo, pbTxt = pb ? `<b class="${pb.pbo >= .5 ? 'dn' : 'tx'}">PBO ${(pb.pbo * 100).toFixed(0)}%</b> (median logit ${nfx(pb.logit, 2)}): in ${Math.round(pb.pbo * pb.splits)} of ${pb.splits} splits of history into two halves, the best cell on one half finished at or below the median on the other. ${pb.cells} cells, ${pb.clusters} group${pb.clusters === 1 ? '' : 's'} correlated above 0.7. ` : 'PBO needs at least 80 bars and two valid cells. ';
  g.innerHTML = h + `<p class="opt-note small muted" style="grid-column:1/-1">${pbTxt}${sw.metric === 'oos' ? 'Amber outline = current settings. Colour = return on the last slice of history. Choosing settings by this colour makes that slice in-sample: the number stops being an out-of-sample estimate, so no best cell is marked.' : 'Amber outline = current settings · ring and ★ = best cell. Prefer a broad green plateau over a single bright cell — isolated peaks rarely survive out of sample.'}</p>`;
}
function applyCell(vx, vy) {
  const sw = BT.sweep, c = btCfg();
  for (const [k, v] of [[sw.x, vx], [sw.y, vy]]) { if (SWEEP[k].p) c.p[k] = v; else c[k] = v; }
  if (c.tpl !== 'custom') c.tpl = c.tpl; // template keeps its name, params updated
  // the grid comes back with the same pair of parameters and the same colour the user was looking at
  const keep = { x: sw.x, y: sw.y, metric: sw.metric };
  renderBtConfig();
  btRunAll().then(ok => {
    if (!ok) return;
    BT.view = 'opt'; renderBtView();
    const X = $('#optX'), Y = $('#optY'), Mt = $('#optM'); if (!X || !Y || !Mt) return;
    const has = (el, v) => [...el.options].some(o => o.value === v);
    if (has(X, keep.x)) X.value = keep.x; if (has(Y, keep.y)) Y.value = keep.y; Mt.value = keep.metric;
    runSweep();
  });
  toast('Settings applied', `${SWEEP[sw.x].label} ${vx} · ${SWEEP[sw.y].label} ${vy}`, 'info');
}
// each FX pair with a live feed, on the same span: the weeks before the live week are fetched one pair after another
// (the run of a pair waits for its prices); pairs without a feed or whose history failed are left out and counted
async function runAllPairs() {
  if (BT.allBusy) return; // a second click while pairs are loading would run two loops into BT.all and count every try twice
  BT.allBusy = true;
  try { await allPairs(); } finally { BT.allBusy = false; }
}
async function allPairs() {
  const c = readBtConfig(), w = BT_HIST.includes(c.hist) ? c.hist : 1, fed = Engine.FX.filter(p => btFed(p.sym)), out = [];
  const say = h => { const el = $('#allBody'); if (el) el.innerHTML = `<div class="empty" role="status">${h}</div>`; };
  for (let i = 0; i < fed.length; i++) {
    const sym = fed[i].sym;
    if (w > 1 && BT_REAL.get(btRealKey(sym, w))?.st !== 'ok') { say(`Loading ${w} weeks of ${escHtml(pretty(sym))} prices from the platform… pair ${i + 1}/${fed.length}`); await btLoad(sym, w); }
    const H = btBars(sym, c.tf, w);
    if (H.why === 'failed' || H.why === 'loading') continue;
    const r = runBacktest(c, sym), cp = { ...c, sym }; btAddTrial(btKey(cp), btCfgHash(cp), r.stats); out.push({ sym, ...r.stats, from: H.why === 'short' ? H.from : null });
  }
  BT.all = out.sort((a, b) => b.ret - a.ret); BT.allOut = Engine.FX.length - out.length;
  save(); drawAll(); renderHonest();
}
function drawAll() {
  const el = $('#allBody'); if (!el || !BT.all) return;
  const pos = BT.all.filter(r => r.ret > 0).length, usd = BT.all.filter(r => M(r.sym) && (M(r.sym).base === 'USD' || M(r.sym).quote === 'USD')).length;
  el.innerHTML = `<table class="tbl sm bt-all"><caption><b>${pos} of ${BT.all.length} pairs profitable</b>${BT.allOut ? ` · ${BT.allOut} left out (no live feed or no platform history)` : ''} · <span tabindex="0"${tipAttr(`Not independent tests|The pairs share currencies (${usd} of them trade against USD), so their results move together: this is not ${BT.all.length} independent tests, but each one is a try that DSR counts.`)}>not ${BT.all.length} independent tests: the pairs share currencies (${usd} trade against USD)</span></caption><thead><tr><th>Pair</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Max DD</th><th>Sharpe</th><th>Return</th></tr></thead><tbody>
    ${BT.all.map(r => `<tr class="all-tr" data-sym="${r.sym}"><td class="sym">${pretty(r.sym)}${r.from ? ` <small class="muted">from ${new Date(r.from * 1000).toISOString().slice(0, 10)}</small>` : ''}</td><td>${r.n}</td><td>${pct(r.win, 0, false)}</td><td>${fmtR(r.pf)}</td><td class="${cls(r.expR)}">${sgn(r.expR, 2)}R</td><td class="dn">${pct(-r.mdd, 1)}</td><td>${r.sharpe.toFixed(2)}</td><td class="${cls(r.ret)}">${pct(r.ret)}</td></tr>`).join('')}</tbody></table>`;
}
function btMarkers(sym, step, first, lastT) {
  const R = BT.res; if (!BT.show || !R || R.sym !== sym) return [];
  const c = chartColors(), b = t => Math.floor(t / step) * step, out = [];
  for (const t of R.trades.slice(-250)) {
    out.push({ time: b(t.et), position: t.side === 'buy' ? 'belowBar' : 'aboveBar', color: '#5aa9ff', shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown', text: 'BT' });
    out.push({ time: b(t.xt), position: 'inBar', color: t.pnl >= 0 ? c.up : c.dn, shape: 'square', text: '' });
  }
  return out.filter(m => m.time >= first && m.time <= lastT);
}
function btCsv() {
  const R = BT.res; if (!R) return;
  const rows = [['n', 'side', 'entry_time_utc', 'entry', 'exit_time_utc', 'exit', M(R.sym).lotName, 'bars', M(R.sym).unit === 'pt' ? 'points' : 'pips', 'r', 'mfe_r', 'pnl_usd', 'reason']];
  R.trades.forEach((t, i) => rows.push([i + 1, t.side, new Date(t.et * 1000).toISOString(), t.ep.toFixed(M(R.sym).digits), new Date(t.xt * 1000).toISOString(), t.xp.toFixed(M(R.sym).digits), t.lots.toFixed(2), t.bars, t.pips.toFixed(1), t.r.toFixed(3), t.mfe.toFixed(3), t.pnl.toFixed(2), t.reason]));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `tradeberry-backtest-${R.sym}-${R.cfg.tpl}.csv`; document.body.appendChild(a); a.click(); a.remove();
  toast('Trades exported', `${R.trades.length} rows`, 'info');
}

function bindBt() {
  const cfgEl = $('#btCfg');
  cfgEl.addEventListener('click', e => {
    const t = e.target.closest('[data-tpl]'); if (t) { readBtConfig(); applyTemplate(t.dataset.tpl); renderBtConfig(); btRunAll(); return; }
    if (e.target.closest('#btRun')) { btRunAll(); return; }
    if (e.target.closest('#btAll')) { if (BT.allBusy) return; btRunAll().then(ok => { if (!ok) return; BT.view = 'all'; renderBtResults(); runAllPairs(); }); }
  });
  cfgEl.addEventListener('change', e => {
    const row = e.target.closest('.rule');
    if (row) { readBtConfig(); const c = btCfg(); if (c.tpl !== 'custom') c.tpl = 'custom'; renderBtConfig(); return; }
    if (e.target.id === 'btSlMode' || e.target.id === 'btTrail' || e.target.id === 'btCost') { readBtConfig(); renderBtConfig(); }
    if (e.target.id === 'btSym') { readBtConfig(); renderBtConfig(); if (S.set.sym !== btCfg().sym) setSymbol(btCfg().sym); } // units follow the instrument
  });
  $('#btOut').addEventListener('click', e => {
    const v = e.target.closest('#btView button'); if (v) { BT.view = v.dataset.v; $$('#btView button').forEach(b => b.classList.toggle('on', b === v)); renderBtView(); return; }
    if (e.target.closest('#btRetry')) { btRunAll(); return; }
    if (e.target.closest('#optRun')) { const b = e.target.closest('#optRun'); b.textContent = 'Running…'; setTimeout(() => { runSweep(); b.textContent = 'Run grid'; }, 20); return; }
    const cell = e.target.closest('.cell[data-x]'); if (cell) { applyCell(+cell.dataset.x, +cell.dataset.y); return; }
    if (e.target.closest('#allRun')) { runAllPairs(); return; }
    if (e.target.closest('#wfRun')) { const b = e.target.closest('#wfRun'); b.textContent = 'Running…'; b.disabled = true; setTimeout(() => { runWalkForward(); }, 20); return; }
    if (e.target.closest('#wfApply')) { applyWfLatest(); return; }
    const ar = e.target.closest('.all-tr'); if (ar) { btCfg().sym = ar.dataset.sym; setSymbol(ar.dataset.sym); renderBtConfig(); BT.view = 'trades'; btRunAll(); return; }
    if (e.target.closest('#btCsv')) btCsv();
    if (e.target.closest('#btTrialsReset')) {
      const n = btTrials().length;
      btCfg().trials = [];
      save(); renderHonest();
      toast('Trials reset', `${n} recorded tr${n === 1 ? 'y' : 'ies'} in this account cleared. They still happened; DSR now counts only the tries from here on.`, 'info');
      return;
    }
    if (e.target.closest('#btToLab')) {
      const s = BT.res.stats, w = BT.res.trades.filter(t => t.r > 0), l = BT.res.trades.filter(t => t.r <= 0);
      if (s.n < 5 || !l.length) { toast('Not enough trades', 'Need at least 5 trades including losers', 'info'); return; }
      const aw = w.reduce((a, t) => a + t.r, 0) / Math.max(1, w.length), al = -l.reduce((a, t) => a + t.r, 0) / l.length;
      setTab('lab'); $('#lWin').value = s.win.toFixed(0); $('#lRR').value = (aw / al || 1).toFixed(2); $('#lRisk').value = BT.res.cfg.risk; runLab();
      toast('Sent to Risk Lab', `${s.win.toFixed(0)}% win · ${(aw / al).toFixed(2)} avg win/loss R`, 'info');
    }
    const tr = e.target.closest('.bt-tr');
    if (tr) {
      const R = BT.res; if (S.set.sym !== R.sym) setSymbol(R.sym); if (S.set.tf !== R.tf) setTF(R.tf);
      const t0 = +tr.dataset.t, t1 = +tr.dataset.x, pad = Math.max(R.tf * 60 * 30, (t1 - t0));
      try { chart.timeScale().setVisibleRange({ from: t0 - pad, to: t1 + pad }); } catch (err) { }
      $$('.bt-tr').forEach(x => x.classList.toggle('sel', x === tr));
    }
  });
  $('#btOut').addEventListener('change', e => { if (e.target.id === 'btShow') { BT.show = e.target.checked; dirty.markers = true; } });
  window.addEventListener('resize', () => { if (activeTab === 'bt') drawBtCurve(); });
  // the explanation layer of the analysis pages (brief.js brTipShow), for the backtester's [data-tip]: hover, focus, tap
  const box = $('.bt'), tipOf = e => { const el = e.target.closest && e.target.closest('[data-tip]'); return el && box.contains(el) && typeof brTipShow === 'function' ? el : null; };
  const over = e => { const el = tipOf(e); if (!el) return; const r = el.getBoundingClientRect(); brTipShow(el.dataset.tip, e.clientX ?? r.left, e.clientY ?? r.bottom - 10); };
  const out = e => { const el = tipOf(e); if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return; brTipHide(); };
  if (box) { box.addEventListener('mouseover', over); box.addEventListener('mouseout', out); box.addEventListener('focusin', over); box.addEventListener('focusout', out); }
}
function openBacktester() {
  if (!$('#btCfg').innerHTML) { btCfg(); renderBtConfig(); renderBtResults(); }
  if (!BT.res) btRunAll();
}

/* ---------- walk-forward analysis ----------
   Split history into K folds. In each fold, optimise two parameters on the training window,
   then trade the next (unseen) window with the winning settings. Only the unseen windows are
   stitched into the result, so the curve shows what re-optimising on a schedule would have done. */
const WF_OBJ = { ret: 'Return', pf: 'Profit factor', sharpe: 'Sharpe', expR: 'Expectancy (R)' };
function wfScore(st, obj) { if (st.n < 3) return -Infinity; return obj === 'pf' ? Math.min(st.pf, 5) : obj === 'sharpe' ? st.sharpe : obj === 'expR' ? st.expR : st.ret; }
function wfRead() {
  const c = btCfg(), w = c.wf, keys = sweepKeys(BT.res?.cfg || c);
  if ($('#wfX')) { w.x = $('#wfX').value; w.y = $('#wfY').value; w.folds = clamp(+$('#wfK').value, 2, 10); w.ratio = +$('#wfR').value; w.mode = $('#wfMode').value; w.obj = $('#wfObj').value; w.pick = $('#wfPick').value; }
  if (!keys.includes(w.x)) w.x = keys[0]; if (!keys.includes(w.y) || w.y === w.x) w.y = keys.find(k => k !== w.x) || keys[0];
  return w;
}
function runWalkForward(auto) {
  const c = BT.res?.cfg ? JSON.parse(JSON.stringify(BT.res.cfg)) : btCopy(readBtConfig()), w = wfRead(), sym = c.sym;
  const done = () => { const b = $('#wfRun'); if (b) { b.disabled = false; b.textContent = 'Run walk-forward'; } };
  const say = (t, d) => { const el = auto && $('#wfBody'); if (el) el.innerHTML = `<div class="empty">${t}. ${d}</div>`; else toast(t, d, 'info'); };
  if (w.x === w.y) { say('Pick two different parameters', 'This strategy has only one parameter to re-optimise.'); done(); return; }
  const bars = btBars(sym, c.tf, c.hist).bars, n = bars.length, xs = SWEEP[w.x].vals, ys = SWEEP[w.y].vals;
  const pMax = { ...c.p }; for (const k of [w.x, w.y]) if (SWEEP[k].p) pMax[k] = Math.max(...SWEEP[k].vals, c.p[k]);
  const W = warmOf(pMax), total = n - W, K = w.folds, Rr = w.ratio, T = Math.floor(total / (Rr + K));
  if (T < 15) { say('Not enough history', `Only ${total} usable bars — use fewer folds, a smaller train ratio or a lower timeframe`); done(); return; }
  const optOf = (vx, vy) => { const o = { p: {} }; for (const [k, v] of [[w.x, vx], [w.y, vy]]) { if (SWEEP[k].p) o.p[k] = v; else o[k] = v; } return o; };
  const folds = [];
  for (let k = 0; k < K; k++) {
    const trF = w.mode === 'anchored' ? W : W + k * T, trT = W + (Rr + k) * T, teF = trT, teT = k === K - 1 ? n : trT + T;
    // grid on training window
    const grid = ys.map(vy => xs.map(vx => {
      const o = optOf(vx, vy), pp = { ...c.p, ...o.p }; if (pp.emaF >= pp.emaS) return null;
      const r = runBacktest(c, sym, { ...o, from: trF, to: trT }); return { vx, vy, st: r.stats, s: wfScore(r.stats, w.obj) };
    }));
    // plateau pick: average each cell with its valid neighbours so isolated spikes lose
    let best = null;
    grid.forEach((row, yi) => row.forEach((cell, xi) => {
      if (!cell || !isFinite(cell.s)) return;
      let sc = cell.s;
      if (w.pick === 'plateau') { const nb = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => grid[yi + dy]?.[xi + dx]).filter(z => z && isFinite(z.s)); sc = nb.reduce((a, z) => a + z.s, 0) / nb.length; }
      if (!best || sc > best.sc) best = { ...cell, sc };
    }));
    if (!best) { folds.push({ k, trF: bars[trF].time, trT: bars[trT - 1].time, teF: bars[teF].time, teT: bars[teT - 1].time, iTr: [trF, trT], iTe: [teF, teT], skip: true }); continue; }
    const te = runBacktest(c, sym, { ...optOf(best.vx, best.vy), from: teF, to: teT });
    folds.push({ k, trF: bars[trF].time, trT: bars[trT - 1].time, teF: bars[teF].time, teT: bars[teT - 1].time, iTr: [trF, trT], iTe: [teF, teT], vx: best.vx, vy: best.vy, is: best.st, isBars: trT - trF, oos: te.stats, oosBars: teT - teF, test: te });
  }
  // stitch out-of-sample windows into one equity curve
  let base = BT_START, peak = BT_START, mdd = 0; const curve = [], barRet = [], trades = []; let inMkt = 0, nb = 0, prev = BT_START;
  for (const f of folds) {
    if (f.skip) continue;
    for (const pt of f.test.curve) { const e = base + (pt.eq - BT_START); curve.push({ t: pt.t, eq: e, k: f.k }); barRet.push(prev ? e / prev - 1 : 0); prev = e; peak = Math.max(peak, e); mdd = Math.max(mdd, (peak - e) / peak); }
    trades.push(...f.test.trades.map(t => ({ ...t, fold: f.k + 1 }))); base += f.test.stats.net; inMkt += f.oos.exposure / 100 * f.oosBars; nb += f.oosBars;
  }
  const ok = folds.filter(f => !f.skip);
  // the unseen windows follow each other up to the end of the data: their bars per year annualise the stitched Sharpe
  const stats = btStats(trades, barRet, mdd, ok.length ? btPerYear(bars, ok[0].iTe[0], n, c.tf) : 0, inMkt / Math.max(1, nb));
  const isRate = ok.reduce((a, f) => a + f.is.ret / f.isBars, 0) / Math.max(1, ok.length), oosRate = stats.ret / Math.max(1, nb);
  const wfe = isRate > 0 ? oosRate / isRate * 100 : null;
  // fixed-settings benchmark over the same unseen span
  const first = ok[0]?.iTe[0] ?? n, fixed = first < n ? runBacktest(c, sym, { from: first }).stats : null;
  const changes = ok.slice(1).filter((f, i) => f.vx !== ok[i].vx || f.vy !== ok[i].vy).length;
  // each unseen window is one more try on this strategy
  for (const f of ok) btAddTrial(btKey(c), btCfgHash(btEff(c, optOf(f.vx, f.vy)), `|wf|${f.k}|${f.iTe[0]}-${f.iTe[1]}`), f.oos);
  save();
  BT.wf = { sym, tf: c.tf, cfg: c, w: { ...w }, folds, curve, trades, stats, wfe, fixed, changes, n, W, T, from: bars[W].time, to: bars[n - 1].time };
  done(); renderBtView(); renderHonest();
}
function applyWfLatest() {
  const f = BT.wf && [...BT.wf.folds].reverse().find(x => !x.skip); if (!f) return;
  const c = btCfg(), w = BT.wf.w;
  for (const [k, v] of [[w.x, f.vx], [w.y, f.vy]]) { if (SWEEP[k].p) c.p[k] = v; else c[k] = v; }
  renderBtConfig(); btRunAll(); BT.view = 'wf'; renderBtResults();
  toast('Latest walk-forward settings applied', `${SWEEP[w.x].label} ${f.vx} · ${SWEEP[w.y].label} ${f.vy} — the values the last training window chose`, 'info');
}
function renderWfView(el) {
  const c = BT.res.cfg, w = wfRead(), keys = sweepKeys(c);
  const sel = (id, v, opts, lab) => `<select id="${id}" aria-label="${lab}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const kOpts = keys.map(k => [k, SWEEP[k].label]);
  el.innerHTML = `<div class="opt-ctrl wf-ctrl">
      <span class="muted small">Re-optimise</span>${sel('wfX', w.x, kOpts, 'First parameter to re-optimise')}<span class="muted small">and</span>${sel('wfY', w.y, kOpts, 'Second parameter to re-optimise')}
      <span class="muted small">by</span>${sel('wfObj', w.obj, Object.entries(WF_OBJ), 'Objective')}
      <span class="muted small">pick</span>${sel('wfPick', w.pick, [['plateau', 'Plateau centre'], ['best', 'Best cell']], 'Pick')}
      <span class="muted small">folds</span>${sel('wfK', w.folds, [3, 4, 5, 6, 8].map(v => [v, v]), 'Folds')}
      <span class="muted small">train : test</span>${sel('wfR', w.ratio, [2, 3, 4, 5].map(v => [v, v + ' : 1']), 'Train to test ratio')}
      ${sel('wfMode', w.mode, [['rolling', 'Rolling window'], ['anchored', 'Anchored (expanding)']], 'Window mode')}
      <button class="btn-pri" id="wfRun">Run walk-forward</button></div>
    <div id="wfBody">${BT.wf && BT.wf.sym === c.sym && BT.wf.tf === c.tf ? '' : `<div class="bt-empty sm"><p>Walk-forward testing is the honest version of optimisation. History is cut into folds: each fold tunes the two parameters on a training window, then trades the <b>next, unseen</b> window with the winners. Only those unseen windows count. If the stitched result holds up, the strategy survives being re-tuned on a schedule — the way you would actually run it.</p></div>`}</div>`;
  if (BT.wf && BT.wf.sym === c.sym && BT.wf.tf === c.tf) drawWf();
  // run on request only: every window's grid is recorded as tries in the account
}
function drawWf() {
  const F = BT.wf, el = $('#wfBody'); if (!F || !el) return;
  const s = F.stats, ok = F.folds.filter(f => !f.skip), prof = ok.filter(f => f.oos.ret > 0).length;
  const span = F.n - F.W, pctX = i => ((i - F.W) / span * 100).toFixed(2);
  const lx = SWEEP[F.w.x].label, ly = SWEEP[F.w.y].label;
  const wfeTxt = F.wfe == null ? '—' : F.wfe.toFixed(0) + '%';
  // null baseline: on a zero-drift walk each unseen window is profitable about half the time
  const pNull = btBinomTail(ok.length, prof), nullTxt = `On a random walk, ${prof} or more of ${ok.length} windows come out profitable by chance ${(pNull * 100).toFixed(pNull < .01 ? 1 : 0)}% of the time.`;
  const verdict = !ok.length ? ['dn', 'No fold produced enough training trades.'] :
    s.ret > 0 && prof >= Math.ceil(ok.length * .6) && (F.wfe ?? 0) >= 50 && pNull <= .1 ? ['up', `Above the coin-flip baseline: ${prof} of ${ok.length} unseen windows were profitable and the strategy kept ${wfeTxt} of its training-period performance (≥ 50% is a common bar). ${nullTxt} Check it on new data before trusting it.`] :
    s.ret > 0 ? ['neutral', `Not distinguishable from luck: profitable overall on unseen data, ${prof} of ${ok.length} windows won${F.wfe != null ? `, efficiency ${wfeTxt}` : ''}. ${nullTxt}`] :
    ['dn', `Not robust: re-optimising did not carry over — ${prof} of ${ok.length} unseen windows were profitable. ${nullTxt} The optimiser is mostly fitting noise.`];
  if (ok.length && s.n < 15) verdict[1] += ` Only ${s.n} trades on unseen data — too few to conclude much; try a lower timeframe or fewer folds.`;
  el.innerHTML = `
    <div class="wf-verdict ${verdict[0]}">${verdict[1]}</div>
    <div class="bt-kpis wf-kpis">
      ${kpi('Unseen return', pct(s.ret), cls(s.ret), '', 'hero')}
      ${kpi('Fixed settings', F.fixed ? pct(F.fixed.ret) : '—', F.fixed ? cls(F.fixed.ret) : 'muted', '', 'key')}${kpi('WF efficiency', wfeTxt, F.wfe == null ? 'muted' : F.wfe >= 50 ? 'up' : 'dn', '', 'key')}${kpi('Windows profitable', `${prof} / ${ok.length}`, prof >= ok.length / 2 ? 'up' : 'dn', '', 'key')}${kpi('Profit factor', fmtR(s.pf), s.pf >= 1 ? 'up' : 'dn', 'Profit factor|Of the trades on the unseen (test) windows only.', 'key')}
      ${kpi('Trades', s.n, '', '', 'sec')}${kpi('Max drawdown', pct(-s.mdd, 2), 'dn', '', 'sec')}${kpi('Settings changed', `${F.changes} of ${Math.max(0, ok.length - 1)}`, 'muted', '', 'sec')}
    </div>
    <div class="wf-tl" aria-label="Fold timeline">
      ${F.folds.map(f => `<div class="wf-row"><span class="wf-k">F${f.k + 1}</span><div class="wf-track"><i class="tr" style="left:${pctX(f.iTr[0])}%;width:${(pctX(f.iTr[1]) - pctX(f.iTr[0])).toFixed(2)}%" title="Train ${dts(f.trF)} → ${dts(f.trT)}"></i><i class="te ${f.skip ? 'na' : f.oos.ret > 0 ? 'up' : 'dn'}" style="left:${pctX(f.iTe[0])}%;width:${(pctX(f.iTe[1]) - pctX(f.iTe[0])).toFixed(2)}%" title="Test ${dts(f.teF)} → ${dts(f.teT)}"></i></div></div>`).join('')}
      <div class="wf-legend small muted"><span><i class="tr"></i>train (optimise)</span><span><i class="te up"></i><i class="te dn"></i>test on unseen data</span><span>${dts(F.from)} → ${dts(F.to)}</span></div>
    </div>
    <div class="bt-curve wf-curve"><canvas id="wfCanvas"></canvas></div>
    <table class="tbl sm wf-tbl" tabindex="0" aria-label="Walk-forward folds"><thead><tr><th>Fold</th><th>Train window</th><th>Test window</th><th>${lx}</th><th>${ly}</th><th>Train return</th><th>Train trades</th><th>Test return</th><th>Test trades</th><th>Test PF</th></tr></thead><tbody>
      ${F.folds.map(f => f.skip ? `<tr><td>F${f.k + 1}</td><td>${dts(f.trF)} → ${dts(f.trT)}</td><td>${dts(f.teF)} → ${dts(f.teT)}</td><td colspan="7" class="muted">Skipped — fewer than 3 training trades in every cell</td></tr>` :
        `<tr><td>F${f.k + 1}</td><td>${dts(f.trF)} → ${dts(f.trT)}</td><td>${dts(f.teF)} → ${dts(f.teT)}</td><td class="tx">${f.vx}</td><td class="tx">${f.vy}</td><td class="${cls(f.is.ret)}">${pct(f.is.ret)}</td><td>${f.is.n}</td><td class="${cls(f.oos.ret)}"><b>${pct(f.oos.ret)}</b></td><td>${f.oos.n}</td><td>${fmtR(f.oos.pf)}</td></tr>`).join('')}
    </tbody></table>
    <div class="wf-foot"><p class="small muted">Train : test ${F.w.ratio} : 1 · ${F.w.mode === 'anchored' ? 'anchored (training grows from the start)' : 'rolling window'} · objective ${WF_OBJ[F.w.obj]} · ${F.w.pick === 'plateau' ? 'plateau centre (cell averaged with its neighbours)' : 'best single cell'} · ${F.T} bars per test window. Efficiency = unseen return per bar ÷ training return per bar.</p>
      ${ok.length ? `<button class="ghost sm" id="wfApply">Use latest fold's settings</button>` : ''}</div>`;
  requestAnimationFrame(drawWfCurve);
}
function drawWfCurve() {
  const F = BT.wf, cv = $('#wfCanvas'); if (!F || !cv || F.curve.length < 2) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const c = chartColors(), pts = F.curve, top = 14, bot = h - 16;
  const eqs = pts.map(p => p.eq), mn = Math.min(BT_START, ...eqs), mx = Math.max(BT_START, ...eqs), pad = (mx - mn) * .1 || 100;
  const X = i => 46 + i / (pts.length - 1) * (w - 54), Y = v => top + (1 - (v - mn + pad) / (mx - mn + 2 * pad)) * (bot - top);
  g.font = '10px JetBrains Mono'; g.strokeStyle = c.grid; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { const v = mn - pad + (mx - mn + 2 * pad) * k / 3, y = Y(v); g.beginPath(); g.moveTo(46, y); g.lineTo(w - 8, y); g.stroke(); g.fillStyle = c.tx; g.fillText(((v / BT_START - 1) * 100).toFixed(1) + '%', 2, y + 3); }
  g.fillStyle = c.tx2; g.fillText('stitched unseen windows', 48, 10);
  // fold boundaries
  let lastK = pts[0].k; pts.forEach((p, i) => { if (p.k !== lastK) { g.setLineDash([2, 3]); g.strokeStyle = c.tx2; g.beginPath(); g.moveTo(X(i), top); g.lineTo(X(i), bot); g.stroke(); g.setLineDash([]); lastK = p.k; } });
  let k0 = -1; pts.forEach((p, i) => { if (p.k !== k0) { g.fillStyle = c.tx2; g.fillText('F' + (p.k + 1), X(i) + 3, bot - 3); k0 = p.k; } });
  const col = eqs[eqs.length - 1] >= BT_START ? c.up : c.dn, y0 = Y(BT_START);
  g.strokeStyle = c.tx2 + '80'; g.beginPath(); g.moveTo(46, y0); g.lineTo(w - 8, y0); g.stroke();
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(i), Y(p.eq)) : g.moveTo(X(i), Y(p.eq))); g.strokeStyle = col; g.lineWidth = 1.8; g.stroke();
  g.fillStyle = c.tx; g.fillText(dts(pts[0].t), 46, h - 2); const lt = dts(pts[pts.length - 1].t); g.fillText(lt, w - 8 - g.measureText(lt).width, h - 2);
}
window.addEventListener('resize', () => { if (activeTab === 'bt' && BT.view === 'wf') drawWfCurve(); });
