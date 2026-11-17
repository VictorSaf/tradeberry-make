'use strict';
/* tradeBerry — chart and symbol / watchlist. Classic script sharing globals with app.js; loaded right after it. */
/* ============ chart ============ */
let chart, candle, candleMarkers, sEma20, sEma50, sBbU, sBbM, sBbL, sRsi; // sRsi: pane 1 of the main chart, null while RSI is off
let bars = [], disp = [], IND = {};
let lines = [], drag = null, tool = null, hovering = false;
const lineSent = new Map(); // 'pos-sl:<id>' | 'pos-tp:<id>' | 'ord:<id>' → the price sent by a drag, until the server answers
// does the ticket draw its next order on the chart now (ticket.js tkPreviewActive; without it, always)
const tkPreview = () => typeof tkPreviewActive !== 'function' || !!tkPreviewActive();
let linesPv = true; // whether the lines on the chart were built with the ticket's preview
// 'SL · after order −$4.02' / 'TP · after order +$8.21': the ticket's money at the level, which for an order that adds to
// a position is the whole position after the fill; a figure that is not a number reads '—'
const tkLineTitle = (w, k) => `${w} · after order ${w === 'SL' ? (Number.isFinite(k.riskUsd) ? usdFmt(-k.riskUsd) : '—') : (Number.isFinite(k.rewUsd) ? usdFmt(k.rewUsd, true) : '—')}`;
// up/down contract: every chart (main, multi-chart panes, basket) takes its rising / falling colours from here,
// i.e. from the --up / --dn CSS tokens. A colour theme only redefines those two tokens, then calls applyTheme().
function chartUpDn() { return { up: cssv('--up'), dn: cssv('--dn') }; }
function chartColors() {
  return { bg: cssv('--s1'), tx: cssv('--tx3'), grid: cssv('--line'), line: cssv('--line2'), ...chartUpDn(), acc: cssv('--acc'), ind1: cssv('--ind1') || '#a78bfa', warn: cssv('--warn'), info: '#5aa9ff', tx2: cssv('--tx2') };
}
// candlestick options for the current display settings; ui.js (candleOpts) adds hollow candles when it is loaded
function candleStyle(c) {
  return typeof candleOpts === 'function' ? candleOpts(c) : { upColor: c.up, downColor: c.dn, wickUpColor: c.up, wickDownColor: c.dn, borderVisible: false };
}
function chartOpts(c) {
  return {
    layout: { background: { type: 'solid', color: c.bg }, textColor: c.tx, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, panes: { separatorColor: c.grid, separatorHoverColor: c.grid, enableResize: false } },
    hoveredSeriesOnTop: false, // v5.2 default lifts the hovered series above the others; keep the drawing order fixed
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.grid, minimumWidth: 78 },
    timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: 0, vertLine: { color: c.line, labelBackgroundColor: c.line }, horzLine: { color: c.line, labelBackgroundColor: c.line } }
  };
}
function initChart() {
  const c = chartColors();
  chart = LightweightCharts.createChart($('#chart'), { ...chartOpts(c), autoSize: true });
  // boot applies the theme before the chart exists: the series starts with the current candle style (hollow, CVD,
  // red rises) read here, not from that earlier applyTheme()
  candle = chart.addSeries(LightweightCharts.CandlestickSeries, candleStyle(c));
  // Fit SL to TP (the yellow button by the magnet, on / off, kept in S.set.fitLv): the price axis also takes in the stop
  // losses and targets of this instrument's positions and pending orders (Victor, 09.11.2026: a button, not automatic).
  // Only while the axis scales itself; the candles' own range comes first, the levels can only widen it.
  candle.applyOptions({ autoscaleInfoProvider: base => { const r = base(); return S.set.fitLv && r && r.priceRange ? levelRange(r) : r; } });
  fitLvInit();
  candleMarkers = LightweightCharts.createSeriesMarkers(candle, []); // one handle for the chart's lifetime
  const ln = (color, w = 1, style = 0) => chart.addSeries(LightweightCharts.LineSeries, { color, lineWidth: w, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  sEma20 = ln(c.ind1, 2); sEma50 = ln(c.info, 2); sBbU = ln(c.tx2 + '88', 1, 2); sBbM = ln(c.tx2 + '55', 1, 0); sBbL = ln(c.tx2 + '88', 1, 2);
  // #rsiChart stays in the page, hidden, only as the CSS source of the RSI pane height (.rsi / .mc-multi / .mc-tight)
  $('#rsiChart').hidden = true;
  rsiPane(S.set.ind.rsi);
  new ResizeObserver(() => requestAnimationFrame(rsiFit)).observe($('#chart'));
  chart.subscribeCrosshairMove(p => { hovering = !!(p && p.time); legend(hovering ? p.seriesData.get(candle) : null); });
  chart.subscribeClick(param => {
    if (overlayClick(param)) return;
    if (!tool || !param.point || (param.paneIndex ?? 0) !== 0) return;
    const price = candle.coordinateToPrice(param.point.y); if (price == null) return;
    const sym = S.set.sym;
    if (tool === 'hline') { (S.hlines[sym] = S.hlines[sym] || []).push(price); changed(); toast('Level added', `${pretty(sym)} ${fp(sym, price)}`, 'info'); }
    if (tool === 'alert') addAlert(sym, price);
    setTool(null);
  });
  initDrag();
  initOverlay();
  if (typeof makePager === 'function') {
    histPager = makePager({ host: $('#chart').parentElement, getKey: pageKey, onOlder: pageGlue });
    chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (!pgMute) histPager.maybeLoad(r); });
  }
}
/* Back-paging (histpage.js): scrolling left past the drawn candles asks the platform for older ones. Off where the chart
   is not the platform's candles: no live feed, intrinsic time, a replay. pgN = older candles in front of the aggregate.
   pgMute: a fit is not the user scrolling (the first quote's one-candle chart would page at boot); the chart reports the
   range on its next frame, so the mute lasts two frames. */
let histPager = null, pgN = 0, pgMute = 0;
function pageKey() {
  const sym = S.set.sym, rp = window.RP;
  if (typeof liveHas !== 'function' || !liveHas(sym) || S.set.type === 'it' || Engine.isReplayDoc) return null;
  return rp && (rp.role === 'child' || rp.state === 'open' || rp.state === 'loading') ? null : { sym, tf: S.set.tf };
}
// older candles arrived: redraw with them in front, the view kept on the same candles (its range event pages on if needed)
function pageGlue() {
  const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(), len = bars.length;
  fullChart(false);
  const k = bars.length - len;
  if (r && k) ts.setVisibleLogicalRange({ from: r.from + k, to: r.to + k });
}
function pageFit(from, to) {
  pgMute++; chart.timeScale().setVisibleLogicalRange({ from, to });
  requestAnimationFrame(() => requestAnimationFrame(() => pgMute--));
}
// RSI is pane 1 of the main chart: the series exists only while RSI is on (removing it removes the pane)
function rsiPane(on) {
  if (on && !sRsi) {
    const c = chartColors();
    sRsi = chart.addSeries(LightweightCharts.LineSeries, { color: c.ind1, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 1, minMove: .1 } }, 1);
    sRsi.priceScale().applyOptions({ scaleMargins: { top: .16, bottom: .1 } });
    sRsi.createPriceLine({ price: 70, color: c.dn + 'aa', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    sRsi.createPriceLine({ price: 30, color: c.up + 'aa', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    if (bars.length) sRsi.setData(bars.map((_, i) => pt(IND.rsi, i)));
    rsiFit();
  } else if (!on && sRsi) { chart.removeSeries(sRsi); sRsi = null; }
}
// keep the RSI pane at its fixed CSS height (pane heights would otherwise scale with the chart)
function rsiFit() {
  const p = sRsi && chart.panes()[1]; if (!p) return;
  const h = parseFloat(getComputedStyle($('#rsiChart')).height) || 96;
  if (Math.abs(p.getHeight() - h) > 1) p.setHeight(h);
}
// height of the price pane (pane 0, top of #chart): pointer and overlay work stays above it
const pricePaneH = () => chart?.panes()[0]?.getHeight() ?? Infinity;
function computeIndAt(i) {
  const c = bars[i].close, k20 = 2 / 21, k50 = 2 / 51;
  IND.e20[i] = i ? IND.e20[i - 1] + k20 * (c - IND.e20[i - 1]) : c;
  IND.e50[i] = i ? IND.e50[i - 1] + k50 * (c - IND.e50[i - 1]) : c;
  if (i >= 19) {
    let s = 0, s2 = 0; for (let j = i - 19; j <= i; j++) { const x = bars[j].close; s += x; s2 += x * x; }
    const mu = s / 20, sd = Math.sqrt(Math.max(0, s2 / 20 - mu * mu));
    IND.bm[i] = mu; IND.bu[i] = mu + 2 * sd; IND.bl[i] = mu - 2 * sd;
  } else IND.bm[i] = IND.bu[i] = IND.bl[i] = null;
  if (!i) { IND.ag[0] = IND.al[0] = 0; IND.rsi[0] = null; }
  else {
    const ch = c - bars[i - 1].close, g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= 14) { IND.ag[i] = (IND.ag[i - 1] * (i - 1) + g) / i; IND.al[i] = (IND.al[i - 1] * (i - 1) + l) / i; }
    else { IND.ag[i] = (IND.ag[i - 1] * 13 + g) / 14; IND.al[i] = (IND.al[i - 1] * 13 + l) / 14; }
    IND.rsi[i] = i >= 14 ? (IND.al[i] === 0 ? 100 : 100 - 100 / (1 + IND.ag[i] / IND.al[i])) : null;
  }
}
function haAt(i) {
  const b = bars[i], c = (b.open + b.high + b.low + b.close) / 4;
  const o = i ? (disp[i - 1].open + disp[i - 1].close) / 2 : (b.open + b.close) / 2;
  disp[i] = { time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c };
}
const pt = (arr, i) => arr[i] == null ? { time: bars[i].time } : { time: bars[i].time, value: arr[i] };
let chartSym = null; // the symbol the main chart last drew
function fullChart(fit) {
  const sym = S.set.sym, m = M(sym);
  let agg = S.set.type === 'it' && typeof itBars === 'function' ? itBars(sym) : Engine.aggregate(sym, S.set.tf, S.set.tf >= 60 ? 40000 : 2200); // 1H/4H reach back as far as the platform's 1-hour history
  /* the paged older candles go in front, with no overlap and no gap (the pager closes it first). The pager also owns the
     aggregate's first bucket: the engine's history starts mid-bucket, so that candle is partial; the platform's is whole.
     The bucket still forming (a one-candle aggregate) stays the chart's. */
  const old = histPager ? histPager.older(agg.length > 1 ? agg[1].time : agg.length ? agg[0].time : 0, bars) : [];
  if (old.length) { const e = old[old.length - 1].time; let i = 0; while (i < agg.length && agg[i].time <= e) i++; if (i) agg = agg.slice(i); }
  pgN = old.length;
  bars = pgN ? old.concat(agg) : agg;
  IND = { e20: [], e50: [], bm: [], bu: [], bl: [], ag: [], al: [], rsi: [] };
  disp = [];
  for (let i = 0; i < bars.length; i++) { computeIndAt(i); if (S.set.type === 'ha') haAt(i); else disp[i] = { ...bars[i] }; }
  candle.applyOptions({ priceFormat: { type: 'price', precision: m.digits, minMove: m.tick } });
  // a price axis dragged by hand stops auto-scaling; a new symbol or a reset view brings it back, or the new
  // instrument's candles sit outside the old price window and the chart looks empty
  if (fit || sym !== chartSym) candle.priceScale().applyOptions({ autoScale: true });
  chartSym = sym;
  candle.setData(disp);
  sEma20.setData(bars.map((_, i) => pt(IND.e20, i))); sEma50.setData(bars.map((_, i) => pt(IND.e50, i)));
  sBbU.setData(bars.map((_, i) => pt(IND.bu, i))); sBbM.setData(bars.map((_, i) => pt(IND.bm, i))); sBbL.setData(bars.map((_, i) => pt(IND.bl, i)));
  if (sRsi) sRsi.setData(bars.map((_, i) => pt(IND.rsi, i)));
  applyIndVis();
  if (fit) { const n = bars.length; pageFit(n - 160, n + 8); }
  dirty.lines = dirty.markers = true;
  legend(null);
}
function applyIndVis() {
  const ind = S.set.ind;
  sEma20.applyOptions({ visible: ind.ema20 }); sEma50.applyOptions({ visible: ind.ema50 });
  [sBbU, sBbM, sBbL].forEach(s => s.applyOptions({ visible: ind.bb }));
  rsiPane(!!ind.rsi);
  if (typeof mcInd === 'function') mcInd();
}
function pushLastPoints(i) {
  candle.update(disp[i]);
  const up = (s, arr) => { if (s && arr[i] != null) s.update({ time: bars[i].time, value: arr[i] }); };
  up(sEma20, IND.e20); up(sEma50, IND.e50); up(sBbU, IND.bu); up(sBbM, IND.bm); up(sBbL, IND.bl); up(sRsi, IND.rsi);
}
/* Each frame rebuilds every bucket from the last displayed bar on from the 1m candles: at high speed (or in a replay)
   several bars can close within one frame, and the bar shown last has usually moved since it was drawn. The series
   may run BARS_SLACK bars past the fullChart() cap, then is rebuilt at the cap with the view kept in place. */
const BARS_MAX = 2200, BARS_SLACK = 200;
function chartTick() {
  if (S.set.type === 'it' && typeof itChartTick === 'function') return itChartTick();
  const src = Engine.candles[S.set.sym], step = S.set.tf * 60;
  if (!src.length) return;
  if (!bars.length || Math.floor(src[src.length - 1].time / step) * step < bars[bars.length - 1].time) return fullChart(false); // the candles went back (a rewind)
  const k0 = bars.length - 1, from = bars[k0].time;
  let j = src.length; while (j > 0 && src[j - 1].time >= from) j--;
  bars.length = k0;
  for (; j < src.length; j++) {
    const c = src[j], b = Math.floor(c.time / step) * step, x = bars[bars.length - 1];
    if (bars.length > k0 && x.time === b) { if (c.high > x.high) x.high = c.high; if (c.low < x.low) x.low = c.low; x.close = c.close; }
    else bars.push({ time: b, open: c.open, high: c.high, low: c.low, close: c.close });
  }
  if (bars.length > k0 + 1) dirty.markers = true;
  for (let i = k0; i < bars.length; i++) {
    computeIndAt(i);
    if (S.set.type === 'ha') haAt(i); else disp[i] = { ...bars[i] };
    pushLastPoints(i);
  }
  if (bars.length - pgN > BARS_MAX + BARS_SLACK) { // the paged older candles are not counted: the rebuild keeps them
    const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(), len = bars.length;
    fullChart(false);
    if (r) { const k = len - bars.length; ts.setVisibleLogicalRange({ from: r.from - k, to: r.to - k }); }
  }
}
function legend(d) {
  const sym = S.set.sym, b = d || disp[disp.length - 1]; if (!b) return;
  const i = bars.findIndex(x => x.time === b.time), ind = S.set.ind;
  // outside its session the chart shows the last price: the legend leads with that state (its own row, never over OHLC)
  const why = typeof ovlSessionText === 'function' ? ovlSessionText(sym) : '';
  let h = (why ? `<b class="lg-mkt"><em>${escHtml(why)}</em></b>` : '') + `<span><i>O</i> ${fp(sym, b.open)}</span><span><i>H</i> ${fp(sym, b.high)}</span><span><i>L</i> ${fp(sym, b.low)}</span><span><i>C</i> ${fp(sym, b.close)}</span>`;
  if (i >= 0) {
    if (ind.ema20) h += `<span style="color:var(--ind1)">EMA20 ${fp(sym, IND.e20[i])}</span>`;
    if (ind.ema50) h += `<span style="color:var(--info)">EMA50 ${fp(sym, IND.e50[i])}</span>`;
    if (ind.rsi && IND.rsi[i] != null) h += `<span>RSI ${IND.rsi[i].toFixed(1)}</span>`;
  }
  const ex = d && exitsByBar.get(b.time);
  if (ex) h += `<span>Closed ${ex.n > 1 ? ex.n + ' trades ' : ''}<b class="${cls(ex.pnl)}">${usdFmt(ex.pnl, true)}</b></span>`;
  if (typeof itLegend === 'function') h += itLegend();
  $('#legend').innerHTML = h;
}
// closed trades by chart bar, for the crosshair legend (older trades carry no P&L label on the chart)
let exitsByBar = new Map();
const MK_PNL_LABELS = 5;
function setMarkers() {
  const sym = S.set.sym, step = S.set.tf * 60, first = bars[0]?.time ?? 0, lastT = bars[bars.length - 1]?.time ?? 0, c = chartColors(), mk = [];
  const b = t => S.set.type === 'it' ? t : Math.floor(t / step) * step, snap = t => S.set.type === 'it' ? bars[barIndexAt(t)]?.time ?? t : t;
  for (const p of S.positions) if (p.sym === sym) mk.push({ time: snap(b(p.open)), position: p.side === 'buy' ? 'belowBar' : 'aboveBar', color: p.side === 'buy' ? c.up : c.dn, shape: p.side === 'buy' ? 'arrowUp' : 'arrowDown', text: `#${p.id}` });
  // history is newest first: one entry arrow per bar and side, one exit dot per bar (P&L summed);
  // only the newest MK_PNL_LABELS exit bars get a text label, the rest show on crosshair hover
  const ent = new Map(), ex = new Map();
  for (const h of S.history.slice(0, 80)) if (h.sym === sym && !h.nbp) {
    const et = snap(b(h.open)), xt = snap(b(h.close));
    if (et >= first && et <= lastT && !ent.has(et + h.side)) ent.set(et + h.side, { time: et, position: h.side === 'buy' ? 'belowBar' : 'aboveBar', color: (h.side === 'buy' ? c.up : c.dn) + '99', shape: h.side === 'buy' ? 'arrowUp' : 'arrowDown', text: '' });
    if (xt < first || xt > lastT) continue;
    const e = ex.get(xt) || { pnl: 0, n: 0, side: h.side, list: [] };
    e.pnl += h.pnl; e.n++; e.list.push(h); ex.set(xt, e);
  }
  mk.push(...ent.values());
  let k = 0;
  for (const [t, e] of [...ex].sort((x, y) => y[0] - x[0])) {
    // exit dot sits on the side opposite the entry arrow, never on the candle body
    // a five-figure P&L is shortened (−$65.1k): the marker text is centred on its bar and a long one is cut by the price axis; hover shows the full figure
    const short = Math.abs(e.pnl) >= 10000 ? (e.pnl < 0 ? '−' : '+') + '$' + (Math.abs(e.pnl) / 1000).toFixed(1) + 'k' : usdFmt(e.pnl, true).replace('.00', '');
    const lbl = k++ < MK_PNL_LABELS ? short + (e.n > 1 ? ` ×${e.n}` : '') : '';
    mk.push({ time: t, position: e.side === 'buy' ? 'aboveBar' : 'belowBar', color: e.pnl >= 0 ? c.up : c.dn, shape: 'circle', size: .6, text: lbl });
  }
  exitsByBar = ex;
  if (typeof btMarkers === 'function') mk.push(...btMarkers(sym, step, first, lastT).map(m => m.position === 'inBar' ? { ...m, position: 'aboveBar' } : m));
  if (S.set.type === 'it') mk.forEach(m => { m.time = bars[barIndexAt(m.time)]?.time ?? m.time; });
  candleMarkers.setMarkers(mk.filter(m => m.time >= first && m.time <= lastT).sort((a, b) => a.time - b.time));
}
function fitLvInit() {
  const b = document.getElementById('fitLvBtn'); if (!b || b.dataset.on) return; b.dataset.on = '1';
  const show = () => { b.classList.toggle('on', !!S.set.fitLv); b.setAttribute('aria-pressed', String(!!S.set.fitLv)); };
  show();
  b.addEventListener('click', e => {
    e.stopPropagation(); // the drawing tools' bar must not take it as a tool
    S.set.fitLv = !S.set.fitLv; show(); save();
    // on: the axis scales itself again, now with the levels; off: back to the candles' own range
    candle.priceScale().applyOptions({ autoScale: true });
    toast(`Fit SL to TP ${S.set.fitLv ? 'on' : 'off'}`, S.set.fitLv ? (chartLevels().length > 1 ? 'The price axis shows the stop losses and targets of this instrument' : 'No stop loss or target on this instrument yet: the axis widens when there is one') : 'The price axis follows the candles', 'info');
  });
}
// SL / TP / entry of this symbol's positions and pending orders (finite prices only), merged into an autoscale range
function chartLevels() {
  const sym = S.set.sym, out = [], add = v => { if (typeof v === 'number' && isFinite(v) && v > 0) out.push(v); };
  for (const p of S.positions) if (p.sym === sym) { add(p.entry); add(p.sl); add(p.tp); }
  // a pending order keeps its exits as distances from its fill (slPips / tpPips): where they land if it fills at its price
  const m = M(sym), pip = m && m.pip;
  for (const o of S.orders) if (o.sym === sym) {
    add(o.price); if (!(pip > 0) || !(o.price > 0)) continue;
    const d = o.side === 'buy' ? 1 : -1;
    if (+o.slPips > 0) add(o.price - d * o.slPips * pip);
    if (+o.tpPips > 0) add(o.price + d * o.tpPips * pip);
  }
  return out;
}
function levelRange(r) {
  const lv = chartLevels(); if (!lv.length) return r;
  const pr = r.priceRange, lo = Math.min(pr.minValue, ...lv), hi = Math.max(pr.maxValue, ...lv);
  return lo === pr.minValue && hi === pr.maxValue ? r : { ...r, priceRange: { minValue: lo, maxValue: hi } };
}
function rebuildLines() {
  for (const L of lines) candle.removePriceLine(L.line);
  lines = [];
  const sym = S.set.sym, c = chartColors();
  const add = (opt, kind, ref, canDrag = true) => lines.push({ line: candle.createPriceLine({ lineWidth: 1, axisLabelVisible: true, title: '', ...opt }), kind, ref, drag: canDrag });
  for (const p of S.positions.filter(p => p.sym === sym)) {
    add({ price: p.entry, color: p.side === 'buy' ? c.up : c.dn, lineStyle: 0, lineWidth: 2, title: p.side.toUpperCase() }, 'pos-entry', p, false);
    if (p.sl != null) add({ price: p.sl, color: c.dn, lineStyle: 2, title: 'SL' }, 'pos-sl', p);
    if (p.tp != null) add({ price: p.tp, color: c.up, lineStyle: 2, title: 'TP' }, 'pos-tp', p);
  }
  for (const o of S.orders.filter(o => o.sym === sym)) add({ price: o.price, color: c.info, lineStyle: 1, title: `${o.side.toUpperCase()} ${o.ot.toUpperCase()}` }, 'ord', o); // side and type, no size (09.11.2026)
  for (const a of S.alerts.filter(a => a.sym === sym && !a.done)) add({ price: a.price, color: c.warn, lineStyle: 3, title: 'ALERT' }, 'alert', a);
  (S.hlines[sym] || []).forEach((p, i) => add({ price: p, color: c.tx2 + 'aa', lineStyle: 0 }, 'hline', i));
  // the next order (the ticket): only while the ticket previews, titled as the next order so it never reads as the open
  // position's own levels (UX 09.11.2026, F7)
  linesPv = tkPreview();
  if (linesPv) {
    const t = S.tk, k = tkCalc();
    if (t.ot !== 'market') add({ price: k.entry, color: c.info + 'cc', lineStyle: 2, title: `${t.side.toUpperCase()} ${t.ot.toUpperCase()}` }, 'tk-entry', null);
    if (k.sl != null) add({ price: k.sl, color: c.dn + 'aa', lineStyle: 2, title: tkLineTitle('SL', k) }, 'tk-sl', null);
    if (k.tp != null) add({ price: k.tp, color: c.up + 'aa', lineStyle: 2, title: tkLineTitle('TP', k) }, 'tk-tp', null);
  }
  dirty.lines = false;
}
function linesTick(k) {
  // the ticket stopped (or started) previewing: its lines go (or come), whichever module drew them (pro.js tk-tpx, tk-lmt)
  if (tkPreview() !== linesPv) rebuildLines();
  if (!linesPv && lines.some(L => L.kind.startsWith('tk-'))) lines = lines.filter(L => !L.kind.startsWith('tk-') || (candle.removePriceLine(L.line), false));
  for (const L of lines) {
    if (drag === L) continue;
    const r = L.ref;
    // a level sent and not yet answered: where it was dropped, marked Sent
    const sentAt = r && typeof r === 'object' ? lineSent.get(L.kind + ':' + r.id) : undefined; // a level's ref is its index (0 for the first one, UX-33)
    if (sentAt != null) { L.line.applyOptions({ price: sentAt, title: (L.kind === 'pos-sl' ? 'SL' : L.kind === 'pos-tp' ? 'TP' : `${r.side.toUpperCase()} ${r.ot.toUpperCase()}`) + ' · Sent' }); continue; }
    // the chart says only the side and the price (Victor, 09.11.2026): size, P&L and the id are in Positions
    if (L.kind === 'pos-entry') L.line.applyOptions({ title: r.side.toUpperCase() });
    else if (L.kind === 'pos-sl' && r.sl != null) L.line.applyOptions({ price: r.sl, title: 'SL' });
    else if (L.kind === 'pos-tp' && r.tp != null) L.line.applyOptions({ price: r.tp, title: 'TP' });
    else if (L.kind === 'ord') L.line.applyOptions({ price: r.price });
    else if (L.kind === 'tk-entry') L.line.applyOptions({ price: k.entry });
    else if (L.kind === 'tk-sl' && k.sl != null) L.line.applyOptions({ price: k.sl, title: tkLineTitle('SL', k) });
    else if (L.kind === 'tk-tp' && k.tp != null) L.line.applyOptions({ price: k.tp, title: tkLineTitle('TP', k) });
  }
}
/* the draggable line under y (px from the top of the chart), or null. A line of the account (a position's stop or
   target, a pending order) wins over the ticket's next order within a pixel of the same distance: the two often sit
   on the same price and a drag must move the position, not the ticket (UX 09.11.2026, F16) */
function priceLineHit(y, touch) {
  let best = null, bs = Infinity; const lim = touch ? 22 : 7; // fingers need a wider grab zone than a mouse
  const h0 = pricePaneH(); if (y > h0) return null; // the RSI pane below holds no draggable lines
  for (const L of lines) {
    if (!L.drag) continue; const c = candle.priceToCoordinate(L.line.options().price); if (c == null || c > h0) continue;
    const d = Math.abs(c - y); if (d >= lim) continue;
    const sc = d + (L.kind.startsWith('tk-') ? 1 : 0); if (sc < bs) { bs = sc; best = L; }
  }
  return best;
}
function initDrag() {
  const el = $('#chart');
  const yOf = e => (e.touches ? e.touches[0].clientY : e.clientY) - el.getBoundingClientRect().top;
  const hit = priceLineHit;
  const start = e => {
    if (tool) return; const L = hit(yOf(e), !!e.touches); if (!L) return;
    e.stopPropagation(); if (e.cancelable) e.preventDefault(); drag = L; if (e.touches && window.haptic) haptic(8);
  };
  const move = e => {
    if (!drag) { if (!e.touches) el.classList.toggle('drag-hover', !!hit(yOf(e))); return; }
    if (e.cancelable) e.preventDefault();
    const price = candle.coordinateToPrice(yOf(e)); if (price == null) return;
    applyDrag(drag, price);
  };
  // a stop, a target or a pending price goes once, on release, through modifyPosition / modifyOrder; until the
  // answer the line stays where it was dropped and says Sent (a refusal puts it back)
  const end = () => {
    if (!drag) return; const L = drag, k = L.kind; drag = null; if (window.haptic) haptic(6);
    if (L.dropAt != null && (k === 'pos-sl' || k === 'pos-tp' || k === 'ord')) {
      const px = L.dropAt; L.dropAt = null;
      const r = k === 'ord' ? modifyOrder(L.ref.id, { price: px }) : modifyPosition(L.ref.id, k === 'pos-sl' ? (L.ref.trail > 0 ? { sl: px, trail: L.ref.trail } : { sl: px }) : { tp: px });
      // the answer is said: 'SL #61 moved to 1.11739' once the account (the server, live) applied it; a refusal is
      // already said with its reason by modifyPosition / modifyOrder
      const what = `${k === 'pos-sl' ? 'SL' : k === 'pos-tp' ? 'TP' : 'Order'} #${L.ref.id} moved to ${fp(L.ref.sym, px)}`;
      const said = ok => { if (ok === true) toast(what, '', 'info'); };
      if (r instanceof Promise) { const key = k + ':' + L.ref.id; lineSent.set(key, px); r.then(said, () => {}).finally(() => { if (lineSent.get(key) === px) lineSent.delete(key); dirty.lines = true; }); }
      else said(r);
    }
    changed(k.startsWith('pos') ? 'pos' : k === 'ord' ? 'ord' : k === 'alert' ? 'al' : 'x');
  };
  el.addEventListener('mousedown', start, true); el.addEventListener('touchstart', start, { capture: true, passive: false });
  // a double-click on a level, stop, target, order or alert line opens its editor: the one of DATA › Edit (UX-57)
  el.addEventListener('dblclick', e => {
    if (tool || typeof editLevel !== 'function') return; const L = hit(yOf(e), false); if (!L) return;
    const t = L.kind === 'hline' ? { kind: 'hline', ref: L.ref, sym: S.set.sym } : /^(pos-sl|pos-tp|ord|alert)$/.test(L.kind) ? { kind: L.kind, ref: L.ref } : null; if (!t) return;
    e.preventDefault(); e.stopPropagation(); editLevel(t, el, L.line.options().price);
  }, true);
  el.addEventListener('mousemove', move, true);
  window.addEventListener('mousemove', e => drag && move(e)); window.addEventListener('touchmove', e => drag && move(e), { passive: false });
  window.addEventListener('mouseup', end); window.addEventListener('touchend', end);
}
function applyDrag(L, price) {
  const sym = S.set.sym, m = M(sym), q = Engine.quote(sym), r = L.ref;
  const round = v => +v.toFixed(m.digits);
  price = round(price);
  if (L.kind === 'tk-sl' || L.kind === 'tk-tp') {
    const k = tkCalc(), pips = Math.max(.1, Math.round(Math.abs(k.entry - price) / m.pip * 10) / 10);
    if (L.kind === 'tk-sl') S.tk.sl = pips; else S.tk.tp = pips;
    syncTicketInputs();
  } else if (L.kind === 'tk-entry') { S.tk.price = price; syncTicketInputs(); }
  else if (L.kind === 'pos-sl') { if (r.side === 'buy' ? price < q.bid : price > q.ask) L.dropAt = price; else return; }
  else if (L.kind === 'pos-tp') { if (r.side === 'buy' ? price > q.bid : price < q.ask) L.dropAt = price; else return; }
  else if (L.kind === 'ord') L.dropAt = price;
  else if (L.kind === 'alert') { r.price = price; r.cond = price >= q.mid ? 'above' : 'below'; }
  else if (L.kind === 'hline') S.hlines[sym][r] = price;
  L.line.applyOptions({ price });
  if (L.kind.startsWith('pos')) dirty.posCells = true;
}
function setTool(t) {
  tool = t;
  $$('#toolSeg button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t && t !== 'measure' && measure && !measure.live) { measure = null; }
  $('#chart').classList.toggle('tool', !!t);
  const hint = $('#toolHint');
  if (t !== 'measure' && measure?.live) { measure = null; reqOverlay(); }
  hint.textContent = t === 'measure' ? 'Click the start point · Esc to cancel' : t === 'hline' ? 'Click the chart to place a level · Esc to cancel' : t === 'alert' ? 'Click the chart to set a price alert · Esc to cancel' : '';
  hint.classList.toggle('show', !!t);
  if (typeof onToolChange === 'function') onToolChange(t);
}
function applyTheme() {
  document.documentElement.dataset.theme = S.set.theme;
  if (!chart) return;
  const c = chartColors();
  chart.applyOptions(chartOpts(c));
  candle.applyOptions(candleStyle(c));
  sEma20.applyOptions({ color: c.ind1 });
  if (sRsi) { sRsi.applyOptions({ color: c.ind1 }); const [a, b] = sRsi.priceLines(); a?.applyOptions({ color: c.dn + 'aa' }); b?.applyOptions({ color: c.up + 'aa' }); }
  [sBbU, sBbL].forEach(s => s.applyOptions({ color: c.tx2 + '88' })); sBbM.applyOptions({ color: c.tx2 + '55' });
  dirty.lines = dirty.markers = true;
  if (activeTab === 'journal') renderJournal(); if (activeTab === 'lab') redrawLab();
  if (typeof renderSparks === 'function') renderSparks();
  if (typeof mcTheme === 'function') mcTheme();
}

/* ============ symbol / watchlist ============ */
/* The watchlist (.mace/design/catalog.md §5) lists the instruments of the sheet the profile offers in six categories:
   Favourites (S.set.fav, at most FAV_MAX), FX (Majors G8 / Crosses / Exotics), Indices (Americas / Europe /
   Asia-Pacific / Rates), Commodities (Metals / Energy / Agriculture), Crypto (by quote currency) and Stocks (by sector,
   with exchange chips). Categories fold (S.set.wlOpen: the open ones; Favourites and FX by default) and only open ones
   are rendered. The search (symbol, name, sector, exchange) ignores folding. Only the rows on screen are filled each
   frame (IntersectionObserver), and they, the chart symbol and what the account holds are the engine's hot set. */
const WL_CATS = [['fav', 'Favourites'], ['fx', 'FX'], ['index', 'Indices'], ['commodity', 'Commodities'], ['crypto', 'Crypto'], ['stock', 'Stocks']];
const CAT_OF = { fx: 'fx', index: 'index', rates: 'index', metal: 'commodity', energy: 'commodity', agri: 'commodity', crypto: 'crypto', stock: 'stock' };
const WL_KEYS = ['all', ...WL_CATS.map(c => c[0])];
const WL_GROUPS = WL_CATS.slice(1); // [category, name] of the instrument categories
const GROUP_TAG = { fx: 'FX', metal: 'Metal', energy: 'Energy', agri: 'Agriculture', index: 'Index', rates: 'Rates', crypto: 'Crypto', stock: 'Stock' };
const TYPE_NAME = { fx: 'FX', commodity: 'Commodity', index: 'Index', crypto: 'Crypto', stock: 'Stock' };
// FAV_MAX (50) is declared in app.js, which loads first and caps S.set.fav in sanitizeState
const G8_CCY = new Set([...Engine.CCY, 'USD']), G8_PAIRS = new Set(Engine.PAIRS.map(p => p.sym));
// index regions by symbol (the sheet's country column names the listing venue, not the market); others by country
const IDX_REGION = { 'US.30': 'Americas', 'US.100': 'Americas', 'US.500': 'Americas', 'DE.30': 'Europe', 'EU.50': 'Europe', 'FTSE.100': 'Europe', 'CAC40.FR': 'Europe', 'IBEX35.SP': 'Europe', 'MIB40.IT': 'Europe', JAP225: 'Asia-Pacific', AUS200: 'Asia-Pacific', 'IND50-NIF': 'Asia-Pacific' };
const EU_COUNTRY = new Set(['Germany', 'France', 'Spain', 'Italy', 'UK', 'Netherlands', 'Switzerland', 'Europe']);
const SUB_ORDER = { fx: ['Majors (G8)', 'Crosses', 'Exotics'], index: ['Americas', 'Europe', 'Asia-Pacific', 'Rates'], commodity: ['Metals', 'Energy', 'Agriculture'] };
const subOf = m => {
  switch (CAT_OF[m.group]) {
    case 'fx': return G8_PAIRS.has(m.sym) ? 'Majors (G8)' : G8_CCY.has(m.base) && G8_CCY.has(m.quote) ? 'Crosses' : 'Exotics';
    case 'index': return m.group === 'rates' ? 'Rates' : IDX_REGION[m.sym] || (EU_COUNTRY.has(m.country) ? 'Europe' : ['AUS', 'IND', 'Japan', 'JP', 'HK', 'China', 'Singapore'].includes(m.country) ? 'Asia-Pacific' : 'Americas');
    case 'commodity': return { metal: 'Metals', energy: 'Energy', agri: 'Agriculture' }[m.group];
    case 'crypto': return 'Quoted in ' + m.quote;
    default: return m.sector || 'Other';
  }
};
// [[category, sub, [instruments]]] in display order: subgroups in their fixed order (stocks: sectors A–Z, by symbol)
function wlOrder(list) {
  const out = [];
  for (const [c] of WL_GROUPS) {
    const ms = list.filter(m => CAT_OF[m.group] === c), subs = new Map();
    for (const m of ms) { const k = subOf(m); if (!subs.has(k)) subs.set(k, []); subs.get(k).push(m); }
    const keys = [...subs.keys()].sort((a, b) => { const o = SUB_ORDER[c]; return o ? o.indexOf(a) - o.indexOf(b) : a.localeCompare(b); });
    for (const k of keys) out.push([c, k, c === 'stock' ? subs.get(k).sort((a, b) => a.sym.localeCompare(b.sym)) : subs.get(k)]);
  }
  return out;
}
const catName = c => (WL_CATS.find(x => x[0] === c) || [c, c])[1];
// what a list of instruments shows: everything the profile offers, plus an instrument it no longer offers while a
// position is still open on it (close-only)
const listedInstr = () => Engine.INSTR.filter(m => isAvailable(m.sym) || closeOnly(m.sym));
// options for a symbol select, grouped by category and subgroup; keep: a symbol that stays listed even if not offered
function instrOptions(sel, keep, only) {
  const list = listedInstr().filter(m => !only || only(m)); if (keep && M(keep) && !list.some(m => m.sym === keep)) list.push(M(keep));
  return wlOrder(list).map(([c, sub, ms]) => `<optgroup label="${escHtml(catName(c) + ' · ' + sub)}">${ms.map(m => `<option value="${m.sym}"${m.sym === sel ? ' selected' : ''}>${escHtml(m.kind === 'cfd' ? `${m.short} · ${m.label}` : m.label)}</option>`).join('')}</optgroup>`).join('');
}
// refill a symbol select when the listed set changes; the current choice survives while it is listed
function syncInstrSelect(el, keep) {
  if (!el) return;
  const cur = el.value || keep, key = listedInstr().map(m => m.sym).join() + '|' + (keep || '');
  if (el.dataset.k === key) return;
  el.dataset.k = key; el.innerHTML = instrOptions(cur, keep);
  if (![...el.options].some(o => o.value === cur)) el.selectedIndex = 0;
}
/* ---------- badges ---------- */
const closeOnlyTitle = sym => `${unavailableNote(sym)}. You can reduce or close a position; nothing can be added.`;
// the jurisdiction cuts the sheet's default leverage (a retail regime also sets S.set.lev to its major cap, so
// capBinds alone would miss the majors)
const capCuts = sym => jurCap(sym) < M(sym).p.lev[0];
// 'Max leverage 1:5 under EU retail (ESMA class: equity; sheet 1:40)'
function levTitle(sym) {
  const j = jurOf(S.set), lev = effLev(sym), sl = sheetLev(sym), [def, max] = M(sym).p.lev, c = CLS_LABEL[levCls(sym, j)] || M(sym).cls;
  if (capCuts(sym)) return `Max leverage 1:${lev} under ${j.name} (${j.majors ? j.majorsName + ' rule' : 'ESMA class'}: ${c}; sheet 1:${def})`;
  const why = S.set.lev > 0 ? (sl < S.set.lev ? `instrument sheet maximum, below your choice 1:${S.set.lev}` : `your choice; sheet maximum 1:${max}`) : `instrument sheet default${def < max ? `; maximum 1:${max}` : ''}`;
  return `Max leverage 1:${lev} under ${j.name} (${why})`;
}
// the tag of a row for its leverage: 'Close only', or 1:x only where the jurisdiction cuts the sheet
function levTagText(sym) {
  if (closeOnly(sym)) return { t: 'Close only', title: closeOnlyTitle(sym) };
  return capCuts(sym) ? { t: `1:${effLev(sym)}`, title: levTitle(sym) } : null;
}
const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const hmU = d => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
// a session badge from Engine.session: 'Closed · opens Mon 15:35' (local time; UTC in the tooltip), short 'Opens 15:35'
// q: the row's quote when it is on screen; without it the session table decides (no quote: the row stays cold)
function sesBadge(sym, q) {
  if (q ? q.open : Engine.isOpen(sym)) return '';
  if (q && q.why === 'off quotes') return `<i class="tag lo wl-ses" title="${escHtml(marketWhy(sym))}"><span class="ses-l">Off quotes</span><span class="ses-s">Off quotes</span></i>`;
  if (q && q.why === 'no feed') return `<i class="tag lo wl-ses" title="${escHtml(marketWhy(sym))}"><span class="ses-l">No feed</span><span class="ses-s">No feed</span></i>`;
  const s = Engine.session(sym);
  if (!s || !s.opensAt) return `<i class="tag lo wl-ses" title="Market closed"><span class="ses-l">Closed</span><span class="ses-s">Closed</span></i>`;
  const d = new Date(s.opensAt * 1000), now = new Date(Engine.simTime * 1000), day = DOW3[d.getDay()];
  const title = `Market closed — opens ${day} ${hm(d)} local time / ${DOW3[d.getUTCDay()]} ${hmU(d)} UTC. Last price shown.`;
  const short = d.toDateString() === now.toDateString() ? `Opens ${hm(d)}` : `Opens ${day} ${hm(d)}`;
  return `<i class="tag lo wl-ses" title="${escHtml(title)}"><span class="ses-l">Closed · opens ${day} ${hm(d)}</span><span class="ses-s">${short}</span></i>`;
}
// 'Close only' in the badge line; the leverage only where it differs from its group's usual one (the group header
// names that), beside the symbol (symLev)
function staticBadges(sym) {
  const lt = levTagText(sym); if (!lt || !closeOnly(sym)) return '';
  return `<i class="tag lo wl-lev co" title="${escHtml(lt.title)}">Close only</i><span class="wl-co-why">no new positions or orders</span>`;
}
function symLev(sym, usual) {
  const lt = levTagText(sym); if (!lt || closeOnly(sym)) return '';
  return lt.t === usual ? `<span class="sr-only">, max leverage ${lt.t}</span>` : `<i class="tag lo wl-lev" title="${escHtml(lt.title)}"><span class="sr-only">max leverage </span>${lt.t}</i>`;
}
// the most common leverage tag of a list of instruments (ties: the first met)
function wlUsualLev(list) { const n = new Map(); let best = null; for (const m of list) { if (closeOnly(m.sym)) continue; const t = levTagText(m.sym)?.t; if (!t) continue; n.set(t, (n.get(t) || 0) + 1); if (!best || n.get(t) > n.get(best)) best = t; } return best; }
/* A quote in three parts, as dealing screens print it: the big figure small, the two pip digits large, the pipette
   (the fractional pip, when the instrument quotes one) small and raised. The parts come from the price string, so the
   digits are exactly fp()'s. */
function pxHtml(sym, v) {
  // the platform's layout from the sheet's fmt (pxSplit, app.js), the same as New order
  const p = pxSplit(sym, v);
  return `<span class="bf">${p.a}</span><span class="pp">${p.b}</span>${p.c ? `<span class="bf">${p.c}</span>` : ''}${p.s ? `<span class="pt">${p.s}</span>` : ''}`;
}
// spread cost in bp of the price: tight (≤ 1.5 bp), wide (> 5 bp or 40% above the sheet's Default), else plain
function spCls(sym, q) { const m = M(sym), bp = q.spread * m.pip / q.bid * 1e4; return { bp, c: bp > 5 || q.spread > m.spread * 1.4 ? 'sp wide' : bp <= 1.5 ? 'sp tight' : 'sp' }; }
/* ---------- favourites and folding ---------- */
const favs = () => Array.isArray(S.set.fav) ? [...new Set(S.set.fav.filter(s => typeof s === 'string' && M(s)))].slice(0, FAV_MAX) : [];
const isFav = sym => favs().includes(sym);
function toggleFav(sym = S.set.sym) {
  if (!M(sym)) return false;
  const f = favs(), i = f.indexOf(sym);
  if (i >= 0) f.splice(i, 1);
  else if (f.length >= FAV_MAX) { toast('Favourites full', `Up to ${FAV_MAX} favourites: remove one before adding ${pretty(sym)}.`, 'warn'); return false; }
  else f.push(sym);
  S.set.fav = f; syncFavBtn(); buildWatch(); renderWatch(); save();
  return true;
}
function syncFavBtn(sym = S.set.sym) {
  const b = $('#favBtn'); if (!b || !M(sym)) return;
  const on = isFav(sym), l = `${on ? 'Remove' : 'Add'} ${pretty(sym)} ${on ? 'from' : 'to'} favourites`;
  b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
  if (b.getAttribute('aria-label') !== l) { b.setAttribute('aria-label', l); b.title = l; }
}
// open by default: Favourites and FX; on a phone with favourites, only Favourites (the rest folded)
const wlOpenDef = () => document.body.classList.contains('mnav-on') && favs().length ? ['fav'] : ['fav', 'fx'];
// S.set.wlOpen (app.js contract): group key → open; no category key chosen yet → the defaults
const wlOpen = () => {
  const w = S.set.wlOpen, own = w && typeof w === 'object' && !Array.isArray(w) && WL_CATS.some(c => typeof w[c[0]] === 'boolean');
  return new Set(own ? WL_CATS.map(c => c[0]).filter(k => w[k] === true) : wlOpenDef());
};
function toggleGroup(c) {
  const o = wlOpen(); if (o.has(c)) o.delete(c); else o.add(c);
  const w = S.set.wlOpen && typeof S.set.wlOpen === 'object' && !Array.isArray(S.set.wlOpen) ? S.set.wlOpen : {};
  S.set.wlOpen = { ...w, ...Object.fromEntries(WL_CATS.map(x => [x[0], o.has(x[0])])) };
  buildWatch(); renderWatch(); save();
  const b = $(`#wl .wl-grp[data-g="${c}"]`); if (b) b.focus({ preventScroll: true });
}
// the active class filter: 'all' or a category; an older value ('metal', 'energy') reads as its category
const wlFilter = () => { const v = S.set.wl; return WL_KEYS.includes(v) ? v : CAT_OF[v] || 'all'; };
/* ---------- rows on screen ---------- */
const WL = { vis: new Set(), io: null, exch: 'all', ref: {}, hotKey: '' };
function wlObserve(rows) {
  if (WL.io) WL.io.disconnect();
  WL.vis.clear();
  if (!rows.length) return;
  if (!WL.io && 'IntersectionObserver' in window) WL.io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) WL.vis.add(e.target); else WL.vis.delete(e.target); }, { rootMargin: '48px 0px' });
  // the first frame after a rebuild: what is on screen now (the observer reports asynchronously)
  const box = $('#wl').getBoundingClientRect(), top = Math.max(box.top, 0) - 48, bot = Math.min(box.bottom, innerHeight) + 48;
  for (const r of rows) {
    if (WL.io) WL.io.observe(r);
    const b = r.getBoundingClientRect(); if (b.height && b.bottom > top && b.top < bot) WL.vis.add(r);
    if (!WL.io) WL.vis.add(r);
  }
}
// symbols of the rows on screen
const wlVisible = () => [...new Set([...WL.vis].map(r => r.dataset.sym))];
// the engine's hot set: rows on screen, the chart, what the account holds, the quote monitor's tiles on screen
function syncHot() {
  const s = new Set(wlVisible()); s.add(S.set.sym);
  for (const list of [S.positions, S.orders, S.alerts]) for (const x of list) s.add(x.sym);
  if (typeof monVisible === 'function') for (const k of monVisible()) s.add(k);
  const a = [...s], k = a.join();
  if (k !== WL.hotKey) { WL.hotKey = k; Engine.hot(a); }
}
let wlBound = false, wlShown = '';
const wlKey = () => `${S.set.jur}|${S.set.lev}|${S.set.wl}|${favs().join()}|${S.positions.map(p => p.sym).join()}`;
function bindWatch() {
  const seg = $('#wlCls'); if (wlBound || !seg) return; wlBound = true;
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-wl]'); if (!b) return;
    S.set.wl = b.dataset.wl; buildWatch(); renderWatch(); if (typeof renderSparks === 'function') renderSparks(); save();
    const n = $$('#wl .wl-row').length, live = $('#wlLive'); if (live) live.textContent = `${n} instrument${n === 1 ? '' : 's'} shown`;
  });
  seg.addEventListener('keydown', e => {
    const bs = [...seg.querySelectorAll('button:not([hidden])')], i = bs.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % bs.length : e.key === 'ArrowLeft' ? (i - 1 + bs.length) % bs.length : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : -1;
    if (j >= 0) { e.preventDefault(); bs[j].focus(); }
  });
  $('#wl').addEventListener('click', e => {
    const g = e.target.closest('.wl-grp[data-g]'); if (g) { toggleGroup(g.dataset.g); return; }
    const x = e.target.closest('.wl-chips button[data-x]'); if (x) { WL.exch = x.dataset.x; buildWatch(); renderWatch(); const b = $(`#wl .wl-chips button[data-x="${WL.exch}"]`); if (b) b.focus({ preventScroll: true }); }
  });
  const fb = $('#favBtn'); if (fb) fb.addEventListener('click', () => toggleFav(S.set.sym));
  // the title band: the search says what it searches; ‹ hides the panel (ui.js pvSet), its edge tab brings it back
  const sr = $('#wlSearch'); if (sr) sr.placeholder = 'Search symbol, name, sector, exchange';
  const ph = $('.watch>.ph');
  if (ph && !$('#wlHide')) {
    ph.insertAdjacentHTML('beforeend', '<button type="button" class="wl-hide" id="wlHide" aria-label="Hide the market watch" title="Hide the market watch (Panels menu or its edge tab brings it back)">‹</button>');
    $('#wlHide').addEventListener('click', () => {
      if (typeof window.pvSet !== 'function') return;
      window.pvSet({ wl: false });
      const e = $('.watch>.pv-edge'); if (e) e.focus({ preventScroll: true });
    });
  }
}
/* Columns: Symbol, Bid, Ask and Time by default; the › in the header adds the spread and the 24 h change and range
   (S.set.wlCols 'full'). The choice is kept. */
function wlColsApply() {
  const full = S.set.wlCols === 'full' && innerWidth >= 1440, w = $('.watch'), b = $('#wlColsBtn'); if (!w) return;
  w.classList.toggle('wl-full', full); w.classList.toggle('wl-basic', !full);
  if (b) { b.setAttribute('aria-expanded', full); b.textContent = full ? '−' : '+'; b.title = full ? 'Hide spread and change' : 'Show spread, 24 h change and range'; }
}
// expanding widens a narrow list to 420 px (the widest the layout allows), folding gives the width back
document.addEventListener('click', e => {
  if (!e.target.closest('#wlColsBtn')) return;
  const full = S.set.wlCols !== 'full', ws = window.wsState ? wsState() : {}, cur = ws.cur || {};
  S.set.wlCols = full ? 'full' : 'basic'; wlColsApply();
  if (window.wsWl && !document.body.classList.contains('mnav-on')) {
    // the width follows the columns: + widens a narrow list to 420 px, − always narrows it back (to the width it had before +,
    // kept in S.set across reloads; else the standard 288 px). A list already narrower than that is left alone
    if (full && cur.wl && cur.wl < 400) { WL.prevW = { w: cur.wl, name: ws.name }; S.set.wlPrevW = cur.wl; wsWl(420, ''); }
    else if (!full) {
      const p = WL.prevW, to = (p && p.w) || (S.set.wlPrevW > 0 && S.set.wlPrevW < 400 ? S.set.wlPrevW : 288);
      WL.prevW = null; delete S.set.wlPrevW;
      if (!cur.wl || cur.wl > to) wsWl(to, p ? p.name : '');
    }
  }
  save();
});
const hmsU = t => new Date(t * 1000).toISOString().slice(11, 19);
function buildWatch() {
  wlColsApply();
  bindWatch();
  const raw = ($('#wlSearch').value || '').trim().toUpperCase(), f = raw.replace('/', '');
  const all = listedInstr(), syms = new Set(all.map(m => m.sym)), by = { fav: favs().filter(s => syms.has(s)).map(M) };
  for (const [c] of WL_GROUPS) by[c] = [];
  for (const m of all) by[CAT_OF[m.group]].push(m);
  // a category the profile does not offer has no button; a saved filter on it shows everything until it is back
  const has = c => by[c].length > 0, fl = wlFilter(), wl = fl === 'fav' || (fl !== 'all' && has(fl)) ? fl : 'all';
  $$('#wlCls button').forEach(b => { const g = b.dataset.wl, on = g === wl; b.hidden = g !== 'all' && g !== 'fav' && !has(g); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const hit = m => !f || m.sym.includes(f) || m.short.toUpperCase().replace('/', '').includes(f) || [m.desc, m.sector, m.exch].some(x => x && x.toUpperCase().includes(raw));
  const open = wlOpen(), cur = S.set.sym, out = [], flat = !document.body.classList.contains('mnav-on');
  const row = (m, c, usual) => `<div class="wl-row${m.sym === cur ? ' on' : ''}" data-sym="${m.sym}" data-c="${c}" role="button" tabindex="0">
      <span class="wl-sym"><span class="wl-nm" title="${escHtml(m.label)}">${escHtml(pretty(m.sym))}</span>${m.kind === 'cfd' ? `<span class="sr-only">, ${escHtml(m.label)},</span>` : ''}${symLev(m.sym, usual)}${WL_SRK.map(wlSr).join('')}</span>
      <span class="px" data-f="bid" aria-hidden="true"></span><span class="px" data-f="ask" aria-hidden="true"></span><span class="sp" data-f="sp" title="Spread in ${m.unit === 'pt' ? 'points' : 'pips'}" aria-hidden="true">—</span><span class="chg" data-f="chg" aria-hidden="true"></span><span class="tm" data-f="tm" aria-hidden="true"></span><span class="wl-bdg">${staticBadges(m.sym)}</span>
    </div>`;
  const head = (c, name, n, isOpen, button) => button
    ? `<button type="button" class="wl-grp" data-g="${c}" aria-expanded="${isOpen}"><svg class="wl-car" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3l3 3-3 3"/></svg><span class="wl-gn">${name}</span><span class="wl-n">${n}</span><span class="sr-only"> instrument${n === 1 ? '' : 's'}</span></button>`
    : `<div class="wl-grp wl-grp-s" data-g="${c}" role="presentation"><span class="wl-gn">${name}</span><span class="wl-n">${n}</span></div>`;
  for (const [c, name] of WL_CATS) {
    if (wl !== 'all' && c !== wl) continue;
    if ((f || (flat && wl === 'all')) && c === 'fav') continue; // each instrument once, in its own category (Fav is its own tab)
    let ms = by[c]; const n = ms.length;
    if (!n && c !== 'fav') continue;
    if (f) { ms = ms.filter(hit); if (!ms.length) continue; }
    // desktop: All lists every category open under a plain band (name, count): the tabs above already pick a category,
    // so a list of folded categories only repeated them (Victor, 31.10.2026); the phone keeps its folding list
    const isOpen = !!f || wl !== 'all' || flat || open.has(c);
    if (f) out.push(head(c, name, ms.length, true, false));
    else if (wl === 'all') out.push(head(c, name, n, isOpen, !flat));
    if (!isOpen) continue;
    if (c === 'fav') { out.push(ms.length ? ms.map(m => row(m, 'fav', wlUsualLev(ms))).join('') : `<div class="wl-empty">No favourites yet: the ☆ beside the symbol on the chart adds one (up to ${FAV_MAX}).</div>`); continue; }
    if (c === 'stock' && !f) {
      const ex = [...new Set(ms.map(m => m.exch))].sort();
      if (!['all', ...ex].includes(WL.exch)) WL.exch = 'all';
      out.push(`<div class="wl-chips" role="group" aria-label="Stock exchange">${['all', ...ex].map(x => `<button type="button" class="chip" data-x="${escHtml(x)}" aria-pressed="${x === WL.exch}">${x === 'all' ? 'All' : escHtml(x)}</button>`).join('')}</div>`);
      if (WL.exch !== 'all') ms = ms.filter(m => m.exch === WL.exch);
    }
    // a subgroup row: its name, (a shared closed note, wlGroupSes), the group's usual leverage, its count
    for (const [, sub, list] of wlOrder(ms)) { const u = wlUsualLev(list), k = list.length; out.push(`<div class="wl-sub" data-c="${c}" role="presentation"><span class="wl-sub-n">${escHtml(sub)}</span>${u ? `<span class="wl-sub-lev" title="Max leverage of this group; an instrument that differs shows its own">${u}</span>` : ''}<span class="wl-sub-c">${k}<span class="sr-only"> instrument${k === 1 ? '' : 's'}</span></span></div>` + list.map(m => row(m, c, u)).join('')); }
  }
  $('#wl').innerHTML = out.join('') || `<div class="wl-empty">No instrument matches “${escHtml(raw)}”.</div>`;
  for (const k in WL.ref) delete WL.ref[k];
  const rows = [...$('#wl').querySelectorAll('.wl-row')];
  // the session badge of each row, from the engine's session table (no quote: off-screen rows stay cold)
  for (const r of rows) { const sym = r.dataset.sym; r._open = Engine.isOpen(sym); if (!r._open) setSes(r, sym); }
  wlObserve(rows);
  wlGroupSes();
  wlShown = wlKey();
  syncSymHead(); syncFavBtn();
}
function setSes(row, sym, q) {
  const b = row.querySelector('.wl-bdg'), old = b.querySelector('.wl-ses'); if (old) old.remove();
  b.insertAdjacentHTML('beforeend', sesBadge(sym, q));
  row.classList.toggle('closed', !row._open);
  if (!WL.gsq) WL.gsq = requestAnimationFrame(() => { WL.gsq = 0; wlGroupSes(); });
}
// a subgroup closed for one and the same reason says it once, on its own header row (full text as its title), instead
// of a footnote on every row; a row that differs (Close only, another session) keeps its own line
function wlGroupSes() {
  for (const sub of $$('#wl .wl-sub')) {
    const rows = []; for (let n = sub.nextElementSibling; n && n.classList.contains('wl-row'); n = n.nextElementSibling) rows.push(n);
    const txt = r => { const e = r.querySelector('.wl-ses .ses-l'); return e ? e.textContent : ''; };
    const t0 = rows.length > 1 ? txt(rows[0]) : '', same = !!t0 && rows.every(r => txt(r) === t0);
    for (const r of rows) r.classList.toggle('ses-grp', same);
    let tag = sub.querySelector('.wl-sub-ses');
    if (same) {
      if (!tag) { tag = document.createElement('span'); tag.className = 'wl-sub-ses'; sub.insertBefore(tag, sub.querySelector('.wl-sub-n')?.nextSibling || null); }
      if (tag.textContent !== t0) tag.textContent = t0;
      tag.title = rows[0].querySelector('.wl-ses')?.title || t0;
    } else if (tag) tag.remove();
  }
}
// the tick flash of a quote: on at each change, held for TICK_MS after the last one, then it fades (CSS)
const TICK_MS = 500;
function tickFlash(el, dir) {
  if (!dir) return;
  // market watch: the Bid and Ask cells light up and start fading at once; a new tick restarts it
  if (el.classList.contains('wl-row')) {
    const bg = dir > 0 ? 'var(--tk-up-bg)' : 'var(--tk-dn-bg)';
    for (const px of el.querySelectorAll(':scope>.px')) { px._fa?.cancel(); px._fa = px.animate?.([{ backgroundColor: bg }, { backgroundColor: 'transparent' }], { duration: 700, easing: 'ease-out' }); }
    return;
  }
  const c = dir > 0 ? 'tk-up' : 'tk-dn';
  if (!el.classList.contains(c)) { el.classList.remove('tk-up', 'tk-dn'); el.classList.add(c); }
  clearTimeout(el._ft); el._ft = setTimeout(() => el.classList.remove('tk-up', 'tk-dn'), TICK_MS);
}
/* the accessible name of a Market watch row (UX 09.11.2026, F17) comes from its content: 'EUR/USD, bid 1.11914, ask
   1.11926, spread 1.2, 24 h change +0.12%, at 10:30:00', then its tags. Each figure is said whole by a screen-reader-only
   twin at the end of the symbol cell (a cell splits the price into big figure / pips / pipette and may be hidden at a
   narrow width, so the cells are aria-hidden). Content, not an aria-label, so the name never leaves out text on screen
   (WCAG 2.5.3); inside the symbol cell, so the row keeps its children (the columns are placed by position). */
const WL_SR = { bid: 'bid', ask: 'ask', sp: 'spread', chg: '24 h change', tm: 'at' }, WL_SRK = Object.keys(WL_SR);
const wlSr = f => `<span class="sr-only" data-sr="${f}"></span>`;
const wlSay = (cl, f, v) => { const e = cl['sr-' + f], t = `, ${WL_SR[f]} ${v}`; if (e && e.textContent !== t) e.textContent = t; };
// a row's cells by field, and their screen-reader twins as 'sr-<field>'
const wlCells = row => row._c || (row._c = Object.fromEntries([...row.querySelectorAll('[data-f],[data-sr]')].map(e => [e.dataset.f || 'sr-' + e.dataset.sr, e])));
function renderWatch() {
  if (wlKey() !== wlShown) buildWatch(); // the profile, the favourites or a close-only position changed what is listed
  else syncSymHead(); // an import can change the chart symbol without setSymbol
  syncHot();
  const minute = Math.floor(Engine.simTime / 60);
  for (const row of WL.vis) {
    if (!row.isConnected) { WL.vis.delete(row); continue; }
    const sym = row.dataset.sym, q = Engine.quote(sym);
    if (q.open !== row._open || (!q.open && q.why !== row._why)) { row._open = q.open; row._why = q.why; setSes(row, sym, q); }
    // the 24 h change: the reference close is read once a simulated minute
    let r = WL.ref[sym]; if (!r || r.k !== minute) {
      const arr = Engine.candles[sym]; let lo = Infinity, hi = -Infinity;
      for (let i = Math.max(0, arr.length - 1440); i < arr.length; i++) { if (arr[i].low < lo) lo = arr[i].low; if (arr[i].high > hi) hi = arr[i].high; }
      r = WL.ref[sym] = { k: minute, v: arr.length ? arr[Math.max(0, arr.length - 1441)].close : NaN, lo, hi };
    }
    const ch = (q.mid / r.v - 1) * 100;
    const cl = wlCells(row), bid = cl.bid, ask = cl.ask;
    const bt = fp(sym, q.bid), at = fp(sym, q.ask);
    // the pip digits take the tick's direction on every change of the price shown (a move below the last digit shows nothing)
    if (row._bt !== bt && row._bid != null) tickFlash(row, Math.sign(q.bid - row._bid));
    if (row._bt !== bt) {
      bid.innerHTML = pxHtml(sym, q.bid);
      // the time of the price: now when it changed live, the last bar's minute for the first price of a closed market
      const arr = Engine.candles[sym], tt = row._bt == null && !q.open && arr.length ? arr[arr.length - 1].time + 59 : Engine.simTime;
      cl.tm.textContent = hmsU(tt); row._bt = bt; row._bid = q.bid;
    } else if (row._bid == null) row._bid = q.bid;
    if (row._at !== at) { ask.innerHTML = pxHtml(sym, q.ask); row._at = at; }
    const c = cl.chg, ct = Number.isFinite(ch) ? pct(ch) : '—', cc = 'chg ' + cls(ch); if (c.textContent !== ct) c.textContent = ct; if (c.className !== cc) c.className = cc;
    // where the price sits in its 24-hour range: a tick on the line under the change
    const rg = r.hi > r.lo ? Math.min(1, Math.max(0, (q.bid - r.lo) / (r.hi - r.lo))) : .5, rgs = rg.toFixed(3);
    if (row._rg !== rgs) { row._rg = rgs; c.style.setProperty('--rg', rgs); c.title = `24 h change ${ct}; 24 h range ${fp(sym, r.lo)} – ${fp(sym, r.hi)}, now at ${Math.round(rg * 100)}% of it`; }
    const sp = cl.sp, st = q.spread.toFixed(q.spread >= 10 ? 0 : 1), sk = spCls(sym, q); // non-FX spreads run to hundreds of points
    if (sp.textContent !== st) { sp.textContent = st; sp.title = `Spread ${st} ${M(sym).unit === 'pt' ? 'points' : 'pips'} = ${sk.bp.toFixed(1)} bp of the price (sheet Default ${M(sym).spread})`; }
    if (sp.className !== sk.c) sp.className = sk.c;
    wlSay(cl, 'bid', bt); wlSay(cl, 'ask', at); wlSay(cl, 'sp', sp.textContent); wlSay(cl, 'chg', ct); wlSay(cl, 'tm', cl.tm.textContent);
  }
}
// chart header: the type of a non-FX instrument, 'Closed' while its market is, and its leverage (a pair: only where a
// jurisdiction cuts it); 'Close only' or 'Not offered' instead when that applies. Recomputed from the profile and the
// positions on every call: each frame, and at once after a profile change, a fill or a close (wrappers below).
function symHeadText(sym = S.set.sym) {
  const m = M(sym); if (!m) return { t: '', title: '' };
  if (closeOnly(sym)) return { t: 'Close only', title: closeOnlyTitle(sym) };
  if (!isAvailable(sym)) return { t: 'Not offered', title: `${unavailableNote(sym)}. Nothing can be traded on it under this profile.` };
  const why = marketWhy(sym), cfd = m.kind === 'cfd', lev = cfd || capCuts(sym);
  return { t: [cfd ? GROUP_TAG[m.group] : '', why ? (why.startsWith('Off') ? 'Off quotes' : 'Closed') : '', lev ? `1:${effLev(sym)}` : ''].filter(Boolean).join(' · '), title: [lev ? levTitle(sym) : '', why].filter(Boolean).join('. ') };
}
function syncSymHead(sym = S.set.sym) {
  const tg = $('#symCls'); if (!M(sym) || !tg) return;
  const h = symHeadText(sym);
  if (tg.textContent !== h.t) tg.textContent = h.t;
  tg.hidden = !h.t; if (tg.title !== h.title) tg.title = h.title;
}
for (const f of ['applyProfile', 'openPosition', 'closePosition']) {
  const orig = window[f]; if (typeof orig !== 'function') continue;
  window[f] = function () { const r = orig.apply(this, arguments); safe('chart header', () => syncSymHead()); return r; };
}
/* Specifications (the 'i' popover in the chart header; a bottom sheet on a phone): every field of the instrument sheet
   the ticket and the account maths use (Engine.META[sym], profile Default), the session table, where the starting
   level comes from, and what this simulation does not apply. */
const numTxt = v => Number.isInteger(v) ? nf0.format(v) : String(+v.toFixed(8));
const pad2 = n => String(n).padStart(2, '0');
const minTxt = n => `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`;
// one row per day of the current server week (Mon–Sun): windows in server time, UTC and local time
function sessTable(sym) {
  const m = M(sym);
  if (m.is247) return [['Every day', 'Open 24/7', 'Open 24/7', 'Open 24/7']];
  const t0 = Engine.simTime, D0 = Math.floor((t0 + Engine.serverOffset(t0) * 3600) / 86400), Mon = D0 - ((((D0 + 4) % 7) + 7) % 7 + 6) % 7, out = [];
  for (let D = Mon; D < Mon + 7; D++) {
    const dow = (((D + 4) % 7) + 7) % 7, ws = m.sess.filter(w => w[0] === dow).map(w => [w[1], w[2]]);
    if (!ws.length) { out.push([DOW3[dow], 'Closed', 'Closed', 'Closed']); continue; }
    const at = mn => { const loc = D * 86400 + mn * 60; return new Date((loc - Engine.serverOffset(loc - 7200) * 3600) * 1000); };
    const day = new Date(D * 86400 * 1000).getUTCDate();
    const u = d => (d.getUTCDate() !== day ? DOW3[d.getUTCDay()] + ' ' : '') + hmU(d), l = d => (d.getDate() !== day ? DOW3[d.getDay()] + ' ' : '') + hm(d);
    out.push([DOW3[dow], ws.map(([a, b]) => `${minTxt(a)}–${minTxt(b)}`).join(', '), ws.map(([a, b]) => `${u(at(a))}–${hmU(at(b))}`).join(', '), ws.map(([a, b]) => `${l(at(a))}–${hm(at(b))}`).join(', ')]);
  }
  return out;
}
function marketText(sym) {
  const why = marketWhy(sym);
  if (why) return why.startsWith('Market closed') ? 'Closed' + why.slice(13) : why;
  const s = Engine.session(sym); if (!s || !s.closesAt) return 'Open 24/7';
  const d = new Date(s.closesAt * 1000);
  return `Open — closes ${DOW3[d.getDay()]} ${hm(d)} (local) / ${hmU(d)} UTC`;
}
// what the EU retail rule would allow on the instrument, said where no jurisdiction cap applies: 'major pairs at 1:30'
const CLS_PLURAL = { 'major pair': 'major pairs', 'minor pair': 'minor pairs', gold: 'gold', 'major index': 'major indices', 'minor index': 'minor indices', commodity: 'commodities', crypto: 'crypto', equity: 'equities' };
function esmaCapText(sym) { const c = levCls(sym, JUR.eu), l = CLS_LABEL[c] || c; return `${CLS_PLURAL[l] || l} at 1:${ESMA_CAP[c]}`; }
function instrCard(sym = S.set.sym) {
  const m = M(sym), p = m.p, j = jurOf(S.set), fx = m.kind === 'fx', st = tradeStatus(sym), q = Engine.quote(sym), [def, max] = p.lev, lev = effLev(sym);
  const per = m.lotName === 'shares' ? 'share' : 'lot', pips = v => numTxt(+(v * m.point / m.pip).toFixed(2));
  const sp = p.spread, spName = ['Default', 'Night', 'News'], spK = ['default', 'night', 'news'].indexOf(q.sp);
  const spHtml = sp.map((v, i) => i === spK ? `<b class="ins-sp-on" title="In force now">${spName[i]} ${numTxt(v)}</b>` : `${spName[i]} ${numTxt(v)}`).join(' · ') + ' points'
    + (fx ? ` (${sp.map(pips).join(' · ')} pips)` : '') + (p.jit ? ` · variation ${nfx(p.jit[0][0], 0)}…+${numTxt(p.jit[0][1])} pts` : '')
    + `; Night 23:00–01:00 server time Mon–Fri, News while a release on ${escHtml(m.newsCcy.join('/'))} is active; now: ${escHtml(q.sp)}`;
  const levTxt = capCuts(sym) ? `1:${lev} — ${j.name} cap (${CLS_LABEL[levCls(sym, j)] || m.cls}); sheet default 1:${def}, maximum 1:${max}`
    : `1:${lev} (${S.set.lev > 0 ? `your choice 1:${S.set.lev}, sheet maximum 1:${max}` : `sheet default; maximum 1:${max}`})${j.none ? ` · no EU limit (ESMA caps ${esmaCapText(sym)})` : '; within the ' + j.name + ' cap'}`;
  // only shown with live prices (the card says nothing about where a static copy's prices come from)
  const prov = 'Live from the broker platform; chart history from the platform';
  const T = v => escHtml(v);
  // the lead of a value in bold, the explanation after it (first " · ", " — ", "; " or " (") in a quieter tone
  const H = v => { const t = String(v), i = Math.min(...[' · ', ' — ', '; ', ' ('].map(x => { const k = t.indexOf(x); return k < 0 ? Infinity : k; })); return i === Infinity ? `<b>${T(t)}</b>` : `<b>${T(t.slice(0, i))}</b><span class="ins-rest">${T(t.slice(i))}</span>`; };
  const rows = [
    ['Description', T(m.desc)],
    ['Type', H([TYPE_NAME[m.type] || m.type, m.sector && m.sector !== TYPE_NAME[m.type] ? m.sector : ''].filter(Boolean).join(' · '))],
    ['Exchange', H([m.exch, m.country && m.country !== 'N/A' ? m.country : ''].filter(Boolean).join(' · '))],
    ['Currencies', H(fx ? `base ${m.base} · profit ${m.quote}` : `profit ${m.quote}`)],
    ['Trade status', H(st === 'full' ? 'Full access (open, reduce and close)' : st === 'close' ? 'Close only — reductions and closes only; no new positions or orders' : unavailableNote(sym))],
    ['Market', H(marketText(sym))],
    ['Digits', H(`${m.digits} · point ${m.point.toFixed(m.digits)}${fx ? ` · pip ${m.pip.toFixed(Math.max(0, -Math.floor(Math.log10(m.pip) + 1e-9)))}` : ' (prices and distances in points)'}`)],
    ['Contract', H(contractText(sym))],
    ['Leverage', H(levTxt)],
    ['Margin per lot', H(`${usdFmt(notionalUsd(sym, 1) / lev)} per ${per} at ${fp(sym, q.bid)} (notional ${usdFmt(notionalUsd(sym, 1))} ÷ ${lev})`)],
    ['Min pending distance', H(`${numTxt(p.minPend)} points${fx ? ` (${pips(p.minPend)} pips)` : ''} from the price; maximum deviation of a market fill ${numTxt(p.maxDev)} points`)],
    ['Volume', H(`min ${numTxt(p.vol[0])} · max ${numTxt(p.vol[1])} · step ${numTxt(p.vol[2])} ${m.lotName}`)],
    ['Spread', spHtml],
    ['Swap', H(`${swapText(sym)} · per ${per} a night: long ${usdFmt(swapPerNight(sym, 'buy', 1), true)}, short ${usdFmt(swapPerNight(sym, 'sell', 1), true)}`)],
    ['Triple swap', H(TRIPLE_TEXT(sym)[0].toUpperCase() + TRIPLE_TEXT(sym).slice(1) + '; rollover 17:00 New York (00:00 server time)')],
    ['Commission', H(commText())],
    ...(Engine.feedOn ? [['Price source', T(prov)]] : [])
  ];
  const ses = sessTable(sym);
  // the figures a trader checks first, as a strip of cells above the sheet (each is also in its row below)
  const open = !marketWhy(sym), key = [
    ['Spread now', `${numTxt(sp[Math.max(0, spK)])} pt${fx ? ` · ${pips(sp[Math.max(0, spK)])} p` : ''}`, ''],
    ['Leverage', `1:${lev}`, ''],
    ['Margin / ' + per, usdFmt(notionalUsd(sym, 1) / lev), ''],
    ['Volume', `${numTxt(p.vol[0])} – ${numTxt(p.vol[1])}`, ''],
    ['Status', st === 'full' ? 'Full access' : st === 'close' ? 'Close only' : 'Unavailable', st === 'full' ? 'up' : 'wn'],
    ['Market', open ? 'Open' : 'Closed', open ? 'up' : 'muted']
  ];
  // the sheet in four groups; every row stays, only the order changes
  const G = [['Instrument', [0, 1, 2, 3, 6, 7, 11]], ['Trading', [4, 5, 8, 9, 10]], ['Costs', [12, 13, 14, 15]], ...(rows.length > 16 ? [['Data', [16]]] : [])];
  return `<div class="ins-h"><b>${T(m.label)}</b><span class="muted mono">${T(m.sym)}</span><button type="button" class="ins-x" aria-label="Close specifications">×</button></div>
    <div class="ins-k">${key.map(([a, b, c]) => `<div><span>${a}</span><b class="mono ${c}">${T(b)}</b></div>`).join('')}</div>
    ${G.map(([g, ix]) => `<div class="ins-gh">${g}</div><dl class="ins-g">${ix.map(i => rows[i]).map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`).join('')}
    <div class="ins-gh">Sessions this week</div><table class="ins-sess"><thead><tr><th scope="col">Day</th><th scope="col">Server (${T(CATALOG.serverTz)})</th><th scope="col">UTC</th><th scope="col">Local</th></tr></thead>
    <tbody>${ses.map(r => `<tr>${r.map((c, i) => i ? `<td>${T(c)}</td>` : `<th scope="row">${T(c)}</th>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="ins-f muted">Every figure comes from the instrument sheet (Default profile).</p>`;
}
function setSymbol(sym, side) {
  if (!Engine.META[sym]) return;
  S.set.sym = sym; S.tk.price = null;
  if (typeof selectDrawing === 'function') { DR.creating = null; DR.hover = null; selectDrawing(null); }
  if (side) S.tk.side = side;
  $$('.wl-row').forEach(r => r.classList.toggle('on', r.dataset.sym === sym));
  $('#symName').textContent = pretty(sym); $('#tkSym').textContent = sym; syncSymHead(sym); syncFavBtn(sym);
  if (S.tk.ot !== 'market') S.tk.price = defaultPendingPrice();
  if (typeof alFollow === 'function') alFollow(sym);
  syncTicketInputs(); fullChart(true); save();
}
