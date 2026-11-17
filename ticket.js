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
  // the size typed (a size outside the sheet stays as typed, so the order is blocked with its reason: tkLotsRaw)
  let lots = Math.max(0, normLots(sym, tkLotsRaw()) || 0), minRisk = null, capped = false;
  /* risk sizing on the sheet's step: lots stays at least the minimum size (read-only callers such as the DOM ladder
     and chart gestures rely on a non-zero size) and at most the maximum; when even the minimum risks more than asked,
     minRisk is set and tkBlocks stops the ticket */
  if (t.sm === 'risk') {
    const raw = sl != null ? +(Math.floor(a.eq * t.risk / 100 / (slPips * pv) / st + 1e-9) * st).toFixed(lotDec(sym)) : 0;
    lots = sl != null ? Math.min(mx, Math.max(mn, raw)) : 0;
    capped = sl != null && raw > mx + 1e-9; // the risk asked for needs more than the sheet's maximum size
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
  // a pending order on a USD-quoted instrument: the margin at the order's price, as it is taken at the fill (UX-72)
  const lev = effLev(sym), margin = notionalUsd(sym, lots) / lev * (ot !== 'market' && m.quote === 'USD' && entry > 0 && q.mid > 0 ? entry / q.mid : 1);
  const k = { sym, side, ot, d, entry, sl, tp, lots, margin, lev, pv, a, q, m, minRisk, capped, riskUsd: sl != null ? slPips * pv * lots : null, rewUsd, spreadCost: q.spread * pv * lots,
    slPips, trailOnly, tps, tpErr, split, stopLimit, limit, tif, expires, comm: commOf(lots, sym), mn };
  return tkNet(k);
}
/* Netting (trade.js): a market order on the side of an open position adds to it. The ticket then reads the position
   after the fill: total size, size-weighted entry, and the position's own SL/TP (the order brings none). Risk and
   reward are of the whole position; sizing by risk finds the size that brings the whole position to the risk asked
   for (risk is linear in the added size: risk0 + |entry − SL| × size). k.margin stays this order's margin (the free-
   margin check); k.mgShow is the position's margin after the fill; k.net carries the position. */
function tkNet(k) {
  if (k.ot !== 'market' || typeof netAgg !== 'function' || netAgg(k.sym, k.side === 'buy' ? 'sell' : 'buy')) return k;
  const g = netAgg(k.sym, k.side); if (!g) return k;
  const t = S.tk, { d, entry, pv, a, m, mn } = k, [, mx, st] = volOf(k.sym), sl = g.sl, vpp = pv / m.pip;
  const risk0 = sl != null ? Math.max(0, d * (g.entry - sl)) * g.lots * vpp : null, dist = sl != null ? d * (entry - sl) : null;
  let lots = k.lots, minRisk = null, capped = false;
  if (t.sm === 'risk') {
    if (sl == null || !(dist > 0)) lots = 0;
    else {
      const raw = +(Math.floor((a.eq * t.risk / 100 - risk0) / (dist * vpp) / st + 1e-9) * st).toFixed(lotDec(k.sym));
      lots = Math.min(mx, Math.max(mn, raw)); capped = raw > mx + 1e-9;
      if (!(raw >= mn - 1e-9)) minRisk = { usd: risk0 + dist * vpp * mn, pct: (risk0 + dist * vpp * mn) / a.eq * 100 };
    }
  }
  const L = g.lots + lots, avg = (g.entry * g.lots + entry * lots) / (L || 1);
  const riskUsd = sl != null ? Math.max(0, d * (avg - sl)) * L * vpp : null;
  const rewUsd = g.tps ? g.tps.reduce((s, x) => s + d * (x.price - avg) * x.lots * vpp, 0) : g.tp != null ? d * (g.tp - avg) * L * vpp : null;
  const margin = notionalUsd(k.sym, lots) / k.lev;
  return { ...k, lots, margin, mgShow: g.im + margin, minRisk, capped, sl, tp: g.tp, tps: null, split: false, tpErr: '', trailOnly: false,
    slPips: sl != null ? d * (entry - sl) / m.pip : null, riskUsd, rewUsd, spreadCost: k.q.spread * pv * lots, comm: commOf(lots, k.sym),
    net: { id: g.p.id, n: g.n, l0: g.lots, e0: g.entry, lots: L, entry: avg } };
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
  // a stop past zero (a distance larger than the price) cannot be placed
  if (k.sl != null && !(k.sl > 0)) { const x = `Stop loss below zero: ${nf0.format(k.slPips)} ${un} is more than the price`; b.push({ btn: x, why: x + '. Shorten the stop.' }); }
  if (t.sm === 'risk' && k.sl == null) b.push({ btn: 'Set a stop loss to size by risk', why: 'Risk sizing needs a stop loss.' });
  else if (k.minRisk) { const x = `Minimum size ${lotsWord(k.sym, k.mn)} risks ${usdFmt(k.minRisk.usd)} (${pct(k.minRisk.pct, 2, false)}) — above your ${+t.risk}%`; b.push({ btn: x, why: x + '.' }); }
  else if (!(k.lots >= k.mn - 1e-9)) { const x = volWhy(k.sym, k.lots); b.push({ btn: x, why: x + '.' }); }
  // a pending order closer to the market than the sheet's minimum distance is refused by placeOrder
  if (t.useTrail && !(+t.trail > 0)) b.push({ btn: 'Trailing distance must be above 0', why: 'Trailing distance must be above 0.' });
  if (k.ot !== 'market') { const g = !(k.entry > 0) ? 'Enter a price above 0' : pendGap(k); if (g) b.push({ btn: g, why: g + '.' }); }
  if (!b.length) {
    // an order against an open position reduces it first: only the part beyond it needs new margin (UX-7)
    const opp = k.ot === 'market' && typeof netAgg === 'function' ? netAgg(k.sym, k.side === 'buy' ? 'sell' : 'buy') : null;
    const need = opp && k.lots > 0 ? k.margin * Math.max(0, k.lots - opp.lots) / k.lots : k.margin;
    if (k.ot === 'market' && need > 0 && need > k.a.free) b.push({ btn: `Insufficient margin — needs ${usdFmt(need)}`, why: `Margin ${usdFmt(need)} exceeds free margin ${usdFmt(k.a.free)}.` });
    if (k.riskUsd != null && eq > 0 && k.riskUsd > eq * RISK_CAP / 100) b.push({ btn: `Risk ${pct(k.riskUsd / eq * 100, 1, false)} — above the ${RISK_CAP}% cap`, why: `Risk ${usdFmt(k.riskUsd)} is ${pct(k.riskUsd / eq * 100, 1, false)} of equity; one trade may risk at most ${RISK_CAP}%.` });
    const cap = orderCaps(k.sym, k.lots); if (cap) b.push({ btn: cap.replace(/ \(.*\)$/, ''), why: cap + '.' });
  }
  if (k.net) return b; // adding to a position: the stop and target fields are not used (the position keeps its own)
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
  if ((t.useTrail && t.trail > 0) || x.be || (k.ot !== 'market' && k.tif !== 'GTC')) add('info', 'Checked by this tab: while it is closed nothing triggers.');
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
  const src = lev === +S.set.lev ? 'account leverage' : 'sheet';
  return m.kind === 'cfd' ? `1:${lev} · ${src}, ${c}` : `1:${lev} · ${src}`;
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
const TKH = { sym: '', size: 'pct', sl: 'pips', tp: 'pips', usd: 0, slPx: null, slAtr: 0, slRp: 0, slRc: 0, tpPx: null, tpR: 0, err: { sl: '', tp: '' }, last: { sl: null, tp: null } };
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
  // a stop at a risk (% of equity, or money in the quote currency): its distance follows from the volume, so it needs
  // the size in lots (sizing by risk would make each one the other's input)
  else if (slOn && (TKH.sl === 'rpct' || TKH.sl === 'rcur')) {
    if (t.sm === 'risk') TKH.sl = 'pips';
    else { const lots = normLots(sym, t.lots) || 0, pv = pipValue(sym, lots), usd = TKH.sl === 'rpct' ? account().eq * TKH.slRp / 100 : TKH.slRc * Engine.usd(m.quote);
      if (pv > 0 && usd > 0) t.sl = r1(Math.max(.1, usd / pv)); }
  }
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
/* a risk in % of equity as a field shows it: two decimals from 0.1%, below that two significant figures (0.025,
   0.0025, 0.0000012), so a small risk never reads '0.00' (round 2, #4). Round 3 (#5): continuous across 0.1% (0.0999
   reads 0.10, as 0.1 does: the rounding is done first, then the decimals are chosen), no cap that turns a tiny risk
   into a row of zeros: under 0.000001% it is '<0.000001'. The value held stays exact. */
function tkPctFmt(v) {
  if (!finite(v)) return '';
  if (v <= 0) return v.toFixed(2);
  if (v < 1e-6) return '<0.000001';
  const r = +v.toPrecision(2);
  return r >= .1 ? v.toFixed(2) : r.toFixed(1 - Math.floor(Math.log10(r) + 1e-12));
}
// a % field (type=number cannot hold '<'): the value, or empty with '<0.000001' as its placeholder
function tkPctSet(id, v) {
  const e = $(id); if (!e || document.activeElement === e) return;
  const s = v === '' ? '' : tkPctFmt(v), lt = s[0] === '<', val = lt ? '' : s, ph = lt ? s : '';
  if (e.value !== val) e.value = val; if (e.placeholder !== ph) e.placeholder = ph;
}
// the field values follow the state, except the one being typed in; the held field of each row carries "set"
function tkFields(k) {
  const t = S.tk, sym = k.sym, m = k.m, set = (id, v) => { const e = $(id); if (e && document.activeElement !== e && e.value !== String(v)) e.value = v; };
  // the cells of one linked row (wherever the steps put them), by their inputs
  const hold = (ids, key) => { for (const c of ids.map(id => $(id)?.closest('.tk3-c')).filter(Boolean)) { const on = c.dataset.k === key; c.classList.toggle('held', on); const tg = c.querySelector('.tk3-tag'); if (tg) tg.textContent = on ? 'set' : 'auto'; } };
  if (!tkLotsTypedBad()) set('#tkLots', lotsFmt(sym, k.lots)); // a size typed outside the sheet stays as typed (F13)
  // sizing by risk: the fields keep the risk asked for (the size may be capped at the sheet's maximum, said under the
  // volume); otherwise they show the risk the size and the stop make
  const byPct = t.sm === 'risk' && TKH.size !== 'usd', byUsd = t.sm === 'risk' && TKH.size === 'usd';
  tkPctSet('#tkRisk', byPct ? +t.risk : k.riskUsd != null ? k.riskUsd / k.a.eq * 100 : '');
  set('#tkRiskUsd', byUsd && TKH.usd > 0 ? (+TKH.usd).toFixed(2) : k.riskUsd != null ? k.riskUsd.toFixed(2) : '');
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
  // the unit lists follow their tick box: SL / TP unticked = the Price/Pips… picker off too (its button mirrors the select)
  $('#tkSlBy').disabled = !t.useSL; $('#tkTpBy').disabled = !t.useTP;
  // with split targets on, picking a unit goes back to one take profit (the handler on #tkTpBy turns split off)
  { const tb = $('#tkTpBy'), tt = t.useTP && k.split ? 'Split take profit is on: picking a unit turns it off and sets one take profit' : ''; if (tb.title !== tt) tb.title = tt; }
  $('#tkSlAtr').disabled ||= !t.useSL; $('#tkTpR').disabled ||= !ownSL;
  // the stop as a risk: the held value, else what the stop and the volume make (% of equity, the quote currency)
  const fx = Engine.usd(m.quote) || 1;
  tkPctSet('#tkSlRp', TKH.sl === 'rpct' && TKH.slRp > 0 ? +TKH.slRp : k.riskUsd != null ? k.riskUsd / k.a.eq * 100 : '');
  set('#tkSlRc', TKH.sl === 'rcur' && TKH.slRc > 0 ? (+TKH.slRc).toFixed(2) : k.riskUsd != null ? (k.riskUsd / fx).toFixed(2) : '');
  $('#tkSlRp').disabled = $('#tkSlRc').disabled = !t.useSL || t.sm === 'risk';
  hold(['#tkSlPx', '#tkSL', '#tkSlAtr', '#tkSlRp', '#tkSlRc'], TKH.sl); hold(['#tkTpPx', '#tkTP', '#tkTpR'], TKH.tp);
  $('#slMoney').textContent = k.riskUsd != null ? usdFmt(-k.riskUsd) : t.useSL ? '' : 'none';
  $('#tpMoney').textContent = k.rewUsd != null ? usdFmt(k.rewUsd, true) : t.useTP ? '' : 'none';
  const lim = tkLimit(), ln = $('#tkLim'); if (ln.textContent !== lim.w) ln.textContent = lim.w;
  // the chips speak the unit in use: % of equity, or dollars (Risk $)
  const inUsd = TKH.size === 'usd';
  for (const b of $$('#tkChips [data-rk]')) {
    const v = +b.dataset.rk, u = +b.dataset.ru, tx = inUsd ? '$' + u : v + '%'; b.disabled = k.slPips == null;
    if (b.textContent !== tx) b.textContent = tx;
    b.classList.toggle('on', t.sm === 'risk' && (inUsd ? Math.abs(TKH.usd - u) < 1e-9 : Math.abs(t.risk - v) < 1e-9));
    b.classList.toggle('over', (inUsd ? u / k.a.eq * 100 : v) > lim.v);
  }
  const tip = t.ot !== 'market' && (TKH.sl === 'price' || TKH.tp === 'price') ? 'Pending: the stop and the target are kept as distances from the fill price, as shown in pips' : 'Fill any field · ↑ ↓ step · Shift × 10 · drag the lines on the chart';
  const tp0 = $('#tkTip'); if (tp0 && tp0.textContent !== tip) tp0.textContent = tip;
  // the label of the entry price is the order it makes (ticket F compact: 'BUY LIMIT @'); the long form is its title
  const pl = $('#tkPriceLbl'); if (pl) { const w = t.ot === 'market' ? 'Entry price' : `${k.d > 0 ? 'Buy' : 'Sell'} ${k.stopLimit ? 'stop-limit' : t.ot} @`, ti = t.ot === 'limit' ? (k.d > 0 ? 'Buy when the price falls to' : 'Sell when the price rises to') : t.ot === 'stop' ? (k.d > 0 ? 'Buy when the price rises to' : 'Sell when the price falls to') : 'Entry price'; if (pl.textContent !== w) pl.textContent = w; if (pl.title !== ti) pl.title = ti; }
  tkNetNote(sym, k);
}
/* Netting (trade.js): with a position open on the instrument, the ticket says what the order does to it. Same side, at
   market: it adds to the position, which keeps its own SL/TP, so the stop and target blocks are switched off. A pending
   order is checked at its fill, so the blocks stay and the note says when they would not apply. Other side: it reduces
   the position, and SL/TP apply only to a part that reverses it. */
function tkNetNote(sym, k) {
  let el = $('#tkNet'); const sb = $('#tkSlBlk'), tb = $('#tkTpBlk'); if (!sb || !tb) return;
  if (!el) { el = document.createElement('div'); el.id = 'tkNet'; el.className = 'tk-net small'; sb.before(el); }
  if (typeof netAgg !== 'function') return;
  const side = k.d > 0 ? 'buy' : 'sell';
  const opp = netAgg(sym, side === 'buy' ? 'sell' : 'buy'), same = netAgg(sym, side), n = k.net;
  const pos = g => `#${g.p.id} (${g.p.side} ${lotsFmt(sym, g.lots)} @ ${fp(sym, g.entry)})`;
  const txt = opp ? `Reduces position ${pos(opp)} at the fill${k.lots > opp.lots + 1e-9 ? `, then opens ${lotsFmt(sym, rS(sym, k.lots - opp.lots))} ${side} with this order's SL/TP` : ''}. Its P/L is realised at the fill price.`
    : n ? `Adds to position ${pos(same)}: after the fill ${lotsFmt(sym, n.lots)} at ${fp(sym, n.entry)} average. The figures below are the whole position, with its own SL/TP; this order brings none.`
    : same ? `If position ${pos(same)} is still open at the fill, this order adds to it and its SL/TP are not applied.` : '';
  // part of the next order's preview (F7): said while the user works in the ticket, not after each fill on its own
  // right after a fill the long note stays off, but the figures below are still the whole position plus this order: a one-line note says so (UX-87)
  const live = tkPreviewActive(), short = n && !live ? `Figures include open position ${pos(same)} plus this order.` : '';
  const shown = live ? txt : short;
  if (el.textContent !== shown) el.textContent = shown; el.hidden = !shown;
  for (const b of [sb, tb]) { b.inert = !!n; b.classList.toggle('tk-off', !!n); }
}
/* The preview of the next order (UX test 09.11.2026, F7): the "Adds to position" note and the ticket's SL/TP lines on
   the chart show while the user works in the ticket (focus, typing, a click in it), not on their own. A fill (a new
   head of S.fills, local or from the server) and the page load turn it off until the next interaction. chart.js reads
   tkPreviewActive(); a change sets dirty.lines so the chart redraws its lines.
   Round 2 (#6): only a new fill on the ticket's own symbol turns it off, and never while a ticket field (input, select)
   has the focus. A snapshot that brings back an older fill, a fill on another instrument (a multi-chart pane, another
   device) leave the preview alone. Focus on a button (the order button after a click) is not
   working in a field, so the fill that click makes still ends the preview.
   Round 3: a fill is new by its identity (fid, position, time as the server wrote them), never by comparing its time
   with the client's clock (#7: the two clocks differ). An older fill a snapshot brings back is told apart by the
   fills' own times only (the newest fill seen so far, same clock). A new fill on the ticket's symbol while a field has
   the focus is kept (TKP.pend) and ends the preview when the focus leaves the ticket (#6). */
const TKP = { on: false, head: null, n: -1, keys: null, top: -Infinity, pend: false };
const tkFillKey = f => f ? `${f.fid}:${f.pos}:${f.t}` : '';
function tkPreviewSet(on) { if (!on) TKP.pend = false; if (TKP.on === on) return; TKP.on = on; if (typeof dirty === 'object' && dirty) dirty.lines = true; }
const tkFieldFocused = () => { const a = document.activeElement; return !!(a && a.matches && a.matches('input,select,textarea') && a.closest('.ticket')); };
// the fills seen: their keys (the newest 500 at most, as S.fills keeps) and the newest fill time among them
function tkFillsSeen(fl) {
  TKP.keys = new Set(fl.map(tkFillKey)); TKP.head = tkFillKey(fl[0]); TKP.n = fl.length;
  TKP.top = fl.reduce((m, f) => f && finite(+f.t) && +f.t > m ? +f.t : m, -Infinity);
}
function tkPreviewActive() {
  if (typeof S !== 'object' || !S) return false;
  const fl = Array.isArray(S.fills) ? S.fills : [];
  if (TKP.keys === null) { tkFillsSeen(fl); return TKP.on; }
  if (fl.length === TKP.n && tkFillKey(fl[0]) === TKP.head) return TKP.on; // nothing new (the usual frame)
  const sym = S.set.sym, top = TKP.top;
  const mine = fl.some(f => f && f.sym === sym && !TKP.keys.has(tkFillKey(f)) && !(+f.t < top));
  tkFillsSeen(fl);
  if (mine && TKP.on) { if (tkFieldFocused()) TKP.pend = true; else tkPreviewSet(false); }
  return TKP.on;
}
function tkPreviewTouch() {
  if (typeof S !== 'object' || !S) return;
  tkPreviewActive(); // fills not looked at yet count before this interaction
  tkPreviewSet(true);
}
// the focus leaves the ticket: a fill made while a field had the focus ends the preview now (#6)
function tkPreviewLeave() { tkPreviewActive(); if (TKP.pend) tkPreviewSet(false); }
/* SL / TP when ticked (F4): the distance kept from an earlier use is reused only when it is plausible on this
   instrument now, at most 5 × ATR 1H (a target: at most 5 × ATR or 2R); otherwise the stop is 1.5 × ATR 1H and the
   target 2R. The row says where its value comes from (TKSRC) until the value is changed. Without an ATR (under 15
   hours of data) nothing can be judged and the kept distance stands. */
const TKSRC = { sl: null, tp: null };
function tkPlausible(row) {
  const t = S.tk, sym = S.set.sym; if (!M(sym)) return;
  const atr = tkAtr1h(sym), r1 = v => +v.toFixed(1);
  if (row === 'sl') {
    if (atr > 0 && !(t.sl > 0 && t.sl <= 5 * atr + 1e-9)) { t.sl = r1(Math.max(.1, 1.5 * atr)); TKSRC.sl = { w: 'default: 1.5 × ATR (1H)', v: t.sl }; }
    // the starting value of a new ticket is the app's default, not something the user chose (tester follow-up)
    else TKSRC.sl = t.sl > 0 ? { w: typeof DEF === 'object' && DEF.tk && t.sl === DEF.tk.sl ? 'default distance' : 'your last distance', v: t.sl } : null;
    // a default never starts inside the spread (UX-40): at least three spreads
    { const q = Engine.quote(sym), sp = q && q.spread; if (sp > 0 && TKSRC.sl && /^default/.test(TKSRC.sl.w) && t.sl < 3 * sp) { t.sl = r1(3 * sp); TKSRC.sl = { w: 'default: 3 × spread', v: t.sl }; } }
    TKH.sl = 'pips';
  } else {
    /* The plausibility cap of a kept target is max(5 × ATR, 2 × SL), not the brief's plain 5 × ATR (decision kept in
       round 2, #11): with a wide stop (say 4 × ATR) the 2R default is 8 × ATR, and a 5 × ATR cap would throw away a
       target the ticket itself proposes. Without a stop there is no R: the cap is 5 × ATR and the default target is
       3 × ATR 1H, said as such (round 2, #3: 'default: 2R' with no stop named an R that did not exist). */
    const sl = t.useSL && t.sl > 0 ? t.sl : 0, cap = Math.max(5 * atr, 2 * sl);
    if (atr > 0 && !(t.tp > 0 && t.tp <= cap + 1e-9)) {
      if (sl > 0) { t.tp = r1(2 * sl); TKSRC.tp = { w: 'default: 2R', v: t.tp }; }
      else { t.tp = r1(Math.max(.1, 3 * atr)); TKSRC.tp = { w: 'default: 3 × ATR (1H)', v: t.tp }; }
    }
    else TKSRC.tp = t.tp > 0 ? { w: typeof DEF === 'object' && DEF.tk && t.tp === DEF.tk.tp ? 'default distance' : 'your last distance', v: t.tp } : null;
    TKH.tp = 'pips';
  }
}
function tkSrcRender() {
  const t = S.tk;
  for (const [row, on, id] of [['sl', t.useSL, '#slSrc'], ['tp', t.useTP && !tkx().split, '#tpSrc']]) {
    const e = $(id); if (!e) continue;
    const s = TKSRC[row], show = !!(on && s && Math.abs(t[row] - s.v) < 1e-9);
    if (s && !show) TKSRC[row] = null; // changed or unticked: the source no longer applies
    const w = show ? s.w : ''; if (e.textContent !== w) e.textContent = w; if (e.hidden !== !show) e.hidden = !show;
  }
}
/* R : R only when both exits are valid (F11): a stop past zero, a held price on the wrong side or a split-target
   error gives none, so the ticket shows '—' instead of a ratio from the last valid value */
function tkRR(k) {
  if (!(k.riskUsd > 0) || !(k.rewUsd > 0)) return null;
  if (k.sl != null && !(k.sl > 0)) return null;
  if (!k.net && (TKH.err.sl || TKH.err.tp || k.tpErr)) return null;
  const r = k.rewUsd / k.riskUsd; return isFinite(r) ? r : null;
}
const tkExitBad = k => !k.net && !!(TKH.err.sl || TKH.err.tp || k.tpErr || (k.sl != null && !(k.sl > 0)));
/* Volume (F13; round 2 #1, #7–#10). S.tk.lots always holds a size the sheet takes: it is what is saved, and what the
   other paths read. A size typed outside the sheet (under the minimum, over the maximum, off the step, negative, an
   emptied field) is kept in TKV.raw for this symbol only: the field shows it, the row under Volume says why, and the
   ticket's own order is computed from it (tkLotsRaw: blocked, or rounded to the step). TKV.base is S.tk.lots at that
   moment, so any other change of the size (presets, stepper, a module) ends the typed value. TKV.note is one line about
   a correction the ticket made itself (rounded on blur, lowered to a maximum), shown while that size stands. */
/* Round 3: TKV.focus is the size the state held when the field took the focus (#1): a key may put a valid size in the
   state, so the figures follow it, but a field left empty or invalid goes back to that size, never to a size only
   typed on the way ('0.05', '7', Backspace, Tab keeps 0.05). A valid size is confirmed when the field is left (Tab,
   a click, Enter: the ticket's Enter moves the focus to the order button). tkVolClear also ends the note (#2), so a
   note never comes back with a size that matches it again later. */
const TKV = { raw: null, sym: '', base: null, prev: null, note: null, focus: null, fsym: '', mute: false };
const tkLotsTypedBad = () => TKV.raw !== null && TKV.sym === S.set.sym && S.tk.sm === 'lots' && TKV.base === S.tk.lots && !!M(S.set.sym);
const tkLotsRaw = () => tkLotsTypedBad() ? TKV.raw : S.tk.lots;
function tkVolClear() { TKV.raw = null; TKV.base = null; TKV.note = null; }
// the size field takes the focus: the size to go back to if it is left without a valid size (#1)
function tkLotsFocus() { if (!M(S.set.sym)) return; TKV.focus = S.tk.lots; TKV.fsym = S.set.sym; }
// the size field was typed in (after app.js put the number in S.tk.lots): a size the sheet takes is the state; any
// other keeps the last valid size in the state (or the step-rounded size when it is only off the step)
function tkLotsTyped(str) {
  const sym = S.set.sym, t = S.tk; if (!M(sym)) return;
  TKV.note = null;
  const s = String(str).trim(), v = s === '' ? NaN : +s;
  if (tkLotsOk(sym, v)) { tkVolClear(); t.lots = v; return; }
  const back = TKV.focus !== null && TKV.fsym === sym ? TKV.focus : TKV.prev; // the size at focus (#1, round 3)
  const [mn, mx] = volOf(sym), n = normLots(sym, v), prev = tkLotsOk(sym, back) ? back : tkLotsCarry(sym, back);
  t.lots = finite(v) && v >= mn - 1e-9 && v <= mx + 1e-9 ? n : prev;
  Object.assign(TKV, { raw: finite(v) ? v : NaN, sym, base: t.lots });
}
// on leaving the field, a size only off the step becomes the size that goes, in the field too, and the row says so (#1)
function tkLotsBlur() {
  TKV.focus = null;
  if (!tkLotsTypedBad()) { save(); return; } // a valid size: confirmed
  const sym = S.set.sym, raw = TKV.raw, [mn, mx, st] = volOf(sym);
  if (!(finite(raw) && raw >= mn - 1e-9 && raw <= mx + 1e-9)) { save(); return; } // outside the sheet: stays as typed, with its reason; the state is the size at focus
  const n = normLots(sym, raw); S.tk.lots = n; tkVolClear();
  TKV.note = { msg: `Rounded to ${lotsWord(sym, n)} (step ${lotsFmt(sym, st)})`, sym, lots: n };
  const f = $('#tkLots'); if (f) f.value = lotsFmt(sym, n);
  save(); safe('ticket', renderTicket);
}
// a size lowered to the instrument's maximum by the ticket itself (a symbol change) is said, not done out of sight (#8).
// Round 3 (#3): one toast per lowering: a second path saying the same lowering while its note stands adds none.
// quiet: the caller says it in its own toast (#4, the ticket filled in by a quick trade)
function tkLotsLowered(sym, quiet) {
  const mx = volOf(sym)[1], msg = `Size lowered to ${lotsWord(sym, mx)} (maximum for ${pretty(sym)})`, nt = TKV.note;
  const said = !!(nt && nt.sym === sym && nt.lots === mx && nt.msg === msg && S.tk.lots === mx);
  TKV.note = { msg, sym, lots: mx }; if (!said && !quiet && !TKV.mute) toast('Size lowered', msg, 'info');
  return msg;
}
function tkVolMsg(k) {
  const t = S.tk, sym = k.sym, [mn, mx, st] = volOf(sym), d0 = v => (v < 0 ? '−$' : '$') + nf0.format(Math.round(Math.abs(v)));
  // sizing by risk: the size is the one the risk makes (the typed one does not apply, #7)
  const raw = t.sm === 'lots' ? +tkLotsRaw() : k.lots;
  if (!finite(raw) || raw < mn - 1e-9 || !(k.lots >= mn - 1e-9)) return `Minimum ${lotsWord(sym, mn)}`;
  if (raw > mx + 1e-9) return `Maximum ${lotsWord(sym, mx)}`;
  if (k.ot === 'market' && k.margin > k.a.free) {
    const per = k.lots > 0 ? k.margin / k.lots : 0, free = k.a.free;
    if (!(free > 0) || !(per > 0)) return `Needs ${d0(k.margin)} margin · free ${d0(free)} · no free margin left`;
    // down to the instrument's step (#5: 1.99 lots is 1.99, not '1 lot')
    let best = Math.min(mx, Math.floor(free / per / st + 1e-9) * st);
    { const n1 = typeof MAX_NOTIONAL_X === 'number' ? notionalUsd(sym, 1) : 0; if (n1 > 0) best = Math.min(best, Math.floor(MAX_NOTIONAL_X * k.a.eq / n1 / st + 1e-9) * st); } // the size offered also passes the per-order cap (UX-39)
    return `Needs ${d0(k.margin)} margin · free ${d0(free)} · max ≈ ${lotsWord(sym, +best.toFixed(lotDec(sym)))}`;
  }
  const cap = orderCaps(sym, k.lots); if (cap) return cap.replace(/ \(.*\)$/, '');
  if (Math.abs(normLots(sym, raw) - raw) > 1e-9) return `Sizes go in steps of ${lotsFmt(sym, st)}: this order sends ${lotsWord(sym, k.lots)}`;
  const nt = TKV.note; if (nt && t.sm === 'lots' && nt.sym === sym && nt.lots === t.lots) return nt.msg;
  return '';
}
// the ticket's size cannot be sent (under the minimum, over the maximum): '' or the reason, as the row under Volume
// says it. The other order paths that take the ticket's size (chart long-press, depth ladder) ask this first, so they
// never send another size than the one typed (round 2, #2)
function tkSizeWhy(k) {
  k = k || tkCalc(); if (S.tk.sm === 'risk' && k.slPips == null) return 'Set a stop loss to size by risk';
  const w = tkVolMsg(k); return /^(Minimum|Maximum)/.test(w) ? w : '';
}
// the messages that say what the ticket did or will do, not what is wrong: the field is not marked invalid
const TK_VOL_INFO = /^(Sizes go|Rounded to|Size lowered)/;
function tkVolRender(k) {
  const e = $('#tkVolErr'), f = $('#tkLots'); if (!e) return;
  const w = tkVolMsg(k); if (e.textContent !== w) e.textContent = w;
  if (f) { const inv = w && !TK_VOL_INFO.test(w) ? 'true' : 'false'; if (f.getAttribute('aria-invalid') !== inv) f.setAttribute('aria-invalid', inv); }
}
// '½' closes this many lots of the position (0: not possible); halfLots comes from trade.js, the fallback rounds the
// same way (down to the sheet's step, nothing under the minimum)
function tkHalf(p) {
  if (typeof halfLots === 'function') return +halfLots(p) || 0;
  const [mn, , st] = volOf(p.sym), h = +(Math.floor(p.lots * .5 / st + 1e-6) * st).toFixed(lotDec(p.sym));
  return h >= mn - 1e-9 && h < p.lots - 1e-9 ? h : 0;
}
// '½' says what it closes; at the minimum size it is grey and says why (F10)
function tkHalfBtn(p) {
  const h = tkHalf(p), sym = p.sym, of = M(sym) ? lotsFmt(sym, p.lots) : (+p.lots).toFixed(2);
  if (h > 0) { const w = `Close ${lotsFmt(sym, h)} of ${of} of #${p.id}`; return `<button type="button" data-act="half" aria-label="½: ${escHtml(w.toLowerCase())}" data-tip="${escHtml(w)}">½</button>`; }
  // round 2 (#12): aria-disabled, not disabled, as in the dock: it keeps the focus, so the reason is reachable from the
  // keyboard, and a click says it (tkFormBuild); grey at .45 (ui-controls: disabled = grey)
  const w = `½ unavailable: #${p.id} is at the minimum size (${M(sym) ? lotsWord(sym, volOf(sym)[0]) : of}); use ✕ Close to close it all`;
  // round 3 (#8): the grey is styles.css's .tk-on-tbl button[aria-disabled="true"] (as in the dock), the reason a
  // data-tip, drawn by tkTipBind below on hover and on keyboard focus (a title shows on hover only)
  return `<button type="button" data-act="half" aria-disabled="true" aria-label="${escHtml(w)}" data-tip="${escHtml(w)}">½</button>`;
}
// the data-tip of a button in the ticket's 'On <SYM> now' table, on hover and on keyboard focus: the app's tooltip
// layer (#brTip, brief.js; styled globally in styles.css) only covers the analysis pages (TIP_SCOPE), so the ticket
// shows its own tips through the same element. On focus it sits under the button, on hover at the pointer.
const TKTIP = { el: null };
function tkTipShow(el, x, y) {
  if (typeof brTipShow !== 'function' || !el.isConnected) return;
  const r = el.getBoundingClientRect(); TKTIP.el = el;
  brTipShow(el.dataset.tip, x ?? r.left, y ?? r.bottom - 10);
}
function tkTipHide() { if (!TKTIP.el) return; TKTIP.el = null; if (typeof brTipHide === 'function') brTipHide(); }
(function tkTipBind() {
  const tipOf = e => { const el = e.target && e.target.closest && e.target.closest('.tk-on-tbl button[data-tip]'); return el || null; };
  document.addEventListener('mouseover', e => { const el = tipOf(e); if (el) tkTipShow(el, e.clientX, e.clientY); else if (TKTIP.el && !TKTIP.el.isConnected) tkTipHide(); });
  document.addEventListener('mousemove', e => { const el = tipOf(e); if (el && el === TKTIP.el) tkTipShow(el, e.clientX, e.clientY); });
  document.addEventListener('focusin', e => { const el = tipOf(e); if (el) tkTipShow(el); else tkTipHide(); });
  const out = e => { const el = tipOf(e); if (!el || el !== TKTIP.el || (e.relatedTarget && el.contains(e.relatedTarget))) return; tkTipHide(); };
  document.addEventListener('mouseout', out); document.addEventListener('focusout', out);
})();
// the margin the quick-trade size blocks at the current price, live, beside the chart's BUY button (Victor, 15.11.2026);
// the ticket's own formula (notional / effective leverage); red when it is more than the free margin
function tkQuickMargin(sym, free) {
  const box = $('#qMgBox'), out = $('#qMargin'); if (!box || !out) return;
  const lots = +($('#qLots') || {}).value || 0, mg = lots > 0 ? notionalUsd(sym, lots) / effLev(sym) : null;
  out.textContent = usdFmt(mg); const over = mg != null && free != null && mg > free;
  box.classList.toggle('over', over);
  const qb = box.parentElement, qw = qb && qb.offsetWidth ? Math.ceil(qb.offsetLeft + qb.offsetWidth) + 'px' : '';
  if (qw && qb.parentElement.style.getPropertyValue('--qw') !== qw) qb.parentElement.style.setProperty('--qw', qw); // the legend starts after it, whatever the prices' width
  box.title = mg == null ? 'Margin: enter a size' : `Margin blocked by ${lots} at the current price: ${usdFmt(mg)}` + (over ? ` — more than your free margin (${usdFmt(free)})` : ` · free margin ${usdFmt(free)}`);
}
function renderTicket() {
  tkBuild(); tkPendAuto(); tkHold(); tkPreviewActive();
  const t = S.tk, k = tkCalc(), sym = k.sym;
  $('#tkBid').innerHTML = bigPx(sym, k.q.bid); $('#tkAsk').innerHTML = bigPx(sym, k.q.ask);
  const m = k.m, cfd = m.kind === 'cfd', un = unitWord(sym), u1 = unitWord(sym, true);
  $('#qBid').textContent = fp(sym, k.q.bid); $('#qAsk').textContent = fp(sym, k.q.ask); $('#qSpread').textContent = k.q.spread.toFixed(1) + ' ' + u1;
  tkQuickMargin(sym, k.a.free);
  $('#slPx').textContent = TKH.err.sl; $('#tpPx').textContent = TKH.err.tp;
  tkUnits(m); tkQuickState(sym); tkFields(k); tkSrcRender(); tkVolRender(k);
  const sizeTxt = t.sm === 'risk' ? (k.minRisk ? `Below the minimum size (${lotsWord(sym, k.mn)}) for this risk` : k.lots ? `${TKH.size === 'usd' ? `${usdFmt(TKH.usd)} = ${pct(TKH.usd / k.a.eq * 100, 2, false)}` : `${+t.risk}% = ${usdFmt(k.a.eq * t.risk / 100)}`} → ${lotsWord(sym, k.lots)}${k.capped ? ` (the maximum) · real risk ${usdFmt(k.riskUsd)} = ${pct(k.riskUsd / k.a.eq * 100, 2, false)}` : ''} · $${smallMoney(k.pv * k.lots)}/${u1}` : 'Set a stop loss to size by risk')
    : m.lotName === 'shares' ? `${lotsWord(sym, k.lots)} · ${usdFmt(k.pv * k.lots)}/${u1}` : cfd ? (m.sizeUnit === 'point' && m.pip !== 1 ? `${lotsWord(sym, k.lots)}: ${ptWorth(sym, k.lots)} ≈ $${smallMoney(k.pv * k.lots)}` : `${contractText(sym)} · $${smallMoney(k.pv * k.lots)}/${u1}`) : `${nf0.format(k.lots * m.size)} ${m.base} · ${usdFmt(k.pv * k.lots)}/pip`;
  $('#sizeHint').textContent = sizeTxt;
  // under the volume, as the lots are typed: the margin they take and the exposure after the order, as a share of
  // equity; green at none, through amber, red from half the equity in margin (margin level 200%)
  const eqv = k.a.eq, used = k.a.mg + k.margin, use = eqv > 0 ? used / eqv : 1, heat = Math.round(Math.min(1, use / .5) * 100);
  const vx = $('#tkVolX');
  if (vx) {
    vx.style.setProperty('--h1', Math.min(100, heat * 2) + '%'); vx.style.setProperty('--h2', Math.max(0, heat * 2 - 100) + '%');
    const vh = `<span>Margin</span><b class="mono">${escHtml(usdFmt(k.mgShow ?? k.margin))}</b><span class="mono">${escHtml(levWords(sym, k.lev).split(' · ')[0])}</span><em class="mono">${eqv > 0 ? escHtml(pct(use * 100, use < .1 ? 2 : 1, false)) + ' of equity in use' : ''}</em><i class="tk-mgbar" aria-hidden="true"><i style="width:${Math.max(2, heat)}%"></i></i>`;
    if (vx._h !== vh) { vx.innerHTML = vh; vx._h = vh; }
    vx.title = eqv > 0 ? `This order ${usdFmt(k.margin)} = ${pct(k.margin / eqv * 100, 2, false)} of equity · in use after it ${usdFmt(used)} = ${pct(use * 100, 1, false)} (margin level ${used > 0 ? pct(eqv / used * 100, 0, false) : '—'}) · red from half the equity in margin` : '';
  }
  const ph = $('#tkPendHint');
  if (ph) { ph.hidden = t.ot === 'market'; if (!ph.hidden) { const pm = pendMin(sym, k.side), x = `At least ${pm.words} (${pm.px}) from the ${pm.from}`; if (ph.textContent !== x) ph.textContent = x; } }
  const rr = tkRR(k);
  const tot = (k.riskUsd || 0) + (k.rewUsd || 0) || 1;
  $('#rrRisk').style.flex = (k.riskUsd || 0) / tot; $('#rrRew').style.flex = (k.rewUsd || 0) / tot;
  const od = tkOdds(k), rows = [
    [cfd ? 'Point value' : 'Pip value', usdFmt(k.pv * (k.net ? k.net.lots : k.lots))], ['Margin required', `${usdFmt(k.mgShow ?? k.margin)} <span class="muted">${escHtml(levWords(sym, k.lev))}</span>`], ['Contract', escHtml(contractText(sym))],
    ['Risk', k.riskUsd != null ? `<span class="dn">${usdFmt(-k.riskUsd)}</span> <span class="muted">${pct(k.riskUsd / k.a.eq * 100, 2, false)}</span>` : '<span class="dn">unlimited</span>'],
    ['Reward', k.rewUsd != null ? `<span class="up">${usdFmt(k.rewUsd, true)}</span>` : '—'],
    ['Reward : risk', rr ? `1 : ${rr.toFixed(2)}` : '—'], ['Spread cost', usdFmt(k.spreadCost)],
    ['Break-even win rate', rr ? pct(100 / (1 + rr), 1, false) : '—']
  ];
  const sw = swapPerNight(sym, k.side, k.lots), tri = nextTriple(Engine.simTime, sym);
  rows.push(['Swap / night', `<span class="${cls(sw)}">${usdFmt(sw, true)}</span> <span class="muted">${escHtml(swapUnitWords(sym, k.side))}</span>`],
    ['To next triple', isFinite(tri) ? fmtIn(tri - Engine.simTime) : '—'], ['Swap basis', `<span class="muted">${escHtml(swapBasis(sym))}</span>`]);
  if (m.div === 'excluded') rows.push(['Dividends', '<span class="muted">No dividend adjustments</span>']);
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
  const sum2 = cell('Margin', usdFmt(k.mgShow ?? k.margin), '', `level <b>${lv(wi.post.level)}</b><br>stop-out <b>${so}</b>`, '', 'Margin level after this order (pending orders included); stop-out at 50%')
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
  tkRenderAdv(k); tkFormRender(k);
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
  const want = +t.lotsBy[kt]; tkVolClear(); // a size typed on the instrument left stays with it
  t.lots = tkLotsBack(sym, t.lotsBy);
  if (finite(want) && want > volOf(sym)[1] + 1e-9) tkLotsLowered(sym); // the size kept for it is over its maximum now (#8)
  Object.assign(t, okV(by[kt]) ? tkVals(by[kt]) : kt === 'FX' ? { sl: DEF.tk.sl, tp: DEF.tk.tp, trail: DEF.tk.trail } : tkDefaults(sym));
  tkSeen = { tk: t, sym, v: tkVals(t) };
}
function syncTicketInputs() {
  const t = S.tk, from = tkSeen && tkSeen.tk === t ? tkSeen.sym : null;
  // a size typed outside the sheet of the symbol left, on a symbol that shares its size (G8 → G8): over the maximum it
  // becomes the maximum and the row says so (#8); only off the step, the size that goes; otherwise it stays as typed
  const carry = from && TKV.raw !== null && TKV.sym === from && t.sm === 'lots' && TKV.base === t.lots ? TKV.raw : null;
  if (M(S.set.sym)) tkFollowSymbol();
  const sym = S.set.sym;
  if (carry !== null && sym !== from && M(sym) && tkKey(sym) === tkKey(from)) {
    const [mn, mx] = volOf(sym);
    if (finite(carry) && carry > mx + 1e-9) { tkVolClear(); t.lots = mx; tkLotsLowered(sym); }
    else if (finite(carry) && carry >= mn - 1e-9) { tkVolClear(); t.lots = normLots(sym, carry); }
    else TKV.sym = sym;
  }
  if (TKV.note && TKV.note.sym !== sym) TKV.note = null; // a note about the symbol left does not apply here (round 3, #2)
  if (TKV.fsym !== sym) TKV.focus = null;
  const keep = tkLotsTypedBad(); // a size typed outside the sheet is not corrected out of sight: the row under Volume says why (F13)
  if (M(sym)) {
    const pre = +t.lots;
    if (!keep) { t.lots = tkLotsFor(sym, t.lots); if (finite(pre) && pre > volOf(sym)[1] + 1e-9) tkLotsLowered(sym); }
    tkUnits(M(sym));
  }
  $$('#sideSeg button').forEach(b => b.classList.toggle('on', b.dataset.side === t.side));
  $$('#otSeg button').forEach(b => b.classList.toggle('on', b.dataset.ot === t.ot));
  $$('#sizeMode button').forEach(b => b.classList.toggle('on', b.dataset.sm === t.sm));
  $('#priceField').hidden = t.ot === 'market'; const pe = $('#tkPend'); if (pe) pe.hidden = t.ot === 'market';
  const set = (id, v) => { const e = $(id); if (document.activeElement !== e) e.value = v; };
  if (!keep) set('#tkLots', M(S.set.sym) ? lotsFmt(S.set.sym, t.lots) : (+t.lots).toFixed(2)); tkPctSet('#tkRisk', +t.risk); set('#tkSL', t.sl); set('#tkTP', t.tp); set('#tkTrail', t.trail);
  if (t.ot !== 'market') { if (t.price == null) t.price = defaultPendingPrice(); set('#tkPrice', fp(S.set.sym, t.price)); }
  $('#useSL').checked = t.useSL; $('#useTP').checked = t.useTP; $('#useTrail').checked = t.useTrail;
  dirty.lines = true; save();
}
function submitTicket(sideOverride) {
  if (!sideOverride) tkPendAuto();
  tkHold(sideOverride, sideOverride ? 'market' : undefined);
  const k = tkCalc(sideOverride), t = S.tk, bl = tkBlocks(k);
  if (bl.length) { toast('Order blocked', bl[0].why, 'dn'); beep('err'); return; }
  const ex = tkExits(), x = tkx();
  // market: absolute stop (a trail-only ticket passes none: the trail becomes the stop at the fill); targets from the fill
  if (k.ot === 'market' && k.net) openPosition({ sym: k.sym, side: k.side, lots: k.lots }); // adds to the open position: it keeps its own exits
  else if (k.ot === 'market') openPosition({ sym: k.sym, side: k.side, lots: k.lots, sl: t.useSL && t.sl > 0 ? k.sl : null, tp: k.tp, tps: ex.tps, be: ex.be, trail: ex.trail });
  else placeOrder({ sym: k.sym, side: k.side, ot: k.ot, price: k.entry, limit: k.stopLimit ? +k.limit.toFixed(k.m.digits) : null, lots: k.lots, slPips: ex.slPips, tpPips: ex.tpPips, tps: ex.tps, be: ex.be, trail: ex.trail,
    tif: k.tif, expires: k.expires, oca: x.oco && S.orders.some(o => o.id === x.oco && o.sym === k.sym) ? x.oco : null });
}
/* One-click trading is off by default: quick-trade buttons, chart-pane B/S and Shift+B/S then only fill in the
   ticket and move focus to its order button, so the order is sent by a second, deliberate press. */
function prefillTicket(sym, side, lots) {
  // the size this call brings is said once, in 'Ticket ready': the symbol change does not toast the kept size first
  if (sym !== S.set.sym) { TKV.mute = lots != null; try { setSymbol(sym, side); } finally { TKV.mute = false; } }
  const t = S.tk; t.side = side; t.ot = 'market'; t.price = null;
  // round 3 (#4): a size over the sheet's maximum is lowered as on a symbol change (#8): the row and the toast say so
  let low = '';
  if (lots != null) { t.sm = 'lots'; t.lots = tkLotsFor(sym, lots); tkVolClear(); if (finite(+lots) && +lots > volOf(sym)[1] + 1e-9) low = tkLotsLowered(sym, true);
    else if (!(finite(+lots) && +lots >= volOf(sym)[0] - 1e-9)) low = `Size raised to ${lotsWord(sym, volOf(sym)[0])} (minimum for ${pretty(sym)})`; }
  syncTicketInputs(); const k = renderTicket(), bl = tkBlocks(k);
  if (document.body.classList.contains('mnav-on') && typeof window.mnavGo === 'function') window.mnavGo('trade');
  const b = $('#tkSubmit'); b.scrollIntoView({ block: 'nearest' });
  if (!bl.length) b.focus({ preventScroll: true });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) b.closest('.panel')?.animate([{ boxShadow: 'inset 0 0 0 2px var(--acc)' }, { boxShadow: 'inset 0 0 0 0 transparent' }], { duration: 900 });
  toast('Ticket ready — not sent', (low ? low + '. ' : '') + (bl.length ? bl[0].why : `${side === 'buy' ? 'Buy' : 'Sell'} ${tkLotsText(sym, k.lots)} ${pretty(sym)}: press Enter or the order button to send. One-click trading is off (account menu).`), 'info');
  { const gb = document.querySelector(`#tkGo .tk-go-b.${side}`); if (gb && !gb.disabled) gb.focus({ preventScroll: true }); } // Enter sends (UX-50)
}
function syncOneClick() {
  const on = !!S.set.oneClick, cb = $('#oneClickSet'); if (cb) cb.checked = on;
  document.documentElement.classList.toggle('one-click', on);
  // the chart and pane buttons send the quick size (#qLots), not the ticket's: each says the size it sends (UX-14)
  const ql = (+($('#qLots') || {}).value || 0).toFixed(2);
  for (const b of $$('#qBuy,#qSell,.mc-b[data-q]')) { const sd = b.id === 'qBuy' || b.dataset.q === 'buy' ? 'Buy' : 'Sell'; b.title = on ? `${sd} ${ql} at market now (one-click on)` : `${sd} ${ql}: fills in the order ticket — one-click trading is off`; if (b.dataset.q) b.dataset.lots = ql; }
  const fn = $('#tkKeysNote'); if (fn) fn.textContent = on ? 'trade instantly (one-click on).' : 'fill in the ticket; one-click trading is off.';
  // the quick-trade labels say what a press does: › fills in the ticket, a plain BUY / SELL sends at market
  for (const [id, w] of [['#qBuy', 'BUY'], ['#qSell', 'SELL']]) { const s = $(id + '>small'); if (s) s.textContent = on ? w : w + ' ›'; }
}
function quickTrade(side) {
  const sym = S.set.sym, m = M(sym), q = Engine.quote(sym), d = side === 'buy' ? 1 : -1, t = S.tk, e = d > 0 ? q.ask : q.bid;
  // the size typed is the size sent: one-click passes it as typed (rounded to the step inside openPosition), so a size
  // outside the sheet's [min, max] is refused with its reason (volWhy) instead of being clamped out of sight; the
  // ticket path may clamp, because the ticket then shows the size it will send
  const typed = +$('#qLots').value || volOf(sym)[0];
  if (!S.set.oneClick) return prefillTicket(sym, side, typed); // prefillTicket puts it on the sheet and says a lowering (round 3, #4)
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
    // from the size in the field (a typed size outside the sheet steps from its nearest valid size)
    const sym = S.set.sym, t = S.tk, st = volOf(sym)[2], d = +b.dataset.step.split(':')[1], cur = tkLotsFor(sym, tkLotsRaw()); t.sm = 'lots'; tkVolClear(); TKV.note = null;
    const inc = (d > 0 ? cur >= 100 * st - 1e-9 : cur > 100 * st + 1e-9) ? 10 * st : st;
    t.lots = tkLotsFor(sym, cur + d * inc); syncTicketInputs();
  }, true);
  panel.addEventListener('click', e => { if (e.target.closest('[data-step^="risk:"]')) { S.tk.sm = 'risk'; TKH.size = 'pct'; } }, true);
  const step = (k, lbl) => `<button type="button" data-xstep="${k}:-1" aria-label="Decrease ${lbl}">−</button>`, stepUp = (k, lbl) => `<button type="button" data-xstep="${k}:1" aria-label="Increase ${lbl}">+</button>`;
  $('#priceField').insertAdjacentHTML('afterend', `
    <div class="field" id="tkLmtField" hidden><div class="lbl-row"><label><input type="checkbox" id="tkSLim"> Stop-limit</label><span class="unit">limit, pips past the stop</span></div>
      <div class="stepper">${step('lmtOff', 'limit offset')}<input id="tkLmtOff" type="number" step="0.5" class="mono" aria-label="Limit offset in pips">${stepUp('lmtOff', 'limit offset')}</div><div class="hint mono" id="tkLmtPx"></div></div>
    <div class="field" id="tkTifField" hidden><div class="lbl-row"><label for="tkTif">Good till</label><span class="unit">UTC</span></div>
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
      <div style="${TK_CSS_ROW}"><label class="small"><input type="checkbox" id="tkSlipOn"> Slippage σ</label><input id="tkSlipSd" type="number" min="0" max="5" step="0.1" style="${TK_IN}" aria-label="Slippage sigma in pips"><span class="small">pip · latency</span><input id="tkLat" type="number" min="0" max="2000" step="10" style="${TK_IN}" aria-label="Latency in milliseconds"><span class="small">ms</span></div>
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
    else if (id === 'tkSlRp') { if (v > 0) { TKH.sl = 'rpct'; TKH.slRp = v; } }
    else if (id === 'tkSlRc') { if (v > 0) { TKH.sl = 'rcur'; TKH.slRc = v; } }
    else if (id === 'tkTP') TKH.tp = 'pips';
    else if (id === 'tkTpPx') { if (v > 0) { TKH.tp = 'price'; TKH.tpPx = v; t.useTP = true; } }
    else if (id === 'tkTpR') { if (v > 0) { TKH.tp = 'r'; TKH.tpR = v; } }
    else return;
    $$('#sizeMode button').forEach(b => b.classList.toggle('on', b.dataset.sm === t.sm));
    dirty.lines = true; save();
  });
  for (const id of ['#tkRiskUsd', '#tkSlPx', '#tkSlAtr', '#tkSlRp', '#tkSlRc', '#tkTpPx', '#tkTpR']) $(id).addEventListener('blur', syncTicketInputs);
  // Shift + ↑ ↓: ten steps (a plain arrow is the field's own step)
  panel.addEventListener('keydown', e => {
    const f = e.target; if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !f.matches('.tk3 input[type=number]') || f.disabled) return;
    e.preventDefault(); try { if (!f.value) f.value = f.placeholder || 0; e.key === 'ArrowUp' ? f.stepUp(10) : f.stepDown(10); } catch (err) { return; }
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#tkChips').addEventListener('click', e => {
    const b = e.target.closest('[data-rk]'); if (!b || b.disabled) return;
    S.tk.sm = 'risk'; if (TKH.size === 'usd') TKH.usd = +b.dataset.ru; else { S.tk.risk = +b.dataset.rk; TKH.size = 'pct'; } syncTicketInputs();
  });
  panel.addEventListener('input', e => { // capture: before any redraw of the ticket reads the old state (UX-29)
    if (e.target.type !== 'checkbox') return; const id = e.target.id, x = tkx(), c = e.target.checked;
    if (id === 'tkSLim') x.stopLimit = c; else if (id === 'tkSplit') { x.split = c; if (c) S.tk.useTP = true; } else if (id === 'tkBe') x.be = c; else if (id === 'tkBeTp') x.beOnTp = c;
  }, true);
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
  tkFormBuild();
  // UX test 09.11.2026. F7: the user works in the ticket (capture: before the click that sends, so the fill it makes
  // turns the preview off again)
  for (const ev of ['focusin', 'input', 'pointerdown', 'click']) panel.addEventListener(ev, tkPreviewTouch, true);
  panel.addEventListener('focusout', e => { if (!e.relatedTarget || !panel.contains(e.relatedTarget)) tkPreviewLeave(); }); // round 3 (#6)
  // F4: ticking SL / TP checks the kept distance before app.js switches it on (capture runs first)
  panel.addEventListener('change', e => { const id = e.target.id; if ((id === 'useSL' || id === 'useTP') && e.target.checked) tkPlausible(id === 'useSL' ? 'sl' : 'tp'); }, true);
  // F13: the size typed is remembered, so a blur does not correct it out of sight; F6: every key recalculates the
  // ticket at once (margin, risk, R:R, costs and the order buttons), not on the next frame
  // round 2 (#9, #10): the size before the key (capture: before app.js writes the number into S.tk.lots), so a size the
  // sheet does not take leaves the last valid one in the state; on leaving the field a size only off the step is
  // written in as the size that goes (#1; focusout: after app.js's blur handler)
  panel.addEventListener('input', e => { if (e.target.id === 'tkLots') TKV.prev = tkLotsTypedBad() ? TKV.base : S.tk.lots; }, true);
  panel.addEventListener('focusout', e => { if (e.target.id === 'tkLots') tkLotsBlur(); });
  panel.addEventListener('focusin', e => { if (e.target.id === 'tkLots') tkLotsFocus(); }, true); // round 3 (#1)
  panel.addEventListener('keydown', e => { if (e.target.id === 'tkLots' && e.key === 'Enter') tkLotsBlur(); });
  // the page leaving (or hiding) while a size is still being typed: what is written is the size the field had at focus;
  // the typed text stays in the field and counts again when the page comes back (#1, tester follow-up)
  const unconfirmed = () => { if (TKV.focus === null || TKV.fsym !== S.set.sym || !(TKV.focus > 0)) return; S.tk.lots = TKV.focus; };
  window.addEventListener('pagehide', unconfirmed, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') unconfirmed();
    else if (TKV.focus !== null) { const f = $('#tkLots'); if (f) { tkLotsTyped(f.value); safe('ticket', renderTicket); } }
  }, true);
  panel.addEventListener('input', e => {
    // a size being typed is not saved: the state on disk changes only when the field is left or Enter confirms it (UX
    // round 3, #1; tester follow-up: a valid keystroke used to be saved at once and on pagehide)
    if (e.target.id === 'tkLots') tkLotsTyped(e.target.value);
    safe('ticket', renderTicket);
  });
  // where the SL / TP values come from (F4) and the volume check (F13): small lines in the existing hint styles
  const hint = (after, id, cls, live) => { const a = $(after); if (!a || $('#' + id)) return; a.insertAdjacentHTML('afterend', `<div class="${cls}" id="${id}"${live ? ' aria-live="polite"' : ' hidden'} style="grid-column:1/-1;margin:0;padding:2px 10px"></div>`); };
  hint('#slPx', 'slSrc', 'hint mono tk-src'); hint('#tpPx', 'tpSrc', 'hint mono tk-src');
  hint($('#tkVolX') ? '#tkVolX' : $('#tkVolRow') ? '#tkVolRow' : '#sizeHint', 'tkVolErr', 'hint mono tk3-err', true); // under the margin line (hidden on the compact ticket), so right under Volume
  const lf = $('#tkLots'); if (lf) lf.setAttribute('aria-describedby', 'tkVolErr');
}
// controls follow the state, except the one being typed in
function tkSyncAdv(k) {
  const x = tkx(), t = S.tk, set = (id, v) => { const e = $(id); if (e && document.activeElement !== e && e.value !== String(v)) e.value = v; }, chk = (id, v) => { const e = $(id); if (e) e.checked = v; };
  const pend = t.ot !== 'market';
  $('#tkLmtField').hidden = t.ot !== 'stop'; $('#tkTifField').hidden = !pend;
  chk('#tkSLim', x.stopLimit); set('#tkLmtOff', x.lmtOff); $('#tkLmtOff').disabled = !x.stopLimit;
  $('#tkLmtPx').textContent = k.stopLimit ? `limit @ ${fp(k.sym, k.limit)} — fills only at this price or better once the stop triggers` : 'off: a stop fills at the market once triggered';
  set('#tkTif', x.tif); set('#tkGtd', x.gtdMin); $('#tkGtdWrap').hidden = x.tif !== 'GTD';
  $('#tkTifHint').textContent = k.expires != null ? `until ${dts(k.expires)} UTC (in ${fmtIn(Math.max(0, k.expires - Engine.simTime))})` : 'until you cancel it';
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
  // on the server account the broker executes with its own slippage, latency and commission: shown, not editable (UX-6)
  if (typeof TradeLink === 'object' && TradeLink.live) for (const id of ['tkSlipOn', 'tkSlipSd', 'tkLat', 'tkComm']) { const e = document.getElementById(id); if (e && !e.disabled) { e.disabled = true; e.title = 'Set by the execution server for your account: not editable here'; } }
}
function tkRenderAdv(k) {
  tkSyncAdv(k);
  const w = tkWhatIf(k), lv = v => isFinite(v) ? nf0.format(v) + '%' : '—', pend = k.ot !== 'market';
  const un = unitWord(k.sym), so = w.so.hedged ? 'hedged on this instrument' : w.so.pips <= 0 ? 'at stop-out' : w.so.dir === 'down' && w.so.pct >= 100 ? `out of reach: ${pretty(k.sym)} alone cannot fall far enough` : `${nf0.format(w.so.pips)} ${un} · ${w.so.pct.toFixed(1)}% ${w.so.dir} on ${pretty(k.sym)}`;
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
    <dl class="stats"><dt>Stop-out (50%)</dt><dd title="First order: if only ${pretty(k.sym)} moves, margin held constant">${so}</dd>${$('#tkWiNotes') ? '' : `
    <dt>Swap per night</dt><dd>${usdFmt(sw, true)}</dd><dt>Commission</dt><dd>${c.comm > 0 ? `${usdFmt(k.comm)} round turn` : 'none (spread-only account)'}</dd>
    <dt>Spread cost</dt><dd>${usdFmt(k.spreadCost)}</dd>`}</dl>`;
  // the notes on the method: under How this is computed when the ticket has it (Advanced → Account after), else here
  const notes = `<p class="small muted">Fills are all-or-nothing at the quote (no partial fills). Slippage: ${escHtml(execModelText(c))}. Commission: ${escHtml(commText(c))}. DAY and GTD expiry use UTC.</p>
    <p class="small muted">Post-trade margin is gross per position and counts every pending order as if it filled. Change in equity is the cost at the fill: the spread${c.comm > 0 ? ' and the commission' : ''}. Risk is measured at the stop price; a gap can fill a stop worse.</p>`;
  const hn = $('#tkWiNotes'), wiFull = hn ? html : html + notes; if (hn && hn._h !== notes) { hn.innerHTML = notes; hn._h = notes; }
  const body = $('#tkWiBody'); if (body._h !== wiFull) { body.innerHTML = wiFull; body._h = wiFull; }
  const note = `All-or-nothing fills · ${c.on ? `symmetric slippage σ ${c.sd} pip` : 'slippage off'} · ${c.comm > 0 ? `$${c.comm.toFixed(2)}/lot` : 'no commission'}`;
  const full = `Fills are all-or-nothing at the quote (no partial fills). Slippage: ${execModelText(c)}. Commission: ${commText(c)}. DAY and GTD expiry use UTC. Settings: Help → Settings → Execution.`;
  const en = $('#tkExecNote'); if (en.textContent !== note) { en.textContent = note; en.title = full; }
  const lf = $('#tkLastFill'), f = S.fills && S.fills[0];
  lf.hidden = !f;
  if (f) { const h = `Last fill: ${f.side === 'buy' ? 'bought' : 'sold'} ${M(f.sym) ? tkLotsText(f.sym, f.lots) : f.lots.toFixed(2)} ${pretty(f.sym)} @ ${fp(f.sym, f.px)} · slip ${slipWords(f.slip, f.sym)} <button type="button" class="link" data-fid="${f.fid}">Receipt</button>`; if (lf._h !== h) { lf.innerHTML = h; lf._h = h; } }
}

/* ============ fill receipt ============ */
const simClock = t => new Date(t * 1000).toISOString().slice(11, 19) + ' UTC';
function renderReceipt(fid, both) {
  const f = (S.fills || []).find(x => x.fid === fid);
  if (!f) { toast('Receipt not found', 'Only the last 500 fills are kept.', 'info'); return; }
  let el = $('#fillDlg');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'fillDlg'; document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-fid]'); if (b) { renderReceipt(+b.dataset.fid, b.dataset.rep === '1'); return; } if (e.target === el || e.target.closest('[data-cf]')) el.hidden = true; });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; } });
  }
  const sym = f.sym, side = f.side === 'buy' ? 'Buy' : 'Sell', mdl = f.model || {};
  const srv = typeof TradeLink === 'object' && TradeLink.live; // the server account: executed, not simulated (decision 42)
  const what = f.kind === 'open' ? `opened position #${f.pos}` : f.kind === 'add' ? `added to position #${f.pos}` : f.kind === 'reduce' ? `reduced position #${f.pos}` : `closed position #${f.pos}`;
  const open = f.kind !== 'open' ? (S.fills || []).find(x => x.pos === f.pos && x.kind === 'open') : null;
  // every fill of the position, oldest first: tabs to go between them, and Both (one report with all of them)
  const group = (S.fills || []).filter(x => x.pos === f.pos && !x.nbp).sort((a, b) => a.t - b.t || a.fid - b.fid);
  const fName = x => x.kind === 'open' ? 'Opening' : x.kind === 'add' ? 'Added' : x.kind === 'reduce' ? 'Partial close' : 'Closing';
  const tabs = group.length > 1 ? `<div class="rc-tabs" role="group" aria-label="Fills of position #${f.pos}">${group.map(x => `<button type="button" data-fid="${x.fid}" aria-pressed="${!both && x.fid === f.fid}">${fName(x)} <span class="mono">#F${x.fid}</span></button>`).join('')}<button type="button" data-fid="${f.fid}" data-rep="1" aria-pressed="${!!both}">Both <span>· trade report</span></button></div>` : '';
  if (both && group.length > 1) { el.innerHTML = receiptReport(group, f, tabs); el.hidden = false; rcFocus(el); return; }
  // the receipt reads like a broker's confirmation (Victor, 31.10.2026): side, size and instrument first, the fill price
  // as the hero, then the cells that explain it (slippage coloured by who it favoured), the model as the footnote
  const buy = f.side === 'buy', size = M(sym) ? tkLotsText(sym, f.lots) : f.lots.toFixed(2), un = unitWord(sym, true);
  const sl = Math.abs(f.slip) >= .05 ? (f.slip > 0 ? 'dn' : 'up') : '', e = escHtml;
  const h = !rcIn(f) ? (S.history || []).find(x => x.id === f.pos && Math.abs(x.close - f.t) < 2 && Math.abs(x.lots - f.lots) < 1e-9) : null;
  const cell = (l, v, sub, cls, wide) => `<div class="rc-c${wide ? ' rc-w' : ''}"><dt>${l}</dt><dd><b class="mono ${cls || ''}">${e(v)}</b>${sub ? `<small>${e(sub)}</small>` : ''}</dd></div>`;
  const cells = [
    cell('Requested', fp(sym, f.ref), f.refKind || 'quote'),
    cell('Slippage', slipWords(f.slip, sym), Math.abs(f.slip) >= .05 ? usdFmt(Math.abs(f.slipUsd || 0)) + (f.slip > 0 ? ' cost' : ' saved') : 'filled at the requested price', sl),
    cell('Quote at the fill', `${fp(sym, f.bid)} / ${fp(sym, f.ask)}`, 'bid / ask · ' + simClock(f.t) + (srv ? '' : ' sim')),
    cell('Spread at fill', `${(+f.spread).toFixed(1)} ${un}`, usdFmt(f.spreadUsd || 0)),
    cell('Commission', rcIn(f) ? (f.comm > 0 ? usdFmt(f.comm) : 'none') : 'none at the close', rcIn(f) ? (f.comm > 0 ? 'round turn, paid at this fill' : 'spread-only account') : 'round turn paid at the opening fill'),
    cell('Latency', mdl.live ? `${f.lat} ms` : '0 ms', mdl.live ? (srv ? 'at the execution server' : 'modelled') : 'paused, replay, or slippage off'),
    cell('Gap', f.gap ? 'yes' : 'no', f.gap ? 'the quote jumped past the order price between two checks' : 'the fill came from a continuous quote', f.gap ? 'warn' : '', true)
  ].join('');
  const model = mdl.on ? `symmetric slippage, σ ${mdl.sd} pip + market move over ${mdl.lat} ms latency; equal odds for and against you${mdl.live ? '' : ' (none while paused or in a replay)'}` : 'slippage off — fills at the quote';
  el.innerHTML = `<div class="modal cf-modal rc-modal ${buy ? 'rc-buy' : 'rc-sell'}" role="dialog" aria-modal="true" aria-labelledby="fdT" aria-describedby="fdB">
    <div class="ph"><h2 id="fdT">Fill receipt · #F${f.fid}</h2><span class="rc-t mono">${e(simClock(f.t))}${srv ? '' : ' sim'}</span></div>${tabs}
    <div class="rc-hero">
      <div class="rc-what"><span class="rc-side">${side}</span><b class="mono">${e(size)}</b><b>${e(pretty(sym))}</b>
        <p id="fdB">${e(`${f.reason || 'Manual'} · ${what}`)}</p></div>
      <div class="rc-px"><small>Filled</small><b class="mono">${bigPx(sym, f.px)}</b><small>${e(M(sym) ? lotsWord(sym, f.lots) : f.lots.toFixed(2) + ' lots')} · all-or-nothing (no partial fills)</small></div>
    </div>
    ${h ? `<div class="rc-pnl"><span>Realized P&amp;L (gross)</span><b class="mono ${h.pnl >= 0 ? 'up' : 'dn'}">${e(usdFmt(h.pnl, true))}</b><small class="mono">${e(`${fp(sym, h.entry)} → ${fp(sym, h.exit)} · ${sgn(+h.pips)} ${unitWord(sym)}`)}</small></div>` : ''}
    <dl class="rc-grid">${cells}</dl>
    <p class="rc-model"><span>${typeof TradeLink === 'object' && TradeLink.live ? 'Execution' : 'Model'}</span> ${e(model)}</p>
    <div class="cf-actions">${open && !tabs ? `<button class="ghost" data-fid="${open.fid}">Opening fill #F${open.fid}</button>` : ''}<button class="cta sm" data-cf="cancel">Close</button></div></div>`;
  el.hidden = false; rcFocus(el);
}
// focus Close without scrolling the receipt away from its top (the tabs and the hero)
function rcFocus(el) { const m = el.querySelector('.rc-modal'); el.querySelector('[data-cf=cancel]').focus({ preventScroll: true }); if (m) m.scrollTop = 0; }

// a fill that adds size (the opening, or an order added to it under netting): commission is paid there, no P&L
const rcIn = x => x.kind === 'open' || x.kind === 'add';
/* The trade report (Both): every fill of one position side by side, the realized P&L and what the execution cost */
function receiptReport(group, f, tabs) {
  const sym = f.sym, e = escHtml, un = unitWord(sym, true), o = group.find(x => x.kind === 'open') || group[0];
  const hs = (S.history || []).filter(h => h.id === f.pos && !h.nbp), pnl = hs.reduce((a, h) => a + h.pnl, 0);
  const last = group[group.length - 1], closed = group.filter(x => !rcIn(x));
  const slipUsd = group.reduce((a, x) => a + (Math.abs(x.slip) >= .05 ? x.slipUsd || 0 : 0), 0), sprUsd = o.spreadUsd || 0 /* a round trip pays the spread once */, comm = group.reduce((a, x) => a + (x.comm || 0), 0);
  const name = x => x.kind === 'open' ? 'Opening' : x.kind === 'add' ? 'Added' : x.kind === 'reduce' ? 'Partial close' : 'Closing';
  const slipC = x => Math.abs(x.slip) >= .05 ? (x.slip > 0 ? 'dn' : 'up') : '';
  const rows = [
    ['Fill', x => `<b>${name(x)}</b> <span class="mono">#F${x.fid}</span>`],
    ['Time', x => `<span class="mono">${e(simClock(x.t))} sim</span>`],
    ['Side · size', x => `<span class="rc-s ${x.side === 'buy' ? 'up' : 'dn'}">${x.side === 'buy' ? 'Buy' : 'Sell'}</span> <span class="mono">${e(M(sym) ? tkLotsText(sym, x.lots) : x.lots.toFixed(2))}</span>`],
    ['Filled', x => `<b class="mono rc-big">${bigPx(sym, x.px)}</b>`],
    ['Requested', x => `<span class="mono">${e(fp(sym, x.ref))}</span> <small>${e(x.refKind || 'quote')}</small>`],
    ['Slippage', x => `<b class="mono ${slipC(x)}">${e(slipWords(x.slip, sym))}</b>${Math.abs(x.slip) >= .05 ? ` <small>${e(usdFmt(Math.abs(x.slipUsd || 0)))}</small>` : ''}`],
    ['Quote at the fill', x => `<span class="mono">${e(fp(sym, x.bid))} / ${e(fp(sym, x.ask))}</span>`],
    ['Spread at fill', x => `<span class="mono">${(+x.spread).toFixed(1)} ${un}</span> <small>${e(usdFmt(x.spreadUsd || 0))}</small>`],
    ['Commission', x => rcIn(x) ? (x.comm > 0 ? `<span class="mono">${e(usdFmt(x.comm))}</span> <small>round turn</small>` : '<span class="mono">none</span> <small>spread-only</small>') : '<span class="mono">none</span> <small>paid at the opening</small>'],
    ['Latency', x => `<span class="mono">${(x.model || {}).live ? x.lat + ' ms' : '0 ms'}</span>`],
    ['Gap', x => x.gap ? '<b class="warn">yes</b>' : '<span class="mono">no</span>']
  ];
  const cols = group.length, mdl = o.model || {};
  const table = `<table class="rc-tbl" style="--rc-n:${cols}"><tbody>${rows.map(([l, fn]) => `<tr><th scope="row">${l}</th>${group.map(x => `<td>${fn(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const model = mdl.on ? `symmetric slippage, σ ${mdl.sd} pip + market move over ${mdl.lat} ms latency; equal odds for and against you` : 'slippage off — fills at the quote';
  return `<div class="modal cf-modal rc-modal rc-rep ${o.side === 'buy' ? 'rc-buy' : 'rc-sell'}" role="dialog" aria-modal="true" aria-labelledby="fdT" aria-describedby="fdB">
    <div class="ph"><h2 id="fdT">Trade report · position #${f.pos}</h2><span class="rc-t mono">${e(simClock(o.t))} → ${e(simClock(last.t))} sim</span></div>${tabs}
    <div class="rc-hero">
      <div class="rc-what"><span class="rc-side">${o.side === 'buy' ? 'Buy' : 'Sell'}</span><b class="mono">${e(M(sym) ? tkLotsText(sym, o.lots) : o.lots.toFixed(2))}</b><b>${e(pretty(sym))}</b>
        <p id="fdB">${e(`${o.reason || 'Manual'} · ${closed.length ? `${closed.length === 1 ? 'one closing fill' : closed.length + ' closing fills'}` : 'still open'} · Fill receipts #F${group.map(x => x.fid).join(', #F')}`)}</p></div>
      <div class="rc-px"><small>Entry → exit</small><b class="mono rc-ee">${e(fp(sym, o.px))} → ${e(closed.length ? fp(sym, last.px) : '—')}</b><small>all-or-nothing fills (no partial fills)</small></div>
    </div>
    ${hs.length ? `<div class="rc-pnl"><span>Realized P&amp;L (gross)</span><b class="mono ${pnl >= 0 ? 'up' : 'dn'}">${e(usdFmt(pnl, true))}</b><small class="mono">${e(`${hs.reduce((a, h) => a + h.pips, 0) >= 0 ? '+' : ''}${hs.reduce((a, h) => a + h.pips, 0).toFixed(1)} ${un}`)}</small></div>` : ''}
    ${table}
    <div class="rc-cost"><span>Execution cost</span><b class="mono ${slipUsd > .005 ? 'dn' : slipUsd < -.005 ? 'up' : ''}">slippage ${slipUsd > .005 ? 'cost ' + e(usdFmt(slipUsd)) : slipUsd < -.005 ? 'saved ' + e(usdFmt(-slipUsd)) : 'none'}</b><b class="mono">spread ${e(usdFmt(sprUsd))}</b><b class="mono">commission ${e(comm > 0 ? usdFmt(comm) : 'none')}</b></div>
    <p class="rc-model"><span>${typeof TradeLink === 'object' && TradeLink.live ? 'Execution' : 'Model'}</span> ${e(model)}</p>
    <div class="cf-actions"><button class="cta sm" data-cf="cancel">Close</button></div></div>`;
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
  { const pg = { trade: 'trade', monitor: 'monitor', research: 'research', calendar: 'research', lab: 'lab', 'strategy lab': 'lab', backtester: 'lab', coach: 'coach' }[s]; if (pg) return { desc: `Open ${s[0].toUpperCase() + s.slice(1)}`, run: () => { const b = document.querySelector(`#views [data-view="${pg}"]`); if (b) b.click(); } }; } // page names (UX-81)
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
    const desc = `${side === 'buy' ? 'Buy' : 'Sell'} ${tkLotsText(sym, lots)} ${pretty(sym)}${ot !== 'market' ? ` ${stopLimit ? 'stop-limit' : ot} @ ${fp(sym, price)}${stopLimit ? ' → ' + fp(sym, lmt) : ''}` : ' at market'}${sl ? ` · SL ${sl}${u}` : ''}${tpRows ? ` · TP ${tpRows.map(r => `${r.pips}${u} ${r.pct}%`).join(' · ')}` : tp ? ` · TP ${tp}${u}` : ''}${trail ? ` · trail ${trail}${u}${sl ? '' : ' (the stop)'}` : ''}${beAt ? ` · BE after ${beAt}${u}` : ''}${ot !== 'market' && tif !== 'GTC' ? ` · ${tif}${gtdS ? ' ' + tk[gi + 1] : ''} (UTC)` : ''}${oco ? ` · OCO with #${oco}` : ''}`;
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
    // live: each move is the server's answer, so the count waits for all of them
    const rs = [...S.positions].map(p => manualBe(p)), say = rs => {
      const c = { '': 0, at: 0, tighter: 0, early: 0, refused: 0 }; rs.forEach(r => c[r]++);
      toast('Break-even', `${c['']} moved · ${c.at + c.tighter} already tighter · ${c.early} not past entry${c.refused ? ` · ${c.refused} refused` : ''}`, 'info');
    };
    if (rs.some(r => r instanceof Promise)) Promise.all(rs).then(say); else say(rs);
  } };
  if (tk[0] === 'alert') {
    const sym = findSym(tk[1]) || S.set.sym; const cond = tk.includes('below') ? 'below' : tk.includes('above') ? 'above' : null;
    const px = parseFloat(tk.filter(t => /^\d*\.?\d+$/.test(t)).pop());
    if (px && !isAvailable(sym)) return { desc: `Alert on ${pretty(sym)}`, block: unavailableNote(sym), blockTitle: 'Not offered', run: () => {} };
    if (px) return { desc: `Alert when ${pretty(sym)} ${cond || (px >= Engine.quote(sym).mid ? 'above' : 'below')} ${fp(sym, px)}`, run: () => addAlert(sym, px, cond) };
  }
  if (tk[0] === 'tf' || TF_ALIAS[tk[0]] && tk.length === 1 && isNaN(+tk[0]) ) { const v = TF_ALIAS[tk[tk[0] === 'tf' ? 1 : 0]]; if (v) return { desc: `Timeframe ${v >= 60 ? v / 60 + 'H' : v + 'm'}`, run: () => setTF(v) }; }
  if (tk[0] === 'speed') { const v = parseInt(tk[1]); if ([1, 10, 60, 300].includes(v)) return TradeLink.live ? { desc: 'Market speed: not available on live prices', run: () => toast('Market speed is off', 'Live prices run in real time.', 'info') } : { desc: `Market speed ${v}×`, run: () => setSpeed(v) }; }
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


/* ============ ticket F: one form (audit canvas, artboard 11 "Ticket final", 30.10.2026) ============
   One screen, top to bottom: Sell | Buy, Market | Pending (the pending type follows the price: a buy below the ask is a
   limit, above it a stop; the other way round for a sell), the volume in one unit (lots, risk %, risk $), stop loss and
   take profit off until ticked, each in one unit, the warnings that matter now, margin / risk / R:R, the order button,
   then what is open on this instrument. Management, costs and checks, and the account after the order fold at the foot.
   The C v3 blocks stay where they are: only the linked cells not in use are hidden, so every id, value and listener is
   the one the rest of the app knows. TKF is display state only (which unit each row shows). */
const TKF = { sl: 'price', tp: 'price' };
// what each SL/TP unit means, shown on hover in the unit list (m: the ticket's instrument)
const tkPipW = m => m && m.unit === 'pt' ? 'points' : 'pips';
const TK_UNIT_TIP = {
  tkSlBy: {
    price: () => 'Price: type the stop level itself. A buy’s stop sits below the current price, a sell’s above it.',
    pips: m => `${tkPipW(m)[0].toUpperCase() + tkPipW(m).slice(1)}: the stop’s distance from the entry, in ${tkPipW(m)}. The level moves with the entry price.`,
    atr: () => 'ATR ×: the stop’s distance as a multiple of the 1-hour ATR (the typical hourly range), so it widens when the market moves more. 1.5 = one and a half hourly ranges.',
    rpct: () => 'Risk %: the share of your equity you accept to lose if the stop is hit. The distance is worked out from the volume.',
    rcur: m => `Risk ${m ? m.quote : ''}: the amount you accept to lose if the stop is hit, in ${m ? m.quote : 'the quote currency'}. The distance is worked out from the volume.`,
  },
  tkTpBy: {
    price: () => 'Price: type the target level itself. A buy’s target sits above the current price, a sell’s below it.',
    pips: m => `${tkPipW(m)[0].toUpperCase() + tkPipW(m).slice(1)}: the target’s distance from the entry, in ${tkPipW(m)}. The level moves with the entry price.`,
    r: () => 'R (× stop): the target as a multiple of the stop’s distance. 2 = twice as far as the stop, so the reward is twice the risk. Needs a stop loss.',
  },
};
const TKF_OPEN = 'tb.tkSec';
// the pending type that fits the price: a price on the better side of the quote is a limit, on the worse side a stop
function tkPendAuto() {
  const t = S.tk; if (t.ot === 'market' || !(t.price > 0) || !M(S.set.sym)) return;
  const q = Engine.quote(S.set.sym), d = t.side === 'buy' ? 1 : -1, ref = d > 0 ? q.ask : q.bid;
  if (!(ref > 0) || t.price === ref) return;
  const ot = d * (t.price - ref) < 0 ? 'limit' : 'stop';
  if (ot !== t.ot) { t.ot = ot; dirty.lines = true; }
}
// the warnings worth a line above the button; everything else is listed under Costs & checks
function tkAlerts(k) {
  const a = [], un = unitWord(k.sym), sp = k.q.spread, now = Engine.simTime;
  const ev = CAL.events.find(e => !e.done && e.impact === 'hi' && k.m.newsCcy.includes(e.ccy) && e.t >= now && e.t - now <= 900);
  if (ev) a.push(`High-impact ${ev.ccy} ${ev.name} in ${fmtIn(ev.t - now)}: spreads and slippage can widen.`);
  if (k.lots >= k.mn) { const w = tkWhatIf(k); if (w.post.level > 50 && w.post.level < 100) a.push(`Margin level after this order ${nf0.format(w.post.level)}%: stop-out is at 50%.`); }
  if (k.slPips != null && !k.trailOnly && k.slPips > sp && k.slPips < 2 * sp) a.push(`Stop loss ${+k.slPips.toFixed(1)} ${un} is less than twice the spread (${sp.toFixed(1)} ${un}).`);
  return a;
}
// the hold (TKH) moves to the unit picked, with the current stop / target in it, so nothing changes but the unit
function tkUnitConvert(row, v) {
  const t = S.tk; if (!M(S.set.sym)) return;
  tkHold(); const k = tkCalc(), m = k.m;
  if (row === 'sl') {
    if (!(t.useSL && t.sl > 0)) { TKH.sl = 'pips'; return; }
    const a = tkAtr1h(k.sym), fx = Engine.usd(m.quote) || 1;
    if (v === 'price') Object.assign(TKH, { sl: 'price', slPx: +(k.entry - k.d * t.sl * m.pip).toFixed(m.digits) });
    else if (v === 'atr' && a > 0) Object.assign(TKH, { sl: 'atr', slAtr: t.sl / a });
    else if (v === 'rpct' && k.riskUsd > 0 && k.a.eq > 0) Object.assign(TKH, { sl: 'rpct', slRp: k.riskUsd / k.a.eq * 100 });
    else if (v === 'rcur' && k.riskUsd > 0) Object.assign(TKH, { sl: 'rcur', slRc: k.riskUsd / fx });
    else TKH.sl = 'pips';
  } else {
    if (!(t.useTP && t.tp > 0)) { TKH.tp = 'pips'; return; }
    if (v === 'price') Object.assign(TKH, { tp: 'price', tpPx: +(k.entry + k.d * t.tp * m.pip).toFixed(m.digits) });
    else if (v === 'r' && t.useSL && t.sl > 0) Object.assign(TKH, { tp: 'r', tpR: t.tp / t.sl });
    else TKH.tp = 'pips';
  }
  TKH.err.sl = TKH.err.tp = ''; tkHold();
}
function tkFormBuild() {
  const tk = $('.ticket .tk3'); if (!tk || $('#tkOnSym')) return;
  const el = h => { const x = document.createElement('template'); x.innerHTML = h.trim(); return x.content.firstElementChild; };
  const sel = (id, lbl, opts) => `<select id="${id}" class="tk-unit" aria-label="${lbl}">${opts.map(([v, w]) => `<option value="${v}">${w}</option>`).join('')}</select>`;
  // order type: Market | Pending. The Limit button becomes Pending; Stop stays in the markup (hidden) for the code that clicks it
  const lim = $('#otSeg [data-ot=limit]'), stp = $('#otSeg [data-ot=stop]');
  // Pending pressed again keeps the price typed (app.js would put the default price back)
  $('#otSeg').addEventListener('click', e => { if (e.target.closest('[data-ot=limit]') && S.tk.ot !== 'market') e.stopPropagation(); }, true);
  lim.innerHTML = '<span class="ot-n">Pending</span> <small class="ot-p">at a price</small>'; stp.hidden = true;
  $('#priceField').after(el(`<div class="tk-pendtype mono" id="tkPendType"></div>`));
  // volume: one unit at a time, with quick sizes (lots) or risk chips (risk %, risk $) under it
  const vh = $('#tkVolBlk .tk3-h'), vl = vh.querySelector('label'); vl.textContent = M(S.set.sym) && M(S.set.sym).kind === 'cfd' ? 'Volume' : 'Volume · lots';
  vh.insertAdjacentHTML('beforeend', sel('tkSizeBy', 'Size in', [['lots', 'Lots'], ['pct', 'Risk %'], ['usd', 'Risk $']]));
  const vRow = $('#tkVolBlk .tk3-row3'); vRow.classList.add('tk-one');
  const presets = el(`<div class="tk-presets" id="tkPresets" role="group" aria-label="Quick size"><button type="button" data-lots="0.1">0.10</button><button type="button" data-lots="0.5">0.50</button><button type="button" data-lots="1">1.00</button></div>`);
  vRow.after(presets); $('#sizeHint').after($('#tkCtr'));
  // stop loss and take profit: the switch, the unit, the money; one field
  $('#tkSlBlk .tk3-h>label').after(el(sel('tkSlBy', 'Stop loss in', [['price', 'Price'], ['pips', 'Pips'], ['atr', 'ATR ×'], ['rpct', 'Risk %'], ['rcur', 'Risk']])));
  $('#tkTpBlk .tk3-h>label').after(el(sel('tkTpBy', 'Take profit in', [['price', 'Price'], ['pips', 'Pips'], ['r', 'R (× stop)']])));
  for (const r of $$('#tkSlBlk .tk3-row3,#tkTpBlk .tk3-row3')) r.classList.add('tk-one');
  // stop loss and take profit in one group: stacked, side by side on a wide ticket (CSS container query)
  const exits = el(`<div class="tk-exits" id="tkExits"></div>`); $('#tkSlBlk').before(exits); exits.append($('#tkSlBlk'), $('#tkTpBlk'));
  // compact (audit canvas, artboard 12): Good till beside the entry price, the volume on one row, SL | TP side by side;
  // the helper lines become titles (nothing removed)
  // the order in one glance (artboard 13): its type under the title, on the side's colour
  $('.ticket>.ph').after(el(`<div class="tk-typeband" id="tkTypeBand" role="status" aria-live="polite"><b></b><span></span></div>`));
  $('#tkPrice').closest('.stepper').after($('#tkTif'));
  for (const o of $('#tkTif').options) { o.title = o.textContent; o.textContent = { GTC: 'GTC', DAY: 'Day', GTD: 'GTD' }[o.value] || o.textContent; }
  $('#tkTif').title = 'Good till: GTC until you cancel it, Day until the end of the day, GTD for a number of minutes (UTC)';
  const vbar = el(`<div class="tk-volrow" id="tkVolRow"><span class="tk-vl">Volume</span></div>`);
  $('#tkVolBlk .tk3-h').after(vbar); vbar.append(vRow, presets, $('#tkChips'), $('#tkSizeBy'));
  vbar.after(el(`<div class="tk-volx" id="tkVolX" role="status" aria-live="polite"></div>`));
  for (const [row, short, long] of [['Sl', 'SL', 'Stop loss'], ['Tp', 'TP', 'Take profit']]) {
    const lb = $(`#tk${row}Blk .tk3-h>label`); for (const n of [...lb.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.textContent = ' ' + short;
    lb.title = long; $(`#tk${row}Blk .tk3-row3`).after($(`#${row.toLowerCase()}Money`));
  }
  $('#tkExits').title = $('#tkTip').textContent;
  // the foot of the form: the warnings that matter now, margin / risk / R:R, the button, then the instrument's book
  $('#tkSubmit').before(el(`<div class="tk-alert" id="tkAlert" role="status" hidden></div>`), el(`<div class="tk-fm" id="tkFootM"></div>`));
  const keys = tk.querySelector('.tk3-keys');
  const on = el(`<section class="tk-on" id="tkOnSym" aria-label="Open on this instrument"><div class="tk-on-h"><span id="tkOnT"></span><span id="tkOnNet"></span></div><div id="tkOnBody"></div></section>`);
  // folded at the foot: Management, Costs & checks, Account after (shell.js writes the exits / acct summaries)
  const adv = el(`<details class="tk-adv" id="tkAdv" data-sec="adv"><summary><span class="tk-adv-t">Advanced</span><span class="tk-adv-s" id="tkAdvS"></span><span class="tk-adv-x" aria-hidden="true"></span></summary><div class="tk-secs" id="tkSecs">${[['exits', 'Management'], ['check', 'Costs & checks'], ['acct', 'Account after']].map(([k, t]) => `<details class="tk-sec" data-sec="${k}"><summary><span class="tk-sec-t">${t}</span><span class="tk-sec-s" data-sum="${k}"></span></summary></details>`).join('')}</div></details>`);
  const secs = adv.querySelector('#tkSecs');
  keys.before(on, el(`<div class="tk-grow" aria-hidden="true"></div>`), adv);
  const sec = k => secs.querySelector(`[data-sec="${k}"]`), put = (k, ...nodes) => { for (const n of nodes) if (n) sec(k).appendChild(n); };
  put('exits', $('#tkSplit')?.closest('.field'), $('#tkSplitField'), $('#useTrail').closest('.field'), $('#tkBeField'));
  // Management, one row per option; its settings show only while it is on
  const trF = $('#useTrail').closest('.field'), trU = trF.querySelector('.lbl-row .unit'), trS = trF.querySelector('.stepper');
  trF.classList.add('tk-opt'); const trW = el(`<div class="tk-opt-v" id="tkTrailV"></div>`); trS.before(trW); trW.append(trS); if (trU) trW.append(trU);
  const beF = $('#tkBeField'); beF.classList.add('tk-opt');
  const beRow = el(`<div class="tk-be-row" id="tkBeRow"></div>`), un0 = () => el(`<span class="unit">pips</span>`);
  const l1 = el(`<span class="tk-be-l"></span>`), l2 = el(`<span class="tk-be-l"></span>`);
  // each break-even setting is a row of two equal halves: what it is | the field with its unit
  const beV = (inp) => { const v = el(`<span class="tk-be-v"></span>`); v.append(inp, un0()); return v; };
  l1.append(el(`<span class="tk-be-t">After, in profit</span>`), beV($('#tkBeAt'))); l2.append(el(`<span class="tk-be-t">Move the stop to entry +</span>`), beV($('#tkBeOff'))); beRow.append(l1, l2);
  const beOld = beF.querySelector(':scope>div:not(.lbl-row)'); if (beOld) beOld.replaceWith(beRow); else beF.append(beRow);
  beF.querySelector('.lbl-row .unit')?.remove();
  for (const i of [$('#tkBeOff'), $('#tkBeAt')]) i.removeAttribute('style');
  $('#tkBeAt').setAttribute('aria-label', 'Break-even trigger, pips in profit');
  const math = el(`<details class="tk-math"><summary>Trade math</summary></details>`); math.appendChild($('#tkStats'));
  put('check', $('#tkWarn'), el(`<div class="tk-rows" id="tkChkRows"></div>`), el(`<div class="tk-rr-cap" id="tkRrCap"></div>`), $('#rrBar'), $('#tkExecNote'), math);
  const how = el(`<details class="tk-math" id="tkWiHow"><summary>How this is computed</summary><div id="tkWiNotes"></div></details>`);
  put('acct', $('#tkWhatIf'), how);
  let open = {}; try { open = JSON.parse(localStorage.getItem(TKF_OPEN) || '{}') || {}; } catch (e) { open = {}; }
  for (const d of [adv, ...secs.children]) {
    d.open = !!open[d.dataset.sec];
    d.addEventListener('toggle', () => { let o = {}; try { o = JSON.parse(localStorage.getItem(TKF_OPEN) || '{}') || {}; } catch (e) { o = {}; } o[d.dataset.sec] = d.open; try { localStorage.setItem(TKF_OPEN, JSON.stringify(o)); } catch (e) { /* private mode */ } });
  }
  // the old summary and More are empty now (their figures are in the foot and the folded sections)
  for (const x of [$('.tk3-sum'), $('#tkMore')]) if (x) x.hidden = true;
  // execution settings belong to the account, not to one order: Help → Settings
  const ex = $('#tkExecField'), hs = $('#help .help-set');
  if (ex && hs) {
    const g = el(`<div class="set-exec" role="group" aria-labelledby="execH"><h4 id="execH">Execution</h4></div>`); g.appendChild(ex); hs.appendChild(g);
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
    g.addEventListener('input', e => {
      const id = e.target.id, v = num(e.target.value); if (v == null) return;
      if (id === 'tkSlipSd') S.set.slipSd = clamp(v, 0, 5); else if (id === 'tkLat') S.set.latMs = clamp(Math.round(v), 0, 2000); else if (id === 'tkComm') S.set.comm = clamp(v, 0, 50); else return;
      dirty.lines = true; save();
    });
    g.addEventListener('change', e => { if (e.target.id === 'tkSlipOn') { S.set.slip = e.target.checked ? 'sym' : 'off'; syncTicketInputs(); } });
  }
  // events
  $('#tkSizeBy').addEventListener('change', e => {
    const t = S.tk, v = e.target.value;
    tkVolClear(); // sizing changes: a size typed outside the sheet no longer applies (#7)
    if (v === 'lots') t.sm = 'lots';
    else {
      // sizing by risk needs a stop: it is switched on with the unit
      const k = tkCalc(); t.sm = 'risk'; t.useSL = true; TKH.size = v;
      if (v === 'usd') TKH.usd = k.riskUsd > 0 ? +k.riskUsd.toFixed(2) : +(k.a.eq * t.risk / 100).toFixed(2);
    }
    syncTicketInputs();
  });
  /* a new unit shows the same stop / target converted (F5): the field shown becomes the held one, with the value it had
     in the old unit; it gets the focus with its value selected (the focus-clears-the-field rule of the ticket would
     otherwise leave it empty) */
  const unitTo = (row, v) => {
    tkUnitConvert(row, v); TKF[row] = v; renderTicket();
    const f = $(`#tk${row === 'sl' ? 'Sl' : 'Tp'}Blk .tk3-c:not([hidden]) input`); if (!f || f.disabled) return;
    const v0 = f.value; f.focus();
    if (f.value === '' && (f.dataset.was || v0)) f.value = f.dataset.was || v0;
    f.placeholder = ''; delete f.dataset.was; try { f.select(); } catch (e) { /* number inputs without selection */ }
  };
  $('#tkSlBy').addEventListener('change', e => unitTo('sl', e.target.value));
  $('#tkTpBy').addEventListener('change', e => {
    // a unit for the single take profit: split targets (Advanced) give way to it, and the ticket says so
    const x = tkx(); if (S.tk.useTP && x.split) { x.split = false; save(); toast('Split take profit off', 'One take profit now, in the unit you picked. Split targets are in Advanced.', 'info'); syncTicketInputs(); }
    unitTo('tp', e.target.value);
  });
  presets.addEventListener('click', e => { const b = e.target.closest('[data-lots]'); if (!b) return; tkVolClear(); TKV.note = null; S.tk.sm = 'lots'; S.tk.lots = tkLotsFor(S.set.sym, +b.dataset.lots); syncTicketInputs(); });
  // Enter in a field goes to the order button (a second Enter sends)
  tk.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('input:not([type=checkbox])') && e.target.closest('.tk3') && !e.target.closest('.tk-sec')) { e.preventDefault(); $('#tkSubmit').focus(); } });
  on.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, row = b.closest('[data-pos],[data-ord]'), sym = S.set.sym;
    if (act === 'closesym') { closeWhere(p => p.sym === sym); return; }
    if (!row) return;
    if (row.dataset.ord) { const o = S.orders.find(x => String(x.id) === row.dataset.ord); if (act === 'cancel' && o) cancelOrder(o.id); return; }
    const id = +row.dataset.pos, p = S.positions.find(x => x.id === id); if (!p) return;
    // a grey '½' only says why (half of the minimum size would close it all)
    if (act === 'half' && b.getAttribute('aria-disabled') === 'true') { toast("Can't close half", `${pretty(p.sym)} #${p.id} is at the minimum size (${M(p.sym) ? lotsWord(p.sym, volOf(p.sym)[0]) : p.lots}): use ✕ Close to close it all`, 'info'); return; }
    if (act === 'close') closeClick(id); else if (act === 'half') closeClick(id, 'Partial close', .5); else if (act === 'rev') confirmRev(p);
  });
}
// what is open on the instrument: positions with their P&L and actions, pending orders with their distance
function tkOnSymRender(sym) {
  const box = $('#tkOnBody'); if (!box) return;
  const ps = S.positions.filter(p => p.sym === sym), os = S.orders.filter(o => o.sym === sym), name = pretty(sym);
  const tt = $('#tkOnT'), tw = `On ${name} now`; if (tt.textContent !== tw) tt.textContent = tw;
  const key = sym + '|' + ps.map(p => `${p.id}:${p.lots}:${p.side}:${p.sl}:${p.tp}`).join(',') + '|' + os.map(o => `${o.id}:${o.price}:${o.lots}`).join(',');
  if (box._k !== key) {
    box._k = key; if (TKTIP.el && box.contains(TKTIP.el)) tkTipHide();
    const lots = (s, v) => M(s) ? lotsFmt(s, v) : (+v).toFixed(2);
    box.innerHTML = !ps.length && !os.length ? ''
      : `<table class="tk-on-tbl"><colgroup><col class="c-sd"><col class="c-lt"><col><col class="c-pl"><col class="c-ac"></colgroup><thead><tr><th scope="col">Side</th><th scope="col">Size</th><th scope="col">Entry · SL / TP</th><th scope="col" class="r">P&amp;L</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>`
        + ps.map(p => `<tr data-pos="${p.id}"><td><span class="tag ${p.side}">${p.side}</span></td><td>${lots(p.sym, p.lots)}</td><td>${fp(p.sym, p.entry)}<br><span class="muted">${p.sl != null ? fp(p.sym, p.sl) : '—'} / ${p.tp != null ? fp(p.sym, p.tp) : '—'}</span></td><td class="r" data-c="pnl"></td><td><div class="acts">${tkHalfBtn(p)}<button type="button" data-act="rev" aria-label="Rev: reverse #${p.id}" title="Reverse">Rev</button><button type="button" data-act="close" aria-label="Close #${p.id}" title="Close">✕</button></div></td></tr>`).join('')
        + os.map(o => `<tr data-ord="${escHtml(o.id)}" class="ord"><td colspan="3"><span class="tag ${o.side}">${o.side} ${escHtml(ordType(o))}</span> ${lots(o.sym, o.lots)} @ ${fp(o.sym, o.price)}</td><td class="r" data-c="dist"></td><td><div class="acts"><button type="button" data-act="cancel" aria-label="Cancel order #${escHtml(o.id)}" title="Cancel order">✕</button></div></td></tr>`).join('')
        + `</tbody></table>${ps.length > 1 ? `<button type="button" class="tk-on-all" data-act="closesym">Close all ${escHtml(name)} positions</button>` : ''}`;
  }
  let net = 0, pnl = 0;
  for (const tr of box.querySelectorAll('tr[data-pos]')) {
    const p = S.positions.find(x => x.id === +tr.dataset.pos); if (!p) continue;
    const r = posPnl(p); net += (p.side === 'buy' ? 1 : -1) * p.lots; pnl += r.pnl;
    const c = tr.querySelector('[data-c=pnl]'), v = usdFmt(r.pnl, true); if (c.textContent !== v) { c.textContent = v; c.className = 'r ' + cls(r.pnl); }
  }
  for (const tr of box.querySelectorAll('tr[data-ord]')) {
    const o = S.orders.find(x => String(x.id) === tr.dataset.ord); if (!o) continue;
    const q = Engine.quote(o.sym), ref = o.side === 'buy' ? q.ask : q.bid, v = (Math.abs(o.price - ref) / M(o.sym).pip).toFixed(1) + ' ' + uShort(o.sym);
    const c = tr.querySelector('[data-c=dist]'); if (c.textContent !== v) c.textContent = v;
  }
  const nh = ps.length ? `net ${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(2)} · <b class="${cls(pnl)}">${usdFmt(pnl, true)}</b>` : os.length ? `${os.length} pending` : 'none';
  const ne = $('#tkOnNet'); if (ne._h !== nh) { ne.innerHTML = nh; ne._h = nh; }
}
function tkFormRender(k) {
  const tk = $('#tkOnSym'); if (!tk) return;
  const t = S.tk, sym = k.sym, m = k.m, un = unitWord(sym), pend = t.ot !== 'market';
  const tog = (e, on, c = 'on') => { if (e && e.classList.contains(c) !== on) e.classList.toggle(c, on); };
  const hide = (e, h) => { if (e && e.hidden !== h) e.hidden = h; };
  const setT = (e, v) => { if (e && e.textContent !== v) e.textContent = v; };
  tog($('#otSeg [data-ot=market]'), !pend); tog($('#otSeg [data-ot=limit]'), pend); tog($('#otSeg [data-ot=stop]'), false);
  // the type band and the side's tint on the whole ticket
  const panel = tk.closest('.ticket'), buy = k.side === 'buy'; tog(panel, buy, 'tk-buy'); tog(panel, !buy, 'tk-sell'); tog(panel, k.ot !== 'market', 'tk-pend');
  const tb = $('#tkTypeBand'); if (tb) { setT(tb.firstChild, `${buy ? 'BUY' : 'SELL'} ${pend ? (k.stopLimit ? 'STOP-LIMIT' : t.ot.toUpperCase()) : 'MARKET'}`); setT(tb.lastChild, pend ? '@ ' + fp(sym, k.entry) : 'at market'); }
  if (pend) {
    const ref = k.d > 0 ? k.q.ask : k.q.bid, dist = Math.abs(k.entry - ref) / m.pip, pm = pendMin(sym, k.side);
    const ph = `<span>${nfx(dist, 1)} ${un} ${k.entry < ref ? 'below' : 'above'} ${k.d > 0 ? 'ask' : 'bid'} · min ${escHtml(pm.words)}</span><span>${k.expires != null ? '→ ' + new Date(k.expires * 1000).toISOString().slice(11, 16) + ' UTC' : k.tif}</span>`;
    const pe = $('#tkPendType'); if (pe._h !== ph) { pe.innerHTML = ph; pe._h = ph; pe.title = [$('#tkPendHint')?.textContent, $('#tkTifHint')?.textContent].filter(Boolean).join(' · '); }
    // Good till's own row only for what does not fit beside the price: the GTD minutes and an OCO link
    const tf = $('#tkTifField'); if (tf) hide(tf, !(tkx().tif === 'GTD' || !$('#tkOcoRow').hidden));
    const lf = $('#tkLmtField'), lp = $('#tkLmtPx')?.textContent || ''; if (lf && lf.title !== lp) lf.title = lp;
  }
  // volume: lots only (Victor, 31.10.2026: the size is typed, its margin and exposure shown as it is typed); a ticket
  // saved while sizing by risk keeps the size it had, in lots
  if (t.sm !== 'lots') { tkVolClear(); t.lots = normLots(sym, k.lots) || t.lots; t.sm = 'lots'; save(); }
  const sizeBy = 'lots', sb = $('#tkSizeBy');
  hide(sb, true); hide($('#tkChips'), true);
  for (const c of $$('#tkVolBlk .tk3-row3>.tk3-c')) hide(c, c.dataset.k !== sizeBy);
  hide($('#tkPresets'), false);
  for (const b of $$('#tkPresets [data-lots]')) tog(b, t.sm === 'lots' && Math.abs(k.lots - +b.dataset.lots) < 1e-9);
  // stop loss / take profit: the unit, its field; off says none
  const pipW = m.unit === 'pt' ? 'Points' : 'Pips';
  for (const [row, on, by] of [['sl', t.useSL, $('#tkSlBy')], ['tp', t.useTP && !k.split, $('#tkTpBy')]]) {
    const blk = $(row === 'sl' ? '#tkSlBlk' : '#tkTpBlk');
    if (row === 'sl') {
      // a stop at a risk needs the volume in lots: with sizing by risk the two options are off (back to points)
      const rk = t.sm === 'risk', cur = `Risk ${m.quote}`;
      for (const o of by.querySelectorAll('[value=rpct],[value=rcur]')) { if (o.disabled !== rk) o.disabled = rk; o.title = rk ? 'Needs the volume in lots: sizing by risk already sets the size from the stop' : ''; }
      setT(by.querySelector('[value=rcur]'), cur); setT(blk.querySelector('.tk3-rc'), cur);
      if (rk && (TKF.sl === 'rpct' || TKF.sl === 'rcur')) TKF.sl = 'pips';
    }
    if (row === 'tp') { const ro = by.querySelector('[value=r]'); if (ro.disabled !== !t.useSL) ro.disabled = !t.useSL; if (TKF.tp === 'r' && !t.useSL) TKF.tp = 'pips'; }
    setT(by.querySelector('[value=pips]'), pipW);
    if (by.value !== TKF[row] && document.activeElement !== by) by.value = TKF[row];
    hide(by, !on); hide(blk.querySelector('.tk3-row3'), !on);
    for (const c of blk.querySelectorAll('.tk3-row3>.tk3-c')) hide(c, c.dataset.k !== TKF[row]);
    const mo = $(row === 'sl' ? '#slMoney' : '#tpMoney');
    if (!on) setT(mo, k.split && row === 'tp' ? `${(k.tps || tkx().tps).length} targets` : 'none');
    tog(mo, !on, 'off');
  }
  hide($('#tkTip'), true);
  const sh = $('#sizeHint'), ct = $('#tkCtr')?.textContent || ''; if (sh && sh.title !== ct) sh.title = ct;
  // the keyboard note rides on the order button as its title (compact ticket: the line itself is hidden)
  const kn = tk.parentElement?.querySelector('.tk3-keys')?.textContent.replace(/\s+/g, ' ').trim() || '', sbt = $('#tkSubmit'); if (sbt && sbt.title !== kn) sbt.title = kn;
  // Management: an option's settings only while it is on
  hide($('#tkTrailV'), !t.useTrail); const bx = tkx(); hide($('#tkBeRow'), !bx.be); hide($('#tkBeTp')?.closest('label'), !bx.be);
  // the risk : reward bar, named
  const rc = $('#tkRrCap'), rq = tkRR(k), rqBad = tkExitBad(k);
  const rcH = rq ? `<span>Risk : reward</span><b class="mono"><span class="dn">${escHtml(usdFmt(-k.riskUsd))}</span> : <span class="up">${escHtml(usdFmt(k.rewUsd, true))}</span> · 1 : ${rq.toFixed(2)}</b>` : `<span>Risk : reward</span><b class="mono muted">${rqBad ? '—' : 'needs a stop and a target'}</b>`;
  if (rc && rc._h !== rcH) { rc.innerHTML = rcH; rc._h = rcH; } hide($('#rrBar'), !rq);
  // the warnings worth a line here
  const al = tkAlerts(k), ah = al.map(x => `<div>${escHtml(x)}</div>`).join(''), ae = $('#tkAlert');
  hide(ae, !al.length); if (ae._h !== ah) { ae.innerHTML = ah; ae._h = ah; }
  // margin, risk, R:R
  const eq = k.a.eq, rp = k.riskUsd != null && eq > 0 ? k.riskUsd / eq * 100 : null, rr = rq, lim = tkLimit();
  const rpCls = rp == null ? 'warn' : rp > RISK_CAP ? 'dn' : rp > lim.v ? 'warn' : '';
  // one line each (Victor, 31.10.2026): Margin and Risk in four cells, R:R in two (break-even in its title)
  const fmRow = (l, cells, title) => `<div class="fm-row fm-${cells.length + 1}"${title ? ` title="${escHtml(title)}"` : ''}><label>${l}</label>${cells.map(([v, c]) => `<b class="mono ${c || ''}${String(v).replace(/<[^>]*>/g, '').length > 10 ? ' fm-long' : ''}">${v}</b>`).join('')}</div>`;
  // a size the order cannot have (under the minimum, over the maximum, negative) shows no margin or risk figure:
  // a negative or impossible amount would read as real (UX 09.11 F13, tester follow-up)
  const badSize = /^(Minimum|Maximum)/.test(tkVolMsg(k));
  const fh = badSize
    ? fmRow('Margin', [['—', 'sub'], [`1:${k.lev}`, 'sub'], ['—', 'sub']], 'Enter a valid size to see the margin')
      + fmRow('Risk', [['—', 'sub'], ['—', 'sub'], ['limit ' + pct(lim.v, 2, false), 'sub']], `Risk limit ${pct(lim.v, 2, false)} of equity`)
      + fmRow('R : R', [['—', 'muted']], '')
    : fmRow('Margin', [[usdFmt(k.mgShow ?? k.margin), 'dn'], [`1:${k.lev}`, 'sub'], [eq > 0 ? `${pct((k.mgShow ?? k.margin) / eq * 100, 2, false)} eq.` : '—', 'sub']], eq > 0 ? `Margin ${usdFmt(k.mgShow ?? k.margin)} at leverage 1:${k.lev} = ${pct((k.mgShow ?? k.margin) / eq * 100, 2, false)} of equity` : '')
    + fmRow('Risk', [[rp != null ? pct(rp, 2, false) : 'no stop', rpCls], [k.riskUsd != null ? usdFmt(-k.riskUsd) : (() => { try { const w = tkWhatIf(k), D = w.post.eq - .5 * w.post.mg; return w.so.hedged || !(D > 0) ? 'downside open' : `<i>to stop-out ≈</i><i>${usdFmt(-D)}</i>`; } catch (e) { return 'downside open'; } })(), k.riskUsd != null ? 'dn' : 'sub fm-2l'], ['limit ' + pct(lim.v, 2, false), 'sub']], `Risk limit ${pct(lim.v, 2, false)} of equity`)
    + fmRow('R : R', [[rr ? '1 : ' + rr.toFixed(2) : rqBad || k.tp != null || k.rewUsd != null ? '—' : 'no target', rr ? (rr < 1 ? 'warn' : '') : 'muted']], rr ? `Break-even at ${pct(100 / (1 + rr), 0, false)} winning trades` : '');
  const fm = $('#tkFootM'); if (fm._h !== fh) { fm.innerHTML = fh; fm._h = fh; }
  // Costs & checks: the cost rows and a one-line summary
  const sw = swapPerNight(sym, k.side, k.lots), tri = nextTriple(Engine.simTime, sym), row = (a, b) => `<div><span>${a}</span><b class="mono">${b}</b></div>`;
  const ch = row('Spread cost', usdFmt(k.spreadCost)) + row('Commission', k.comm > 0 ? usdFmt(k.comm) : 'none') + row('Swap a night', usdFmt(sw, true)) + row('Next triple swap', isFinite(tri) ? fmtIn(tri - Engine.simTime) : '—');
  const cr = $('#tkChkRows'); if (cr._h !== ch) { cr.innerHTML = ch; cr._h = ch; }
  const nNotes = Math.max(0, ($('#tkWarn')?.children.length || 1) - 1), cs = `<b>${escHtml(usdFmt(k.spreadCost + k.comm))}</b> · swap ${escHtml(usdFmt(sw, true))}/night · ${nNotes} note${nNotes === 1 ? '' : 's'}`;
  const ce = $('.tk-sec-s[data-sum="check"]'); if (ce && ce._h !== cs) { ce.innerHTML = cs; ce._h = cs; }
  // Advanced, closed: what is switched on in it and what the order costs, so the row says why it is worth opening
  const ax = tkx(), on = [t.useTrail && t.trail > 0 ? `trailing ${t.trail}` : '', ax.be ? 'break-even' : '', t.useTP && ax.split ? `${ax.tps.length} targets` : ''].filter(Boolean);
  setT($('#tkAdvS'), `costs ${usdFmt(k.spreadCost + k.comm)} · ${on.length ? on.join(' · ') : 'no trailing, no break-even'}`);
  tkOnSymRender(sym);
}
/* front · ticket modes (Victor, 31.10.2026): Market order / Pending order as two big tabs at the top of the panel.
   Market: the side is chosen at the click, by two big SELL / BUY buttons at the bottom with the live bid / ask (the
   Buy/Sell switch and the order button are hidden). Pending: the Buy/Sell switch and the order button as before.
   The tabs are the existing #otSeg buttons, so the order type keeps its one implementation; Advanced is untouched. */
(function tkModes() {
  const tk = document.querySelector('.panel.ticket'), ot = $('#otSeg'), sub = $('#tkSubmit'), body = tk && tk.querySelector('.tk3');
  if (!tk || !ot || !sub || !body) return;
  ot.classList.add('tk-modes'); (tk.querySelector('.ph') || body).after(ot);
  for (const [k, n, p] of [['market', 'Market order', 'now'], ['limit', 'Pending order', 'at a price']]) {
    const b = ot.querySelector(`[data-ot=${k}]`); if (!b) continue;
    b.querySelector('.ot-n').textContent = n; const s = b.querySelector('.ot-p'); if (s) s.textContent = p;
  }
  sub.insertAdjacentHTML('afterend', `<div class="tk-go" id="tkGo" role="group" aria-label="Send a market order">
    <button type="button" class="tk-go-b sell" data-go="sell"><small>Sell</small><b class="mono" id="tkGoBid"></b></button>
    <button type="button" class="tk-go-b buy" data-go="buy"><small>Buy</small><b class="mono" id="tkGoAsk"></b></button></div>`);
  const go = $('#tkGo');
  go.addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b || b.disabled) return;
    S.tk.side = b.dataset.go; renderTicket(); submitTicket();
  });
  // the ticket describes the button you are about to press (UX-7, UX-13): the pointer or the focus on Sell or Buy makes
  // the summary, the netting note, the stop's validation and the SL/TP shown those of that side, before the click
  const aim = e => { const b = e.target.closest && e.target.closest('[data-go]'); if (!b || !S || !S.tk || S.tk.ot !== 'market') return;
    if (S.tk.side === b.dataset.go && TKP.on) return; S.tk.side = b.dataset.go; tkPreviewSet(true); renderTicket(); };
  go.addEventListener('pointerover', aim); go.addEventListener('focusin', aim);
  const sync = () => {
    if (typeof S === 'undefined' || !S || !S.tk) return; // built before the state loads; the first render syncs
    // the ticket renames the order-type buttons on each render: the switch keeps its own names
    for (const [k, n] of [['market', 'Market order'], ['limit', 'Pending order']]) { const e = ot.querySelector(`[data-ot=${k}] .ot-n`); if (e && e.textContent !== n) e.textContent = n; }
    const ph = tk.querySelector('.ph'); if (ph && ph.nextElementSibling !== ot) ph.after(ot); // the type band is added later: the tabs stay first
    // the instrument, large, right under the switch
    let nm = $('#tkInst'); if (!nm) { nm = document.createElement('div'); nm.id = 'tkInst'; nm.className = 'tk-inst'; }
    if (ot.nextElementSibling !== nm) ot.after(nm);
    // name in the middle, the live spread at the right edge (mirrored from the header's #tkSpr, which the ticks update)
    if (!nm.querySelector('.tk-inst-n')) { nm.innerHTML = '<span class="tk-inst-n"></span><span class="tk-inst-s mono" title="Spread now"><i>SPR</i> <b></b></span>'; const src = $('#tkSpr'), dst = nm.querySelector('.tk-inst-s b'), cp = () => { if (src && dst.textContent !== src.textContent) dst.textContent = src.textContent; }; if (src) new MutationObserver(cp).observe(src, { childList: true, characterData: true, subtree: true }); cp(); }
    const sy = S.set.sym, nt = M(sy) ? pretty(sy) : sy, nn = nm.querySelector('.tk-inst-n'); if (nn.textContent !== nt) { nn.textContent = nt; nm.title = M(sy) ? `${M(sy).short || sy} · ${contractText(sy)}` : sy; }
    const mk = S.tk.ot === 'market'; tk.classList.toggle('tk-mk', mk); if (!mk) return;
    const bid = $('#tkBid'), ask = $('#tkAsk'), gb = $('#tkGoBid'), ga = $('#tkGoAsk');
    if (bid && gb.innerHTML !== bid.innerHTML) gb.innerHTML = bid.innerHTML;
    if (ask && ga.innerHTML !== ask.innerHTML) ga.innerHTML = ask.innerHTML;
    // blocked (market closed, margin, size…): both buttons say why, as the order button would
    // each button for its own side (UX-7): a Sell that reduces a long is not blocked by what would block a Buy
    for (const b of go.querySelectorAll('[data-go]')) {
      let why = sub.disabled ? sub.textContent : '';
      try { const bl = tkBlocks(tkCalc(b.dataset.go)); why = bl.length ? bl[0].btn || bl[0].why : ''; } catch (e) { /* keeps the order button's own state */ }
      b.disabled = !!why; b.title = why || `${b.dataset.go === 'buy' ? 'Buy' : 'Sell'} ${$('#tkLots')?.value || ''} at market now`; }
  };
  // the volume, stop and target fields empty on a click, ready for a new value; the old one stays as the placeholder and
  // comes back if you leave the field without typing (nothing changes until you type)
  const CLR = '#tkLots, #tkPrice, #tkExits .tk3-row3 input';
  tk.addEventListener('focusin', e => { const f = e.target; if (!f.matches || !f.matches(CLR) || f.disabled) return; f.dataset.was = f.value; f.placeholder = f.value; f.value = ''; });
  // a field emptied by typing (a value typed, then deleted) is not "left without typing": it stays empty, and the row
  // under it says what is missing (UX 09.11 round 2, #10)
  tk.addEventListener('input', e => { const f = e.target; if (f.matches && f.matches(CLR) && 'was' in f.dataset) f.dataset.typed = '1'; });
  tk.addEventListener('focusout', e => { const f = e.target; if (!f.matches || !f.matches(CLR) || !('was' in f.dataset)) return; if (f.value === '' && f.dataset.was && !f.dataset.typed) f.value = f.dataset.was; f.placeholder = ''; delete f.dataset.was; delete f.dataset.typed; });
  // the SL / TP unit pickers drawn by the app (not the browser's menu): a button with the chosen unit and a menu of the
  // options; the native <select> stays hidden underneath, keeps the value and gets the change, so the ticket logic is unchanged
  const pick = [], picked = new Set();
  // the unit selects are built by the ticket form after this runs: each is wrapped on the first render that finds it
  const mkPick = () => { for (const id of ['tkSlBy', 'tkTpBy', 'tkTif']) {
    const sel = $('#' + id); if (!sel || picked.has(sel)) continue; picked.add(sel);
    const w = document.createElement('div'); w.className = 'tk-pick'; sel.after(w); w.append(sel);
    w.insertAdjacentHTML('beforeend', `<button type="button" class="tk-pick-b" aria-haspopup="listbox" aria-expanded="false"><span></span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button><div class="dd-pop tk-pick-pop" role="listbox" hidden></div>`);
    const b = w.querySelector('.tk-pick-b'), pop = w.querySelector('.tk-pick-pop');
    const close = () => { pop.hidden = true; b.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      // on hover each unit explains itself; a disabled one says why (its option's title)
      const tip = o => (o.disabled && o.title) || (TK_UNIT_TIP[sel.id] || {})[o.value]?.(M(S.set.sym)) || '';
      pop.innerHTML = [...sel.options].map(o => `<button type="button" role="option" data-v="${escHtml(o.value)}" aria-selected="${o.selected}"${o.disabled ? ' disabled' : ''}${tip(o) ? ` title="${escHtml(tip(o))}"` : ''}>${escHtml(o.textContent)}</button>`).join('');
      pop.hidden = false; b.setAttribute('aria-expanded', 'true');
      const r = b.getBoundingClientRect(); pop.style.minWidth = r.width + 'px'; pop.style.left = Math.max(6, Math.min(innerWidth - pop.offsetWidth - 6, r.left)) + 'px'; pop.style.top = r.bottom + 'px';
      (pop.querySelector('[aria-selected=true]') || pop.querySelector('button:not(:disabled)'))?.focus();
    };
    b.addEventListener('click', e => { e.stopPropagation(); if (!sel.disabled) pop.hidden ? open() : close(); });
    pop.addEventListener('click', e => { const o = e.target.closest('[data-v]'); if (!o || o.disabled) return; close(); b.focus(); if (sel.value !== o.dataset.v || (sel.id === 'tkTpBy' && S.tk.useTP && tkx().split)) { sel.value = o.dataset.v; sel.dispatchEvent(new Event('change', { bubbles: true })); } });
    pop.addEventListener('keydown', e => {
      const l = [...pop.querySelectorAll('button:not(:disabled)')], i = l.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.stopPropagation(); close(); b.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); l[(i + (e.key === 'ArrowDown' ? 1 : l.length - 1)) % l.length]?.focus(); }
    });
    document.addEventListener('pointerdown', e => { if (!pop.hidden && !w.contains(e.target)) close(); });
    addEventListener('scroll', e => { if (!pop.hidden && e.target.contains && e.target.contains(w)) close(); }, true);
    pick.push(() => { const t = sel.selectedOptions[0]?.textContent || ''; const sp = b.firstElementChild; if (sp.textContent !== t) sp.textContent = t; b.disabled = sel.disabled; b.title = sel.title || ''; b.setAttribute('aria-label', sel.getAttribute('aria-label') || t); });
  } };
  // SL and TP start unticked every time the app opens (the saved ticket may carry them ticked from the last session)
  let fresh = true;
  const _render = renderTicket;
  renderTicket = function () { if (fresh && S.tk) { fresh = false; S.tk.useSL = false; S.tk.useTP = false; for (const id of ['useSL', 'useTP']) { const c = document.getElementById(id); if (c) c.checked = false; } } const r = _render.apply(this, arguments); safe('ticket modes', sync); safe('ticket unit pickers', () => { mkPick(); pick.forEach(f => f()); }); return r; };
  sync();
})();
