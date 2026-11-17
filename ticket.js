'use strict';
/* tradeBerry — ticket and command bar. Classic script sharing globals with app.js; loaded right after it. */
/* ============ ticket ============ */
// 20 pips (points) from the side the order fills on, and at least twice the sheet's minimum pending distance
function defaultPendingPrice() {
  const t = S.tk, m = M(S.set.sym), q = Engine.quote(S.set.sym), d = t.side === 'buy' ? 1 : -1;
  const ref = d > 0 ? q.ask : q.bid, off = Math.max(20 * m.pip, 2 * m.p.minPend * m.point) * (t.ot === 'limit' ? -d : d);
  return +(ref + off).toFixed(m.digits);
}
/* Sizes on the instrument sheet (p.vol: [min, max, step]): 0.01 lots on FX, whole shares, 100-lot steps on XRP.
   tkLotsFor puts a size on the step and inside [min, max]; tkLotsText is the size as the order button says it. */
const tkLotsFor = (sym, v) => { const [mn, mx] = volOf(sym), n = normLots(sym, v); return finite(n) ? Math.min(mx, Math.max(mn, n)) : mn; };
/* A size is kept per instrument (one entry for the G8 pairs, as tkKey does for SL/TP), never clamped across sheets:
   the size set on EUR/USD comes back when you return to it. An instrument not seen yet starts on its sheet's minimum
   (100 XRP lots carried to BTCUSD would be 100 BTC). A stored ticket that does not fit the sheet at boot also gets the minimum. */
const tkLotsOk = (sym, v) => { const [mn, mx] = volOf(sym), n = normLots(sym, v); return finite(+v) && +v > 0 && Math.abs(n - v) < 1e-9 && n >= mn - 1e-9 && n <= mx + 1e-9; };
const tkLotsCarry = (sym, v) => tkLotsOk(sym, v) ? normLots(sym, v) : volOf(sym)[0];
const tkLotsBack = (sym, mem) => { const v = mem && mem[tkKey(sym)]; return finite(+v) && +v > 0 ? tkLotsFor(sym, v) : volOf(sym)[0]; };
const tkQBy = {}; // quick-trade size per instrument key
const tkLotsText = (sym, lots) => M(sym).lotName === 'shares' ? lotsWord(sym, lots) : lotsFmt(sym, lots);
// the size unit in words: 'lots (100,000 EUR)', 'shares', 'lots · $50 per point', 'lots · 1 pt (0.01) = €0.01', 'lots (100 Ounces)'
function tkSizeUnit(sym) {
  const m = M(sym), c = contractText(sym).replace(/^1 lot = /, '');
  if (m.lotName === 'shares') return m.size === 1 ? 'shares' : `lots (${c})`;
  return m.sizeUnit === 'point' ? (m.pip === 1 ? `lots · ${c}` : `lots · ${ptWorth(sym)}`) : `lots (${c})`;
}
/* Ticket fields of the order model (S.tkx; S.tk keeps the fields sanitizeState knows): stop-limit offset, time in
   force, OCO link, split targets, break-even. normTkx() validates a stored copy (normalizeOrders calls it). */
const TKX_DEF = { stopLimit: false, lmtOff: 2, tif: 'GTC', gtdMin: 240, oco: 0, split: false, tps: [{ pips: 20, pct: 50 }, { pips: 40, pct: 50 }], be: false, beAt: 10, beOff: 0, beOnTp: false };
function normTkx(v) {
  const x = v && typeof v === 'object' && !Array.isArray(v) ? v : {}, o = JSON.parse(JSON.stringify(TKX_DEF)), fin = n => typeof n === 'number' && isFinite(n);
  for (const k of ['stopLimit', 'split', 'be', 'beOnTp']) if (typeof x[k] === 'boolean') o[k] = x[k];
  if (fin(x.lmtOff) && Math.abs(x.lmtOff) <= 500) o.lmtOff = x.lmtOff;
  if (['GTC', 'DAY', 'GTD'].includes(x.tif)) o.tif = x.tif;
  if (fin(x.gtdMin) && x.gtdMin >= 0 && x.gtdMin <= 60 * 24 * 30) o.gtdMin = x.gtdMin;
  if (Number.isInteger(x.oco) && x.oco >= 0) o.oco = x.oco;
  if (Array.isArray(x.tps) && x.tps.length >= 2 && x.tps.length <= TP_MAX && x.tps.every(r => r && fin(r.pips) && r.pips >= 0 && fin(r.pct) && r.pct >= 0 && r.pct <= 100)) o.tps = x.tps.map(r => ({ pips: r.pips, pct: r.pct }));
  if (fin(x.beAt) && x.beAt >= 0 && x.beAt <= 1000) o.beAt = x.beAt;
  if (fin(x.beOff) && Math.abs(x.beOff) <= 1000) o.beOff = x.beOff;
  return o;
}
const tkx = () => S.tkx || (S.tkx = normTkx(null));
// the exits the ticket puts on any order (the ticket itself, quick trade, DOM ladder, chart long-press)
function tkExits() {
  const t = S.tk, x = tkx(), split = t.useTP && x.split;
  return { slPips: t.useSL ? t.sl : 0, tpPips: t.useTP && !split ? t.tp : 0, tps: split ? x.tps.map(r => ({ pips: r.pips, pct: r.pct })) : undefined, trail: t.useTrail ? t.trail : 0,
    be: x.be ? { at: x.beAt > 0 ? x.beAt : null, off: x.beOff, onTp: x.beOnTp } : undefined };
}
function tkCalc(sideOverride) {
  const t = S.tk, x = tkx(), sym = S.set.sym, m = M(sym), q = Engine.quote(sym), side = sideOverride || t.side, d = side === 'buy' ? 1 : -1;
  const ot = sideOverride ? 'market' : t.ot;
  const entry = ot === 'market' ? (d > 0 ? q.ask : q.bid) : (t.price ?? q.mid);
  // a trailing stop without a stop loss is the stop: it starts trail pips from entry, so the risk is known
  const ownSL = t.useSL && t.sl > 0, trailOnly = !ownSL && t.useTrail && t.trail > 0, slPips = ownSL ? t.sl : trailOnly ? t.trail : null;
  const sl = slPips != null ? entry - d * slPips * m.pip : null;
  const pv = pipValue(sym, 1), a = account();
  const [mn, mx, st] = volOf(sym);
  let lots = normLots(sym, t.lots) || 0, minRisk = null;
  /* risk sizing on the sheet's step: lots stays at least the minimum size (read-only callers such as the DOM ladder
     and chart gestures rely on a non-zero size) and at most the maximum; when even the minimum risks more than asked,
     minRisk is set and tkBlocks stops the ticket */
  if (t.sm === 'risk') {
    const raw = sl != null ? +(Math.floor(a.eq * t.risk / 100 / (slPips * pv) / st + 1e-9) * st).toFixed(lotDec(sym)) : 0;
    lots = sl != null ? Math.min(mx, Math.max(mn, raw)) : 0;
    if (sl != null && !(raw >= mn - 1e-9)) minRisk = { usd: slPips * pv * mn, pct: slPips * pv * mn / a.eq * 100 };
  }
  const split = t.useTP && x.split;
  let tp = t.useTP && !split && t.tp > 0 ? entry + d * t.tp * m.pip : null, tps = null, tpErr = '', rewUsd = tp != null ? t.tp * pv * lots : null;
  if (split && lots >= mn) {
    const b = buildTps(sym, side, entry, lots, x.tps);
    if (b.err) tpErr = b.err; else { tps = b.tps; tp = tps[0].price; rewUsd = tps.reduce((s, l) => s + Math.abs(l.price - entry) / m.pip * pv * l.lots, 0); }
  }
  const stopLimit = ot === 'stop' && x.stopLimit, limit = stopLimit ? entry + d * x.lmtOff * m.pip : null;
  const tif = ot === 'market' ? 'GTC' : x.tif, now = Engine.simTime, expires = tif === 'DAY' ? dayEnd(now) : tif === 'GTD' ? now + x.gtdMin * 60 : null;
  const lev = effLev(sym), margin = notionalUsd(sym, lots) / lev;
  return { sym, side, ot, d, entry, sl, tp, lots, margin, lev, pv, a, q, m, minRisk, riskUsd: sl != null ? slPips * pv * lots : null, rewUsd, spreadCost: q.spread * pv * lots,
    slPips, trailOnly, tps, tpErr, split, stopLimit, limit, tif, expires, comm: commOf(lots, sym), mn };
}
/* What-If, IBKR style: Current / This order / Post-trade. Post-trade margin is gross per position (no offsetting of
   opposite positions) and counts every pending order as if it filled. Equity changes by the immediate cost of the
   trade: the position is marked at the other side of the quote (the spread) and commission is paid at the fill.
   Stop-out distance: how far this pair alone can move against the post-trade exposure before the margin level
   reaches 50%, first order (margin held constant). */
const pendingMargin = () => S.orders.reduce((s, o) => s + posMargin(o), 0);
function tkWhatIf(k) {
  const a = k.a, pend = pendingMargin(), chg = { eq: -(k.spreadCost + k.comm), mg: k.margin };
  const post = { eq: a.eq + chg.eq, mg: a.mg + pend + k.margin }; post.free = post.eq - post.mg; post.level = post.mg ? post.eq / post.mg * 100 : Infinity;
  const net = S.positions.filter(p => p.sym === k.sym).reduce((s, p) => s + (p.side === 'buy' ? 1 : -1) * p.lots, 0) + k.d * k.lots, L = Math.abs(net);
  const D = post.eq - .5 * post.mg, so = L < 1e-9 ? { hedged: true, pips: Infinity, pct: Infinity } : { hedged: false, pips: Math.max(0, D / (k.pv * L)), dir: net > 0 ? 'down' : 'up' };
  if (!so.hedged) so.pct = so.pips * k.m.pip / k.q.mid * 100;
  return { cur: { eq: a.eq, mg: a.mg, free: a.free, level: a.level }, chg, pend, nPend: S.orders.length, post, so };
}
const corrCache = {};
function pairCorr(a, b) {
  if (a === b) return 1;
  const key = a < b ? a + b : b + a, c = corrCache[key];
  if (c && Engine.simTime - c.t < 300 && performance.now() - c.rt < 5000) return c.r;
  const r = Engine.corr(Engine.returns(a, 1440), Engine.returns(b, 1440));
  corrCache[key] = { r, t: Engine.simTime, rt: performance.now() };
  return r;
}
/* Ticket checks come in three levels. Blocking ones (tkBlocks) stop the order and are written on the button;
   tkWarnings returns plain strings (other modules prepend their own), each tagged risk or info through WARN_LV. */
function tkBlocks(k) {
  const b = [], t = S.tk, eq = k.a.eq, un = unitWord(k.sym);
  // not offered under the profile: nothing new on it (a position already open stays close-only)
  const na = unavailableWhy(k.sym); if (na) b.push({ btn: na, why: na + (closeOnly(k.sym) ? '. You can close existing positions.' : '.') });
  // outside its session (or off quotes): the button names the opening time, as openPosition and placeOrder would
  const mw = marketWhy(k.sym); if (mw) b.push({ btn: mw, why: mw + '.' });
  if (t.sm === 'risk' && k.sl == null) b.push({ btn: 'Set a stop loss to size by risk', why: 'Risk sizing needs a stop loss.' });
  else if (k.minRisk) { const x = `Minimum size ${lotsWord(k.sym, k.mn)} risks ${usdFmt(k.minRisk.usd)} (${pct(k.minRisk.pct, 2, false)}) — above your ${+t.risk}%`; b.push({ btn: x, why: x + '.' }); }
  else if (!(k.lots >= k.mn - 1e-9)) { const x = volWhy(k.sym, k.lots); b.push({ btn: x, why: x + '.' }); }
  // a pending order closer to the market than the sheet's minimum distance is refused by placeOrder
  if (k.ot !== 'market') { const g = pendGap(k); if (g) b.push({ btn: g, why: g + '.' }); }
  if (!b.length) {
    if (k.ot === 'market' && k.margin > k.a.free) b.push({ btn: `Insufficient margin — needs ${usdFmt(k.margin)}`, why: `Margin ${usdFmt(k.margin)} exceeds free margin ${usdFmt(k.a.free)}.` });
    if (k.riskUsd != null && eq > 0 && k.riskUsd > eq * RISK_CAP / 100) b.push({ btn: `Risk ${pct(k.riskUsd / eq * 100, 1, false)} — above the ${RISK_CAP}% cap`, why: `Risk ${usdFmt(k.riskUsd)} is ${pct(k.riskUsd / eq * 100, 1, false)} of equity; one trade may risk at most ${RISK_CAP}%.` });
    const cap = orderCaps(k.sym, k.lots); if (cap) b.push({ btn: cap.replace(/ \(.*\)$/, ''), why: cap + '.' });
  }
  const x = tkx(), sp = k.q.spread, add = (btn, why) => b.push({ btn, why: why || btn + '.' });
  if (k.tpErr) add(k.tpErr);
  if (TKH.err.sl) add(TKH.err.sl); if (TKH.err.tp) add(TKH.err.tp);
  if (k.stopLimit && x.lmtOff < 0) add(`Limit must be at or ${k.d > 0 ? 'above' : 'below'} the stop`, `${k.d > 0 ? 'Buy' : 'Sell'} stop-limit: the limit must be at or ${k.d > 0 ? 'above' : 'below'} the stop price.`);
  if (k.ot !== 'market' && k.tif === 'GTD' && !(k.expires >= Engine.simTime + 60)) add('Expiry must be at least one minute ahead');
  // a stop loss inside the current spread would be refused at the click (market: it is already past the other side of
  // the quote; pending: placeOrder asks for more than the spread), so the button says so first
  const ownSL = k.slPips != null && !k.trailOnly;
  if (ownSL && (k.ot === 'market' ? (k.d > 0 ? k.sl >= k.q.bid : k.sl <= k.q.ask) : !(k.slPips > sp))) add(stopInSpreadWhy(k.sym, sp));
  if (k.trailOnly && !(t.trail > sp)) add(`Trailing stop must be wider than the spread (${sp.toFixed(1)} ${un})`);
  if (x.be && x.beAt > 0 && !(x.beAt > sp)) add(`Break-even trigger must exceed the spread (${sp.toFixed(1)} ${un})`);
  if (x.be && !(x.beAt > 0) && !x.beOnTp) add(`Break-even needs a trigger: ${un} in profit or the first target`);
  // the stop goes to entry + offset when price is trigger pips in profit: an offset at or past the trigger is at or beyond
  // the price at that moment, so it could never be set
  if (x.be && x.beAt > 0 && x.beOff >= x.beAt) add(`Break-even offset must be below the trigger (${x.beAt} ${un})`, `Break-even: the offset (${x.beOff} ${un}) must be below the trigger (${x.beAt} ${un}), or the stop would sit at or beyond the price.`);
  if (k.ot === 'market' && !b.length && k.lots >= k.mn) { const w = tkWhatIf(k); if (w.post.level <= 50) add(`Post-trade margin level ${nf0.format(w.post.level)}% — at stop-out`); }
  return b;
}
// the minimum pending distance (sheet minPend, points) from the side the order fills on, in words; pendGap: '' or
// why the ticket's price is too close
function pendMin(sym, side) {
  const m = M(sym), d = m.p.minPend * m.point, from = side === 'buy' ? 'ask' : 'bid';
  return { d, from, words: m.unit === 'pt' ? `${m.p.minPend} pt` : `${nfx(d / m.pip, 1)} pips`, px: d.toFixed(m.digits) };
}
function pendGap(k) {
  const pm = pendMin(k.sym, k.side), ref = k.d > 0 ? k.q.ask : k.q.bid;
  return k.entry > 0 && Math.abs(k.entry - ref) < pm.d - 1e-12 ? `Too close to the market: at least ${pm.words} from the ${pm.from}` : '';
}
const WARN_LV = new Map();
function tkWarnings(k) {
  const w = [], add = (lv, x) => { WARN_LV.set(x, lv); w.push(x); };
  if (WARN_LV.size > 400) WARN_LV.clear();
  if (k.riskUsd != null && k.riskUsd > k.a.eq * RISK_HIGH / 100 && k.riskUsd <= k.a.eq * RISK_CAP / 100) add('risk', `High risk: ${pct(k.riskUsd / k.a.eq * 100, 1, false)} of equity on one trade.`);
  if (k.sl == null && S.tk.sm !== 'risk') add('risk', 'No stop loss — downside is unlimited.');
  const t = S.tk, x = tkx(), un = unitWord(k.sym);
  if (k.trailOnly) add('info', `Trailing stop: the stop starts ${t.trail} ${un} from entry and follows the price ${t.trail} ${un} behind; it never moves back.`);
  else if (t.useTrail && t.trail > 0) add('info', `Trailing stop starts once price is ${t.trail} ${un} in your favour from entry, then follows ${t.trail} ${un} behind; until then your ${t.sl}-${unitWord(k.sym, true)} stop applies.`);
  if (k.ot !== 'market' && k.margin > k.a.free) add('risk', 'Not enough free margin now: if it triggered at current prices, this order would be rejected.');
  // a take profit is a profit only if it beats the entry and the commission
  const tpLegs = k.tps ? k.tps.map(l => l.price) : k.tp != null ? [k.tp] : [];
  if (tpLegs.some(v => k.d * (v - k.entry) <= 0)) add('risk', `Take profit at or ${k.d > 0 ? 'below' : 'above'} the entry: it would close at a loss.`);
  else if (k.rewUsd != null && k.comm > 0 && k.rewUsd <= k.comm) add('risk', `Take profit gains ${usdFmt(k.rewUsd)}, commission is ${usdFmt(k.comm)}: it closes at a net loss.`);
  if (k.lots >= k.mn) { const wi = tkWhatIf(k); if (wi.post.level > 50 && wi.post.level < 150 && !wi.so.hedged) add('risk', `Post-trade margin level ${nf0.format(wi.post.level)}% — a ${wi.so.pct.toFixed(1)}% move against you on ${pretty(k.sym)} reaches stop-out.`); }
  if ((t.useTrail && t.trail > 0) || x.be || (k.ot !== 'market' && k.tif !== 'GTC')) add('info', 'Checked by this tab: while it is closed nothing triggers, and the simulated market does not move.');
  for (const p of S.positions) {
    const r = pairCorr(k.sym, p.sym), dd = (p.side === 'buy' ? 1 : -1) * k.d, eff = r * dd;
    if (p.sym === k.sym) { add('info', dd > 0 ? `Adds to your open ${p.side} ${pretty(p.sym)} #${p.id}.` : `Offsets your open ${p.side} ${pretty(p.sym)} #${p.id}.`); break; }
    if (eff > .6) { add('risk', `Correlation guard: ${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)} with your ${p.side} ${pretty(p.sym)} — this stacks the same exposure.`); break; }
    if (eff < -.6) { add('info', `Hedge: this largely offsets your ${p.side} ${pretty(p.sym)} (ρ ${r.toFixed(2)}).`); break; }
  }
  const ev = CAL.events.find(e => !e.done && e.impact === 'hi' && k.m.newsCcy.includes(e.ccy) && e.t - Engine.simTime < 3600);
  if (ev) add('risk', `High-impact ${ev.ccy} ${ev.name} in ${fmtIn(ev.t - Engine.simTime)}.`);
  return w;
}
// strings added by other modules (the tilt guard) are risk-level; anything unknown is info
const warnLevel = x => WARN_LV.get(x) || (/^Tilt guard/.test(x) ? 'risk' : 'info');
// ticket labels that follow the instrument: unit (pips / pt) and size (lots / contracts)
let tkUnitsFor = '';
function tkUnits(m) {
  if (tkUnitsFor === m.sym) return;
  const prev = tkUnitsFor; tkUnitsFor = m.sym;
  const un = unitWord(m.sym), unitOf = id => $(id)?.closest('.lbl-row')?.querySelector('.unit');
  for (const id of ['#useSL', '#useTP', '#useTrail']) { const e = unitOf(id); if (e) e.textContent = un; }
  const be = unitOf('#tkBe'); if (be) be.textContent = un;
  const sz = $('#tkCtr'); if (sz) sz.textContent = tkSizeUnit(m.sym);
  const ll = $('#tkLotsLbl'); if (ll) ll.textContent = m.lotName === 'shares' && m.size === 1 ? 'Shares' : 'Lots';
  for (const e of $$('.tk3 .tk3-un')) e.textContent = m.unit === 'pt' ? 'Points' : 'Pips';
  for (const id of ['#tkSlPx', '#tkTpPx', '#tkPrice']) { const e = $(id); if (e) e.step = String(m.pip); }
  const sp = $('#tkSpr'); if (sp) sp.title = `Spread in ${m.unit === 'pt' ? 'points' : 'pips'}`;
  // the size fields take the sheet's min, max and step (index.html keeps the FX values as the markup default)
  const [mn, mx, st] = volOf(m.sym), word = m.lotName === 'shares' ? 'shares' : 'lots';
  for (const id of ['#tkLots', '#qLots']) { const e = $(id); if (!e) continue; e.step = String(st); e.min = String(mn); e.max = String(mx); e.setAttribute('aria-label', id === '#qLots' ? `Quick trade size in ${word}` : `Order size in ${word}`); }
  // the quick size of the instrument left is kept; the one entered gets its own back (or a size on its sheet)
  const q = $('#qLots'); if (!q) return;
  if (prev && M(prev) && finite(+q.value) && +q.value > 0) tkQBy[tkKey(prev)] = +q.value;
  if (document.activeElement !== q) q.value = lotsFmt(m.sym, prev ? tkLotsBack(m.sym, tkQBy) : tkLotsFor(m.sym, +q.value || mn));
}
// quick trade says why nothing can be sent (closed market, close only, not offered), as the order button does
let tkQuickWhy = null;
function tkQuickState(sym) {
  const w = unavailableWhy(sym) || marketWhy(sym);
  if (w === tkQuickWhy) return; tkQuickWhy = w;
  for (const b of $$('#qBuy,#qSell')) { b.disabled = !!w; b.setAttribute('aria-disabled', w ? 'true' : 'false'); }
  if (w) for (const b of $$('#qBuy,#qSell')) b.title = w; else syncOneClick();
}
// '1:500 · sheet' on FX, '1:100 · sheet, major index' otherwise; '1:20 · EU retail cap for major index' when the
// jurisdiction cuts the sheet's leverage (a choice above the sheet maximum is already capped by sheetLev)
function levWords(sym, lev) {
  const m = M(sym), c = CLS_LABEL[levCls(sym)] || m.cls;
  if (capBinds(sym)) return `1:${lev} · ${jurOf(S.set).name} cap for ${c}`;
  return m.kind === 'cfd' ? `1:${lev} · sheet, ${c}` : `1:${lev} · sheet`;
}
// the sheet's swap and its triple day: 'From the instrument sheet: −9.217 pts long / −8.771 pts short a night; triple on Wednesday'
// day names, also read by instrCard (chart.js) for the triple-swap day
const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const swapBasis = sym => `From the instrument sheet: ${swapText(sym)}; ${TRIPLE_TEXT(sym)}`;
// one side's swap as the sheet gives it: '−9.217 pts/night' (FX) or '−5.00%/yr' of the notional
function swapUnitWords(sym, side) {
  const [l, s, u] = M(sym).p.swap, v = side === 'buy' ? l : s;
  return u === 'pts' ? `${nfx(v, 3)} pts/night` : `${sgn(v * 100, 2)}%/yr`;
}
/* ============ ticket C v3: linked fields ============
   Volume: Lots | Risk % | Risk $; stop loss: Price | Pips | ATR ×; take profit: Price | Pips | R. The field typed in is
   the one held ("set"); the others are worked out from it, and when the market or the stop moves the held one stays.
   S.tk keeps the order model (lots or risk %, stop and target in pips); TKH says which field holds and its value.
   A change from outside (a line dragged on the chart, the symbol's own distances, an import) holds the pips again. */
const TKH = { sym: '', size: 'pct', sl: 'pips', tp: 'pips', usd: 0, slPx: null, slAtr: 0, tpPx: null, tpR: 0, err: { sl: '', tp: '' }, last: { sl: null, tp: null } };
// side / ot / price: the order being sent when it is not the ticket's own (Shift+B/S, quick trade, DOM ladder);
// the held prices are measured from that order's entry. Returns '' or why the held stop / target cannot apply.
function tkHold(side, ot, price) {
  const t = S.tk, sym = S.set.sym, m = M(sym); if (!m) return '';
  if (TKH.sym !== sym || TKH.tk !== t) Object.assign(TKH, { sym, tk: t, size: 'pct', sl: 'pips', tp: 'pips', last: { sl: null, tp: null } });
  if (TKH.last.sl != null && t.sl !== TKH.last.sl) TKH.sl = 'pips';
  if (TKH.last.tp != null && t.tp !== TKH.last.tp) TKH.tp = 'pips';
  side = side || t.side; ot = ot || t.ot; price = ot === 'market' ? null : price ?? t.price;
  const q = Engine.quote(sym), d = side === 'buy' ? 1 : -1, entry = ot === 'market' ? (d > 0 ? q.ask : q.bid) : (price ?? q.mid), r1 = v => +v.toFixed(1);
  const slOn = t.useSL, tpOn = t.useTP && !tkx().split;
  TKH.err.sl = TKH.err.tp = '';
  if (slOn && TKH.sl === 'price' && TKH.slPx != null) { const p = d * (entry - TKH.slPx) / m.pip; if (p > 0) t.sl = r1(p); else TKH.err.sl = `Stop loss must be ${d > 0 ? 'below' : 'above'} the entry (${fp(sym, entry)})`; }
  else if (slOn && TKH.sl === 'atr') { const a = tkAtr1h(sym); if (a > 0 && TKH.slAtr > 0) t.sl = r1(TKH.slAtr * a); }
  if (tpOn && TKH.tp === 'price' && TKH.tpPx != null) { const p = d * (TKH.tpPx - entry) / m.pip; if (p > 0) t.tp = r1(p); else TKH.err.tp = `Take profit must be ${d > 0 ? 'above' : 'below'} the entry (${fp(sym, entry)})`; }
  else if (tpOn && slOn && TKH.tp === 'r' && TKH.tpR > 0 && t.sl > 0) t.tp = r1(TKH.tpR * t.sl);
  if (t.sm === 'risk' && TKH.size === 'usd' && TKH.usd > 0) { const eq = account().eq; if (eq > 0) t.risk = +(TKH.usd / eq * 100).toFixed(4); }
  TKH.last.sl = t.sl; TKH.last.tp = t.tp;
  return TKH.err.sl || TKH.err.tp;
}
// the odds the target comes first and the typical time to either, random walk with the spread against you both ways
// (the formula of Trade math, obs.js obsOdds; σ per minute from the last 4 hours)
const tkSig = {};
function tkOdds(k) {
  if (k.slPips == null || k.split || !(S.tk.useTP && S.tk.tp > 0)) return null;
  const sp = k.q.spread, a = Math.max(.1, k.slPips - sp), b = S.tk.tp + sp;
  let g = tkSig[k.sym];
  if (!g || performance.now() - g.at > 5000) {
    const r = Engine.returns(k.sym, 240), n = r.length, mu = n ? r.reduce((s, x) => s + x, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) : 0;
    g = tkSig[k.sym] = { sig: sd * k.q.mid / k.m.pip, at: performance.now() };
  }
  return { p: a / (a + b), mins: g.sig > 0 ? a * b / (g.sig * g.sig) : null };
}
const tkLimit = () => (typeof rulesCfg === 'function' && rulesCfg().size ? { v: 2, w: 'your limit 2% (Rules)' } : { v: RISK_HIGH, w: `high above ${RISK_HIGH}%` });
// the field values follow the state, except the one being typed in; the held field of each row carries "set"
function tkFields(k) {
  const t = S.tk, sym = k.sym, m = k.m, set = (id, v) => { const e = $(id); if (e && document.activeElement !== e && e.value !== String(v)) e.value = v; };
  // the cells of one linked row (wherever the steps put them), by their inputs
  const hold = (ids, key) => { for (const c of ids.map(id => $(id)?.closest('.tk3-c')).filter(Boolean)) { const on = c.dataset.k === key; c.classList.toggle('held', on); const tg = c.querySelector('.tk3-tag'); if (tg) tg.textContent = on ? 'set' : 'auto'; } };
  set('#tkLots', lotsFmt(sym, k.lots));
  set('#tkRisk', k.riskUsd != null ? (k.riskUsd / k.a.eq * 100).toFixed(2) : '');
  set('#tkRiskUsd', k.riskUsd != null ? k.riskUsd.toFixed(2) : '');
  $('#tkRisk').disabled = $('#tkRiskUsd').disabled = k.slPips == null;
  hold(['#tkLots', '#tkRisk', '#tkRiskUsd'], t.sm === 'lots' ? 'lots' : TKH.size === 'usd' ? 'usd' : 'pct');
  const atr = tkAtr1h(sym), ownSL = t.useSL && t.sl > 0;
  set('#tkSlPx', TKH.sl === 'price' && TKH.slPx != null && t.useSL ? fp(sym, TKH.slPx) : ownSL ? fp(sym, k.entry - k.d * t.sl * m.pip) : ''); set('#tkSL', t.sl);
  set('#tkSlAtr', ownSL && atr > 0 ? (t.sl / atr).toFixed(2) : '');
  $('#tkSlAtr').disabled = !(atr > 0) || !t.useSL; $('#tkSlAtr').title = atr > 0 ? `ATR 1H ${atr.toFixed(1)} ${unitWord(sym)}` : 'ATR needs 15 hours of data';
  const tpOn = t.useTP && t.tp > 0 && !k.split;
  set('#tkTpPx', TKH.tp === 'price' && TKH.tpPx != null && tpOn ? fp(sym, TKH.tpPx) : tpOn ? fp(sym, k.entry + k.d * t.tp * m.pip) : ''); set('#tkTP', t.tp);
  set('#tkTpR', tpOn && ownSL ? (t.tp / t.sl).toFixed(2) : '');
  for (const id of ['#tkSlPx', '#tkSL']) $(id).disabled = !t.useSL;
  for (const id of ['#tkTpPx', '#tkTP', '#tkTpR']) $(id).disabled = !t.useTP || k.split;
  $('#tkSlAtr').disabled ||= !t.useSL; $('#tkTpR').disabled ||= !ownSL;
  hold(['#tkSlPx', '#tkSL', '#tkSlAtr'], TKH.sl); hold(['#tkTpPx', '#tkTP', '#tkTpR'], TKH.tp);
  $('#slMoney').textContent = k.riskUsd != null ? usdFmt(-k.riskUsd) : t.useSL ? '' : 'off';
  $('#tpMoney').textContent = k.rewUsd != null ? usdFmt(k.rewUsd, true) : t.useTP ? '' : 'off';
  const lim = tkLimit(), ln = $('#tkLim'); if (ln.textContent !== lim.w) ln.textContent = lim.w;
  for (const b of $$('#tkChips [data-rk]')) { const v = +b.dataset.rk; b.disabled = k.slPips == null; b.classList.toggle('on', t.sm === 'risk' && TKH.size !== 'usd' && Math.abs(t.risk - v) < 1e-9); b.classList.toggle('over', v > lim.v); }
  const tip = t.ot !== 'market' && (TKH.sl === 'price' || TKH.tp === 'price') ? 'Pending: the stop and the target are kept as distances from the fill price, as shown in pips' : 'Fill any field · ↑ ↓ step · Shift × 10 · drag the lines on the chart';
  const tp0 = $('#tkTip'); if (tp0 && tp0.textContent !== tip) tp0.textContent = tip;
  const pl = $('#tkPriceLbl'); if (pl) { const w = t.ot === 'limit' ? (k.d > 0 ? 'Buy when the price falls to' : 'Sell when the price rises to') : t.ot === 'stop' ? (k.d > 0 ? 'Buy when the price rises to' : 'Sell when the price falls to') : 'Entry price'; if (pl.textContent !== w) pl.textContent = w; }
}
function renderTicket() {
  tkBuild(); tkHold();
  const t = S.tk, k = tkCalc(), sym = k.sym;
  $('#tkBid').innerHTML = bigPx(sym, k.q.bid); $('#tkAsk').innerHTML = bigPx(sym, k.q.ask);
  const m = k.m, cfd = m.kind === 'cfd', un = unitWord(sym), u1 = unitWord(sym, true);
  $('#qBid').textContent = fp(sym, k.q.bid); $('#qAsk').textContent = fp(sym, k.q.ask); $('#qSpread').textContent = k.q.spread.toFixed(1) + ' ' + u1;
  $('#slPx').textContent = TKH.err.sl; $('#tpPx').textContent = TKH.err.tp;
  tkUnits(m); tkQuickState(sym); tkFields(k);
  const sizeTxt = t.sm === 'risk' ? (k.minRisk ? `Below the minimum size (${lotsWord(sym, k.mn)}) for this risk` : k.lots ? `→ ${lotsWord(sym, k.lots)} · $${smallMoney(k.pv * k.lots)}/${u1}` : 'Set a stop loss to size by risk')
    : m.lotName === 'shares' ? `${lotsWord(sym, k.lots)} · ${usdFmt(k.pv * k.lots)}/${u1}` : cfd ? (m.sizeUnit === 'point' && m.pip !== 1 ? `${lotsWord(sym, k.lots)}: ${ptWorth(sym, k.lots)} ≈ $${smallMoney(k.pv * k.lots)}` : `${contractText(sym)} · $${smallMoney(k.pv * k.lots)}/${u1}`) : `${nf0.format(k.lots * m.size)} ${m.base} · ${usdFmt(k.pv * k.lots)}/pip`;
  $('#sizeHint').textContent = `${sizeTxt} · margin ${usdFmt(k.margin)} · ${levWords(sym, k.lev).split(' · ')[0]}`;
  const ph = $('#tkPendHint');
  if (ph) { ph.hidden = t.ot === 'market'; if (!ph.hidden) { const pm = pendMin(sym, k.side), x = `At least ${pm.words} (${pm.px}) from the ${pm.from}`; if (ph.textContent !== x) ph.textContent = x; } }
  const rr = k.riskUsd && k.rewUsd ? k.rewUsd / k.riskUsd : null;
  const tot = (k.riskUsd || 0) + (k.rewUsd || 0) || 1;
  $('#rrRisk').style.flex = (k.riskUsd || 0) / tot; $('#rrRew').style.flex = (k.rewUsd || 0) / tot;
  const od = tkOdds(k), rows = [
    [cfd ? 'Point value' : 'Pip value', usdFmt(k.pv * k.lots)], ['Margin required', `${usdFmt(k.margin)} <span class="muted">${escHtml(levWords(sym, k.lev))}</span>`], ['Contract', escHtml(contractText(sym))],
    ['Risk', k.riskUsd != null ? `<span class="dn">${usdFmt(-k.riskUsd)}</span> <span class="muted">${pct(k.riskUsd / k.a.eq * 100, 2, false)}</span>` : '<span class="dn">unlimited</span>'],
    ['Reward', k.rewUsd != null ? `<span class="up">${usdFmt(k.rewUsd, true)}</span>` : '—'],
    ['Reward : risk', rr ? `1 : ${rr.toFixed(2)}` : '—'], ['Spread cost', usdFmt(k.spreadCost)],
    ['Break-even win rate', rr ? pct(100 / (1 + rr), 1, false) : '—']
  ];
  const sw = swapPerNight(sym, k.side, k.lots), tri = nextTriple(Engine.simTime, sym);
  rows.push(['Swap / night', `<span class="${cls(sw)}">${usdFmt(sw, true)}</span> <span class="muted">${escHtml(swapUnitWords(sym, k.side))}</span>`],
    ['To next triple', isFinite(tri) ? fmtIn(tri - Engine.simTime) : '—'], ['Swap basis', `<span class="muted">${escHtml(swapBasis(sym))}</span>`]);
  if (m.div === 'excluded') rows.push(['Dividends', '<span class="muted">No dividend adjustments (simulated index pays none)</span>']);
  if (od) rows.push(['Odds TP before SL', `${pct(od.p * 100, 0, false)} <span class="muted">random walk</span>`], ['Typical time to resolve', od.mins ? '~' + fmtDur(od.mins) : '—']);
  $('#tkStats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  const spr = $('#tkSpr'); if (spr) spr.textContent = k.q.spread.toFixed(1);
  // the summary: who does what, then risk / reward / R:R, the bar, then margin / costs / time and swap
  const bl = tkBlocks(k), wi = tkWhatIf(k), eq = k.a.eq, rp = k.riskUsd != null && eq > 0 ? k.riskUsd / eq * 100 : null, lim = tkLimit();
  const sizeW = m.lotName === 'shares' && m.size === 1 ? (k.lots === 1 ? 'share' : 'shares') : (k.lots === 1 ? 'lot' : 'lots');
  const you = `<span class="tk3-k">You</span><b class="${t.side === 'buy' ? 'up' : 'dn'}">${t.side === 'buy' ? 'BUY' : 'SELL'}</b><b class="mono">${escHtml(tkLotsText(sym, k.lots).replace(/ .*$/, ''))}</b><span>${sizeW} ${escHtml(sym)}</span><span class="mono tk3-when">${t.ot === 'market' ? 'now' : k.stopLimit ? 'stop-limit' : t.ot} @ ${fp(sym, k.entry)}</span>`;
  const yo = $('#tkYou'); if (yo._h !== you) { yo.innerHTML = you; yo._h = you; }
  const rpCls = rp == null ? 'muted' : rp > RISK_CAP ? 'dn' : rp > lim.v ? 'warn' : '';
  const cell = (lab, big, bigCls, small, smallCls, title) => `<div${title ? ` title="${escHtml(title)}"` : ''}><label>${lab}</label><b class="mono ${bigCls}">${big}</b><small class="mono ${smallCls || ''}">${small}</small></div>`;
  const sumH = cell('You risk', rp != null ? pct(rp, 2, false) : 'open', rpCls, k.riskUsd != null ? usdFmt(-k.riskUsd) : 'no stop', 'dn')
    + cell('To make', k.rewUsd != null ? pct(k.rewUsd / eq * 100, 2, false) : 'open', 'up', k.rewUsd != null ? usdFmt(k.rewUsd, true) : 'no target', 'up')
    + cell('Reward : risk', rr ? '1 : ' + rr.toFixed(2) : '—', rr != null && rr < 1 ? 'warn' : '', rr ? `break even at <b>${pct(100 / (1 + rr), 1, false)}</b> wins` : '');
  const sum = $('#tkSum'); if (sum._h !== sumH) { sum.innerHTML = sumH; sum._h = sumH; }
  const lv = v => isFinite(v) ? nf0.format(v) + '%' : '—';
  const so = wi.so.hedged ? 'hedged' : wi.so.pips <= 0 ? 'at stop-out' : `${nf0.format(wi.so.pips)} ${un} away`;
  const nights = od && od.mins ? Math.round(od.mins / 1440) : null;
  const sum2 = cell('Margin', usdFmt(k.margin), '', `level <b>${lv(wi.post.level)}</b><br>stop-out <b>${so}</b>`, '', 'Margin level after this order (pending orders included); stop-out at 50%')
    + cell('Costs', usdFmt(k.spreadCost + k.comm), '', `spread${k.comm > 0 ? ' + commission' : ' · no commission'}`)
    + cell('Time · swap', od && od.mins ? '~' + fmtDur(od.mins) : '—', '', `<b class="${cls(sw)}">${usdFmt(sw, true)}</b>/night${nights != null ? ` · ≈ ${nights} night${nights === 1 ? '' : 's'}` : ''}`, '', 'Typical time until the stop or the target is reached (random walk), and the swap a night');
  const s2 = $('#tkSum2'); if (s2._h !== sum2) { s2.innerHTML = sum2; s2._h = sum2; }
  // market closed or not offered: said once, at the top; the button keeps the reason, the list does not repeat it
  const mw = unavailableWhy(sym) || marketWhy(sym), mk = $('#tkMkt'); mk.hidden = !mw; if (mw && mk.textContent !== mw) mk.textContent = mw;
  const ch = $('#tkChal'); if (ch && ch.previousElementSibling !== mk) mk.after(ch);
  // what can go wrong: the blocks, the warnings, then what the numbers say about this trade
  const w = tkWarnings(k), extra = [];
  if (k.slPips != null) { const a = tkAtr1h(sym); if (a > 0) { const x = k.slPips / a; extra.push([x < 1 ? 'risk' : 'info', `The stop is ${x.toFixed(1)}× ATR (one hour moves ${a.toFixed(1)} ${un})${x < 1 ? ': an ordinary hour can reach it' : x < 2 ? ': a couple of ordinary hours can reach it' : ': beyond the usual hourly noise'}.`]); } }
  if (od && rr) { const be = 100 / (1 + rr); extra.push([od.p * 100 < be ? 'risk' : 'info', `The target comes first ${pct(od.p * 100, 0, false)} of the time (random walk); you need ${pct(be, 1, false)} to break even.`]); }
  if (k.slPips != null && k.slPips > 0) { const f = k.q.spread / k.slPips; extra.push([f > .1 ? 'risk' : 'info', `The spread costs ${usdFmt(k.spreadCost)}, ${Math.round(f * 100)}% of your stop.`]); }
  if (rr != null && rr < 1) extra.push(['risk', `Reward is smaller than risk (1 : ${rr.toFixed(2)}): you must win more often than you lose.`]);
  const items = bl.filter(x => x.btn !== mw).map(x => ['block', x.why]).concat(w.map(x => [warnLevel(x), x]), extra);
  const order = { block: 0, risk: 1, info: 2 }; items.sort((a, b) => order[a[0]] - order[b[0]]);
  const nB = items.filter(x => x[0] === 'block').length, nR = items.filter(x => x[0] === 'risk').length;
  const head = `<div class="w-head"><span>What can go wrong</span><span>${nB ? `${nB} blocked · ` : ''}${nR} risk</span></div>`;
  const html = head + items.map(([lv2, x]) => `<div class="w-${lv2}"><span class="w-lv">${lv2 === 'block' ? 'Blocked' : lv2 === 'risk' ? 'Risk' : 'Note'}</span>${escHtml(x)}</div>`).join('');
  const wb = $('#tkWarn'); wb.hidden = !items.length; if (wb._h !== html) { wb.innerHTML = html; wb._h = html; }
  wb.className = 'warn ' + (bl.length ? 'lv-block' : items.some(x => x[0] === 'risk') ? 'lv-risk' : 'lv-info');
  // the order button names the order; a pre-mortem that will open first is said on it, with the reason under it
  let pmWhy = '';
  if (!bl.length && typeof pmNeeded === 'function') {
    try {
      if (pmNeeded({ sym, side: k.side, lots: k.lots, price: k.ot === 'market' ? undefined : k.entry, sl: k.trailOnly ? undefined : k.sl ?? undefined, tp: k.tp ?? undefined })) {
        const pc = typeof pmCfg === 'function' ? pmCfg() : { minRisk: 1 };
        pmWhy = typeof tiltStatus === 'function' && tiltStatus().armed ? 'Tilt guard is on' : k.sl == null || k.trailOnly ? 'No stop loss' : rp != null && rp >= pc.minRisk ? `Risk ${pct(rp, 2, false)} (pre-mortem from ${pc.minRisk}%)` : 'Your rules ask for it';
      }
    } catch (e) { pmWhy = ''; }
  }
  const btn = $('#tkSubmit');
  btn.className = 'cta ' + (bl.length ? 'blocked' : t.side);
  btn.disabled = !!bl.length;
  btn.textContent = bl.length ? bl[0].btn : `${t.side === 'buy' ? 'Buy' : 'Sell'} ${tkLotsText(sym, k.lots)} ${sym}${t.ot === 'market' ? '' : ` ${k.stopLimit ? 'stop-limit' : t.ot} @ ${fp(sym, k.entry)}${k.stopLimit ? ' → ' + fp(sym, k.limit) : ''}`}${pmWhy ? ' · pre-mortem next' : ''}`;
  const pn = $('#tkPmNote'), pt = pmWhy ? `${pmWhy}: the pre-mortem opens before the order is sent.` : ''; pn.hidden = !pt; if (pn.textContent !== pt) pn.textContent = pt;
  tkRenderAdv(k); tkStepsRender(k);
  return k;
}
/* Stop, target and trail distances per instrument. S.tk.sl/tp/trail are distances in the unit of the current symbol,
   and 20 pips on EUR/USD is no stop at all on gold (spread 225 pt). S.tk.bySym keeps what the user set: one entry per
   instrument, and one 'FX' entry shared by the 16 G8 pairs (Engine.PAIRS: their pips are alike, so they behave as
   before). On a switch the values of the symbol left are stored when they are FX or were changed by the user; the
   symbol entered gets its stored values, else a default from the sheet: stop = max(2 × the simulated hourly σ
   (seed.sIn, per open hour) × price, 3 × spread) in the displayed unit, target = 2 × stop, trail = stop. */
const TK_G8 = new Set(Engine.PAIRS.map(p => p.sym));
const tkKey = sym => TK_G8.has(sym) ? 'FX' : sym;
// ATR(14) 1H in the displayed unit (shared.js atr1h: Wilder's, complete hours); 0 under 15 hours
function tkAtr1h(sym) {
  const a = atr1h(sym);
  return a != null ? a / M(sym).pip : 0;
}
function tkDefaults(sym) {
  // the spread now (night and news widen it), never below the sheet's default spread
  const m = M(sym), q = Engine.quote(sym), sp = Math.max(m.spread, q.spread), s1 = m.seed && m.seed.sIn;
  const vol = s1 > 0 && q.bid > 0 ? 2 * s1 * q.bid / m.pip : .5 * tkAtr1h(sym), sl = Math.ceil(Math.max(3 * sp, vol));
  return { sl, tp: 2 * sl, trail: sl };
}
let tkSeen = null; // { tk: the S.tk object, sym, v: the values put in on entry }
const tkVals = t => ({ sl: t.sl, tp: t.tp, trail: t.trail });
// distances for a symbol that may not be the ticket's own (multi-chart panes trade other instruments)
function tkDistFor(sym) {
  const t = S.tk, k = tkKey(sym);
  if (k === tkKey(S.set.sym)) return tkVals(t);
  const v = t.bySym && t.bySym[k];
  return v && ['sl', 'tp', 'trail'].every(x => typeof v[x] === 'number' && isFinite(v[x]) && v[x] >= 0) ? tkVals(v)
    : k === 'FX' ? { sl: DEF.tk.sl, tp: DEF.tk.tp, trail: DEF.tk.trail } : tkDefaults(sym);
}
function tkFollowSymbol() {
  const t = S.tk, sym = S.set.sym;
  if (!t.bySym || typeof t.bySym !== 'object' || Array.isArray(t.bySym)) t.bySym = {};
  const by = t.bySym, own = tkKey(sym) !== 'FX';
  const okV = v => v && ['sl', 'tp', 'trail'].every(k => typeof v[k] === 'number' && isFinite(v[k]) && v[k] >= 0);
  if (!tkSeen || tkSeen.tk !== t) {
    // first look at this ticket (boot, import, reset): its values stand; an instrument outside the G8 still on the FX
    // defaults gets its own
    const d = DEF.tk;
    if (own && !okV(by[sym]) && t.sl === d.sl && t.tp === d.tp && t.trail === d.trail) Object.assign(t, tkDefaults(sym));
    if (!tkLotsOk(sym, t.lots)) t.lots = tkLotsCarry(sym, t.lots);
    tkSeen = { tk: t, sym, v: tkVals(t) }; return;
  }
  if (tkSeen.sym === sym) return;
  const from = tkSeen.sym, cur = tkVals(t), kf = tkKey(from), kt = tkKey(sym);
  if (kf === kt) { tkSeen.sym = sym; return; } // G8 → G8: one set of values, as before
  const changed = ['sl', 'tp', 'trail'].some(k => cur[k] !== tkSeen.v[k]);
  if (kf === 'FX' || changed || okV(by[kf])) by[kf] = cur;
  // the size: stored for the symbol left, given back for the symbol entered (before c6 the size stayed as set)
  if (!t.lotsBy || typeof t.lotsBy !== 'object' || Array.isArray(t.lotsBy)) t.lotsBy = {};
  if (finite(+t.lots) && +t.lots > 0) t.lotsBy[kf] = +t.lots;
  t.lots = tkLotsBack(sym, t.lotsBy);
  Object.assign(t, okV(by[kt]) ? tkVals(by[kt]) : kt === 'FX' ? { sl: DEF.tk.sl, tp: DEF.tk.tp, trail: DEF.tk.trail } : tkDefaults(sym));
  tkSeen = { tk: t, sym, v: tkVals(t) };
}
function syncTicketInputs() {
  if (M(S.set.sym)) tkFollowSymbol();
  const t = S.tk;
  if (M(S.set.sym)) { t.lots = tkLotsFor(S.set.sym, t.lots); tkUnits(M(S.set.sym)); }
  $$('#sideSeg button').forEach(b => b.classList.toggle('on', b.dataset.side === t.side));
  $$('#otSeg button').forEach(b => b.classList.toggle('on', b.dataset.ot === t.ot));
  $$('#sizeMode button').forEach(b => b.classList.toggle('on', b.dataset.sm === t.sm));
  $('#priceField').hidden = t.ot === 'market'; const pe = $('#tkPend'); if (pe) pe.hidden = t.ot === 'market';
  const set = (id, v) => { const e = $(id); if (document.activeElement !== e) e.value = v; };
  set('#tkLots', M(S.set.sym) ? lotsFmt(S.set.sym, t.lots) : (+t.lots).toFixed(2)); set('#tkRisk', (+t.risk).toFixed(2)); set('#tkSL', t.sl); set('#tkTP', t.tp); set('#tkTrail', t.trail);
  if (t.ot !== 'market') { if (t.price == null) t.price = defaultPendingPrice(); set('#tkPrice', fp(S.set.sym, t.price)); }
  $('#useSL').checked = t.useSL; $('#useTP').checked = t.useTP; $('#useTrail').checked = t.useTrail;
  dirty.lines = true; save();
}
function submitTicket(sideOverride) {
  tkHold(sideOverride, sideOverride ? 'market' : undefined);
  const n0 = S.positions.length + S.orders.length;
  const k = tkCalc(sideOverride), t = S.tk, bl = tkBlocks(k);
  if (bl.length) { toast('Order blocked', bl[0].why, 'dn'); beep('err'); return; }
  const ex = tkExits(), x = tkx();
  // market: absolute stop (a trail-only ticket passes none: the trail becomes the stop at the fill); targets from the fill
  if (k.ot === 'market') openPosition({ sym: k.sym, side: k.side, lots: k.lots, sl: t.useSL && t.sl > 0 ? k.sl : null, tp: k.tp, tps: ex.tps, be: ex.be, trail: ex.trail });
  else placeOrder({ sym: k.sym, side: k.side, ot: k.ot, price: k.entry, limit: k.stopLimit ? +k.limit.toFixed(k.m.digits) : null, lots: k.lots, slPips: ex.slPips, tpPips: ex.tpPips, tps: ex.tps, be: ex.be, trail: ex.trail,
    tif: k.tif, expires: k.expires, oca: x.oco && S.orders.some(o => o.id === x.oco && o.sym === k.sym) ? x.oco : null });
  // back to Buy / Sell once the order really exists (a pre-mortem or a refusal may hold it: tkStepsRender checks)
  TKS.sent = n0;
}
/* One-click trading is off by default: quick-trade buttons, chart-pane B/S and Shift+B/S then only fill in the
   ticket and move focus to its order button, so the order is sent by a second, deliberate press. */
function prefillTicket(sym, side, lots) {
  if (sym !== S.set.sym) setSymbol(sym, side);
  const t = S.tk; t.side = side; t.ot = 'market'; t.price = null; TKS.started = true;
  if (lots != null) { t.sm = 'lots'; t.lots = tkLotsFor(sym, lots); }
  syncTicketInputs(); const k = renderTicket(), bl = tkBlocks(k);
  if (document.body.classList.contains('mnav-on') && typeof window.mnavGo === 'function') window.mnavGo('trade');
  const b = $('#tkSubmit'); b.scrollIntoView({ block: 'nearest' });
  if (!bl.length) b.focus({ preventScroll: true });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) b.closest('.panel')?.animate([{ boxShadow: 'inset 0 0 0 2px var(--acc)' }, { boxShadow: 'inset 0 0 0 0 transparent' }], { duration: 900 });
  toast('Ticket ready — not sent', bl.length ? bl[0].why : `${side === 'buy' ? 'Buy' : 'Sell'} ${tkLotsText(sym, k.lots)} ${pretty(sym)}: press the order button to send. One-click trading is off (Guide → Settings).`, 'info');
}
function syncOneClick() {
  const on = !!S.set.oneClick, cb = $('#oneClickSet'); if (cb) cb.checked = on;
  document.documentElement.classList.toggle('one-click', on);
  for (const b of $$('#qBuy,#qSell,.mc-b[data-q]')) { const sd = b.id === 'qBuy' || b.dataset.q === 'buy' ? 'Buy' : 'Sell'; b.title = on ? `${sd} at market now (one-click on)` : `${sd}: fills in the order ticket — one-click trading is off`; }
  const fn = $('#tkKeysNote'); if (fn) fn.textContent = on ? 'trade instantly (one-click on).' : 'fill in the ticket; one-click trading is off.';
}
function quickTrade(side) {
  const sym = S.set.sym, m = M(sym), q = Engine.quote(sym), d = side === 'buy' ? 1 : -1, t = S.tk, e = d > 0 ? q.ask : q.bid;
  // the size typed is the size sent: one-click passes it as typed (rounded to the step inside openPosition), so a size
  // outside the sheet's [min, max] is refused with its reason (volWhy) instead of being clamped out of sight; the
  // ticket path may clamp, because the ticket then shows the size it will send
  const typed = +$('#qLots').value || volOf(sym)[0];
  if (!S.set.oneClick) return prefillTicket(sym, side, tkLotsFor(sym, typed));
  const why = tkHold(side, 'market'); if (why) { toast('Order blocked', why + '.', 'dn'); beep('err'); return null; }
  const lots = typed, ex = tkExits();
  return openPosition({ sym, side, lots, sl: t.useSL ? e - d * t.sl * m.pip : null, tp: ex.tpPips ? e + d * t.tp * m.pip : null, tps: ex.tps, be: ex.be, trail: ex.trail });
}

/* ============ ticket: order-model controls, What-If, execution note, last fill ============
   Built into the existing ticket panel on the first render (index.html keeps the base fields). */
const TK_CSS_ROW = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
const TK_IN = 'width:72px;min-height:28px;padding:2px 6px;background:var(--s2);color:var(--tx);border:1px solid var(--line2);border-radius:var(--r-sm);font-family:var(--mono)';
let tkBuilt = false;
function tkBuild() {
  if (tkBuilt) return; const panel = $('.ticket'); if (!panel || !$('#priceField')) return;
  tkBuilt = true;
  $('#priceField').insertAdjacentHTML('beforeend', `<div class="hint mono" id="tkPendHint" hidden></div>`);
  // the lots stepper moves on the sheet's step (10 steps at a time from 100 steps up: 0.1 lot on FX from 1 lot, as
  // before); capture phase, so the generic stepper (app.js, 0.01 lots) does not run for it
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-step^="lots:"]'); if (!b || !M(S.set.sym)) return;
    e.stopPropagation();
    const sym = S.set.sym, t = S.tk, st = volOf(sym)[2], d = +b.dataset.step.split(':')[1], cur = tkLotsFor(sym, t.lots); t.sm = 'lots';
    const inc = (d > 0 ? cur >= 100 * st - 1e-9 : cur > 100 * st + 1e-9) ? 10 * st : st;
    t.lots = tkLotsFor(sym, cur + d * inc); syncTicketInputs();
  }, true);
  panel.addEventListener('click', e => { if (e.target.closest('[data-step^="risk:"]')) { S.tk.sm = 'risk'; TKH.size = 'pct'; } }, true);
  const step = (k, lbl) => `<button type="button" data-xstep="${k}:-1" aria-label="Decrease ${lbl}">−</button>`, stepUp = (k, lbl) => `<button type="button" data-xstep="${k}:1" aria-label="Increase ${lbl}">+</button>`;
  $('#priceField').insertAdjacentHTML('afterend', `
    <div class="field" id="tkLmtField" hidden><div class="lbl-row"><label><input type="checkbox" id="tkSLim"> Stop-limit</label><span class="unit">limit, pips past the stop</span></div>
      <div class="stepper">${step('lmtOff', 'limit offset')}<input id="tkLmtOff" type="number" step="0.5" class="mono" aria-label="Limit offset in pips">${stepUp('lmtOff', 'limit offset')}</div><div class="hint mono" id="tkLmtPx"></div></div>
    <div class="field" id="tkTifField" hidden><div class="lbl-row"><label for="tkTif">Good till</label><span class="unit">simulation UTC</span></div>
      <div style="${TK_CSS_ROW}"><select id="tkTif" aria-label="Time in force"><option value="GTC">Cancelled (GTC)</option><option value="DAY">End of day (DAY)</option><option value="GTD">Time (GTD)</option></select>
      <span id="tkGtdWrap" style="${TK_CSS_ROW}"><input id="tkGtd" type="number" min="1" step="15" style="${TK_IN}" aria-label="Minutes until the order expires"><span class="unit">min</span></span></div>
      <div class="hint mono" id="tkTifHint"></div>
      <div class="lbl-row" id="tkOcoRow" hidden><label for="tkOco">OCO with</label><select id="tkOco" aria-label="One-cancels-other with a pending order"></select></div></div>`);
  // split targets: switched on under More; the legs then open below the stop/target pair (the ticket keeps its height otherwise)
  const two = $('#tkTpBlk') || $('#useTP').closest('.field');
  two.insertAdjacentHTML('afterend', `<div class="field" id="tkSplitField" hidden><div class="lbl-row"><label>Targets</label><span class="unit">pips · % of size</span></div>
    <div id="tkLegs" style="display:flex;flex-direction:column;gap:4px"></div><div class="hint mono" id="tkLegsHint"></div></div>`);
  // What-If sits at the top of More (the ticket keeps its height, so the depth ladder below keeps its levels);
  // its key figure, the post-trade margin level, is in the summary strip
  const more = $('#tkMore'), ms = more && more.querySelector('summary');
  if (ms) { ms.textContent = 'More — account after this order, split targets, trailing, break-even, execution'; ms.insertAdjacentHTML('afterend', `<div class="field" id="tkWhatIf"><div class="lbl-row"><label>Account after this order</label><span class="unit mono" id="tkWiSum"></span></div><div id="tkWiBody"></div></div>`); }
  $('#tkSubmit').insertAdjacentHTML('afterend', `<div class="foot-note" id="tkExecNote"></div><div class="foot-note" id="tkLastFill" hidden></div>`);
  const trailField = $('#useTrail').closest('.field');
  trailField.insertAdjacentHTML('beforebegin', `<div class="field"><div class="lbl-row"><label><input type="checkbox" id="tkSplit"> Split take profit</label><span class="unit">2–4 partial targets</span></div></div>`);
  trailField.insertAdjacentHTML('afterend', `<div class="field" id="tkBeField"><div class="lbl-row"><label><input type="checkbox" id="tkBe"> Break-even</label><span class="unit">pips</span></div>
      <div style="${TK_CSS_ROW}"><label class="small" for="tkBeAt">after</label><input id="tkBeAt" type="number" min="0" step="1" style="${TK_IN}"><span class="small">in profit, stop to entry +</span><input id="tkBeOff" type="number" step="0.5" style="${TK_IN}" aria-label="Break-even offset in pips"></div>
      <label class="small"><input type="checkbox" id="tkBeTp"> or when the first target fills</label></div>
    <div class="field" id="tkExecField"><div class="lbl-row"><label>Execution</label><span class="unit">all-or-nothing fills</span></div>
      <div style="${TK_CSS_ROW}"><label class="small"><input type="checkbox" id="tkSlipOn"> Slippage σ</label><input id="tkSlipSd" type="number" min="0" max="5" step="0.1" style="${TK_IN}" aria-label="Slippage sigma in pips"><span class="small">pip · latency</span><input id="tkLat" type="number" min="0" max="2000" step="10" style="${TK_IN}" aria-label="Simulated latency in milliseconds"><span class="small">ms</span></div>
      <div style="${TK_CSS_ROW}"><label class="small" for="tkComm">Commission $</label><input id="tkComm" type="number" min="0" max="50" step="0.5" style="${TK_IN}"><span class="small">per lot round turn</span></div></div>`);
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  // C v3 fields: the one typed in holds (TKH); lots and risk % keep their own handlers (app.js) for the value
  panel.addEventListener('input', e => {
    const id = e.target.id, v = num(e.target.value), t = S.tk;
    if (id === 'tkLots') t.sm = 'lots';
    else if (id === 'tkRisk') { t.sm = 'risk'; TKH.size = 'pct'; }
    else if (id === 'tkRiskUsd') { if (v > 0) { t.sm = 'risk'; TKH.size = 'usd'; TKH.usd = v; } }
    else if (id === 'tkSL') TKH.sl = 'pips';
    else if (id === 'tkSlPx') { if (v > 0) { TKH.sl = 'price'; TKH.slPx = v; t.useSL = true; } }
    else if (id === 'tkSlAtr') { if (v > 0) { TKH.sl = 'atr'; TKH.slAtr = v; } }
    else if (id === 'tkTP') TKH.tp = 'pips';
    else if (id === 'tkTpPx') { if (v > 0) { TKH.tp = 'price'; TKH.tpPx = v; t.useTP = true; } }
    else if (id === 'tkTpR') { if (v > 0) { TKH.tp = 'r'; TKH.tpR = v; } }
    else return;
    $$('#sizeMode button').forEach(b => b.classList.toggle('on', b.dataset.sm === t.sm));
    dirty.lines = true; save();
  });
  for (const id of ['#tkRiskUsd', '#tkSlPx', '#tkSlAtr', '#tkTpPx', '#tkTpR']) $(id).addEventListener('blur', syncTicketInputs);
  // Shift + ↑ ↓: ten steps (a plain arrow is the field's own step)
  panel.addEventListener('keydown', e => {
    const f = e.target; if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !f.matches('.tk3 input[type=number]') || f.disabled) return;
    e.preventDefault(); try { if (!f.value) f.value = f.placeholder || 0; e.key === 'ArrowUp' ? f.stepUp(10) : f.stepDown(10); } catch (err) { return; }
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#tkChips').addEventListener('click', e => {
    const b = e.target.closest('[data-rk]'); if (!b || b.disabled) return;
    S.tk.sm = 'risk'; S.tk.risk = +b.dataset.rk; TKH.size = 'pct'; syncTicketInputs();
  });
  panel.addEventListener('input', e => {
    const id = e.target.id, x = tkx(), v = num(e.target.value);
    if (id === 'tkLmtOff' && v != null) x.lmtOff = v;
    else if (id === 'tkGtd' && v != null) x.gtdMin = Math.max(0, v);
    else if (id === 'tkBeAt' && v != null) x.beAt = Math.max(0, v);
    else if (id === 'tkBeOff' && v != null) x.beOff = v;
    else if (id === 'tkSlipSd' && v != null) S.set.slipSd = clamp(v, 0, 5);
    else if (id === 'tkLat' && v != null) S.set.latMs = clamp(Math.round(v), 0, 2000);
    else if (id === 'tkComm' && v != null) S.set.comm = clamp(v, 0, 50);
    else if (e.target.dataset.leg != null && v != null) { const r = x.tps[+e.target.dataset.leg]; if (r) r[e.target.dataset.k] = Math.max(0, v); }
    else return;
    dirty.lines = true; save();
  });
  panel.addEventListener('change', e => {
    const id = e.target.id, x = tkx(), c = e.target.checked;
    if (id === 'tkSLim') x.stopLimit = c; else if (id === 'tkSplit') { x.split = c; if (c) S.tk.useTP = true; }
    else if (id === 'tkBe') x.be = c; else if (id === 'tkBeTp') x.beOnTp = c;
    else if (id === 'tkSlipOn') S.set.slip = c ? 'sym' : 'off';
    else if (id === 'tkTif') x.tif = e.target.value; else if (id === 'tkOco') x.oco = +e.target.value || 0;
    else return;
    syncTicketInputs();
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-xstep],[data-leg-del],[data-leg-add],[data-fid]'); if (!b) return;
    const x = tkx();
    if (b.dataset.fid) { renderReceipt(+b.dataset.fid); return; }
    if (b.dataset.legAdd != null) { if (x.tps.length < TP_MAX) { const last = x.tps[x.tps.length - 1]; x.tps.push({ pips: (last?.pips || 20) + 20, pct: Math.max(0, 100 - x.tps.reduce((s, r) => s + r.pct, 0)) }); } }
    else if (b.dataset.legDel != null) { if (x.tps.length > 2) x.tps.splice(+b.dataset.legDel, 1); }
    else { const [k, dir] = b.dataset.xstep.split(':'), d = +dir;
      if (k === 'lmtOff') x.lmtOff = +(x.lmtOff + d * .5).toFixed(1);
      if (k === 'gtdMin') x.gtdMin = Math.max(1, x.gtdMin + d * 15); }
    syncTicketInputs();
  });
  tkStepsBuild();
}
// controls follow the state, except the one being typed in
function tkSyncAdv(k) {
  const x = tkx(), t = S.tk, set = (id, v) => { const e = $(id); if (e && document.activeElement !== e && e.value !== String(v)) e.value = v; }, chk = (id, v) => { const e = $(id); if (e) e.checked = v; };
  const pend = t.ot !== 'market';
  $('#tkLmtField').hidden = t.ot !== 'stop'; $('#tkTifField').hidden = !pend;
  chk('#tkSLim', x.stopLimit); set('#tkLmtOff', x.lmtOff); $('#tkLmtOff').disabled = !x.stopLimit;
  $('#tkLmtPx').textContent = k.stopLimit ? `limit @ ${fp(k.sym, k.limit)} — fills only at this price or better once the stop triggers` : 'off: a stop fills at the market once triggered';
  set('#tkTif', x.tif); set('#tkGtd', x.gtdMin); $('#tkGtdWrap').hidden = x.tif !== 'GTD';
  $('#tkTifHint').textContent = k.expires != null ? `until ${dts(k.expires)} UTC (simulation time, in ${fmtIn(Math.max(0, k.expires - Engine.simTime))})` : 'until you cancel it';
  const peers = S.orders.filter(o => o.sym === k.sym);
  $('#tkOcoRow').hidden = !pend || !peers.length;
  const opts = `<option value="0">— none —</option>` + peers.map(o => `<option value="${o.id}">#${o.id} ${escHtml(o.side)} ${escHtml(ordType(o))} @ ${fp(o.sym, o.price)}${o.oca ? ' (OCO)' : ''}</option>`).join('');
  const oc = $('#tkOco'); if (oc._h !== opts) { oc.innerHTML = opts; oc._h = opts; }
  if (!peers.some(o => o.id === x.oco)) x.oco = 0; set('#tkOco', x.oco);
  chk('#tkSplit', t.useTP && x.split); $('#tkSplitField').hidden = !(t.useTP && x.split);
  const legs = $('#tkLegs');
  if (t.useTP && x.split) {
    const rows = x.tps.map((r, i) => { const l = k.tps && k.tps[i]; return `<div style="${TK_CSS_ROW}"><span class="small mono">TP${i + 1}</span><input data-leg="${i}" data-k="pips" type="number" min="0" step="1" style="${TK_IN}" aria-label="TP${i + 1} ${unitWord(k.sym)}"><input data-leg="${i}" data-k="pct" type="number" min="0" max="100" step="5" style="${TK_IN}" aria-label="TP${i + 1} percent of size"><span class="small">%</span><span class="hint mono">${l ? `${lotsWord(k.sym, l.lots)} @ ${fp(k.sym, l.price)}` : ''}</span>${x.tps.length > 2 ? `<button type="button" class="ghost" data-leg-del="${i}" aria-label="Remove TP${i + 1}">✕</button>` : ''}</div>`; }).join('')
      + (x.tps.length < TP_MAX ? `<div><button type="button" class="link" data-leg-add="1">+ Add target</button></div>` : '');
    const key = x.tps.length + ':' + rows.replace(/<span class="hint mono">[^<]*<\/span>/g, '');
    if (legs._k !== key || !legs.children.length) { legs.innerHTML = rows; legs._k = key; }
    else [...legs.querySelectorAll('.hint')].forEach((h, i) => { const l = k.tps && k.tps[i]; h.textContent = l ? `${lotsWord(k.sym, l.lots)} @ ${fp(k.sym, l.price)}` : ''; });
    legs.querySelectorAll('input[data-leg]').forEach(inp => { const r = x.tps[+inp.dataset.leg]; if (r && document.activeElement !== inp) inp.value = r[inp.dataset.k]; });
    const tot = x.tps.reduce((s, r) => s + r.pct, 0);
    $('#tkLegsHint').textContent = k.tpErr ? k.tpErr : tot < 100 ? `${100 - tot}% has no target and runs on the stop` : 'targets cover the whole size; nearest first';
  } else { legs.innerHTML = ''; legs._k = ''; $('#tkLegsHint').textContent = ''; }
  chk('#tkBe', x.be); set('#tkBeAt', x.beAt); set('#tkBeOff', x.beOff); chk('#tkBeTp', x.beOnTp);
  const c = execCfg(); chk('#tkSlipOn', c.on); set('#tkSlipSd', c.sd); set('#tkLat', c.lat); set('#tkComm', c.comm);
}
function tkRenderAdv(k) {
  tkSyncAdv(k);
  const w = tkWhatIf(k), lv = v => isFinite(v) ? nf0.format(v) + '%' : '—', pend = k.ot !== 'market';
  const un = unitWord(k.sym), so = w.so.hedged ? 'hedged on this instrument' : w.so.pips <= 0 ? 'at stop-out' : `${nf0.format(w.so.pips)} ${un} · ${w.so.pct.toFixed(1)}% ${w.so.dir} on ${pretty(k.sym)}`;
  const sum = `level ${lv(w.post.level)} · stop-out ${w.so.hedged ? 'hedged' : nf0.format(w.so.pips) + ' ' + un}`;
  const ws = $('#tkWiSum'); if (ws.textContent !== sum) ws.textContent = sum;
  const sw = swapPerNight(k.sym, k.side, k.lots), c = execCfg();
  const cs = 'style="white-space:normal;padding:2px 3px;overflow-wrap:anywhere"', row = (a, b, cc, d) => `<tr><th scope="row" ${cs}>${a}</th><td ${cs}>${b}</td><td ${cs}>${cc}</td><td ${cs}>${d}</td></tr>`;
  const html = `${pend ? `<div class="small muted">Post-trade at ${fp(k.sym, k.entry)}, other prices unchanged</div>` : ''}<table class="tbl sm" style="width:100%;table-layout:fixed;margin-top:4px;font-size:var(--fs-2xs)"><thead><tr><th ${cs}></th><th ${cs}>Current</th><th ${cs}>Change</th><th ${cs}>Post-trade</th></tr></thead><tbody>
    ${row('Equity', usdFmt(w.cur.eq), usdFmt(w.chg.eq, true), usdFmt(w.post.eq))}
    ${row('Margin used', usdFmt(w.cur.mg), usdFmt(w.chg.mg, true), usdFmt(w.post.mg))}
    ${w.nPend ? row(`<span class="muted">incl. ${w.nPend} pending</span>`, '—', '—', usdFmt(w.pend)) : ''}
    ${row('Free margin', usdFmt(w.cur.free), usdFmt(w.post.free - w.cur.free, true), usdFmt(w.post.free))}
    ${row('Margin level', lv(w.cur.level), '', lv(w.post.level))}</tbody></table>
    <dl class="stats"><dt>Stop-out (50%)</dt><dd title="First order: if only ${pretty(k.sym)} moves, margin held constant">${so}</dd>
    <dt>Swap per night</dt><dd>${usdFmt(sw, true)}</dd><dt>Commission</dt><dd>${c.comm > 0 ? `${usdFmt(k.comm)} round turn` : 'none (spread-only account)'}</dd>
    <dt>Spread cost</dt><dd>${usdFmt(k.spreadCost)}</dd></dl>
    <p class="small muted">Fills are all-or-nothing at the quote (no partial fills). Slippage: ${escHtml(execModelText(c))}. Commission: ${escHtml(commText(c))}. DAY and GTD expiry use simulation UTC.</p>
    <p class="small muted">Post-trade margin is gross per position and counts every pending order as if it filled. Change in equity is the cost at the fill: the spread${c.comm > 0 ? ' and the commission' : ''}. Risk is measured at the stop price; a gap can fill a stop worse.</p>`;
  const body = $('#tkWiBody'); if (body._h !== html) { body.innerHTML = html; body._h = html; }
  const note = `All-or-nothing fills · ${c.on ? `symmetric slippage σ ${c.sd} pip` : 'slippage off'} · ${c.comm > 0 ? `$${c.comm.toFixed(2)}/lot` : 'no commission'}`;
  const full = `Fills are all-or-nothing at the quote (no partial fills). Slippage: ${execModelText(c)}. Commission: ${commText(c)}. DAY and GTD expiry use simulation UTC. Settings: More → Execution.`;
  const en = $('#tkExecNote'); if (en.textContent !== note) { en.textContent = note; en.title = full; }
  const lf = $('#tkLastFill'), f = S.fills && S.fills[0];
  lf.hidden = !f;
  if (f) { const h = `Last fill: ${f.side === 'buy' ? 'bought' : 'sold'} ${M(f.sym) ? tkLotsText(f.sym, f.lots) : f.lots.toFixed(2)} ${pretty(f.sym)} @ ${fp(f.sym, f.px)} · slip ${slipWords(f.slip, f.sym)} <button type="button" class="link" data-fid="${f.fid}">Receipt</button>`; if (lf._h !== h) { lf.innerHTML = h; lf._h = h; } }
}

/* ============ fill receipt ============ */
const simClock = t => new Date(t * 1000).toISOString().slice(11, 19) + ' UTC';
function renderReceipt(fid) {
  const f = (S.fills || []).find(x => x.fid === fid);
  if (!f) { toast('Receipt not found', 'Only the last 500 fills are kept.', 'info'); return; }
  let el = $('#fillDlg');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'fillDlg'; document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-fid]'); if (b) { renderReceipt(+b.dataset.fid); return; } if (e.target === el || e.target.closest('[data-cf]')) el.hidden = true; });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; } });
  }
  const sym = f.sym, side = f.side === 'buy' ? 'Buy' : 'Sell', mdl = f.model || {};
  const what = f.kind === 'open' ? `opened position #${f.pos}` : f.kind === 'reduce' ? `reduced position #${f.pos}` : `closed position #${f.pos}`;
  const open = f.kind !== 'open' ? (S.fills || []).find(x => x.pos === f.pos && x.kind === 'open') : null;
  const rows = [
    ['Quote at the fill', `${fp(sym, f.bid)} / ${fp(sym, f.ask)} · ${simClock(f.t)} sim`],
    ['Requested', `${fp(sym, f.ref)} (${f.refKind || 'quote'})`],
    ['Filled', `${fp(sym, f.px)} · ${M(sym) ? lotsWord(sym, f.lots) : f.lots.toFixed(2) + ' lots'}, all-or-nothing (no partial fills)`],
    ['Slippage', `${slipWords(f.slip, sym)}${Math.abs(f.slip) >= .05 ? ` · ${usdFmt(Math.abs(f.slipUsd || 0))}` : ''}`],
    ['Spread at fill', `${(+f.spread).toFixed(1)} ${unitWord(sym, true)} · ${usdFmt(f.spreadUsd || 0)}`],
    ['Latency', mdl.live ? `${f.lat} ms (simulated)` : '0 ms (simulation paused, replay, or slippage off)'],
    ['Commission', f.kind === 'open' ? (f.comm > 0 ? `${usdFmt(f.comm)} (round turn, paid at this fill)` : 'none (spread-only account)') : 'none at the close (round turn paid at the opening fill)'],
    ['Gap', f.gap ? 'yes — the quote jumped past the order price between two checks' : 'no'],
    ['Model', mdl.on ? `symmetric slippage, σ ${mdl.sd} pip + market move over ${mdl.lat} ms latency; equal odds for and against you${mdl.live ? '' : ' (none while paused or in a replay)'}` : 'slippage off — fills at the quote']
  ];
  el.innerHTML = `<div class="modal cf-modal" role="dialog" aria-modal="true" aria-labelledby="fdT" aria-describedby="fdB">
    <div class="ph"><h2 id="fdT">Fill receipt · #F${f.fid}</h2></div>
    <p class="cf-body" id="fdB">${escHtml(`${side} ${M(sym) ? tkLotsText(sym, f.lots) : f.lots.toFixed(2)} ${pretty(sym)} · ${f.reason || ''} · ${what}`)}</p>
    <dl class="stats" style="padding:0 12px">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${escHtml(b)}</dd>`).join('')}</dl>
    <div class="cf-actions">${open ? `<button class="ghost" data-fid="${open.fid}">Opening fill #F${open.fid}</button>` : ''}<button class="cta sm" data-cf="cancel">Close</button></div></div>`;
  el.hidden = false; el.querySelector('[data-cf=cancel]').focus();
}

/* ============ command bar ============ */
const TF_ALIAS = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '60': 60, '4h': 240, '240': 240, '1': 1, '5': 5, '15': 15, 'h1': 60, 'h4': 240, 'm1': 1, 'm5': 5, 'm15': 15 };
/* Any instrument in META, by its symbol (eurusd, eur/usd, us.500, aapl.us) or an alias: the symbol without its dots
   (us500, de30, brkbus) and a stock's ticker without the exchange suffix (aapl, brk.b) when no other instrument has
   that root and it is no command word. One the profile does not offer is found and then blocked by the caller. */
const CMD_WORDS = new Set(['buy', 'sell', 'long', 'short', 'sl', 'tp', 'limit', 'stop', 'at', 'risk', 'trail', 'lmt', 'gtd', 'gtc', 'oco', 'be', 'day', 'close', 'flatten', 'all',
  'winners', 'losers', 'profit', 'loss', 'green', 'red', 'alert', 'above', 'below', 'tf', 'speed', 'lev', 'leverage', 'theme', 'dark', 'light', 'brief', 'bt', 'test', 'trend', 'fib',
  'channel', 'ray', 'layout', 'grid', 'measure', 'export', 'journal', 'stats', 'coach', 'receipt', 'fill', 'fills', 'breakeven']);
let symAlias = null;
function findSym(tok) {
  if (!tok) return null;
  const s = String(tok).toUpperCase().replace('/', '');
  if (Engine.META[s]) return s;
  if (!symAlias) {
    const a = {}, roots = {};
    for (const m of Engine.INSTR) {
      if (m.sym.includes('.') && !Engine.META[m.sym.replace(/\./g, '')]) a[m.sym.replace(/\./g, '')] = m.sym;
      if (m.group === 'stock') { const r = m.sym.replace(/\.[A-Z]+$/, ''); if (r !== m.sym) (roots[r] = roots[r] || []).push(m.sym); }
    }
    // a root shared with another instrument's root (DE.US and DE.30 both read 'DE') is ambiguous: no alias
    const allRoots = {}; for (const m of Engine.INSTR) { const r = m.sym.split('.')[0]; allRoots[r] = (allRoots[r] || 0) + 1; }
    for (const [r, l] of Object.entries(roots)) if (l.length === 1 && !Engine.META[r] && !a[r] && !CMD_WORDS.has(r.toLowerCase()) && (allRoots[r.split('.')[0]] || 0) <= 1) a[r] = l[0];
    symAlias = a;
  }
  return symAlias[s] || null;
}
function parseCmd(raw) {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' '); if (!s) return null;
  const tk = s.split(' ');
  const num = k => { const i = tk.indexOf(k); return i >= 0 && tk[i + 1] != null ? parseFloat(tk[i + 1]) : null; };
  if (/^(buy|sell|long|short)\b/.test(s)) {
    const side = /^(buy|long)/.test(s) ? 'buy' : 'sell';
    const sym = tk.map(findSym).find(Boolean) || S.set.sym, m = M(sym), [mn, , st] = volOf(sym);
    const KEYS = ['sl', 'tp', 'limit', 'stop', 'at', 'risk', 'trail', 'lmt', 'gtd', 'oco', 'be'];
    const lotTok = tk.slice(1).find((t, i) => /^\d*\.?\d+$/.test(t) && !KEYS.includes(tk[i]));
    const riskV = num('risk'); const lim = num('limit'), stp = num('stop'), at = num('at');
    const sl = num('sl'), trail = num('trail'), lmt = num('lmt'), oco = num('oco'), beAt = num('be');
    // tp 40 · tp 20,40 (equal shares) · tp 20:30,40:70 (pips:percent)
    const tpRaw = tk[tk.indexOf('tp') + 1], tpI = tk.indexOf('tp');
    const tpRows = tpI >= 0 && tpRaw && tpRaw.includes(',') ? tpRaw.split(',').map((x, i, all) => { const [pp, pc] = x.split(':'); return { pips: parseFloat(pp), pct: pc != null ? parseFloat(pc) : Math.round(100 / all.length * 100) / 100 }; }) : null;
    if (tpRows && !tpRows.some(r => r.pct !== tpRows[0].pct) && tpRows.reduce((x, r) => x + r.pct, 0) < 100) tpRows[tpRows.length - 1].pct = +(100 - tpRows.slice(0, -1).reduce((x, r) => x + r.pct, 0)).toFixed(2);
    const tp = tpRows ? null : num('tp');
    // time in force: gtc (default) · day · gtd 30m / 2h / 1d
    const gi = tk.indexOf('gtd'), gm = gi >= 0 ? /^(\d*\.?\d+)(m|h|d)$/.exec(tk[gi + 1] || '') : null, gtdS = gm ? parseFloat(gm[1]) * { m: 60, h: 3600, d: 86400 }[gm[2]] : null;
    const tif = gi >= 0 ? 'GTD' : tk.includes('day') ? 'DAY' : 'GTC';
    const ot = lim ? 'limit' : stp ? 'stop' : at ? (side === 'buy' ? (at < Engine.quote(sym).ask ? 'limit' : 'stop') : (at > Engine.quote(sym).bid ? 'limit' : 'stop')) : 'market';
    const price = lim || stp || at || null, stopLimit = ot === 'stop' && lmt != null;
    // sizes on the sheet's step (2.4 shares are 2); a size under the minimum stays as it is, so the block says so
    let lots = lotTok ? normLots(sym, parseFloat(lotTok)) : null, block = unavailableNote(sym) || marketWhy(sym);
    const u = m.unit === 'pt' ? 'pt' : 'p';
    const a = account(), pv1 = pipValue(sym, 1), slEff = sl || (trail && !sl ? trail : null);
    if (riskV && slEff) {
      lots = +(Math.floor(a.eq * riskV / 100 / (slEff * pv1) / st + 1e-9) * st).toFixed(lotDec(sym));
      if (!(lots >= mn - 1e-9)) { const r1 = slEff * pv1 * mn; block = block || `Minimum size ${lotsWord(sym, mn)} risks ${usdFmt(r1)} (${pct(r1 / a.eq * 100, 2, false)}) — above your ${riskV}%`; lots = 0; }
    }
    if (lots == null) lots = tkLotsFor(sym, S.tk.sm === 'lots' ? S.tk.lots : 1);
    const desc = `${side === 'buy' ? 'Buy' : 'Sell'} ${tkLotsText(sym, lots)} ${pretty(sym)}${ot !== 'market' ? ` ${stopLimit ? 'stop-limit' : ot} @ ${fp(sym, price)}${stopLimit ? ' → ' + fp(sym, lmt) : ''}` : ' at market'}${sl ? ` · SL ${sl}${u}` : ''}${tpRows ? ` · TP ${tpRows.map(r => `${r.pips}${u} ${r.pct}%`).join(' · ')}` : tp ? ` · TP ${tp}${u}` : ''}${trail ? ` · trail ${trail}${u}${sl ? '' : ' (the stop)'}` : ''}${beAt ? ` · BE after ${beAt}${u}` : ''}${ot !== 'market' && tif !== 'GTC' ? ` · ${tif}${gtdS ? ' ' + tk[gi + 1] : ''} (simulation UTC)` : ''}${oco ? ` · OCO with #${oco}` : ''}`;
    const margin = notionalUsd(sym, lots) / effLev(sym), riskUsd = slEff ? slEff * pv1 * lots : null;
    if (!block && !(lots >= mn - 1e-9)) block = volWhy(sym, lots);
    if (!block) block = orderCaps(sym, lots);
    if (!block && ot === 'market' && margin > a.free) block = `Insufficient margin — needs ${usdFmt(margin)} · free ${usdFmt(a.free)}`;
    if (!block && riskUsd != null && a.eq > 0 && riskUsd > a.eq * RISK_CAP / 100) block = `Risk ${pct(riskUsd / a.eq * 100, 1, false)} of equity — above the ${RISK_CAP}% per-trade cap`;
    if (!block && tpRows) { const q = Engine.quote(sym), b = buildTps(sym, side, price || (side === 'buy' ? q.ask : q.bid), lots, tpRows); if (b.err) block = b.err; }
    if (!block && gi >= 0 && !(gtdS >= 60)) block = 'GTD needs a duration of at least one minute, e.g. gtd 30m, gtd 2h, gtd 1d';
    if (!block && lmt != null && !stopLimit) block = 'lmt (stop-limit) goes with a stop price: buy eurusd stop 1.0900 lmt 1.0905';
    if (!block && (tif !== 'GTC' || oco) && ot === 'market') block = 'Time in force and OCO apply to limit and stop orders';
    const detail = `Margin ${usdFmt(margin)} · risk ${riskUsd != null ? `${usdFmt(riskUsd)} (${pct(riskUsd / a.eq * 100, 2, false)})` : 'unlimited — no stop'}`;
    const be = beAt ? { at: beAt, off: 0, onTp: false } : undefined;
    return { desc, detail, block, confirm: true, run: () => {
      if (ot === 'market') { const q = Engine.quote(sym), d = side === 'buy' ? 1 : -1, e = d > 0 ? q.ask : q.bid; openPosition({ sym, side, lots, sl: sl ? e - d * sl * m.pip : null, tp: tp ? e + d * tp * m.pip : null, tps: tpRows || undefined, be, trail: trail || 0 }); }
      else placeOrder({ sym, side, ot, price, limit: stopLimit ? lmt : null, lots, slPips: sl || 0, tpPips: tp || 0, tps: tpRows || undefined, be, trail: trail || 0, tif, expires: tif === 'GTD' ? Engine.simTime + gtdS : null, oca: oco || null });
      if (sym !== S.set.sym) setSymbol(sym);
    } };
  }
  if (tk[0] === 'receipt' || tk[0] === 'fills' || tk[0] === 'fill') {
    const f = S.fills && S.fills[0];
    return f ? { desc: `Fill receipt #F${f.fid}`, detail: `${f.side} ${f.lots.toFixed(2)} ${pretty(f.sym)} @ ${fp(f.sym, f.px)}`, run: () => renderReceipt(f.fid) } : { desc: 'Fill receipt', block: 'No fills yet', blockTitle: 'Nothing to show', run: () => {} };
  }
  if (tk[0] === 'close' || tk[0] === 'flatten') {
    const sym = findSym(tk[1]);
    // mass closes preview what they will close and ask for a second Enter
    const mass = (desc, fn) => { const ps = S.positions.filter(fn), pl = ps.reduce((x, p) => x + posPnl(p).pnl, 0);
      return { desc, detail: `${ps.length} position${ps.length > 1 ? 's' : ''} · floating ${usdFmt(pl, true)}`, confirm: true, block: ps.length ? '' : 'No matching open positions', blockTitle: 'Nothing to close', run: () => closeWhere(fn) }; };
    if (tk[1] === 'all' || tk[0] === 'flatten' || !tk[1]) return mass(`Close all ${S.positions.length} positions`, () => true);
    if (/^(winners|profit|green)/.test(tk[1])) return mass('Close all profitable positions', p => posPnl(p).pnl > 0);
    if (/^(losers|loss|red)/.test(tk[1])) return mass('Close all losing positions', p => posPnl(p).pnl < 0);
    if (sym) return mass(`Close all ${pretty(sym)} positions`, p => p.sym === sym);
  }
  // the same rule as the BE button (manualBe, app.js): only where the price is past the entry, and never loosening a stop
  if (tk[0] === 'be' || tk[0] === 'breakeven') return { desc: 'Move stops to break-even where price is past entry (never loosens a stop)', run: () => {
    const c = { '': 0, at: 0, tighter: 0, early: 0 }; [...S.positions].forEach(p => c[manualBe(p)]++);
    toast('Break-even', `${c['']} moved · ${c.at + c.tighter} already tighter · ${c.early} not past entry`, 'info');
  } };
  if (tk[0] === 'alert') {
    const sym = findSym(tk[1]) || S.set.sym; const cond = tk.includes('below') ? 'below' : tk.includes('above') ? 'above' : null;
    const px = parseFloat(tk.filter(t => /^\d*\.?\d+$/.test(t)).pop());
    if (px && !isAvailable(sym)) return { desc: `Alert on ${pretty(sym)}`, block: unavailableNote(sym), blockTitle: 'Not offered', run: () => {} };
    if (px) return { desc: `Alert when ${pretty(sym)} ${cond || (px >= Engine.quote(sym).mid ? 'above' : 'below')} ${fp(sym, px)}`, run: () => addAlert(sym, px, cond) };
  }
  if (tk[0] === 'tf' || TF_ALIAS[tk[0]] && tk.length === 1 && isNaN(+tk[0]) ) { const v = TF_ALIAS[tk[tk[0] === 'tf' ? 1 : 0]]; if (v) return { desc: `Timeframe ${v >= 60 ? v / 60 + 'H' : v + 'm'}`, run: () => setTF(v) }; }
  if (tk[0] === 'speed') { const v = parseInt(tk[1]); if ([1, 10, 60, 300].includes(v)) return { desc: `Simulation speed ${v}×`, run: () => setSpeed(v) }; }
  /* lev default · lev 200 (a choice, never above an instrument's sheet maximum) · lev eu / lev none (the optional
     jurisdiction cap). Under a retail cap the leverage is the regime's own: another choice is refused with the rule. */
  if (tk[0] === 'lev' || tk[0] === 'leverage') {
    const a = (tk[1] || '').replace('1:', ''), v = parseInt(a), j = jurOf(S.set), named = Object.prototype.hasOwnProperty.call(JUR, a) && JUR_KEYS.includes(a);
    const jk = j.none ? 'none' : S.set.jur;
    if (named) { const nj = JUR[a]; return { desc: `Jurisdiction cap: ${nj.name}`, detail: capText(nj), run: () => requestProfile(nj.choice ? `${a}:${S.set.lev > 0 ? S.set.lev : 'default'}` : a) }; }
    if (a === 'default' || a === 'sheet') {
      if (!j.choice) { const d = `${j.name} sets the leverage`; return { desc: 'Leverage: sheet default', block: `${d}: ${capText(j)}. Set the jurisdiction cap to None (Settings) to use the sheet leverage.`, blockTitle: 'Leverage capped', run: () => {} }; }
      return { desc: 'Leverage: sheet default (each instrument at its sheet leverage)', run: () => requestProfile(`${jk}:default`) };
    }
    if (LEV_CHOICES.includes(v)) {
      if (j.choice) return { desc: `Leverage 1:${v} where the sheet allows it`, detail: 'Never above an instrument\'s sheet maximum', run: () => requestProfile(`${jk}:${v}`) };
      // asking for the cap the profile already applies is a no-op, not an error
      if (v === j.cap['fx-major']) { const d = `Already at the 1:${v} cap for majors under ${j.name}`; return { desc: d, detail: capText(j), run: () => toast(d, `${j.name}: ${capText(j)}. Set the jurisdiction cap to None (Settings) for another leverage.`, 'info') }; }
      return { desc: `Leverage 1:${v}`, block: `${j.name} caps leverage at ${capText(j)}. Set the jurisdiction cap to None (Settings) for another leverage.`, blockTitle: 'Leverage capped', run: () => {} };
    }
  }
  if (tk[0] === 'theme' || tk[0] === 'dark' || tk[0] === 'light') return { desc: 'Toggle theme', run: () => { S.set.theme = tk[0] === 'dark' || tk[0] === 'light' ? tk[0] : S.set.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); } };
  if (/^(stress|lab|montecarlo|risk)/.test(tk[0])) return { desc: 'Open Risk Lab', run: () => setTab('lab') };
  if (tk[0] === 'brief' || tk[0] === 'analysis' || tk[0] === 'analyze' || tk[0] === 'analyse') { const bs = findSym(tk[1]) || S.set.sym; return { desc: `Market brief for ${pretty(bs)}`, run: () => { if (bs !== S.set.sym) setSymbol(bs); openBrief(bs); } }; }
  if (/^(backtest|bt|test)$/.test(tk[0])) { const bs = findSym(tk[1]); return { desc: `Open backtester${bs ? ' on ' + pretty(bs) : ''}`, run: () => loadLazy().then(() => { if (bs) { btCfg().sym = bs; setSymbol(bs); BT.res = null; $('#btCfg').innerHTML = ''; } setTab('bt'); }) }; }
  if (tk[0] === 'trend' || tk[0] === 'trendline' || tk[0] === 'fib' || tk[0] === 'fibonacci' || tk[0] === 'channel' || tk[0] === 'ray') { const t = { trendline: 'trend', fibonacci: 'fib' }[tk[0]] || tk[0]; return { desc: `Draw: ${DRAW_TOOLS[t].name}`, run: () => setTool(t) }; }
  if ((tk[0] === 'layout' || tk[0] === 'grid') && tk[1]) { const l = { single: '1', one: '1', two: '2h', three: '3', four: '4', '2': '2h', '2x2': '4' }[tk[1]] || tk[1]; if (MC_LAYOUTS[l]) return { desc: `Layout: ${MC_LAYOUTS[l].name}`, run: () => setLayout(l) }; }
  if (tk[0] === 'measure') return { desc: 'Measure tool', run: () => setTool('measure') };
  if (tk[0] === 'export') return { desc: 'Export account to a file', run: () => exportAccount() };
  if (/^(journal|stats|coach)/.test(tk[0])) return { desc: 'Open journal & analytics', run: () => setTab('journal') };
  const sym = findSym(tk[0]);
  if (sym && !isAvailable(sym)) return { desc: `Open ${pretty(sym)} chart`, block: unavailableNote(sym), blockTitle: 'Not offered', run: () => {} };
  if (sym) return { desc: `Open ${pretty(sym)} chart`, run: () => setSymbol(sym) };
  return null;
}
const CMD_EX = ['backtest audusd', 'brief gbpjpy', 'buy 1 eurusd sl 20 tp 40', 'buy 1 us.500 sl 2000', 'buy 10 aapl sl 300', 'buy 1 eurusd sl 20 tp 20,40', 'sell eurusd stop 1.0800 lmt 1.0795 gtd 2h', 'sell gbpjpy risk 1 sl 30 tp 60', 'buy audusd limit 0.6880 sl 15 tp 30', 'close losers', 'be', 'receipt', 'alert usdjpy above 159', 'tf 1h', 'speed 60', 'eurgbp', 'stress test'];
let cmdSel = 0, cmdArm = null; // cmdArm: the command text armed by a first Enter, waiting for the second
const cmdKey = v => v.trim().toLowerCase().replace(/\s+/g, ' ');
function renderCmd() {
  const v = $('#cmdInput').value, p = parseCmd(v), armed = p && p.confirm && !p.block && cmdArm === cmdKey(v);
  const items = p ? [p.block ? { t: p.desc, d: p.block, k: 'blocked', cls: 'blk' } : armed ? { t: 'Confirm: ' + p.desc, d: p.detail, k: 'Enter again', ok: true, cls: 'arm', btn: true } : { t: p.desc, d: p.detail, k: p.confirm ? 'Enter to review' : 'Enter', ok: true }]
    : (v ? [{ t: 'Not recognised — try one of these:', k: '' }] : []).concat(CMD_EX.filter(x => !v || x.includes(v.toLowerCase().split(' ')[0])).map(x => ({ t: x, k: 'example', fill: x })));
  $('#cmdList').innerHTML = items.map((it, i) => `<div class="cmd-item ${i === cmdSel ? 'on' : ''} ${it.cls || ''}" data-fill="${escHtml(it.fill || '')}"><span class="${it.ok ? 'ok' : ''}">${escHtml(it.t)}${it.d ? `<em class="cmd-d">${escHtml(it.d)}</em>` : ''}</span>${it.btn ? '<button type="button" class="cta sm cmd-ok">Confirm</button>' : ''}<small>${it.k}</small></div>`).join('');
}
function openCmd() { document.activeElement?.blur?.(); $('#cmd').hidden = false; $('#cmdInput').value = ''; cmdSel = -1; cmdArm = null; renderCmd(); $('#cmdInput').focus(); }
function closeCmd() { $('#cmd').hidden = true; }

// trades, orders and mass closes run on the second Enter (or Confirm); blocked ones never run
function execCmd() {
  const v = $('#cmdInput').value, p = parseCmd(v); if (!p) { toast('Command not recognised', v, 'dn'); return; }
  if (p.block) { toast(p.blockTitle || 'Order blocked', p.block, 'dn'); beep('err'); return; }
  if (p.confirm && cmdArm !== cmdKey(v)) { cmdArm = cmdKey(v); cmdSel = -1; renderCmd(); $('#cmdInput').focus(); return; }
  cmdArm = null; closeCmd(); p.run();
}


/* ============ ticket E: step by step (canvas artboard 11) ============
   The ticket starts as two buttons, Buy and Sell. A side opens the steps, one at a time: Volume, Stop loss, Take profit,
   Manage, Entry, Check, Account after. Every block of the ticket moves into its step (nothing removed); a closed step
   is one row with its value, and the order button stays at the foot with the order written on it, so it can be sent
   from any step. TKS is display state only: the order is S.tk as before, with its defaults, so a step not opened
   still shows (and sends) the value it holds. */
const TK_MODE_KEY = 'meridian-ticket-mode';
const tkModeLoad = () => { try { return localStorage.getItem(TK_MODE_KEY) === 'pro' ? 'pro' : 'guided'; } catch (e) { return 'guided'; } };
const TKS = { started: false, step: 0, max: 0, sent: null, sig: null, mode: tkModeLoad() };
const TK_STEPS = [
  ['vol', 'Volume', 'How much?'], ['sl', 'Stop loss', 'Where do you get out with a loss?'], ['tp', 'Take profit', 'Where do you take the profit?'],
  ['mng', 'Manage', 'Trailing stop and break-even.'], ['entry', 'Entry', 'Now, or wait for a price?'], ['check', 'Check', 'Read before you send.'], ['after', 'Account after', 'The account once it fills.']
];
function tkStepGo(i) { TKS.started = true; TKS.step = clamp(i, 0, TK_STEPS.length - 1); TKS.max = Math.max(TKS.max, TKS.step); renderTicket(); const b = $(`.tk-step[data-i="${TKS.step}"] .tk-body input:not([type=checkbox]):not([disabled])`) || $(`.tk-step[data-i="${TKS.step}"] .tk-head`); if (b && document.activeElement?.closest('.ticket')) b.focus({ preventScroll: true }); $(`.tk-step[data-i="${TKS.step}"]`)?.scrollIntoView({ block: 'nearest' }); }
function tkModeSet(mode, announce = true) {
  TKS.mode = mode === 'pro' ? 'pro' : 'guided';
  document.body.classList.toggle('tk-pro', TKS.mode === 'pro');
  try { localStorage.setItem(TK_MODE_KEY, TKS.mode); } catch (e) { /* private mode: lasts this visit */ }
  $$('#tkMode button').forEach(b => {
    const on = b.dataset.mode === TKS.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  renderTicket();
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    if (typeof reqOverlay === 'function') reqOverlay();
  });
  if (announce && typeof toast === 'function') toast(TKS.mode === 'pro' ? 'Pro workspace' : 'Guided workspace', TKS.mode === 'pro' ? 'Advanced chart tools and all order controls are visible.' : 'A focused workspace and one decision at a time.', 'info');
}
function tkStepsBuild() {
  const tk = $('.ticket .tk3'); if (!tk || $('#tkSteps')) return;
  const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
  const steps = el(`<div class="tk-steps" id="tkSteps">${TK_STEPS.map(([k, t, q], i) => `<section class="tk-step" data-k="${k}" data-i="${i}" aria-label="${t}">
    <div class="tk-spine" aria-hidden="true"><span class="tk-node">${i + 2}</span><span class="tk-line"></span></div>
    <div class="tk-main"><button type="button" class="tk-head" data-go="${i}" aria-expanded="false"><span class="tk-t">${t}</span><span class="tk-q">${q}</span><span class="tk-sumv mono" data-sum-of="${k}"></span></button>
    <div class="tk-body"></div></div></section>`).join('')}</div>`);
  const body = k => steps.querySelector(`[data-k="${k}"] .tk-body`), put = (k, ...nodes) => { for (const n of nodes) if (n) body(k).appendChild(n); };
  // Volume: lots with three quick sizes; margin only (the risk needs a stop)
  const vol = $('#tkVolBlk'), lotsCell = vol.querySelector('.tk3-c[data-k=lots]'), pctCell = vol.querySelector('.tk3-c[data-k=pct]'), usdCell = vol.querySelector('.tk3-c[data-k=usd]');
  const presets = el(`<div class="tk-presets" role="group" aria-label="Quick size"><button type="button" data-lots="0.1">0.10</button><button type="button" data-lots="0.5">0.50</button><button type="button" data-lots="1">1.00</button></div>`);
  const volRow = el(`<div class="tk-volrow"></div>`); volRow.append(presets, lotsCell);
  put('vol', volRow, el(`<div class="tk-kpis" id="tkVolKpi"></div>`), $('#sizeHint'), $('#tkCtr'));
  // Stop loss: the switch, the three linked fields, the risk; sizing from the risk lives here
  const slB = $('#tkSlBlk'), slSw = slB.querySelector('.tk3-h>label'), slRow = slB.querySelector('.tk3-row3');
  const riskRow = el(`<div class="tk-riskrow"><div class="tk-risk-h">Size from risk <span id="tkLimW"></span></div></div>`);
  const riskCells = el(`<div class="tk3-row3 tk-risk2"></div>`); riskCells.append(pctCell, usdCell);
  riskRow.append($('#tkChips'), riskCells);
  put('sl', slSw, slRow, $('#slPx'), $('#tkTip'), el(`<div class="tk-kpis" id="tkSlKpi"></div>`), riskRow);
  // Take profit: the switch, the three fields, reward and R:R, split targets
  const tpB = $('#tkTpBlk'), tpSw = tpB.querySelector('.tk3-h>label'), tpRow = tpB.querySelector('.tk3-row3');
  put('tp', tpSw, tpRow, $('#tpPx'), el(`<div class="tk-kpis" id="tkTpKpi"></div>`), $('#rrBar'), el(`<div class="tk-rows" id="tkTpRows"></div>`), $('#tkSplit')?.closest('.field'), $('#tkSplitField'));
  put('mng', $('#useTrail').closest('.field'), $('#tkBeField'));
  const otBlk = $('#otSeg').parentElement;
  put('entry', $('#otSeg'), $('#tkPend'));
  const math = el(`<details class="tk-math"><summary>Trade math</summary></details>`); math.appendChild($('#tkStats'));
  put('check', $('#tkWarn'), el(`<div class="tk-rows" id="tkChkRows"></div>`), $('#tkExecNote'), $('#tkExecField'), math);
  put('after', $('#tkWhatIf'));
  // the blocks emptied by the move, and the old summary (its figures are in the steps and at the foot)
  for (const x of [$('#tkVolBlk'), slB, tpB, otBlk, $('.tk3-sum')]) if (x) x.hidden = true;
  // the More sections shell.js summarises stay (hidden): their summaries feed the step rows
  const more = $('#tkMore'); if (more) { more.hidden = true; more.insertAdjacentHTML('beforeend', ['acct', 'exits', 'exec', 'math'].map(k => `<details class="tk-sec" data-sec="${k}"><summary><span class="tk-sec-t"></span><span class="tk-sec-s" data-sum="${k}"></span></summary></details>`).join('')); }
  $('#sideSeg').after(steps);
  // the foot: margin, risk, R:R; the order button; next step
  const foot = el(`<div class="tk-foot"><div class="tk-verdict" id="tkVerdict" role="status"><span></span><b></b></div><div class="tk-fm" id="tkFootM"></div><div class="tk-fb"></div><button type="button" class="tk-next" id="tkNext"><span>Next: <b id="tkNextT"></b></span><kbd>Enter ↵</kbd></button></div>`);
  tk.appendChild(foot); const fb = foot.querySelector('.tk-fb');
  fb.append($('#tkSubmit'), $('#tkPmNote'), $('#tkLastFill'));
  foot.appendChild(tk.querySelector('.tk3-keys'));
  tk.insertAdjacentHTML('afterbegin', `<p class="tk-idle-note" id="tkIdleNote">Pick a side. Then size, stop and set a target, one decision at a time. Switch to Pro for advanced chart and order controls.</p>`);
  $('#sideSeg').before($('#tkIdleNote'));
  const ph = $('.ticket>.ph');
  if (ph && !$('#tkMode')) ph.insertAdjacentHTML('beforeend', `<div class="tk-mode" id="tkMode" role="group" aria-label="Trading experience"><button type="button" data-mode="guided" title="Focused workspace with step-by-step orders">Guided</button><button type="button" data-mode="pro" title="All chart and order controls">Pro</button></div>`);
  if (ph && !$('#tkClear')) ph.insertAdjacentHTML('beforeend', `<button type="button" class="tk-clear" id="tkClear" title="Back to Buy / Sell (the values stay)">Clear</button>`);
  // events: a side starts the steps (the Buy / Sell handler of app.js sets the side first)
  $('#sideSeg').addEventListener('click', e => { if (e.target.closest('button[data-side]') && !TKS.started) tkStepGo(0); });
  steps.addEventListener('click', e => { const h = e.target.closest('[data-go]'); if (h) tkStepGo(+h.dataset.go); });
  presets.addEventListener('click', e => { const b = e.target.closest('[data-lots]'); if (!b) return; S.tk.sm = 'lots'; S.tk.lots = tkLotsFor(S.set.sym, +b.dataset.lots); syncTicketInputs(); });
  $('#tkNext').addEventListener('click', () => tkStepGo(TKS.step + 1));
  $('#tkClear').addEventListener('click', () => { Object.assign(TKS, { started: false, step: 0, max: 0, sent: null }); renderTicket(); });
  $('#tkMode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) tkModeSet(b.dataset.mode); });
  steps.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.tk-body input:not([type=checkbox])')) { e.preventDefault(); e.target.blur(); tkStepGo(TKS.step + 1); } });
  tkModeSet(TKS.mode, false);
}
function tkStepsRender(k) {
  const steps = $('#tkSteps'); if (!steps) return;
  const t = S.tk, sym = k.sym, un = unitWord(sym), tk = $('.ticket');
  const cnt = S.positions.length + S.orders.length;
  if (TKS.sent != null && cnt > TKS.sent) Object.assign(TKS, { started: false, step: 0, max: 0, sent: null });
  // an order loaded from elsewhere while the ticket shows Buy / Sell (a Depth level, the Lab, a brief, an idea) opens
  // the steps, on Entry when it is pending, so the order the button sends is the one on screen
  const sig = `${t.side}|${t.ot}|${t.price}`;
  if (!TKS.started && TKS.sig != null && sig !== TKS.sig) Object.assign(TKS, { started: true, step: t.ot === 'market' ? 0 : 4, max: Math.max(TKS.max, t.ot === 'market' ? 0 : 4) });
  TKS.sig = sig;
  const guided = TKS.mode !== 'pro', started = TKS.started || !guided, idle = guided && !started;
  document.body.classList.toggle('tk-pro', !guided);
  document.body.classList.toggle('intent-order', guided && TKS.started);
  document.body.classList.toggle('has-positions', S.positions.length > 0);
  if (tk._idle !== idle) { tk.classList.toggle('tk-idle', idle); tk._idle = idle; }
  const lv = v => isFinite(v) ? nf0.format(v) + '%' : '—', eq = k.a.eq, rp = k.riskUsd != null && eq > 0 ? k.riskUsd / eq * 100 : null, rr = k.riskUsd && k.rewUsd ? k.rewUsd / k.riskUsd : null;
  const wi = tkWhatIf(k), lim = tkLimit(), rpCls = rp == null ? 'muted' : rp > RISK_CAP ? 'dn' : rp > lim.v ? 'warn' : '';
  const warnTxt = $('#tkWarn .w-head span+span')?.textContent || '';
  const sum = {
    vol: `${tkLotsText(sym, k.lots)} · margin ${usdFmt(k.margin)}`,
    sl: k.slPips != null && !k.trailOnly ? `${fp(sym, k.sl)} · ${+k.slPips.toFixed(1)} ${un} · ${usdFmt(-k.riskUsd)} (${pct(rp, 2, false)})` : k.trailOnly ? `trailing ${t.trail} ${un} · ${usdFmt(-k.riskUsd)}` : 'none',
    tp: k.split ? `${(k.tps || []).length || tkx().tps.length} targets · ${k.rewUsd != null ? usdFmt(k.rewUsd, true) : ''}` : k.tp != null ? `${fp(sym, k.tp)} · ${+t.tp.toFixed(1)} ${un} · 1 : ${rr ? rr.toFixed(2) : '—'}` : 'none',
    mng: [t.useTrail && t.trail > 0 ? `trailing ${t.trail} ${un}` : 'no trailing', tkx().be ? `break-even ${tkx().beAt}` : 'no break-even'].join(' · '),
    entry: t.ot === 'market' ? 'market · now' : `${k.stopLimit ? 'stop-limit' : t.ot} @ ${fp(sym, k.entry)}${k.stopLimit ? ' → ' + fp(sym, k.limit) : ''} · ${k.tif}${tkx().oco ? ' · OCO #' + tkx().oco : ''}`,
    check: warnTxt || '—',
    after: `level ${lv(wi.post.level)} · stop-out ${wi.so.hedged ? 'hedged' : nf0.format(wi.so.pips) + ' ' + un}`
  };
  for (const st of steps.children) {
    const i = +st.dataset.i, cur = guided && started && TKS.step === i, seen = !guided || TKS.max >= i;
    st.classList.toggle('cur', cur); st.classList.toggle('seen', seen && !cur);
    const nd = st.querySelector('.tk-node'), mk = seen && !cur ? '✓' : String(i + 2); if (nd.textContent !== mk) nd.textContent = mk;
    const hd = st.querySelector('.tk-head'); if (hd.getAttribute('aria-expanded') !== String(cur)) hd.setAttribute('aria-expanded', String(cur));
    const sEl = st.querySelector('.tk-sumv'), v = sum[st.dataset.k]; if (sEl.textContent !== v) sEl.textContent = v;
  }
  // the step figures, as cells: label over a large value
  const cell = (l, v, c, sub) => `<div><label>${l}</label><b class="mono ${c || ''}">${v}</b>${sub ? `<small class="mono">${sub}</small>` : ''}</div>`;
  const setH = (id, h) => { const e = $(id); if (e && e._h !== h) { e.innerHTML = h; e._h = h; } };
  setH('#tkVolKpi', cell('Margin', usdFmt(k.margin)) + cell('Equity used', eq > 0 ? pct(k.margin / eq * 100, 2, false) : '—') + cell('Level after', lv(wi.post.level)));
  const atr = tkAtr1h(sym);
  setH('#tkSlKpi', k.riskUsd != null ? cell('You risk', usdFmt(-k.riskUsd), 'dn') + cell('% equity', pct(rp, 2, false), rpCls) + cell('Stop / ATR', atr > 0 && k.slPips ? (k.slPips / atr).toFixed(1) + '×' : '—') : '');
  const od = tkOdds(k);
  setH('#tkTpKpi', k.rewUsd != null ? cell('You make', usdFmt(k.rewUsd, true), 'up') + cell('R : R', rr ? '1 : ' + rr.toFixed(2) : '—', rr != null && rr < 1 ? 'warn' : '') + cell('Break-even', rr ? pct(100 / (1 + rr), 1, false) : '—') : '');
  const row = (a, b) => `<div><span>${a}</span><b class="mono">${b}</b></div>`;
  setH('#tkTpRows', k.rewUsd != null ? row('Target comes first', od ? pct(od.p * 100, 0, false) + ' <span class="muted">random walk</span>' : '—') + row('Typical time to resolve', od && od.mins ? '~' + fmtDur(od.mins) : '—') + row('Of equity', pct(k.rewUsd / eq * 100, 2, false)) : '');
  const sw = swapPerNight(sym, k.side, k.lots), tri = nextTriple(Engine.simTime, sym);
  setH('#tkChkRows', row('Spread cost', usdFmt(k.spreadCost)) + row('Commission', k.comm > 0 ? usdFmt(k.comm) : 'none') + row('Swap a night', usdFmt(sw, true)) + row('Next triple swap', isFinite(tri) ? fmtIn(tri - Engine.simTime) : '—'));
  const lw = $('#tkLimW'); if (lw && lw.textContent !== lim.w) lw.textContent = lim.w;
  for (const b of $$('.tk-presets [data-lots]')) b.classList.toggle('on', t.sm === 'lots' && Math.abs(k.lots - +b.dataset.lots) < 1e-9);
  setH('#tkFootM', cell('Margin', usdFmt(k.margin), '', eq > 0 ? pct(k.margin / eq * 100, 2, false) + ' of equity' : '')
    + cell('Risk', rp != null ? pct(rp, 2, false) : '—', rp != null ? rpCls : 'muted', k.riskUsd != null ? usdFmt(-k.riskUsd) : 'set a stop')
    + cell('R : R', rr ? '1 : ' + rr.toFixed(2) : '—', rr ? '' : 'muted', rr ? 'break-even ' + pct(100 / (1 + rr), 0, false) : 'set a target'));
  const verdict = $('#tkVerdict');
  if (verdict) {
    const v = !t.useSL || k.riskUsd == null ? ['warn', 'Risk undefined', 'Set a protective stop before execution']
      : rp > RISK_CAP ? ['bad', 'Order blocked', `Risk exceeds ${RISK_CAP}% of equity`]
      : rp > lim.v ? ['warn', 'Above profile', `${pct(rp, 2, false)} exceeds your ${pct(lim.v, 2, false)} reference`]
      : rr != null && rr < 1 ? ['warn', 'Weak asymmetry', `Reward is ${rr.toFixed(2)}× the defined risk`]
      : ['good', 'Risk defined', `${pct(rp, 2, false)} of equity · ${rr ? '1 : ' + rr.toFixed(2) + ' R:R' : 'target not set'}`];
    verdict.className = 'tk-verdict ' + v[0]; verdict.querySelector('span').textContent = v[1]; verdict.querySelector('b').textContent = v[2];
  }
  const nx = $('#tkNext'), last = TKS.step >= TK_STEPS.length - 1; if (nx.hidden !== (!guided || !started || last)) nx.hidden = !guided || !started || last; if (!last) { const w = TK_STEPS[TKS.step + 1][1]; if ($('#tkNextT').textContent !== w) $('#tkNextT').textContent = w; }
  const cl = $('#tkClear'); if (cl.hidden !== (!guided || !started)) cl.hidden = !guided || !started;
}
