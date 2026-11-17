'use strict';
/* tradeBerry — Basket builder: chart any weighted group of currencies against another (synthetic index),
   see its closest tradable proxy, and execute it as a set of pair legs. Lives in the Observatory. */

const BK = { chart: null, series: null, ema: null, el: null, lines: [], cmp: [], retry: {} };
const BK_COL = ['#5b9cf6', '#f2a93b', '#c678dd', '#4fc3a1', '#e06c75', '#d6c35a', '#56b6c2', '#9aa4b2'];
const BK_PRESETS = [
  { id: 'dxy', name: 'Dollar index (DXY-style)', long: { USD: 1 }, short: { EUR: 57.6, JPY: 13.6, GBP: 11.9, CAD: 9.1, CHF: 3.6 }, note: 'ICE DXY weights without the Swedish krona, renormalised.' },
  { id: 'riskon', name: 'Risk-on vs havens', long: { AUD: 1, NZD: 1 }, short: { JPY: 1, CHF: 1 }, note: 'Commodity / high-beta currencies against the classic safe havens.' },
  { id: 'yen', name: 'Yen index', long: { JPY: 1 }, short: { USD: 1, EUR: 1, GBP: 1, AUD: 1 }, note: 'Equal-weighted yen against four majors.' },
  { id: 'euro', name: 'Euro index', long: { EUR: 1 }, short: { USD: 1, GBP: 1, JPY: 1, CHF: 1 }, note: 'Equal-weighted euro against four majors.' },
  { id: 'bloc', name: 'Commodity bloc vs Europe', long: { AUD: 1, NZD: 1, CAD: 1 }, short: { EUR: 1, GBP: 1, CHF: 1 }, note: 'Resource economies against European currencies.' }
];
// short whole names for the overlap grid headers
const BK_AB = { dxy: 'DXY', riskon: 'Risk-on', yen: 'Yen', euro: 'Euro', bloc: 'Bloc', myexp: 'Mine' };
function bkCfg() {
  const c = obsCfg();
  if (!c.baskets) c.baskets = [];
  if (!c.bkSel) c.bkSel = 'dxy';
  if (!c.bkTf) c.bkTf = 15;
  if (!c.bkLots) c.bkLots = 1;
  if (!c.bkMode) c.bkMode = 'risk';
  if (c.bkRisk == null) c.bkRisk = .5;
  if (c.bkSl === undefined) c.bkSl = 'auto';
  if (c.bkTp === undefined) c.bkTp = 'auto';
  if (!c.bkCmp) c.bkCmp = 'none';
  if (c.bkTrail == null) c.bkTrail = 0;
  if (c.bkBe == null) c.bkBe = 0;
  if (!S.bkHist) S.bkHist = [];
  if (!S.bkAlerts) S.bkAlerts = [];
  if (!S.bkOrders) S.bkOrders = [];
  if (!c.bkEntry) c.bkEntry = 'market';
  if (c.bkPane !== 'an' && c.bkPane !== 'tr') c.bkPane = 'an';
  if (!c.bkPend) c.bkPend = 15;
  if (!c.bkAn) c.bkAn = 'attr';
  if (!c.bkAnW) c.bkAnW = 1440;
  if (!c.bkAl) c.bkAl = 20;
  if (!S.bkPos) S.bkPos = [];
  return c;
}
const bkAll = () => [...BK_PRESETS, ...bkCfg().baskets];
const bkGet = id => bkAll().find(b => b.id === id) || BK_PRESETS[0];
// the definition with this id, or null (bkGet falls back on the DXY, which must never stand in for a deleted basket)
const bkFind = id => bkAll().find(b => b.id === id) || null;
/* One data window for the whole tool: the EUR/USD history (every leg is a G8 pair), never the symbol on the main
   chart. BK_N = three days of 1-minute closes plus the base bar: header, chart, KPIs, stretch and levels share it. */
const BK_N = 4321, bkLen = () => Engine.candles.EURUSD.length;
const bkSnapOf = b => ({ long: bkNorm(b.long), short: bkNorm(b.short) });
// what a group, an order or an alert works on: the composition saved at its creation; a row saved before snapshots
// falls back on the current definition, and gets null when that definition was deleted
const bkComp = r => r && r.long && r.short ? r : bkFind(r && r.bid);
const bkSame = (a, b) => { if (!a || !b) return false; const x = bkSnapOf(a), y = bkSnapOf(b), eq = (p, q) => Object.keys(p).length === Object.keys(q).length && Object.keys(p).every(k => Math.abs(p[k] - (q[k] || 0)) < 1e-9); return eq(x.long, y.long) && eq(x.short, y.short); };
function bkNorm(w) { const t = Object.values(w).reduce((s, x) => s + (+x || 0), 0); return t ? Object.fromEntries(Object.entries(w).filter(([, x]) => +x > 0).map(([k, x]) => [k, x / t])) : {}; }
const bkLabel = b => { const f = w => Object.entries(bkNorm(w)).map(([k, x]) => Object.keys(w).length > 1 ? `${k} ${(x * 100).toFixed(0)}%` : k).join(' + '); return `${f(b.long)} vs ${f(b.short)}`; };
// 1-minute index path: Σ w·log(value of long ccys in USD) − Σ w·log(short ccys)
function bkPath(b, n) {
  const P = ccyPaths(n), L = bkNorm(b.long), Sx = bkNorm(b.short), out = [];
  for (let i = 0; i < P._t.length; i++) { let v = 0; for (const [c, w] of Object.entries(L)) v += w * P[c][i]; for (const [c, w] of Object.entries(Sx)) v -= w * P[c][i]; out.push(v); }
  return { t: P._t, v: out };
}
function bkCandles(path, tf) {
  const step = tf * 60, out = [], v0 = path.v[0];
  for (let i = 0; i < path.t.length; i++) {
    const t = Math.floor(path.t[i] / step) * step, x = 100 * Math.exp(path.v[i] - v0), last = out[out.length - 1];
    if (!last || last.time !== t) out.push({ time: t, open: last ? last.close : x, high: Math.max(x, last ? last.close : x), low: Math.min(x, last ? last.close : x), close: x });
    else { last.high = Math.max(last.high, x); last.low = Math.min(last.low, x); last.close = x; }
  }
  return out;
}
// split the basket into tradable pair legs; size is USD notional in lots of 100k
function bkLegs(b, lots, side = 'buy') {
  return Object.entries(bkLegMap(b, lots, side)).map(([sym, v]) => ({ sym, side: v > 0 ? 'buy' : 'sell', lots: Math.round(Math.abs(v) * 100) / 100 })).filter(l => l.lots >= .01).sort((x, y) => y.lots - x.lots);
}
// the exact (unrounded) signed lots of every leg: what the index asks for before the 0.01 lot step
function bkLegMap(b, lots, side = 'buy') {
  const L = bkNorm(b.long), Sx = bkNorm(b.short), legs = {}, sg = side === 'buy' ? 1 : -1;
  const add = (a, c, w) => {
    let p = Engine.PAIRS.find(x => x.base === a && x.quote === c); if (p) { legs[p.sym] = (legs[p.sym] || 0) + w / Engine.usd(a); return true; }
    p = Engine.PAIRS.find(x => x.base === c && x.quote === a); if (p) { legs[p.sym] = (legs[p.sym] || 0) - w / Engine.usd(c); return true; }
    return false;
  };
  for (const [a, wa] of Object.entries(L)) for (const [c, wc] of Object.entries(Sx)) { if (a === c) continue; const w = wa * wc * lots * sg; if (!add(a, c, w)) { add(a, 'USD', w); add('USD', c, w); } }
  return legs;
}
/* Replication at a size: every leg the index asks for is at or above its pair's minimum lot once rounded, and each
   currency's exposure from the rounded legs stays within ±2% of the notional of what the exact legs give. */
const BK_REP_TOL = .02;
function bkRepAt(b, lots) {
  const raw = Object.entries(bkLegMap(b, lots, 'buy')).filter(([, v]) => Math.abs(v) > 1e-9), legs = bkLegs(b, lots, 'buy'), n = lots * 1e5;
  const lost = raw.filter(([sym]) => { const l = legs.find(x => x.sym === sym); return !l || l.lots < volOf(sym)[0] - 1e-9; }).map(([sym]) => sym);
  const want = exposureOf(raw.map(([sym, v]) => ({ sym, side: v > 0 ? 'buy' : 'sell', lots: Math.abs(v) }))).ccy, got = exposureOf(legs).ccy;
  let drift = 0, dk = ''; for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) { const x = Math.abs((got[k] || 0) - (want[k] || 0)) / n; if (x > drift) { drift = x; dk = k; } }
  return { ok: !lost.length && drift <= BK_REP_TOL, lost, drift, dk };
}
const bkRepOk = (b, lots) => lots > 0 && bkRepAt(b, lots).ok;
/* The smallest size (0.01 steps, up to 20 × $100k) from which every larger size replicates: scanned down from the top,
   the first size that fails sets it. Cached per composition and minute (the leg sizes follow the USD rates). null:
   not even 20 replicates. */
function bkMinRep(b) {
  const key = JSON.stringify(bkSnapOf(b)) + '|' + Math.floor(Engine.simTime / 60);
  if (BK.minRep && BK.minRep.key === key) return BK.minRep.v;
  let v = null;
  for (let k = 2000; k >= 1; k--) { if (!bkRepOk(b, k / 100)) break; v = k / 100; }
  BK.minRep = { key, v };
  return v;
}
function bkMinRepHtml(b, lots) {
  if (!lots) return '';
  const mn = bkMinRep(b), at = bkRepAt(b, lots), lf = x => x.toFixed(2);
  const why = [at.lost.length ? `${listText(at.lost.map(pretty))} ${at.lost.length > 1 ? 'fall' : 'falls'} under the minimum lot` : '', at.drift > BK_REP_TOL ? `${at.dk} is off by ${(at.drift * 100).toFixed(1)}% of notional` : ''].filter(Boolean).join(', ');
  if (mn == null) return `<p class="small dn" data-bk-minrep>Up to 20 × $100k the legs do not replicate the index within ±2% of notional${why ? ` (at ${lf(lots)}: ${why})` : ''}.</p>`;
  if (at.ok && lots < mn) return `<p class="small muted" data-bk-minrep>At ${lf(lots)} × $100k the legs replicate the index (every leg at or above its minimum lot, each currency within ±2% of notional), but the 0.01 lot rounding breaks it at some sizes below ${lf(mn)}; from ${lf(mn)} up, every size does.</p>`;
  if (!at.ok) return `<p class="small dn" data-bk-minrep>At ${lf(lots)} × $100k the legs no longer replicate the index: ${why}. Every size from ${lf(mn)} up does; below ${lf(mn)} a leg can fall under its minimum lot or a currency drift more than 2% of notional from the index.</p>`;
  return `<p class="small muted" data-bk-minrep>Smallest size that replicates the index: ${lf(mn)} × $100k (every leg at or above its minimum lot, each currency within ±2% of notional).</p>`;
}
// each leg's share of the basket's USD notional and of its entry cost (spread + commission)
function bkLegShares(rows) {
  const nt = rows.map(l => notionalUsd(l.sym, l.lots)), N = nt.reduce((a, x) => a + x, 0) || 1, C = rows.reduce((a, l) => a + l.cost + l.comm, 0) || 1;
  return rows.map((l, i) => ({ ...l, notional: nt[i], nShare: nt[i] / N, cShare: (l.cost + l.comm) / C }));
}
/* A leg whose share of the cost is more than twice its share of the notional: the costliest such leg, and what the
   basket would cost at the same size without it. A leg cannot leave the index alone (the legs follow the weights), so
   the copy drops one of its currencies, on a side that keeps another one: the one that saves the most. */
function bkDropSug(b, lots, cost) {
  if (!lots || cost.rows.length < 2) return null;
  const over = bkLegShares(cost.rows).filter(l => l.cShare > 2 * l.nShare).sort((x, y) => y.cost + y.comm - (x.cost + x.comm))[0];
  if (!over) return null;
  const m = M(over.sym); let best = null;
  for (const k of [m.base, m.quote]) for (const side of ['long', 'short']) {
    if (!(+b[side][k] > 0) || Object.keys(b[side]).filter(x => +b[side][x] > 0).length < 2) continue;
    const nb = { long: { ...b.long }, short: { ...b.short } }; delete nb[side][k];
    const to = bkCost(bkLegs(nb, lots, 'buy'), lots).bp;
    if (!best || to < best.to) best = { ccy: k, side, to };
  }
  if (!best || !(best.to < cost.bp)) return null;
  return { sym: over.sym, pair: pretty(over.sym), nShare: over.nShare, cShare: over.cShare, ccy: best.ccy, side: best.side, from: cost.bp, to: best.to, cut: cost.bp - best.to };
}
/* The basket against the single positions (the legs of open baskets are not counted): on each currency where both
   hold at least $500 and the basket moves it by 2% of its notional, whether it adds to the position, hedges it or
   turns it around, from which positions, and the net after the trade. */
function bkCcyOverlap(b, side, lots) {
  if (!lots) return [];
  const mine = S.positions.filter(p => !p.bgid), e0 = exposureOf(mine).ccy, x = exposureOf(bkLegs(b, lots, side)).ccy, out = [];
  const sOf = (p, k) => { const m = M(p.sym); if (!m) return 0; const d = p.side === 'buy' ? 1 : -1; return m.kind === 'cfd' ? (m.quote === k && k !== 'USD' ? d : 0) : m.base === k ? d : m.quote === k ? -d : 0; };
  for (const [k, v] of Object.entries(x)) {
    const a = e0[k] || 0; if (Math.abs(a) < 500 || Math.abs(v) < Math.max(500, BK_REP_TOL * lots * 1e5)) continue;
    const after = a + v, from = [...new Set(mine.filter(p => sOf(p, k) * a > 0).map(p => `${pretty(p.sym)} ${p.side}`))];
    out.push({ k, kind: a * v > 0 ? 'adds' : after * a < 0 ? 'reverses' : 'hedges', mine: a, add: v, after, from });
  }
  return out.sort((p, q) => Math.abs(q.add) - Math.abs(p.add));
}
const bkK = v => (v < 0 ? '−' : '+') + '$' + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + 'M' : (Math.abs(v) / 1e3).toFixed(0) + 'k');
const bkOvTxt = o => `${o.kind === 'adds' ? 'adds to' : o.kind} your ${o.mine > 0 ? 'long' : 'short'} ${o.k}${o.from.length ? ` from ${o.from.length > 2 ? `${o.from.slice(0, 2).join(', ')} and ${o.from.length - 2} more` : listText(o.from)}` : ''}: ${o.k} ${bkK(o.after)} after this`;
function bkCcyxHtml(b, lots) {
  const rows = ['buy', 'sell'].map(sd => [sd, bkCcyOverlap(b, sd, lots).slice(0, 3)]).filter(([, o]) => o.length);
  if (!rows.length) return '';
  return `<div class="bk-ccyx small" data-bk-ccyx>${rows.map(([sd, o]) => `<p><span class="tag ${sd}">${sd}</span> ${o.map(bkOvTxt).map(escHtml).join('; ')}.</p>`).join('')}<p class="muted">Against your single positions (Your currency exposure), not the legs of open baskets. Nothing is blocked.</p></div>`;
}
// the legs' P&L against the index move × the notional, in $ and in bp of notional (null without a composition)
function bkRepErr(g, st = bkGroupState(g)) {
  if (st.mv == null || !(g.lots > 0)) return null;
  const n = g.lots * 1e5, usd = st.pnl - st.mv / 1e4 * n;
  return { usd, bp: usd / n * 1e4 };
}
const bkRepTxt = e => e ? `vs index ${usdFmt(e.usd, true)} · ${sgn(e.bp, 1)} bp` : '';
const bkRepTip = g => `Replication gap|The legs' P&L minus the index move × the notional (${usd0(g.lots * 1e5)}), in $ and in bp of notional. It starts near −${(g.cost || 0).toFixed(1)} bp: the legs are valued at the price they would close at, so the entry spreads show here. The rest comes from rounding each leg to its lot step and from the index being a weighted average of logs while the legs are linear; it stays small above the minimum replicating size.`;
function drawBask(b0, c) {
  bkCfg();
  const b = bkGet(c.bkSel), isPreset = BK_PRESETS.some(p => p.id === b.id), col = chartColors();
  const { path, z, idx } = bkView(b), ch = n => n <= z ? path.v[z] - path.v[z - n] : null;
  const r1 = []; for (let i = Math.max(1, z - 1440); i <= z; i++) r1.push(path.v[i] - path.v[i - 1]);
  const vol = stdev(r1) * Math.sqrt(1440);
  const sz = bkSize(b, c, vol), legs = bkLegs(b, sz.lots, 'buy'), cost = bkCost(legs, sz.lots), mkt = mktState('EURUSD'), pend = c.bkEntry !== 'market';
  BK.sz = sz;
  const drop = bkDropSug(b, sz.lots, cost);
  // what keeps the Buy/Sell buttons off: no stop to size on (Risk %), a closed market for a market entry
  const block = sz.need ? sz.need : !mkt.open && !pend ? mkt.label : '';
  // the closest single pair, sized on β for the same exposure: one spread instead of one per leg
  const px = bkProxy(b, sz, r1), px0 = { s: px.sym, r: px.r }, pxSide = px.side, pxShare = px.r * px.r;
  // notional against the leverage the sheet allows on these legs (the lowest of them): red above half of it
  const eq = account().eq, lev = sz.lots * 1e5 / eq, cbp = sz.costBp || 0, maxLev = cost.rows.length ? Math.min(...cost.rows.map(l => effLev(l.sym))) : Infinity, levHi = lev > maxLev / 2;
  const t0 = dts(path.t[0]), hours = Math.round(z / 60);
  BK.prev = bkPrev(idx, sz, t0);
  // the ticket's preview lines are drawn only while no group of this composition is open (bkData)
  const showPrev = !!BK.prev && !S.bkPos.some(g => g.bid === b.id && bkSame(bkComp(g), b));
  const nrm = { long: bkNorm(b.long), short: bkNorm(b.short) };
  // a redraw while the stop / target editor has the focus gives it back (the draft is kept in BK.edV)
  const ae = document.activeElement, fid = ['bkEdSl', 'bkEdTp'].includes(ae?.id) ? '#' + ae.id : ae?.dataset?.bkEd ? `[data-bk-ed="${escHtml(ae.dataset.bkEd)}"]` : '';
  const ccyChip = (side, k) => { const w = isPreset && nrm[side][k] ? nrm[side][k] * 100 : b[side][k]; return `<label class="bk-c ${w > 0 ? 'on ' + side : ''}"><span>${k}</span><input type="number" min="0" max="100" step="1" data-side="${side}" data-c="${k}" value="${w > 0 ? +(+w).toFixed(1) : ''}" placeholder="·" ${isPreset ? 'disabled' : ''} aria-label="${k} weight on ${side} side"></label>`; };
  b0.innerHTML = `<div class="bk">
    <div class="bk-top"><div class="bk-list"><div class="bk-strip" role="group" aria-label="Baskets">${bkAll().map(x => `<button class="pill ${x.id === b.id ? 'on' : ''}" data-bk="${escHtml(x.id)}" aria-pressed="${x.id === b.id}">${escHtml(x.name)}</button>`).join('')}</div><button class="pill add" data-bk-new>+ New basket</button></div></div>
    <div class="obs-split"><div class="bk-main">
      <div class="bk-head"><div><b class="bk-name">${escHtml(b.name)}</b><div class="small muted mono">${bkLabel(b)}</div></div>
        <div class="bk-px"><b class="mono" data-bk-idx>${idx.toFixed(3)}</b><small class="muted" data-tip="${escHtml(`Index level|The index is set to 100 at ${t0} UTC, the start of the loaded history (${hours} hours of trading), and follows the weighted currencies from there. That start moves forward every minute, so the level can shift slightly while the market stands still; moves in bp do not.`)}">index, 100 = ${t0}</small></div>
        <div class="mini-seg" data-bktf>${[[5, '5m'], [15, '15m'], [60, '1H'], [240, '4H']].map(([v, l]) => `<button data-val="${v}" class="${c.bkTf === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="bk-chart" id="bkChart"></div>
      <div class="dj-leg small bk-cleg">${obsSw('--ind1', 'ema', 'EMA20 of the index')} <span style="white-space:nowrap"><i class="bk-ln alert" aria-hidden="true"></i>index alerts</span> ${showPrev ? '<span style="white-space:nowrap"><i class="bk-ln prev" aria-hidden="true"></i>stop and target of the ticket below (buy / sell)</span>' : ''}</div>
      <div class="bk-cmp"><span class="small muted">Compare</span><div class="mini-seg" data-bkcmp>${[['none', 'Off'], ['ccy', '8 currency indices'], ['bask', 'Other baskets']].map(([v, l]) => `<button data-val="${v}" class="${c.bkCmp === v ? 'on' : ''}">${l}</button>`).join('')}</div><div class="bk-leg" id="bkLeg"></div></div>
      <div class="obs-kpis">${[[60, '1H'], [240, '4H'], [1440, '1D'], [4320, '3D']].map(([n, l]) => { const v = ch(n); return kpi(l, v == null ? '—' : bp(v), v == null ? '' : cls(v), v == null ? `Basket over ${l}|Not enough history yet: the index has ${hours} hours of trading, ${l} needs ${n / 60}.` : `Basket over ${l}|How much the basket moved over the last ${{ '1H': 'hour', '4H': '4 hours', '1D': '24 hours', '3D': '3 days' }[l]} of trading, in basis points (0.01%).`); }).join('')}</div>
      <div class="bk-an"><div class="bk-an-h"><div class="mini-seg" data-bkan>${[['attr', 'What moved it'], ['sess', 'By hour'], ['corr', 'Basket overlap']].map(([v, l]) => `<button data-val="${v}" class="${c.bkAn === v ? 'on' : ''}">${l}</button>`).join('')}</div>${c.bkAn === 'attr' ? `<div class="mini-seg" data-bkanw>${[[60, '1H'], [240, '4H'], [1440, '1D'], [4320, '3D']].map(([v, l]) => `<button data-val="${v}" class="${c.bkAnW === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}</div><div class="bk-an-b" id="bkAn">${bkAnHtml(b, c)}</div></div>
    </div><aside class="obs-side">
      <div class="mini-seg bk-pane" data-bkpane role="group" aria-label="Panel">${[['an', 'Analyse'], ['tr', `Trade${S.bkPos.length ? ` · ${S.bkPos.length} open` : ''}`]].map(([v, l]) => `<button data-val="${v}" class="${c.bkPane === v ? 'on' : ''}" aria-pressed="${c.bkPane === v}">${l}</button>`).join('')}</div>
      <div class="bk-pn"${c.bkPane === 'an' ? '' : ' hidden'}>
      <div class="ins"><label>Composition ${isPreset ? '<span class="muted">· preset, duplicate to edit</span>' : ''}</label>
        <div class="bk-row"><span class="bk-side up">Long</span>${Engine.ALL.map(k => ccyChip('long', k)).join('')}</div>
        <div class="bk-row"><span class="bk-side dn">Short</span>${Engine.ALL.map(k => ccyChip('short', k)).join('')}</div>
        ${!isPreset && bkUsers(b.id) ? `<p class="small muted">Open baskets, pending orders and alerts on this basket keep the composition they were created with; an edit changes only new ones.</p>` : ''}
        ${isPreset ? `<p class="small muted">${escHtml(b.note)} Shown as shares of each side (100%)${Object.values(b.short).some(x => x > 1) || Object.values(b.long).some(x => x > 1) ? `; source weights ${Object.entries(b.short).map(([k, x]) => `${k} ${x}`).join(' · ')}` : ''}.</p><button class="ghost sm" data-bk-dup>Duplicate &amp; edit</button>` : `<div class="bk-edit"><button class="ghost sm" data-bk-eq data-tip="Equalise risk|Weights each currency on its side by 1 / its volatility (its 1-minute moves against the average of the eight, last day), so each side's currencies move the index about equally. It ignores the correlations between the currencies: two that move together still count as two separate bets.">Equalise risk</button><input id="bkName" value="${escHtml(b.name)}" maxlength="40" aria-label="Basket name"><button class="link" data-bk-del>Delete</button></div>`}</div>
      <div class="ins"><label>Stretch</label>${bkStretchHtml(b, c, path)}</div>
      <div class="ins"><label>Index alerts</label><div class="bk-trade"><label>Alert at ± <input type="number" id="bkAl" min="1" max="2000" step="1" value="${c.bkAl}"> bp from now</label><button class="ghost sm" data-bk-alert>Set alert</button></div>
        ${S.bkAlerts.length ? S.bkAlerts.map((a, i) => `<div class="bk-al"><span><b>${escHtml(a.name)}</b> <span class="small muted mono">±${a.bp} bp · ${bkAlDist(a)}</span></span><button class="link" data-bk-alx="${i}" aria-label="Remove alert">Remove</button></div>`).join('') : '<p class="small muted">Get a toast and a chime when the basket moves this far either way — the dashed lines on the chart.</p>'}</div>
      <div class="ins"><label>Behaviour</label><p>Daily volatility <b class="mono">${(vol * 1e4).toFixed(0)} bp</b>. Closest tradable proxy: <button class="pill" data-sym="${px0.s}">${pretty(px0.s)}</button> ${obsV(`ρ ${px0.r.toFixed(2)}`, '', `Correlation ${px0.r.toFixed(2)}|Of the index's 1-minute moves over the last day with ${pretty(px0.s)}. ${px0.r < 0 ? 'Negative: the pair moves opposite to the index, so selling it is the same direction as buying the basket.' : 'Positive: the pair moves with the index.'}`)}${Math.abs(px0.r) < .8 ? ' — no single pair captures it, which is the point of a basket.' : `.</p><p class="bk-proxy"><b>${pxSide === 'buy' ? 'Buying' : 'Selling'} ${pretty(px0.s)}</b> alone follows ${obsV(`${(pxShare * 100).toFixed(0)}%`, 'up', `Share explained|ρ² = ${pxShare.toFixed(2)}: the part of the index's moves that this one pair reproduces.`)} of the index with 1 leg instead of ${legs.length}.${sz.lots ? ` For the same exposure it is sized on ${obsV(`β ${nfx(px.beta, 2)}`, '', `Beta ${nfx(px.beta, 2)}|How many bp the index moved per bp of ${pretty(px0.s)}, over the last day of 1-minute moves. The proxy size is the basket notional × |β| and its stop the basket stop ÷ |β|: the same dollar risk at the stop.`)}: <b class="mono">${lotsFmt(px0.s, px.lots)}</b> lots${px.slPips ? `, stop <b class="mono">${nfx(px.slPips, 1)}</b> ${unitWord(px0.s)}` : ''}; spread ≈ <b class="mono">${usdFmt(px.cost)}</b> against <b class="mono">${usdFmt(cost.usd)}</b> for the basket. <button class="ghost sm" data-bk-proxy="${px0.s}" data-side="${pxSide}" data-lots="${px.lots}" data-sl="${px.slPips || ''}" data-tp="${px.tpPips || ''}">Trade ${pretty(px0.s)} instead</button>` : ''}`}</p></div>
      <p class="small muted">Ready to trade this basket? <button class="link" data-bkpane-go="tr">Open the Trade panel</button></p>
      </div><div class="bk-pn"${c.bkPane === 'tr' ? '' : ' hidden'}>
      <div class="ins"><label>Trade the basket as one position</label>
        <div class="bk-trade"><div class="mini-seg" data-bkmode>${[['risk', 'Risk %'], ['lots', 'Size']].map(([v, l]) => `<button data-val="${v}" class="${c.bkMode === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          ${c.bkMode === 'risk' ? `<label>Risk <input type="number" id="bkRisk" min=".05" max="5" step=".05" value="${c.bkRisk}"> % equity</label>` : `<label>Basket size <input type="number" id="bkLots" min=".1" max="20" step=".1" value="${c.bkLots}"> × $100k notional</label>`}
          <label>Stop <input type="number" id="bkSl" min="0" max="2000" step="1" value="${sz.sl || ''}" placeholder="none"> bp</label>
          <label>Target <input type="number" id="bkTp" min="0" max="4000" step="1" value="${sz.tp || ''}" placeholder="none"> bp</label>
          <label>Trail <input type="number" id="bkTrail" min="0" max="2000" step="1" value="${c.bkTrail || ''}" placeholder="off"> bp</label>
          <label>Break-even at <input type="number" id="bkBe" min="0" max="2000" step="1" value="${c.bkBe || ''}" placeholder="off"> bp</label></div>
        <p class="small muted">Daily volatility ≈ <b class="mono">${(vol * 1e4).toFixed(0)} bp</b>${sz.sl ? ` · stop = ${(sz.sl / (vol * 1e4)).toFixed(2)}× a day's move` : ''}${sz.sl && sz.tp ? ` · net of the ${cbp.toFixed(1)} bp entry cost, reward : risk ${(sz.tp - cbp).toFixed(1)} : ${(sz.sl + cbp).toFixed(1)} bp (1 : ${((sz.tp - cbp) / (sz.sl + cbp)).toFixed(2)})` : ''}. Stop and target are measured on the index and close every leg together.${sz.sl ? ' Basket stop is managed by this tab; each leg also carries a wide disaster stop. The basket stop works only while this tab is open: with the tab closed or in the background, only those disaster stops (3× the basket stop) protect the legs.' : ''}</p>
        <p class="small muted">The legs are sent one by one, each at its own price: slippage on every leg comes on top of the risk shown, and if one leg is not filled the others are closed again, paying their spreads.</p>
        <table class="tbl sm bk-legs"><thead><tr><th>Leg</th><th>Side</th><th><span tabindex="0" data-tip="Leg lots|Each leg's own size in lots of its pair (100,000 units of its base currency), not the basket's × $100k notional.">Leg lots</span></th><th>Spread cost</th></tr></thead><tbody>${bkLegShares(cost.rows).map((l, i, a) => `<tr${a.length > 1 && i === a.reduce((m, x, j) => x.cost + x.comm > a[m].cost + a[m].comm ? j : m, 0) ? ' class="bk-leg-max"' : ''}><td>${pretty(l.sym)}<div class="small muted bk-leg-sh">${Math.round(l.nShare * 100)}% of notional, ${Math.round(l.cShare * 100)}% of cost</div></td><td><span class="tag ${escHtml(l.side)}">${escHtml(l.side)}</span></td><td class="mono">${l.lots.toFixed(2)}</td><td class="mono">${usdFmt(l.cost)}</td></tr>`).join('') || `<tr><td class="muted" colspan="4">${sz.need ? 'Risk % sizes the legs from the stop: set a stop' : 'Add currencies on both sides'}</td></tr>`}</tbody></table>
        ${drop ? `<p class="small" data-bk-drop>${drop.pair} is ${Math.round(drop.cShare * 100)}% of the entry cost for ${Math.round(drop.nShare * 100)}% of the notional: excluding ${drop.pair} would cut the cost by ${drop.cut.toFixed(1)} bp (${drop.from.toFixed(1)} → ${drop.to.toFixed(1)} bp at this size), by dropping ${drop.ccy} from the ${drop.side} side — a different index. <button class="ghost sm" data-bk-dupx="${drop.ccy}">Duplicate without ${drop.ccy}</button></p>` : ''}
        ${legs.length ? bkMinRepHtml(b, sz.lots) : ''}
        ${BK.prev ? `<div class="bk-lv" tabindex="0" data-tip="${escHtml(`Stop and target on the index|In bp from the index now: that distance is what the stop and target mean. The levels after them are the same points on the charted index (100 = ${t0} UTC), drawn as dashed lines; that start moves forward every minute, so the levels shift slightly while the bp distance stays.`)}">${bkLvHtml(BK.prev)}</div>` : ''}
        <div class="bk-sum"><span>Notional <b class="mono ${levHi ? 'dn' : ''}" tabindex="0" data-tip="${escHtml(`Notional ${usd0(sz.lots * 1e5)}|${lev.toFixed(1)}× your equity of ${usd0(eq)}: every 1% move of the index is ${usd0(sz.lots * 1e3)}.${isFinite(maxLev) ? ` The sheet allows leverage up to ${maxLev}:1 on these legs; ${levHi ? 'this is above half of it: a large position for one idea.' : 'shown red above half of it.'}` : ''}`)}">${usd0(sz.lots * 1e5)} · ${lev.toFixed(1)}×</b></span><span>Margin <b class="mono" tabindex="0" data-tip="${escHtml(`Margin|${(cost.margin / eq * 100).toFixed(1)}% of your equity is set aside while the legs are open.`)}">${usdFmt(cost.margin)} · ${(cost.margin / eq * 100).toFixed(1)}%</b></span><span>Entry cost <b class="mono ${sz.sl && cost.bp > sz.sl * .15 ? 'dn' : ''}">${usdFmt(cost.usd)} · ${cost.bp.toFixed(1)} bp</b></span><span>Risk <b class="mono dn" tabindex="0" data-tip="${escHtml(sz.sl ? `Risk at the stop ${usdFmt(sz.risk)}|${usdFmt(sz.lots * 1e5 * sz.sl / 1e4)} for the ${sz.sl} bp stop on the index plus ${usdFmt(sz.cost)} of entry spreads${execCfg().comm > 0 ? ' and commission' : ''}: ${sz.pct.toFixed(2)}% of equity.` : 'No basket stop|Without a stop the possible loss is open-ended.')}">${sz.sl ? usdFmt(-sz.risk) : 'unlimited'}</b></span></div>
        <div class="bk-trade"><div class="mini-seg" data-bkentry>${[['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop entry']].map(([v, l]) => `<button data-val="${v}" class="${c.bkEntry === v ? 'on' : ''}">${l}</button>`).join('')}</div>${c.bkEntry !== 'market' ? `<label>at <input type="number" id="bkPend" min="1" max="2000" step="1" value="${c.bkPend}"> bp</label>` : ''}</div>
        ${c.bkEntry !== 'market' ? `<p class="small muted">${c.bkEntry === 'limit' ? `Buy fills if the index falls ${c.bkPend} bp, sell if it rises ${c.bkPend} bp — entering on a pullback.` : `Buy fills if the index rises ${c.bkPend} bp, sell if it falls ${c.bkPend} bp — entering on a breakout.`} Size, stop and target are fixed now.${mkt.open ? '' : ` ${escHtml(mkt.label)}: the order waits and fills at the reopening gap, at the first prices after it.`}</p>` : ''}
        ${block ? `<p class="small ${sz.need ? 'dn' : 'muted'}" data-bk-block>${escHtml(sz.need ? `Risk % with no stop: ${sz.need}.` : `${block}. Market entries are off until then; a Limit or Stop entry can wait.`)}</p>` : ''}
        ${legs.length ? bkCcyxHtml(b, sz.lots) : ''}
        <div class="bk-btns"><button class="pm-go buy" data-bk-trade="buy" ${legs.length && !block ? '' : 'disabled'}>${c.bkEntry === 'market' ? 'Buy basket' : `Buy ${c.bkEntry}`}</button><button class="pm-go sell" data-bk-trade="sell" ${legs.length && !block ? '' : 'disabled'}>${c.bkEntry === 'market' ? 'Sell basket' : `Sell ${c.bkEntry}`}</button></div></div>
      ${S.bkOrders.length ? `<div class="ins"><label>Pending baskets · ${S.bkOrders.length}</label>${S.bkOrders.map((o, i) => `<div class="bk-al"><span><b>${escHtml(o.name)}</b> <span class="tag ${escHtml(o.side)}">${escHtml(o.side)} ${escHtml(o.type)}</span><div class="small muted mono" data-bko="${i}">${bkOrdTxt(o)}</div></span><button class="link" data-bk-ordx="${i}">Cancel</button></div>`).join('')}</div>` : ''}
      <div class="ins"><label>Open baskets · ${S.bkPos.length}</label>${S.bkPos.length ? S.bkPos.map(g => { const st = bkGroupState(g), gi = escHtml(g.gid); return `<div class="bk-pos"><div><b>${escHtml(g.name)}</b> <span class="tag ${escHtml(g.side)}">${escHtml(g.side)}</span><div class="small muted mono" data-bkg-st="${gi}">${escHtml(bkStopTxt(g))}</div></div><div class="bk-pos-v"><b class="mono ${cls(st.pnl)}" data-bkg-pnl="${gi}">${usdFmt(st.pnl, true)}</b><span class="small mono ${cls(st.mv || 0)}" data-bkg-mv="${gi}">${st.mv == null ? '—' : sgn(st.mv, 1) + ' bp'}</span>${st.mv == null ? '' : `<span class="small mono muted bk-rep" tabindex="0" data-bkg-rep="${gi}" data-tip="${escHtml(bkRepTip(g))}">${bkRepTxt(bkRepErr(g, st))}</span>`}</div><div class="bk-pos-b"><button class="ghost sm" data-bk-ed="${gi}" aria-expanded="${BK.ed === g.gid}" ${g.closing || st.mv == null ? 'disabled' : ''}>Edit</button><button class="ghost sm" data-bk-be="${gi}" ${bkBeOk(g, st) ? '' : 'disabled'} data-tip="${escHtml(bkBeTip(g))}">BE</button><button class="ghost sm" data-bk-half="${gi}" title="Close half of every leg" ${g.closing ? 'disabled' : ''}>½</button><button class="ghost sm" data-bk-closeg="${gi}" ${bkCloseOff(g) ? 'disabled' : ''}>Close</button></div></div>${BK.ed === g.gid && !g.closing && st.mv != null ? bkEdHtml(g, st) : ''}`; }).join('') : '<p class="small muted">Nothing open. A basket opens as several pair legs that share one stop and one target on the index.</p>'}</div>
      ${bkExpHtml()}
      ${bkHistHtml()}
      </div>
    </aside></div></div>`;
  if (fid) $(fid)?.focus();
  bkChart(b, c);
}
function bkChart(b, c) {
  const host = $('#bkChart'); if (!host) return;
  try { BK.chart?.remove(); } catch (e) { }
  const col = chartColors();
  BK.chart = LightweightCharts.createChart(host, { ...chartOpts(col), autoSize: true, rightPriceScale: { borderColor: col.grid }, timeScale: { borderColor: col.grid, timeVisible: true, rightOffset: 4 } });
  BK.series = BK.chart.addSeries(LightweightCharts.CandlestickSeries, { ...candleStyle(col), priceFormat: { type: 'price', precision: 3, minMove: .001 } });
  BK.ema = BK.chart.addSeries(LightweightCharts.LineSeries, { color: cssv('--ind1'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  bkData(b, c, true);
}
function bkData(b, c, fit) {
  if (!BK.series) return;
  // one path for the chart, the header and the ticket levels (bkView): the same window and the same base
  const { path, idx } = bkView(b), N = path.v.length, cd = bkCandles(path, c.bkTf);
  let e = cd[0].close; const em = cd.map(k => (e += 2 / 21 * (k.close - e), { time: k.time, value: e }));
  BK.series.setData(cd); BK.ema.setData(em);
  const v0s = path.v[0], px = v => 100 * Math.exp(v - v0s);
  const hd = $('[data-bk-idx]'); if (hd) hd.textContent = idx.toFixed(3);
  if (BK.sz) { BK.prev = bkPrev(idx, BK.sz, dts(path.t[0])); const lv = $('.bk-lv'); if (lv && BK.prev) lv.innerHTML = bkLvHtml(BK.prev); }
  for (const l of BK.lines) try { BK.series.removePriceLine(l); } catch (e) { }
  BK.lines = [];
  // a group, order or alert is drawn on this chart only while its own composition is the one charted
  for (const g of S.bkPos.filter(g => g.bid === b.id && bkSame(bkComp(g), b))) {
    const d = g.side === 'buy' ? 1 : -1, add = (v, color, title, style) => BK.lines.push(BK.series.createPriceLine({ price: px(v), color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    add(g.v0, chartColors().tx2 || '#9aa4b2', `${escHtml(g.side)} basket`, 0);
    const sm = bkStopMv(g); if (sm != null) add(g.v0 + d * sm / 1e4, chartColors().dn, sm > -(g.sl || Infinity) ? (sm >= 0 && !g.trail ? 'break-even' : `trail ${sgn(sm, 0)}bp`) : `stop ${g.sl}bp`, 2);
    if (g.tp) add(g.v0 + d * g.tp / 1e4, chartColors().up, `target ${g.tp}bp`, 2);
  }
  for (const o of S.bkOrders.filter(o => o.bid === b.id && bkSame(bkComp(o), b))) BK.lines.push(BK.series.createPriceLine({ price: px(o.trig), color: o.side === 'buy' ? chartColors().up : chartColors().dn, lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: `${escHtml(o.side)} ${escHtml(o.type)}` }));
  for (const a of S.bkAlerts.filter(a => a.bid === b.id && bkSame(bkComp(a), b))) for (const v of [a.up, a.dn]) BK.lines.push(BK.series.createPriceLine({ price: px(v), color: chartColors().acc, lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: `alert ${v === a.up ? '+' : '−'}${a.bp}bp` }));
  // the ticket's stop and target for a buy and a sell, before anything is sent
  if (BK.prev && !S.bkPos.some(g => g.bid === b.id && bkSame(bkComp(g), b))) for (const sd of ['buy', 'sell']) for (const [k, v] of Object.entries(BK.prev[sd])) if (v) BK.lines.push(BK.series.createPriceLine({ price: v, color: (k === 'sl' ? chartColors().dn : chartColors().up) + '99', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: `${sd} ${k === 'sl' ? 'stop' : 'target'}` }));
  bkCmpData(b, c, N, cd, fit);
  if (fit) BK.chart.timeScale().fitContent();
}
function bkCmpList(b, c) {
  if (c.bkCmp === 'ccy') return Engine.ALL.map(k => ({ name: k, long: { [k]: 1 }, short: Object.fromEntries(Engine.ALL.filter(x => x !== k).map(x => [x, 1])) }));
  if (c.bkCmp === 'bask') return bkAll().filter(x => x.id !== b.id);
  return [];
}
function bkCmpData(b, c, N, cd, rebuild) {
  const list = bkCmpList(b, c);
  if (rebuild || BK.cmp.length !== list.length) {
    for (const s of BK.cmp) try { BK.chart.removeSeries(s); } catch (e) { }
    // comparisons on their own (left) scale: their range no longer squeezes the basket's candles
    BK.chart.applyOptions({ leftPriceScale: { visible: list.length > 0, borderColor: chartColors().grid } });
    BK.cmp = list.map((x, i) => BK.chart.addSeries(LightweightCharts.LineSeries, { priceScaleId: 'left', color: BK_COL[i % BK_COL.length], lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
  }
  const leg = $('#bkLeg'), out = [];
  list.forEach((x, i) => {
    const k = bkCandles(bkPath(x, N), c.bkTf).map(q => ({ time: q.time, value: q.close }));
    BK.cmp[i].setData(k); const last = k[k.length - 1]?.value ?? 100;
    out.push(`<span class="bk-chip"><i style="background:${BK_COL[i % BK_COL.length]}"></i>${escHtml(x.name)} <b class="mono ${cls(last - 100)}">${sgn((last / 100 - 1) * 1e4, 0)}</b></span>`);
  });
  if (leg) leg.innerHTML = list.length ? out.join('') + '<span class="small muted">bp since start · left scale</span>' : '';
}
/* ---------- basket as one position ---------- */
function bkIdxNow(b) { const L = bkNorm(b.long), Sx = bkNorm(b.short); let v = 0; for (const [k, w] of Object.entries(L)) v += w * Math.log(Engine.usd(k)); for (const [k, w] of Object.entries(Sx)) v -= w * Math.log(Engine.usd(k)); return v; }
// the charted window of a basket: path, last index z and the index level (100 at the first bar)
function bkView(b) { const path = bkPath(b, Math.min(BK_N, bkLen())), z = path.v.length - 1; return { path, z, idx: 100 * Math.exp(path.v[z] - path.v[0]) }; }
// the ticket's stop and target as index levels, for a buy and for a sell, from the index level now (the base of the
// levels, 100 = t0, is the start of the window: it moves every minute, so the bp distances are what is shown first)
function bkPrev(idx, sz, t0 = '') {
  if (!sz.sl && !sz.tp) return null;
  const lvl = m => idx * Math.exp(m / 1e4);
  return { buy: { sl: sz.sl ? lvl(-sz.sl) : null, tp: sz.tp ? lvl(sz.tp) : null }, sell: { sl: sz.sl ? lvl(sz.sl) : null, tp: sz.tp ? lvl(-sz.tp) : null }, bp: { sl: sz.sl || 0, tp: sz.tp || 0 }, t0 };
}
// one side: the distance in bp on the index (signed as the index moves), then the level on the charted index
function bkLvSide(P, sd) {
  const d = sd === 'buy' ? 1 : -1, one = (k, lab, tone) => P.bp[k] ? `${lab} <b class="mono ${tone}">${sgn((k === 'sl' ? -d : d) * P.bp[k], 0)} bp</b> <small class="muted mono">${P[sd][k].toFixed(3)}</small>` : `${lab} <b class="mono">—</b>`;
  return `<span><span class="tag ${sd}">${sd}</span> ${one('sl', 'stop', 'dn')} · ${one('tp', 'target', 'up')}</span>`;
}
const bkLvHtml = P => `${bkLvSide(P, 'buy')}${bkLvSide(P, 'sell')}${P.t0 ? `<small class="muted bk-lv-b">index levels after the bp, 100 = ${escHtml(P.t0)} UTC</small>` : ''}`;
// whole dollars for notional and equity ($357,000, not $357,000.00)
const usd0 = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + '$' + nf0.format(Math.abs(Math.round(v)));
// the Close button waits while a close is pending on a closed market (nothing can fill before the reopening)
const bkCloseOff = g => !!g.closing && !mktState('EURUSD').open;
/* The closest single pair and its size for the same exposure. β = cov(index, pair) / var(pair) over the last day of
   1-minute moves: the pair's notional is |β| × the basket notional, so a 1 bp move of the pair stands for β bp of the
   index; its stop (and target) are the basket's ÷ |β|, the same dollar distance. r1: the index's 1-minute moves. */
function bkProxy(b, sz, r1) {
  if (!r1) { const { path, z } = bkView(b); r1 = []; for (let i = Math.max(1, z - 1440); i <= z; i++) r1.push(path.v[i] - path.v[i - 1]); }
  const best = Engine.PAIRS.map(p => { const rp = Engine.returns(p.sym, r1.length); return { sym: p.sym, rp, r: Engine.corr(r1, rp) }; }).sort((x, y) => Math.abs(y.r) - Math.abs(x.r))[0];
  const n = Math.min(r1.length, best.rp.length), a = r1.slice(-n), q = best.rp.slice(-n), ma = a.reduce((s, x) => s + x, 0) / n, mq = q.reduce((s, x) => s + x, 0) / n;
  let cv = 0, vq = 0; for (let i = 0; i < n; i++) { cv += (a[i] - ma) * (q[i] - mq); vq += (q[i] - mq) ** 2; }
  const beta = vq ? cv / vq : 0, ab = Math.abs(beta) || 1, m = M(best.sym), lots = sz.lots ? normLots(best.sym, Math.abs(beta) * sz.lots * 1e5 / (m.size * Engine.usd(m.base))) : 0;
  const pips = bp => bp ? Math.round(bp / ab / 1e4 * Engine.mid(best.sym) / m.pip * 10) / 10 : null;
  return { sym: best.sym, r: best.r, beta, side: beta >= 0 ? 'buy' : 'sell', lots, slPips: pips(sz.sl), tpPips: pips(sz.tp), cost: lots ? Engine.quote(best.sym).spread * pipValue(best.sym, lots) : 0 };
}
// the verdict next to the closest basket in the overlap grid: only past ±0.7, and a negative ρ is a hedge, not the same bet
const bkOverlapTxt = r => r > .7 ? ' — holding both is largely the same bet.' : r < -.7 ? ' — they move opposite: holding both the same way largely hedges one with the other.' : '.';
// how many open groups, pending orders and alerts were created on this basket id
const bkUsers = id => [...(S.bkPos || []), ...(S.bkOrders || []), ...(S.bkAlerts || [])].filter(x => x.bid === id).length;
function bkVol(b) { const p = bkPath(b, Math.min(1441, bkLen())), r = []; for (let i = 1; i < p.v.length; i++) r.push(p.v[i] - p.v[i - 1]); return stdev(r) * Math.sqrt(1440); }
/* Size, stop and target. Risk = notional × stop + the entry cost (every leg's spread, plus commission when the account
   charges one): Risk % sizes on that sum, so the loss at the stop is the risk shown. Risk % without a stop has nothing
   to size on (need). */
function bkSize(b, c, vol) {
  const dv = vol * 1e4, sl = c.bkSl === 'auto' ? Math.max(5, Math.round(dv * .5)) : (+c.bkSl || 0), tp = c.bkTp === 'auto' ? Math.round(sl * 1.5) : (+c.bkTp || 0);
  const eq = account().eq, costAt = l => bkCost(bkLegs(b, l, 'buy'), l).usd, riskAt = l => l * 1e5 * sl / 1e4 + costAt(l);
  let lots = c.bkLots, need = '';
  if (c.bkMode === 'risk') {
    if (!sl) { lots = 0; need = 'a stop is needed to size on risk'; }
    else {
      const want = eq * c.bkRisk / 100, perLot = 1e5 * sl / 1e4 + costAt(1);
      lots = clamp(Math.floor(want / perLot * 100) / 100, .01, 50);
      // the legs round to 0.01 lot each: step down while the rounded basket costs more than the risk asked
      for (let k = 0; k < 20 && lots > .01 && riskAt(lots) > want; k++) lots = Math.round((lots - .01) * 100) / 100;
    }
  }
  const cost = lots ? costAt(lots) : 0, risk = sl && lots ? riskAt(lots) : null;
  return { sl, tp, lots, risk, pct: risk != null ? risk / eq * 100 : null, cost, costBp: lots ? cost / (lots * 1e5) * 1e4 : 0, need };
}
// cost of the legs at the quote now: the spread of each, plus the commission the account charges at the open
function bkCost(legs, lots) {
  const rows = legs.map(l => { const m = M(l.sym), q = Engine.quote(l.sym); return { ...l, cost: q.spread * pipValue(l.sym, 1) * l.lots, comm: commOf(l.lots, l.sym), margin: l.lots * 1e5 * Engine.usd(m.base) / effLev(l.sym) }; });
  const usd = rows.reduce((s, r) => s + r.cost + r.comm, 0);
  return { rows, usd, margin: rows.reduce((s, r) => s + r.margin, 0), bp: lots ? usd / (lots * 1e5) * 1e4 : 0 };
}
// mv: the move of the group's own composition since the open, in bp for the group's side; null when it has none
function bkGroupState(g) {
  const legs = S.positions.filter(p => p.bgid === g.gid), b = bkComp(g);
  return { n: legs.length, pnl: legs.reduce((s, p) => s + posPnl(p).pnl, 0), mv: b ? (g.side === 'buy' ? 1 : -1) * (bkIdxNow(b) - g.v0) * 1e4 : null, legs };
}
function bkFlags(b, side, sz, cost, vol) {
  const f = [], dv = vol * 1e4, ccys = [...new Set([...Object.keys(bkNorm(b.long)), ...Object.keys(bkNorm(b.short))])];
  if (!sz.sl) f.push(['nosl', 'No basket stop — the possible loss is open-ended']);
  else {
    if (sz.pct > 2) f.push(['size', `Risking ${sz.pct.toFixed(1)}% of equity on one basket`]);
    if (sz.sl < dv * .35) f.push(['tight', `Stop of ${sz.sl} bp is only ${(sz.sl / dv).toFixed(2)}× the basket's daily move (${dv.toFixed(0)} bp)`]);
    if (cost.bp > sz.sl * .15) f.push(['cost', `Entry spreads cost ${cost.bp.toFixed(1)} bp — ${(cost.bp / sz.sl * 100).toFixed(0)}% of the stop`]);
  }
  const ev = typeof bhNewsSoon === 'function' && bhNewsSoon(ccys); if (ev) f.push(['news', `High-impact ${ev.ccy} ${ev.name} in ${bhDur(ev.t - Engine.simTime)}`]);
  const rv = typeof bhRevenge === 'function' && bhRevenge(); if (rv) f.push(rv);
  if (S.bkPos.some(g => g.bid === b.id && g.side === side)) f.push(['corr', `Adds to an open ${b.name} ${side}`]);
  // the same bet as single positions already held (a hedge is not flagged: it is shown in the ticket only)
  const ad = bkCcyOverlap(b, side, sz.lots).filter(o => o.kind === 'adds').slice(0, 2);
  if (ad.length) f.push(['corr', ad.map(bkOvTxt).join('; ').replace(/^a/, 'A')]);
  if (typeof tiltStatus === 'function' && tiltStatus().armed) f.push(['tilt', tiltStatus().why]);
  return f;
}
/* Opening a basket. b is a definition or a saved composition ({id, name, long, short}); the group keeps the normalised
   weights as its snapshot. The legs open one by one: when not all of them fill, the filled ones are closed again
   (rollback), so no partial basket stays open under a stop meant for the whole index. Each leg carries its own wide
   disaster stop (3 × the basket stop from its fill, never closer than 3 spreads, so a tight basket stop cannot
   put it inside a leg's spread): the basket stop is watched by this tab only. */
function bkExec(b, side, sz, pm, flags) {
  const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), snap = bkSnapOf(b), legs = bkLegs(snap, sz.lots, side), ctx = flags.map(f => f[0]);
  const mkt = mktState('EURUSD');
  if (!mkt.open) { toast('Not filled', `${b.name}: ${mkt.label}. No leg was sent.`, 'dn'); setTimeout(obsDraw, 0); return null; }
  const v0 = bkIdxNow(snap), cost = bkCost(legs, sz.lots), dsl = sz.sl ? 3 * sz.sl / 1e4 : 0, opened = [];
  // live: the execution server opens the legs (all or none), keeps the group and watches its stop, target, trail,
  // break-even and time stop (Task 9); the group arrives with the gw state
  if (TradeLink.live) {
    const c = bkCfg();
    TradeLink.send('basket', { do: 'open', bid: b.id, name: b.name, long: snap.long, short: snap.short, side, lots: sz.lots, sl: sz.sl || null, tp: sz.tp || null, trail: +c.bkTrail || 0, be: +c.bkBe || 0, risk: sz.risk, pm: pm || null, ctx }, `${side === 'buy' ? 'Buy' : 'Sell'} ${b.name} (${legs.length} legs)`, 'pos')
      .then(r => { if (!r.ok) { toast('Not filled', `${b.name}: ${r.text || 'refused by the execution server'}.`, 'dn'); beep('err'); } else toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${b.name}`, `${legs.length} legs filled${sz.sl ? ` · stop ${sz.sl} bp` : ''}${sz.tp ? ` · target ${sz.tp} bp` : ''}`, 'info'); setTimeout(obsDraw, 0); });
    return null;
  }
  // the legs are quiet (o.basket): this function says it once for all of them, with the first refusal as the cause
  let why = '';
  for (const l of legs) {
    const q = Engine.quote(l.sym), ref = l.side === 'buy' ? q.ask : q.bid;
    const p = openPosition({ sym: l.sym, side: l.side, lots: l.lots, basket: b.id, bgid: gid, pmDone: true, ctx, slPips: dsl ? Math.max(dsl * ref, 3 * (q.ask - q.bid)) / M(l.sym).pip : undefined, reason: 'Basket order' });
    if (p) opened.push(p); else if (!why) why = bkWhy(lastReject, l.sym);
  }
  if (!opened.length) { toast('Not filled', `${b.name}: none of the ${legs.length} legs filled${why ? ` (${why})` : ''}.`, 'dn'); beep('err'); setTimeout(obsDraw, 0); return null; }
  if (opened.length < legs.length) {
    for (const p of opened) closeVia(p.id, 'Basket rollback', 1, { basket: true });
    const stuck = opened.filter(p => S.positions.includes(p)); stuck.forEach(p => { delete p.bgid; });
    save();
    toast(`Not opened: ${opened.length} of ${legs.length} legs filled, the filled legs were closed`, `${b.name}${why ? `: ${why}` : ''}${stuck.length ? ` · ${stuck.length} could not be closed and stay open as single positions` : ''}`, 'warn'); beep('err');
    setTimeout(obsDraw, 0); return null;
  }
  const c = bkCfg();
  const g = { gid, bid: b.id, name: b.name, side, lots: sz.lots, v0, t0: Engine.simTime, sl: sz.sl || null, tp: sz.tp || null, trail: +c.bkTrail || 0, be: +c.bkBe || 0, pk: 0, mae: 0,
    risk: sz.risk, pm, timeStop: pm?.timeStop || 0, long: snap.long, short: snap.short, cost: cost.bp, legs: opened.map(p => ({ id: p.id, lots: p.lots })) };
  S.bkPos.push(g);
  save(); toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${b.name}`, `${legs.length} legs filled${sz.sl ? ` · stop ${sz.sl} bp` : ''}${sz.tp ? ` · target ${sz.tp} bp` : ''}`, 'info'); beep('fill');
  setTimeout(obsDraw, 0);
  return g;
}
// why a leg was refused, in the words of the basket: a disaster stop inside the spread names itself
function bkWhy(rej, sym) {
  if (!rej) return '';
  if (/inside the spread|wrong side of price|wider than the spread/i.test(rej)) return `the disaster stop of ${pretty(sym)} fell inside its spread (spreads wider than usual, or a basket stop too tight)`;
  return `${pretty(sym)}: ${rej}`;
}
function bkTrade(side) {
  const c = bkCfg(), b = bkGet(c.bkSel), vol = bkVol(b), sz = bkSize(b, c, vol), legs = bkLegs(b, sz.lots, side), cost = bkCost(legs, sz.lots), flags = bkFlags(b, side, sz, cost, vol);
  if (sz.need) { toast('Not sent', `Risk %: ${sz.need}.`, 'dn'); return; }
  if (!legs.length) return;
  const pend = c.bkEntry !== 'market';
  if (!pend && !mktState('EURUSD').open) { toast('Not filled', `${b.name}: ${mktState('EURUSD').label}.`, 'dn'); return; }
  const need = typeof pmNeedFor === 'function' && pmNeedFor(sz.pct ?? 0, !!sz.sl, flags.map(f => f[0]));
  const go = pm => pend ? bkPlace(b, side, sz, pm, flags, c.bkEntry, c.bkPend) : bkExec(b, side, sz, pm, flags);
  if (!need) return go(null);
  const reward = sz.tp ? sz.lots * 1e5 * sz.tp / 1e4 - sz.cost : null, snap = bkSnapOf(b);
  pmGate({
    side, flags, noun: 'basket', label: `${side === 'buy' ? 'Buy' : 'Sell'} basket`,
    summary: `<span class="tag ${side}">${side}</span><b>${escHtml(b.name)}</b><span class="muted">${legs.length} legs · ${usdFmt(sz.lots * 1e5)}</span><span>risk ${sz.sl ? `<b class="dn">${usdFmt(-sz.risk)}</b> <span class="muted">${sz.pct.toFixed(2)}% · spreads included</span>` : '<b class="dn">unlimited</b>'}</span>${sz.tp ? `<span>target <b class="up">${usdFmt(reward, true)}</b> <span class="muted">net</span></span>` : ''}`,
    skipRecord: () => ({ type: 'basket', t: Engine.simTime, bid: b.id, name: b.name, long: { ...snap.long }, short: { ...snap.short }, side, v0: bkIdxNow(snap), sl: sz.sl || null, tp: sz.tp || null, risk: sz.risk, reward, flags: flags.map(f => f[1]) }),
    onGo: go
  });
}
/* the live account: the execution server keeps the baskets (Task 9 OMS); a command and its answer, said once */
function bkLive(cmd, label, ok) {
  return TradeLink.send('basket', cmd, label, 'pos').then(r => { if (!r.ok) { toast('Not done', `${label}: ${r.text || 'refused by the execution server'}.`, 'dn'); beep('err'); } else if (ok) toast(ok[0], ok[1], 'info'); setTimeout(obsDraw, 0); return r.ok; });
}
function bkPlace(b, side, sz, pm, flags, type, bpv) {
  if (TradeLink.live) { const snap = bkSnapOf(b); return bkLive({ do: 'place', bid: b.id, name: b.name, long: snap.long, short: snap.short, side, lots: sz.lots, sl: sz.sl || null, tp: sz.tp || null, risk: sz.risk, pm: pm || null, ctx: (flags || []).map(f => f[0]), type, bp: bpv }, `${b.name}: ${side} ${type}`, [`${b.name}: ${side} ${type} placed`, `Fills if the index moves ${bpv} bp`]); }
  // units: o.sz.cost is the entry cost in USD (as bkSize gives it); a group's g.cost is the same cost in bp of notional
  const snap = bkSnapOf(b), v = bkIdxNow(snap), d = side === 'buy' ? 1 : -1, dir = type === 'limit' ? -d : d; // +1: trigger when index rises
  S.bkOrders.push({ bid: b.id, name: b.name, side, type, bp: bpv, dir, trig: v + dir * bpv / 1e4, t: Engine.simTime, sz: { sl: sz.sl, tp: sz.tp, lots: sz.lots, risk: sz.risk, pct: sz.pct, cost: sz.cost ?? null }, pm, flags, long: snap.long, short: snap.short });
  const mkt = mktState('EURUSD');
  save(); toast(`${b.name}: ${side} ${type} placed`, `Fills if the index ${dir > 0 ? 'rises' : 'falls'} ${bpv} bp${mkt.open ? '' : ` · ${mkt.label}: fills at the reopening gap`}`, 'info'); setTimeout(obsDraw, 0);
}
function bkOrdTxt(o) { const b = bkComp(o); if (!b) return 'basket deleted — this order will not fill'; const v = bkIdxNow(b); return `${o.dir > 0 ? 'rise' : 'fall'} ${o.bp} bp · ${Math.max(0, o.dir * (o.trig - v) * 1e4).toFixed(1)} bp to go`; }
// an index alert at ± bp from now, on the composition of today
function bkAlertRow(b, bpv) { const snap = bkSnapOf(b), v = bkIdxNow(snap); return { bid: b.id, name: b.name, bp: bpv, t: Engine.simTime, up: v + bpv / 1e4, dn: v - bpv / 1e4, long: snap.long, short: snap.short }; }
// world numeraire: each currency against the equal-weighted average of all eight, so USD is not a fixed zero
function bkWorld(P) { const n = P._t.length, m = new Array(n).fill(0); for (const k of Engine.ALL) for (let i = 0; i < n; i++) m[i] += P[k][i] / Engine.ALL.length; return m; }
function bkAnHtml(b, c) {
  const L = bkNorm(b.long), Sx = bkNorm(b.short);
  if (c.bkAn === 'attr') {
    const n = Math.min(c.bkAnW + 1, bkLen()), P = ccyPaths(n), m = bkWorld(P), z = n - 1;
    const rows = Engine.ALL.map(k => { const dv = (P[k][z] - m[z]) - (P[k][0] - m[0]), w = (L[k] || 0) - (Sx[k] || 0); return { k, w, dv, ct: w * dv * 1e4 }; }).filter(r => r.w);
    const tot = rows.reduce((a, r) => a + r.ct, 0), mx = Math.max(1e-9, ...rows.map(r => Math.abs(r.ct)));
    const top = rows.slice().sort((a, b2) => Math.abs(b2.ct) - Math.abs(a.ct))[0];
    return `<div class="bk-attr">${rows.sort((a, b2) => b2.ct - a.ct).map(r => `<div class="bk-exp-r" tabindex="0" data-tip="${escHtml(`${r.k} · ${r.w > 0 ? 'long' : 'short'} ${Math.abs(r.w * 100).toFixed(0)}%|Its contribution: ${sgn(r.ct, 1)} bp. ${r.w > 0 ? `Held long: ${r.k} ${r.ct >= 0 ? 'rose' : 'fell'} against the average of all eight and ${r.ct >= 0 ? 'lifted' : 'held back'} the index.` : `Held short: ${r.k} ${r.ct >= 0 ? 'fell' : 'rose'} against the average of all eight and ${r.ct >= 0 ? 'lifted' : 'held back'} the index.`}`)}"><span class="mono">${r.k} <small class="muted">${r.w > 0 ? 'long' : 'short'} ${Math.abs(r.w * 100).toFixed(0)}%</small></span><div class="bk-exp-bar"><i class="${r.ct >= 0 ? 'up' : 'dn'}" style="${r.ct >= 0 ? 'left:50%' : `left:${50 - Math.abs(r.ct) / mx * 50}%`};width:${Math.abs(r.ct) / mx * 50}%"></i></div><b class="mono ${cls(r.ct)}">${sgn(r.ct, 1)}</b></div>`).join('')}</div>
      <p class="small">Index ${sgn(tot, 1)} bp over ${{ 60: '1 hour', 240: '4 hours', 1440: '1 day', 4320: '3 days' }[c.bkAnW]}. ${top ? `Biggest driver: <b>${top.k}</b> (${sgn(top.ct, 1)} bp${top.ct * tot < 0 ? ', against the net move' : ''}).` : ''} <span class="muted">Each currency is measured against the average of all eight, so the long and short sides are comparable.</span></p>`;
  }
  if (c.bkAn === 'sess') {
    // activity only (average absolute move): no direction, and n per hour, since three days give ~3 samples an hour
    const p = bkView(b).path, hr = Array.from({ length: 24 }, () => []);
    for (let i = 60; i < p.v.length; i += 60) hr[Math.floor((p.t[i - 60] % 86400) / 3600)].push(Math.abs((p.v[i] - p.v[i - 60]) * 1e4));
    const av = hr.map(x => x.length ? x.reduce((q, y) => q + y, 0) / x.length : 0), mx = Math.max(1e-9, ...av), ns = hr.map(x => x.length).filter(x => x), n0 = Math.min(...ns), n1 = Math.max(...ns);
    const best = av.indexOf(Math.max(...av)), quiet = av.indexOf(Math.min(...av.filter(x => x > 0))), hh = h => String(h).padStart(2, '0');
    return `<div class="bh-hrs bk-sess">${av.map((v, h) => `<div data-tip="${hh(h)}:00 UTC|Average move ${v.toFixed(1)} bp, from n = ${hr[h].length} hour${hr[h].length === 1 ? '' : 's'}." style="--h:${(v / mx * 100).toFixed(0)}%" class="${hr[h].length ? 'nt' : 'z'}"><i></i></div>`).join('')}</div>
      <div class="bh-hrs-ax"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      <p class="small">Most active <b>${hh(best)}:00 UTC</b> (${av[best].toFixed(1)} bp per hour), quietest ${hh(quiet)}:00. <span class="muted">Bar height = average absolute move in that hour over the last three days, n = ${n0 === n1 ? n0 : `${n0}–${n1}`} per hour: a few samples each, so neighbouring hours are not reliably different.</span></p>`;
  }
  const all = bkAll(), n = Math.min(1441, bkLen()), R2 = all.map(x => { const p = bkPath(x, n), r = []; for (let i = 5; i < p.v.length; i += 5) r.push(p.v[i] - p.v[i - 5]); return r; });
  const M2 = all.map((_, i) => all.map((_, j) => i === j ? 1 : Engine.corr(R2[i], R2[j])));
  const me = all.findIndex(x => x.id === b.id), twin = M2[me].map((r, j) => ({ r, j })).filter(x => x.j !== me).sort((a, b2) => Math.abs(b2.r) - Math.abs(a.r))[0];
  // headers: a whole short name (the presets have their own, a custom basket its first word), the full name as a tooltip
  const ab = x => escHtml(BK_AB[x.id] || String(x.name).split(/[\s(]/)[0] || '·'), hd = (x, c) => `<span class="${c}" data-tip="${escHtml(x.name)}|${escHtml(bkLabel(x))}">${ab(x)}</span>`;
  return `<div class="bk-corr" style="grid-template-columns:76px repeat(${all.length},minmax(0,1fr))"><span></span>${all.map(x => hd(x, 'h')).join('')}${all.map((x, i) => `${hd(x, `h r ${i === me ? 'acc' : ''}`)}${M2[i].map((r, j) => `<span class="c ${i === j ? 'd' : ''}" title="${escHtml(x.name)} vs ${escHtml(all[j].name)}: ${r.toFixed(2)}" style="background:${r >= 0 ? `color-mix(in srgb,var(--corr-pos) ${Math.round(Math.abs(r) * 55)}%,transparent)` : `color-mix(in srgb,var(--corr-neg) ${Math.round(Math.abs(r) * 55)}%,transparent)`}">${i === j ? '' : nfx(r, 2)}</span>`).join('')}`).join('')}</div>
    <p class="small">${twin ? `<b>${escHtml(b.name)}</b> overlaps most with <b>${escHtml(all[twin.j].name)}</b> (ρ ${twin.r.toFixed(2)})${bkOverlapTxt(twin.r)}` : ''} <span class="muted">5-minute returns, last 24h.</span></p>`;
}
/* The basket stop on the index (bp for the group's side): the larger of the stop, break-even and the trail.
   Break-even sits at +cost (the entry spreads, already paid), so a close there is about flat; the automatic one
   engages only once the best move is past both its trigger and the cost. */
function bkStopParts(g) {
  const cost = g.cost || 0;
  return { sl: g.sl ? -g.sl : -Infinity, be: g.beSet || (g.be && g.pk >= g.be && g.pk > cost) ? cost : -Infinity, tr: g.trail ? g.pk - g.trail : -Infinity };
}
function bkStopMv(g) { const p = bkStopParts(g), st = Math.max(p.sl, p.be, p.tr); return isFinite(st) ? st : null; }
// which part sets the stop now: 'sl', 'be', 'trail' (null: no stop)
function bkStopKind(g) { const p = bkStopParts(g), st = Math.max(p.sl, p.be, p.tr); return !isFinite(st) ? null : st === p.tr && st > p.be && st > p.sl ? 'trail' : st === p.be && st > p.sl ? 'be' : 'sl'; }
function bkStopTxt(g) {
  if (g.closing) return `close pending — ${g.pendWhy || 'retrying'} · it retries until every leg is closed`;
  if (!bkComp(g)) return 'basket deleted before its composition was saved — stop and target suspended, no automatic close';
  const sm = bkStopMv(g), k = bkStopKind(g), lab = sm == null ? 'no stop' : k === 'be' ? `stop at break-even (+${sm.toFixed(1)} bp, the spreads)` : k === 'trail' ? `trailing stop ${sgn(sm, 1)} bp` : `stop −${g.sl} bp`;
  return `${lab} · target ${g.tp ? g.tp + ' bp' : '—'} · best ${sgn(g.pk || 0, 1)}`;
}
// BE is offered once the move is above the entry cost: below it, a stop at +cost would close at once
const bkBeOk = (g, st = bkGroupState(g)) => !g.beSet && !g.closing && st.mv != null && st.mv > (g.cost || 0);
const bkBeTip = g => `Break-even|Moves the basket stop to +${(g.cost || 0).toFixed(1)} bp on the index: the entry spreads are already paid, so a close there is about flat. Available once the basket is more than ${(g.cost || 0).toFixed(1)} bp in profit.`;
/* Changing the stop and target of an open basket (bp on the index from the entry, as at the open): the stop on the
   losing side and the target on the winning side, neither already crossed by the index (it would close at once);
   empty = none. Break-even and the trail keep their rule: the tighter of stop, break-even and trail applies. Each
   leg's disaster stop is set again as at the open (3 × the stop from its entry, never closer than 3 spreads) through the
   same path as the positions table (the leg's sl, then changed('pos')); a leg whose new disaster stop would be past
   its price keeps the old one. Returns '' or why it was refused. */
function bkEditApply(gid, sl, tp) {
  const g = S.bkPos.find(x => x.gid === gid); if (!g) return 'This basket is no longer open.';
  if (TradeLink.live) { bkLive({ do: 'edit', gid, sl: sl || null, tp: tp || null }, `${g.name}: stop and target`, [`${g.name}: stop and target sent`, 'The execution server applies them to the basket.']); return ''; }
  if (g.closing) return 'Close pending on this basket: its stop and target cannot be changed until it completes.';
  const st = bkGroupState(g); if (st.mv == null) return 'This basket has no saved composition: its stop and target are suspended.';
  const okN = (x, mx) => x == null || (Number.isInteger(x) && x >= 1 && x <= mx);
  if (!okN(sl, 2000)) return 'Stop: a whole number of bp from 1 to 2000 below the entry (the losing side), or empty for none.';
  if (!okN(tp, 4000)) return 'Target: a whole number of bp from 1 to 4000 above the entry (the winning side), or empty for none.';
  if (sl != null && st.mv <= -sl) return `The index is already ${sgn(st.mv, 1)} bp from the entry: a stop at −${sl} bp would close the basket at once.`;
  if (tp != null && st.mv >= tp) return `The index is already ${sgn(st.mv, 1)} bp from the entry: a target at +${tp} bp would close the basket at once.`;
  const old = { sl: g.sl || null, tp: g.tp || null }, cost = g.cost || 0;
  g.sl = sl; g.tp = tp; g.risk = sl ? g.lots * 1e5 * (sl + cost) / 1e4 : null;
  let kept = 0;
  for (const p of st.legs) {
    if (!sl) { p.sl = null; p.trailed = false; continue; }
    const q = Engine.quote(p.sym), d = p.side === 'buy' ? 1 : -1, lvl = p.entry - d * Math.max(3 * sl / 1e4 * p.entry, 3 * (q.ask - q.bid));
    if (d > 0 ? lvl < q.bid : lvl > q.ask) { p.sl = lvl; p.trailed = false; } else kept++;
  }
  changed('pos');
  const fs = x => x ? `−${x} bp` : 'none', ft = x => x ? `+${x} bp` : 'none', k = bkStopKind(g), sm = bkStopMv(g);
  const held = k === 'trail' ? ` · the trailing stop (${sgn(sm, 1)} bp) is tighter and stays in charge` : k === 'be' ? ` · the break-even stop (+${sm.toFixed(1)} bp) is tighter and stays in charge` : '';
  const rr = sl && tp ? ` · net reward : risk ${(tp - cost).toFixed(1)} : ${(sl + cost).toFixed(1)} bp (1 : ${((tp - cost) / (sl + cost)).toFixed(2)})` : '';
  const dis = sl ? `leg disaster stops reset to 3× the stop (${3 * sl} bp) from each entry${kept ? `; ${kept} leg${kept > 1 ? 's keep their' : ' keeps its'} old one (the new one would be past the price)` : ''}` : 'no basket stop: the possible loss is open-ended, and the legs carry no disaster stop';
  toast(`${g.name}: stop and target changed`, `stop ${fs(old.sl)} → ${fs(sl)} · target ${ft(old.tp)} → ${ft(tp)} · ${dis}${rr}${held}`, 'info');
  if (activeTab === 'obs' && obsCfg().view === 'bask') setTimeout(obsDraw, 0);
  return '';
}
// the editor's live line: where the index is, and the net reward : risk of the values typed
function bkEdRr(g, v, st = bkGroupState(g)) {
  const cost = g.cost || 0, sl = +v.sl > 0 ? Math.round(+v.sl) : 0, tp = +v.tp > 0 ? Math.round(+v.tp) : 0;
  const rr = sl && tp ? `Net of the ${cost.toFixed(1)} bp entry cost, reward : risk ${(tp - cost).toFixed(1)} : ${(sl + cost).toFixed(1)} bp (1 : ${((tp - cost) / (sl + cost)).toFixed(2)}).` : !sl ? 'No stop: the possible loss is open-ended (net of costs, no reward : risk).' : `No target: net risk ${(sl + cost).toFixed(1)} bp with the ${cost.toFixed(1)} bp entry cost.`;
  return `In bp on the index from the entry; the index is now ${st.mv == null ? '—' : sgn(st.mv, 1)} bp. ${rr} Enter saves, Escape cancels.`;
}
function bkEdHtml(g, st) {
  const gi = escHtml(g.gid), v = BK.edV && BK.edV.gid === g.gid ? BK.edV : { sl: g.sl || '', tp: g.tp || '' };
  return `<div class="bk-ed" role="group" aria-label="Change the stop and target of ${escHtml(g.name)}"><div class="bk-trade"><label>Stop <input type="number" id="bkEdSl" data-gid="${gi}" min="1" max="2000" step="1" value="${escHtml(String(v.sl))}" placeholder="none"> bp</label><label>Target <input type="number" id="bkEdTp" data-gid="${gi}" min="1" max="4000" step="1" value="${escHtml(String(v.tp))}" placeholder="none"> bp</label></div><p class="small muted" data-bk-ed-rr>${bkEdRr(g, v, st)}</p><div class="bk-ed-b"><button class="ghost sm" data-bk-ed-ok="${gi}">Save</button><button class="link" data-bk-ed-x="${gi}">Cancel</button></div></div>`;
}
const bkEdNum = id => { const i = $(id); if (!i || i.value.trim() === '') return null; const x = +i.value; return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : NaN; };
function bkEdOpen(gid) { BK.ed = gid; BK.edV = null; obsDraw(); const i = $('#bkEdSl'); if (i) { i.focus(); i.select(); } }
function bkEdClose(gid) { BK.ed = null; BK.edV = null; obsDraw(); const b = $(`[data-bk-ed="${escHtml(gid)}"]`); if (b) b.focus(); }
function bkEdSave(gid) {
  const why = bkEditApply(gid, bkEdNum('#bkEdSl'), bkEdNum('#bkEdTp'));
  if (why) { toast('Not changed', why, 'dn'); return false; }
  bkEdClose(gid); return true;
}
// the record of a closed group: P&L of every leg net of commission, the move of its own composition
function bkFinish(g, reason) {
  const H = S.history.filter(h => h.bgid === g.gid), pnl = H.reduce((a, h) => a + h.pnl - (h.comm || 0), 0), b = bkComp(g);
  const row = { gid: g.gid, name: g.name, side: g.side, t0: g.t0, t1: Engine.simTime, pnl, mfe: g.pk || 0, mae: g.mae || 0, sl: g.sl, reason, risk: g.risk };
  if (b) row.mv = (g.side === 'buy' ? 1 : -1) * (bkIdxNow(b) - g.v0) * 1e4;
  S.bkHist.unshift(row);
  if (S.bkHist.length > 60) S.bkHist.pop();
}
/* Close every leg. The group leaves the book (and enters the record) only when no leg is left: a leg refused (market
   closed, requote) keeps the group as "close pending", retried by bkMonitor while the market is open. */
const BK_RETRY_MS = 3000;
function bkCloseGroup(gid, reason = 'Basket close') {
  const g = S.bkPos.find(x => x.gid === gid);
  if (TradeLink.live) { if (g) bkLive({ do: 'close', gid }, `${g.name}: close`); return ''; }
  let why = '';
  // the legs close quietly (ctx.basket): one summary toast below, for the close or for the close pending
  for (const p of S.positions.filter(p => p.bgid === gid)) { closeVia(p.id, reason, 1, { basket: true }); if (S.positions.includes(p) && !why) why = lastReject || 'a leg was not closed'; }
  const left = S.positions.filter(p => p.bgid === gid);
  if (!g) { save(); return !left.length; }
  if (left.length) {
    const first = !g.closing;
    g.closing = reason; g.pendWhy = `${left.length} of ${(g.legs || []).length || left.length} legs still open: ${why}`.slice(0, 300); g.legs = left.map(p => ({ id: p.id, lots: p.lots }));
    BK.retry[gid] = performance.now(); save();
    if (first) { toast(`${g.name}: close pending`, `${left.length} leg${left.length > 1 ? 's' : ''} still open (${why}). The basket stays in the book and retries when the market quotes.`, 'warn'); beep('err'); }
    return false;
  }
  bkFinish(g, reason);
  S.bkPos = S.bkPos.filter(x => x.gid !== gid); delete BK.retry[gid]; save();
  // one toast for the whole basket: why it closed, the P&L of every leg net of commission, the move of the index
  const h = S.bkHist[0], pnl = h && h.gid === gid ? h.pnl : 0, mv = h && h.gid === gid && Number.isFinite(h.mv) ? ` · ${sgn(h.mv, 1)} bp` : '';
  toast(`${g.name}: ${BK_WHY[reason] || reason.toLowerCase()}`, `${usdFmt(pnl, true)}${mv} · ${(g.legs || []).length || 'all'} legs closed`, pnl >= 0 ? 'up' : 'dn'); beep(pnl >= 0 ? 'win' : 'loss');
  return true;
}
const BK_WHY = { 'Basket close': 'closed', 'Basket stop': 'basket stop', 'Basket trail': 'trailing stop', 'Break-even': 'break-even stop', 'Basket target': 'basket target', 'Time stop': 'time stop' };
// ½: closes half of every leg, or nothing when a leg rounds (lot step, minimum size) more than 20% away from half
function bkHalf(gid) {
  const g = S.bkPos.find(x => x.gid === gid); if (!g || g.closing) return false;
  if (TradeLink.live) { bkLive({ do: 'half', gid }, `${g.name}: close half`); return true; }
  const mkt = mktState('EURUSD'); if (!mkt.open) { toast('Not closed', `${g.name}: ${mkt.label}.`, 'dn'); return false; }
  const legs = S.positions.filter(p => p.bgid === gid), bad = [];
  // the lots the close will really take (closeLots: down to the step, nothing under the minimum size), not a rounding
  for (const p of legs) {
    const l = closeLots(p, .5), f = l / p.lots;
    if (!l) bad.push(`${pretty(p.sym)} ${lotsFmt(p.sym, p.lots)} → none (minimum size ${lotsFmt(p.sym, volOf(p.sym)[0])})`);
    else if (Math.abs(f - .5) > .1 + 1e-9) bad.push(`${pretty(p.sym)} ${lotsFmt(p.sym, p.lots)} → ${lotsFmt(p.sym, l)} (${Math.round(f * 100)}%)`);
  }
  if (bad.length) { toast('½ refused at this size', `Half of a leg rounds more than 20% away from half: ${bad.join(', ')}. Close the whole basket instead.`, 'dn'); return false; }
  const n0 = legs.reduce((a, p) => a + notionalUsd(p.sym, p.lots), 0);
  for (const p of legs) closeVia(p.id, 'Basket close', .5, { basket: true });
  const now = S.positions.filter(p => p.bgid === gid), miss = now.filter(p => { const r = (g.legs || []).find(x => x.id === p.id); return r && p.lots >= r.lots - 1e-9; });
  g.legs = now.map(p => ({ id: p.id, lots: p.lots }));
  // the basket's size follows what is really left: the notional of the legs now over the notional before the close
  const k = n0 > 0 ? now.reduce((a, p) => a + notionalUsd(p.sym, p.lots), 0) / n0 : .5;
  g.lots = +(g.lots * k).toFixed(4); if (g.risk) g.risk *= k; save();
  toast(`${g.name}: ${miss.length ? `half closed on ${legs.length - miss.length} of ${legs.length} legs` : 'closed half'}`, `${usdFmt(S.history.filter(h => h.bgid === gid).reduce((a, h) => a + h.pnl, 0), true)} banked so far${miss.length ? ' · the legs left whole keep their full size' : ''}`, miss.length ? 'warn' : 'info');
  return !miss.length;
}
// a leg closed or reduced outside the basket (by hand, its disaster stop, a stop-out): the basket no longer matches
// its index, so the group ends and the legs left become single positions with their own stops
function bkSplit(g, legs) {
  for (const p of legs) delete p.bgid;
  S.bkPos = S.bkPos.filter(x => x !== g); delete BK.retry[g.gid];
  toast(`${g.name}: basket split`, `A leg was closed or reduced outside the basket, so the ${legs.length} remaining leg${legs.length > 1 ? 's are' : ' is'} now single positions${legs.some(p => p.sl != null) ? ', each with its disaster stop' : ''}. The basket stop and target no longer apply.`, 'warn');
}
// net currency exposure of every open position, in USD: the same split as exposureOf (panels.js). A pair splits into
// its two currencies; any other instrument counts only towards its quote currency when that is not USD. The basket
// tool works on the G8 currencies (Engine.ALL); the others (MXN, PLN, …) are returned by otherCcyExposure and shown
// as their own rows, outside the stress scenarios.
function ccyExposure() {
  const e = Object.fromEntries(Engine.ALL.map(k => [k, 0]));
  for (const [k, v] of Object.entries(exposureOf().ccy)) if (k in e && isFinite(v)) e[k] += v;
  return e;
}
function otherCcyExposure() { const g8 = new Set(Engine.ALL); return Object.fromEntries(Object.entries(exposureOf().ccy).filter(([k, v]) => !g8.has(k) && isFinite(v) && Math.abs(v) >= 500)); }
// net USD notional per CFD instrument (long +, short −), shown as its own rows
function cfdExposure() { return Object.fromEntries(Object.entries(exposureOf().inst).filter(([, v]) => isFinite(v) && Math.abs(v) >= 500)); }
function bkExpHtml() {
  const e = ccyExposure(), cfd = cfdExposure(), oth = otherCcyExposure(), mx = Math.max(1, ...[...Object.values(e), ...Object.values(cfd), ...Object.values(oth)].map(Math.abs)), gross = Object.values(e).reduce((a, v) => a + Math.abs(v), 0) / 2;
  if (!S.positions.length) return '<div class="ins"><label>Your currency exposure</label><p class="small muted">Open positions are netted here by currency — two pairs can quietly add up to one big bet.</p></div>';
  const k1 = v => Math.abs(v) < 500 ? '—' : (v > 0 ? '+' : '−') + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : (Math.abs(v) / 1e3).toFixed(0) + 'k');
  const row = (name, v, title = '') => { const w = Math.abs(v) / mx * 50; return `<div class="bk-exp-r"${title ? ` title="${escHtml(title)}"` : ''}><span class="mono">${escHtml(name)}</span><div class="bk-exp-bar"><i class="${v >= 0 ? 'up' : 'dn'}" style="${v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></div><b class="mono ${cls(v)}">${k1(v)}</b></div>`; };
  const top = [...Object.entries(e), ...Object.entries(oth), ...Object.entries(cfd).map(([s, v]) => [M(s).short, v])].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const cfdRows = Object.entries(cfd).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([s, v]) => row(M(s).short, v, `${M(s).label}: net ${v >= 0 ? 'long' : 'short'} ${usdFmt(Math.abs(v))} notional`)).join('');
  const othRows = Object.entries(oth).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => row(k, v, `${k}: net ${v >= 0 ? 'long' : 'short'} ${usdFmt(Math.abs(v))}, a currency outside the G8 (not in the baskets or the stress tests)`)).join('');
  return `<div class="ins"><label>Your currency exposure · all positions · G8 currencies</label>
    <div class="bk-exp">${Engine.ALL.map(k => row(k, e[k])).join('')}</div>
    ${othRows ? `<label class="bk-sub">Currencies outside the G8 · USD notional</label><div class="bk-exp">${othRows}</div>` : ''}
    ${cfdRows ? `<label class="bk-sub">CFD exposure · USD notional per instrument</label><div class="bk-exp">${cfdRows}</div>` : ''}
    <p class="small">Biggest bet: <b>${top[1] >= 0 ? 'long' : 'short'} ${escHtml(top[0])}</b> ${usd0(Math.abs(top[1]))}. A 1% move of this currency mix ≈ <b class="mono">${usdFmt(gross * .01)}</b>${cfdRows ? ' (CFD price moves not included)' : ''}.</p>
    <button class="ghost sm" data-bk-exp>Chart my exposure as a basket</button>
    <label class="bk-sub">Stress test · P&amp;L if this happened now</label>
    <div class="bk-stress">${bkStress(e).map(x => `<div title="${x.d}"><span>${x.n}</span><b class="mono ${cls(x.pnl)}">${usdFmt(x.pnl, true)}</b></div>`).join('')}</div>
    <p class="small muted">Moves are in each currency's value; your exposure is linear, so the estimate ignores spreads and gaps. "Worst day" replays the worst 24h of the last three days on today's positions.${cfdRows ? ' CFDs count only through their quote currency here; their own price moves are not in these scenarios.' : ''}${othRows ? ' Currencies outside the G8 are not in these scenarios.' : ''}</p></div>`;
}
function bkStress(e) {
  const mv = m => Object.entries(m).reduce((a, [k, x]) => a + (e[k] || 0) * x / 100, 0);
  const all = (x, ex = []) => Object.fromEntries(Engine.ALL.filter(k => !ex.includes(k)).map(k => [k, x]));
  const out = [
    { n: 'USD +1%', d: 'Dollar up 1% against everything', pnl: mv({ ...all(-1, ['USD']) }) },
    { n: 'Risk-off', d: 'JPY +1.5%, CHF +1%, AUD and NZD −1.5%, CAD −0.5% vs USD', pnl: mv({ JPY: 1.5, CHF: 1, AUD: -1.5, NZD: -1.5, CAD: -.5 }) },
    { n: 'Risk-on', d: 'The reverse of risk-off', pnl: mv({ JPY: -1.5, CHF: -1, AUD: 1.5, NZD: 1.5, CAD: .5 }) },
    { n: 'EUR −1%', d: 'Euro down 1% against everything', pnl: mv({ EUR: -1 }) }
  ];
  const P = ccyPaths(Math.min(BK_N, bkLen())); let worst = 0;
  for (let i = 1440; i < P._t.length; i += 15) { let x = 0; for (const k of Engine.ALL) x += (e[k] || 0) * (Math.exp(P[k][i] - P[k][i - 1440]) - 1); worst = Math.min(worst, x); }
  out.push({ n: 'Worst day', d: 'Worst 24h of the last three days, replayed on current exposure', pnl: worst });
  return out;
}
function bkAlDist(a) { const b = bkComp(a); if (!b) return 'basket deleted'; const v = bkIdxNow(b); return `${sgn((a.up - v) * 1e4, 0)} / ${sgn((a.dn - v) * 1e4, 0)} bp to go`; }
// how far the index is from its 20-bar mean, and how often such stretches closed in this window (partly EMA lag, not reversion)
function bkStretchHtml(b, c, path = bkView(b).path) {
  const cd = bkCandles(path, c.bkTf); if (cd.length < 60) return '<p class="small muted">Needs more history.</p>';
  const lc = cd.map(k => Math.log(k.close)), st = bkStretch(lc), zl = st.zl, n = st.n, back = st.back;
  /* the reference: the same rule on the same bar moves in a shuffled order (a random walk with this volatility), 20
     seeded shuffles so the figure does not jump between redraws. A come-back rate near it is the EMA lag, not reversion. */
  const d = lc.slice(1).map((x, i) => x - lc[i]); let rs = 0x9e3779b9 ^ d.length, rn = 0, rb = 0;
  const rnd = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let k = 0; k < 20; k++) { const s = d.slice(); for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), x = s[i]; s[i] = s[j]; s[j] = x; } const p = [lc[0]]; for (const x of s) p.push(p[p.length - 1] + x); const q = bkStretch(p); rn += q.n; rb += q.back; }
  const rw = rn ? rb / rn : null, pc = n ? back / n : null, se = rw != null && n ? 2 * Math.sqrt(rw * (1 - rw) / n) : 0;
  const cmp = rw == null || pc == null ? '' : Math.abs(pc - rw) <= se ? 'about the same' : pc > rw ? 'more than' : 'fewer than';
  const tfl = { 5: '5m', 15: '15m', 60: '1H', 240: '4H' }[c.bkTf];
  const w = Math.min(100, Math.abs(zl) / 3 * 100);
  return `<div class="bk-z"><div class="bk-z-bar"><i class="${zl >= 0 ? 'up' : 'dn'}" style="${zl >= 0 ? 'left:50%' : `left:${50 - w / 2}%`};width:${w / 2}%"></i><span style="left:${50 + clamp(zl, -3, 3) / 3 * 50}%"></span></div><b class="mono ${Math.abs(zl) >= 2 ? (zl > 0 ? 'up' : 'dn') : ''}">${sgn(zl, 2)}σ</b></div>
    <p class="small">${Math.abs(zl) >= 2 ? `<b>Stretched ${zl > 0 ? 'above' : 'below'}</b> its 20-bar mean on ${tfl}.` : `Within normal range of its 20-bar mean on ${tfl}.`} ${n ? `Over the last three days, <b>${back} of ${n}</b> moves past 2σ came back to the mean within 20 bars (${Math.round(pc * 100)}%). A random walk with the same moves, shuffled, comes back ${rw != null ? `${Math.round(rw * 100)}%` : '—'} of the time by the same rule${cmp ? ` — ${cmp === 'about the same' ? `about the same at n = ${n}` : `${cmp} it, on only n = ${n}`}` : ''}: the EMA20 lags, so it catches up with price even if price stops moving.` : `No 2σ stretches in this window yet. For reference, a random walk with the same moves, shuffled, comes back ${rw != null ? `${Math.round(rw * 100)}%` : '—'} of the time by the same rule (back within 20 bars), from the EMA lag alone.`} Not a forecast of the next move.</p>`;
}
// distance of a log-price path from its EMA20 in σ, and how many crossings of 2σ came back within 20 bars
function bkStretch(lc) {
  let e = Math.exp(lc[0]); const em = lc.map(x => (e += 2 / 21 * (Math.exp(x) - e)));
  const res = lc.map((x, i) => x - Math.log(em[i])), sd = stdev(res.slice(20)) || 1e-9, z = res.map(r => r / sd);
  let n = 0, back = 0; for (let i = 20; i < z.length - 20; i++) if (Math.abs(z[i]) >= 2 && Math.abs(z[i - 1]) < 2) { n++; for (let j = i + 1; j <= i + 20; j++) if (Math.sign(z[j]) !== Math.sign(z[i]) || Math.abs(z[j]) < .25) { back++; break; } }
  return { zl: z[z.length - 1], n, back };
}
function bkEqualise(b) {
  const P = ccyPaths(Math.min(1441, bkLen()));
  const vol = k => { const o = Engine.ALL.filter(x => x !== k), r = []; for (let i = 1; i < P._t.length; i++) { let a = P[k][i] - P[k][i - 1]; for (const x of o) a -= (P[x][i] - P[x][i - 1]) / o.length; r.push(a); } return stdev(r) || 1e-9; };
  for (const side of ['long', 'short']) { const ks = Object.keys(b[side]).filter(k => +b[side][k] > 0); if (ks.length < 2) continue; const inv = ks.map(k => 1 / vol(k)), t = inv.reduce((a, x) => a + x, 0); ks.forEach((k, i) => b[side][k] = +(inv[i] / t * 100).toFixed(1)); }
}
// a record row from before the 24.10 fix: a move no basket makes (|mv| > 1000 bp) or a "Basket close" at exactly $0
const bkHistBad = h => (Number.isFinite(h.mv) && Math.abs(h.mv) > 1000) || (h.reason === 'Basket close' && Math.abs(+h.pnl || 0) < .005);
function bkHistHtml() {
  const all = S.bkHist || []; if (!all.length) return '';
  // closes recorded before the 24.10 fix (a deleted or edited basket read with another composition, a weekend close
  // written as $0) cannot be recomputed: they stay listed, marked, and count in none of the figures
  const H = all.filter(h => !bkHistBad(h)), nx = all.length - H.length;
  const W = H.filter(h => h.pnl > 0), cap = W.filter(h => h.mfe > 0 && Number.isFinite(h.mv)).map(h => h.mv / h.mfe), mae = bhMean(H.map(h => Math.abs(h.mae))), er = H.length && mae > 0 ? [bhMean(H.map(h => h.mfe)) / mae] : [];
  return `<div class="ins"><label>Basket record · ${H.length}${nx ? ` <span class="muted">+ ${nx} excluded</span>` : ''}</label>
    <div class="obs-kpis bh-kpis three">${kpi('Win rate', H.length ? (W.length / H.length * 100).toFixed(0) + '%' : '—', '', `Win rate|${W.length} of ${H.length} closed baskets made money${nx ? `; ${nx} recorded before the 24.10 fix are left out` : ''}. On a few baskets this is mostly luck.`)}${kpi('Kept of best move', cap.length ? (bhMean(cap) * 100).toFixed(0) + '%' : '—', '', `Kept of best move|On the ${cap.length} winning baskets, the move at the close as a share of the best move while open.`)}${kpi('Edge ratio', er.length ? bhMean(er).toFixed(2) : '—', '', `Edge ratio|Average best ÷ average worst move while open, over ${H.length} baskets. A few baskets swing it either way.`)}</div>
    <div class="bk-hist">${all.slice(0, 6).map(h => { const bad = bkHistBad(h); return `<div class="bk-h${bad ? ' ex' : ''}"><div><b>${escHtml(h.name)}</b> <span class="tag ${escHtml(h.side)}">${escHtml(h.side)}</span><div class="small muted mono">${escHtml(String(h.reason).replace('Basket ', ''))} · best <span class="up">${sgn(h.mfe, 0)}</span> · worst <span class="dn">${sgn(h.mae, 0)}</span> bp</div>${bad ? '<div class="small muted">excluded: recorded before the 24.10 fix</div>' : ''}</div><b class="mono ${bad ? 'muted' : cls(h.pnl)}">${usdFmt(h.pnl, true)}</b></div>`; }).join('')}</div>
    <p class="small muted">Best and worst are the basket's largest move for and against you while open, in bp (MFE / MAE). Edge ratio = average best ÷ average worst.</p></div>`;
}
function bkMonitor() {
  if (TradeLink.live) return; // the live account's baskets are watched on the execution server (Task 9)
  const open = mktState('EURUSD').open;
  if (S.bkAlerts && S.bkAlerts.length) for (const a of [...S.bkAlerts]) { const b = bkComp(a); if (!b) continue; const v = bkIdxNow(b); if (v >= a.up || v <= a.dn) { S.bkAlerts = S.bkAlerts.filter(x => x !== a); save(); toast(`${a.name} ${v >= a.up ? 'up' : 'down'} ${a.bp} bp`, `Basket alert set ${bhDur(Engine.simTime - a.t)} ago`, v >= a.up ? 'up move' : 'dn move'); beep('alert'); if (activeTab === 'obs' && obsCfg().view === 'bask') setTimeout(obsDraw, 0); } }
  // pending baskets fill only while the legs quote: a trigger crossed during the close fills at the reopening gap
  if (open && S.bkOrders && S.bkOrders.length) for (const o of [...S.bkOrders]) { const b = bkComp(o); if (!b) continue; const v = bkIdxNow(b); if (o.dir * (v - o.trig) >= 0) { S.bkOrders = S.bkOrders.filter(x => x !== o); bkExec({ id: o.bid, name: o.name, long: b.long, short: b.short }, o.side, o.sz, o.pm, o.flags || []); } }
  if (!S.bkPos || !S.bkPos.length) return;
  let ch = false;
  for (const g of [...S.bkPos]) {
    const st = bkGroupState(g);
    if (g.closing) {
      if (!st.n) { bkFinish(g, g.closing); S.bkPos = S.bkPos.filter(x => x !== g); delete BK.retry[g.gid]; ch = true; }
      else if (open && !(performance.now() - (BK.retry[g.gid] ?? -Infinity) < BK_RETRY_MS)) { bkCloseGroup(g.gid, g.closing); ch = true; }
      continue;
    }
    if (!st.n) { bkFinish(g, 'Legs closed'); S.bkPos = S.bkPos.filter(x => x !== g); ch = true; continue; }
    // the legs as opened (a row saved before this record starts from the legs it has now)
    if (!Array.isArray(g.legs) || !g.legs.length) { g.legs = st.legs.map(p => ({ id: p.id, lots: p.lots })); ch = true; }
    if (g.legs.some(l => !st.legs.some(p => p.id === l.id && p.lots >= l.lots - 1e-9))) { bkSplit(g, st.legs); ch = true; continue; }
    // no composition (deleted before snapshots): stop, target and time stop are suspended, nothing closes by itself
    if (st.mv == null) continue;
    g.pk = Math.max(g.pk || 0, st.mv); g.mae = Math.min(g.mae || 0, st.mv);
    const sm = bkStopMv(g);
    // bkCloseGroup says it (one toast for the basket: the stop, target or time stop, its P&L and move)
    if (sm != null && st.mv <= sm) { const k = bkStopKind(g); bkCloseGroup(g.gid, k === 'trail' ? 'Basket trail' : k === 'be' ? 'Break-even' : 'Basket stop'); ch = true; }
    else if (g.tp && st.mv >= g.tp) { bkCloseGroup(g.gid, 'Basket target'); ch = true; }
    else if (g.timeStop && Engine.simTime - g.t0 >= g.timeStop) { if (st.pnl <= 0) bkCloseGroup(g.gid, 'Time stop'); else g.timeStop = 0; ch = true; }
  }
  if (ch) { save(); if (activeTab === 'obs' && obsCfg().view === 'bask') setTimeout(obsDraw, 0); }
}
// replay a skipped basket from the 1-minute currency paths
function bkSkipHit(s) {
  const mins = Math.floor((Engine.simTime - s.t) / 60); if (mins < 1 || (!s.sl && !s.tp)) return { res: 'open' };
  const p = bkPath(s, Math.min(mins + 1, bkLen())), d = s.side === 'buy' ? 1 : -1, base = s.v0 ?? p.v[0];
  for (let i = 0; i < p.v.length; i++) { const mv = d * (p.v[i] - base) * 1e4; if (s.sl && mv <= -s.sl) return { res: 'sl', t: p.t[i] }; if (s.tp && mv >= s.tp) return { res: 'tp', t: p.t[i] }; }
  return { res: 'open' };
}
function bkTick() {
  const c = obsCfg(); if (activeTab !== 'obs' || c.view !== 'bask' || !$('#bkChart')) return; bkData(bkGet(c.bkSel), c, false);
  for (const g of S.bkPos || []) {
    const st = bkGroupState(g), gi = escHtml(g.gid), a = $(`[data-bkg-pnl="${gi}"]`), m = $(`[data-bkg-mv="${gi}"]`);
    if (a) { a.textContent = usdFmt(st.pnl, true); a.className = 'mono ' + cls(st.pnl); }
    if (m) { m.textContent = st.mv == null ? '—' : sgn(st.mv, 1) + ' bp'; m.className = 'small mono ' + cls(st.mv || 0); }
    const t = $(`[data-bkg-st="${gi}"]`); if (t) t.textContent = bkStopTxt(g);
    const rp = $(`[data-bkg-rep="${gi}"]`); if (rp) rp.textContent = bkRepTxt(bkRepErr(g, st));
    const be = $(`[data-bk-be="${gi}"]`); if (be) be.disabled = !bkBeOk(g, st);
    const cl = $(`[data-bk-closeg="${gi}"]`); if (cl) cl.disabled = bkCloseOff(g);
  }
  (S.bkOrders || []).forEach((o, i) => { const e = $(`[data-bko="${i}"]`); if (e) e.textContent = bkOrdTxt(o); });
  if (c.bkAn === 'attr' && (BK.anT = (BK.anT || 0) + 1) % 10 === 0) { const a = $('#bkAn'); if (a) a.innerHTML = bkAnHtml(bkGet(c.bkSel), c); }
}
function bkSaveEdit() {
  const c = bkCfg(), b = c.baskets.find(x => x.id === c.bkSel); if (!b) return;
  $$('#obsBody .bk-c input').forEach(i => { const v = +i.value || 0; if (v > 0) b[i.dataset.side][i.dataset.c] = v; else delete b[i.dataset.side][i.dataset.c]; });
  const nm = $('#bkName'); if (nm) b.name = nm.value.replace(/[<>"'`&]/g, '').trim().slice(0, 40) || 'My basket';
  save();
}
function bindBasket() {
  const body = $('#obs'); bkCfg(); setInterval(() => safe('baskets', bkMonitor), 500);
  body.addEventListener('click', e => {
    if (obsCfg().view !== 'bask') return;
    const c = bkCfg(), t = e.target;
    const pick = t.closest('[data-bk]'); if (pick) { c.bkSel = pick.dataset.bk; save(); obsDraw(); return; }
    if (t.closest('[data-bk-new]') || t.closest('[data-bk-dup]')) {
      const src = t.closest('[data-bk-dup]') ? bkGet(c.bkSel) : { name: 'My basket', long: { EUR: 1 }, short: { USD: 1, JPY: 1 } };
      const nb = { id: 'b' + Date.now().toString(36), name: src.id ? src.name + ' (copy)' : src.name, long: { ...src.long }, short: { ...src.short } };
      c.baskets.push(nb); c.bkSel = nb.id; save(); obsDraw(); return;
    }
    if (t.closest('[data-bk-del]')) {
      const id = c.bkSel, del = () => { c.baskets = c.baskets.filter(x => x.id !== id); c.bkSel = 'dxy'; save(); obsDraw(); }, n = bkUsers(id);
      if (!n) { del(); return; }
      askConfirm({ title: 'Delete this basket?', body: `${n} open basket position${n > 1 ? 's, orders or alerts were' : ', order or alert was'} created on it. They keep the composition they were created with and stay managed here; only the definition is deleted.`, ok: 'Delete', onOk: del });
      return;
    }
    const tf = t.closest('[data-bktf] [data-val]'); if (tf) { c.bkTf = +tf.dataset.val; save(); obsDraw(); return; }
    const tr = t.closest('[data-bk-trade]'); if (tr) { bkTrade(tr.dataset.bkTrade); return; }
    const an = t.closest('[data-bkan] [data-val]'); if (an) { c.bkAn = an.dataset.val; save(); obsDraw(); return; }
    const aw = t.closest('[data-bkanw] [data-val]'); if (aw) { c.bkAnW = +aw.dataset.val; save(); const a = $('#bkAn'); if (a) a.innerHTML = bkAnHtml(bkGet(c.bkSel), c); $$('[data-bkanw] button').forEach(x => x.classList.toggle('on', x === aw)); return; }
    const en = t.closest('[data-bkentry] [data-val]'); if (en) { c.bkEntry = en.dataset.val; save(); obsDraw(); return; }
    const ox = t.closest('[data-bk-ordx]'); if (ox && TradeLink.live) { const o = S.bkOrders[+ox.dataset.bkOrdx]; if (o) bkLive({ do: 'cancel', id: o.id }, `${o.name}: cancel`); return; }
    if (ox) { S.bkOrders.splice(+ox.dataset.bkOrdx, 1); save(); setTimeout(obsDraw, 0); return; }
    if (t.closest('[data-bk-alert]') && TradeLink.live) { const b = bkGet(c.bkSel), bpv = c.bkAl, snap = bkSnapOf(b); bkLive({ do: 'alert', bid: b.id, name: b.name, long: snap.long, short: snap.short, bp: bpv }, `${b.name}: alert`, ['Basket alert set', `${b.name} ±${bpv} bp`]); return; }
    if (t.closest('[data-bk-alert]')) { const b = bkGet(c.bkSel), bpv = c.bkAl; S.bkAlerts.push(bkAlertRow(b, bpv)); save(); toast('Basket alert set', `${b.name} ±${bpv} bp`, 'info'); setTimeout(obsDraw, 0); return; }
    const ax = t.closest('[data-bk-alx]'); if (ax && TradeLink.live) { const a = S.bkAlerts[+ax.dataset.bkAlx]; if (a) bkLive({ do: 'alertDel', id: a.id }, `${a.name}: alert`); return; }
    if (ax) { S.bkAlerts.splice(+ax.dataset.bkAlx, 1); save(); setTimeout(obsDraw, 0); return; }
    if (t.closest('[data-bk-eq]')) { const b = c.baskets.find(x => x.id === c.bkSel); if (b) { bkEqualise(b); save(); toast('Risk equalised', 'Weights now scale with 1 / volatility of each currency', 'info'); setTimeout(obsDraw, 0); } return; }
    const hf = t.closest('[data-bk-half]'); if (hf) { bkHalf(hf.dataset.bkHalf); setTimeout(obsDraw, 0); return; }
    const be = t.closest('[data-bk-be]'); if (be) { const g = S.bkPos.find(x => x.gid === be.dataset.bkBe); if (g && bkBeOk(g) && TradeLink.live) { bkLive({ do: 'be', gid: g.gid }, `${g.name}: break-even`); return; } if (g && bkBeOk(g)) { g.beSet = true; save(); toast(`${g.name}: stop at break-even`, `The basket stop is now at +${(g.cost || 0).toFixed(1)} bp on the index: the entry spreads are already paid, so a close there is about flat (slippage aside).`, 'info'); } setTimeout(obsDraw, 0); return; }
    if (t.closest('[data-bk-exp]')) {
      const e = ccyExposure(), L = {}, Sx = {}; for (const [k, v] of Object.entries(e)) { if (v > 500) L[k] = +(v / 1e3).toFixed(1); else if (v < -500) Sx[k] = +(-v / 1e3).toFixed(1); }
      if (!Object.keys(L).length || !Object.keys(Sx).length) { toast('Nothing to chart', 'Exposure needs at least one long and one short currency', 'info'); return; }
      let b = c.baskets.find(x => x.id === 'myexp'); if (!b) { b = { id: 'myexp', name: 'My exposure' }; c.baskets.push(b); }
      b.long = L; b.short = Sx; c.bkSel = 'myexp'; save(); toast('My exposure', 'Your open positions, charted as one index', 'info'); setTimeout(obsDraw, 0); return;
    }
    const eo = t.closest('[data-bk-ed]'); if (eo) { if (BK.ed === eo.dataset.bkEd) bkEdClose(eo.dataset.bkEd); else bkEdOpen(eo.dataset.bkEd); return; }
    const ek = t.closest('[data-bk-ed-ok]'); if (ek) { bkEdSave(ek.dataset.bkEdOk); return; }
    const ex = t.closest('[data-bk-ed-x]'); if (ex) { bkEdClose(ex.dataset.bkEdX); return; }
    const dx = t.closest('[data-bk-dupx]'); if (dx) {
      // the suggested copy: the same basket without one currency (bkDropSug), selected for editing
      const src = bkGet(c.bkSel), k = dx.dataset.bkDupx, nb = { id: 'b' + Date.now().toString(36), name: `${src.name} without ${k}`.replace(/[<>"'`&]/g, '').slice(0, 40), long: { ...src.long }, short: { ...src.short } };
      delete nb.long[k]; delete nb.short[k];
      if (!Object.keys(nb.long).length || !Object.keys(nb.short).length) return;
      c.baskets.push(nb); c.bkSel = nb.id; save(); toast('Basket duplicated', `${nb.name}: ${bkLabel(nb)}`, 'info'); obsDraw(); return;
    }
    const cg = t.closest('[data-bk-closeg]'); if (cg) { bkCloseGroup(cg.dataset.bkCloseg); setTimeout(obsDraw, 0); return; }
    const pn = t.closest('[data-bkpane] [data-val]') || t.closest('[data-bkpane-go]'); if (pn) { c.bkPane = pn.dataset.val || pn.dataset.bkpaneGo; save(); obsDraw(); return; }
    const pr = t.closest('[data-bk-proxy]'); if (pr) {
      // the ticket gets the proxy's β size and the basket's stop and target ÷ |β| (pips); the symbol switch settles first
      const sym = pr.dataset.bkProxy, d = pr.dataset, k = S.tk;
      setSymbol(sym); if (typeof syncTicketInputs === 'function') syncTicketInputs();
      k.side = d.side; k.ot = 'market'; k.price = null;
      if (+d.lots > 0) { k.sm = 'lots'; k.lots = typeof tkLotsFor === 'function' ? tkLotsFor(sym, +d.lots) : +d.lots; }
      // the basket's own levels or none: a stop or target left over from an earlier ticket is switched off
      if (+d.sl > 0) { k.sl = +d.sl; k.useSL = true; } else k.useSL = false;
      if (+d.tp > 0) { k.tp = +d.tp; k.useTP = true; } else k.useTP = false;
      if (typeof syncTicketInputs === 'function') syncTicketInputs();
      if (typeof setView === 'function') setView('trade');
      toast('Proxy loaded — not sent', `${d.side} ${+d.lots > 0 ? lotsFmt(sym, k.lots) + ' ' : ''}${pretty(sym)}${+d.sl > 0 ? ` · stop ${d.sl} ${unitWord(sym)}` : ''} in the ticket, sized on β for the basket's exposure — review, then submit`, 'info'); return;
    }
    const md = t.closest('[data-bkmode] [data-val]'); if (md) { c.bkMode = md.dataset.val; save(); obsDraw(); return; }
    const cm = t.closest('[data-bkcmp] [data-val]'); if (cm) { c.bkCmp = cm.dataset.val; save(); obsDraw(); return; }
  });
  // the stop / target editor of an open basket: the draft survives a redraw, Enter saves, Escape cancels
  body.addEventListener('input', e => {
    const i = e.target; if (i.id !== 'bkEdSl' && i.id !== 'bkEdTp') return;
    const g = S.bkPos.find(x => x.gid === i.dataset.gid); if (!g) return;
    BK.edV = { gid: g.gid, sl: $('#bkEdSl')?.value ?? '', tp: $('#bkEdTp')?.value ?? '' };
    const rr = $('[data-bk-ed-rr]'); if (rr) rr.textContent = bkEdRr(g, BK.edV);
  });
  body.addEventListener('keydown', e => {
    const i = e.target; if (i.id !== 'bkEdSl' && i.id !== 'bkEdTp') return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); bkEdSave(i.dataset.gid); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); bkEdClose(i.dataset.gid); }
  });
  body.addEventListener('change', e => {
    if (obsCfg().view !== 'bask') return;
    const c = bkCfg();
    const id = e.target.id;
    if (id === 'bkLots') { c.bkLots = clamp(+e.target.value || 1, .1, 20); save(); setTimeout(obsDraw, 0); return; }
    if (id === 'bkRisk') { c.bkRisk = clamp(+e.target.value || .5, .05, 5); save(); setTimeout(obsDraw, 0); return; }
    if (id === 'bkPend') { c.bkPend = clamp(Math.round(+e.target.value || 15), 1, 2000); save(); setTimeout(obsDraw, 0); return; }
    if (id === 'bkAl') { c.bkAl = clamp(Math.round(+e.target.value || 20), 1, 2000); save(); return; }
    if (id === 'bkTrail' || id === 'bkBe') { const v = Math.round(+e.target.value || 0); c[id] = v > 0 ? v : 0; save(); setTimeout(obsDraw, 0); return; }
    if (id === 'bkSl' || id === 'bkTp') { const v = Math.round(+e.target.value || 0); c[id] = v > 0 ? v : 0; save(); setTimeout(obsDraw, 0); return; }
    if (e.target.closest('.bk-c') || e.target.id === 'bkName') {
      const i = e.target; if (i.dataset.side) { const other = i.dataset.side === 'long' ? 'short' : 'long', o = body.querySelector(`.bk-c input[data-side=${other}][data-c=${i.dataset.c}]`); if (+i.value > 0 && o) o.value = ''; }
      bkSaveEdit(); clearTimeout(BK.rt); BK.rt = setTimeout(obsDraw, 0);
    }
  });
}
// register as an Observatory view
OBS_VIEWS.push(['bask', 'Baskets', 'Build your own index']);
OBS_SRC.bask = ['ICE U.S. Dollar Index methodology (DXY weights)', 'https://www.ice.com/insights/indexation-and-etfs/managing-us-dollar-risk-in-uncertain-times'];
OBS_EXT.bask = drawBask;

/* the proxy pill of Baskets › Analyse opens its instrument, like the same pills elsewhere (UX-67) */
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.ins button.pill[data-sym]'); if (b && typeof setSymbol === 'function') setSymbol(b.dataset.sym); });
