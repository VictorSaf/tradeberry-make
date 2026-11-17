'use strict';
/* tradeBerry — multi-chart layout.
   The main chart (with ticket, overlay, drawings, DOM) stays pane A. Up to three extra live panes,
   each with its own pair and timeframe, EMA20/50, position / order / level lines, a P&L chip,
   one-click trade buttons and swap-into-main. Crosshair sync across all panes (by time),
   optional timeframe link, and an auto-fill that picks the pairs most correlated to the main one. */

const MC_LAYOUTS = {
  '1': { n: 1, name: 'Single chart', icon: '<rect x="2" y="2" width="12" height="12" rx="1.5"/>' },
  '2h': { n: 2, name: 'Two side by side', icon: '<rect x="2" y="2" width="5.5" height="12" rx="1.2"/><rect x="8.5" y="2" width="5.5" height="12" rx="1.2"/>' },
  '2v': { n: 2, name: 'Two stacked', icon: '<rect x="2" y="2" width="12" height="5.5" rx="1.2"/><rect x="2" y="8.5" width="12" height="5.5" rx="1.2"/>' },
  '3': { n: 3, name: 'One large + two', icon: '<rect x="2" y="2" width="7" height="12" rx="1.2"/><rect x="10" y="2" width="4" height="5.5" rx="1"/><rect x="10" y="8.5" width="4" height="5.5" rx="1"/>' },
  '4': { n: 4, name: '2 × 2 grid', icon: '<rect x="2" y="2" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="1"/><rect x="2" y="8.5" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1"/>' }
};
const MC_TFS = [[1, '1m'], [5, '5m'], [15, '15m'], [60, '1H'], [240, '4H']];
const MC = { panes: [], lock: null };
const MC_SPLIT = { '2h': { c: 50 }, '2v': { r: 50 }, '3': { c: 62, r: 50 }, '4': { c: 60, r: 62 } };
const mcSplit = l => { const c = mcCfg(); c.split = c.split || {}; return (c.split[l] = { ...MC_SPLIT[l], ...(c.split[l] || {}) }); };
function mcApplySplit() {
  const c = mcCfg(), l = c.layout, g = $('#mcGrid');
  if (!MC_SPLIT[l]) { g.style.removeProperty('--mc-c'); g.style.removeProperty('--mc-r'); return; }
  const s = mcSplit(l);
  if (s.c != null) g.style.setProperty('--mc-c', s.c + '%'); else g.style.removeProperty('--mc-c');
  if (s.r != null) g.style.setProperty('--mc-r', s.r + '%'); else g.style.removeProperty('--mc-r');
  // RSI and quick-trade go compact when the main pane gets small
  requestAnimationFrame(() => { const a = $('#mcGrid > .chart-area').getBoundingClientRect(); $('.chartp').classList.toggle('mc-tight', L_n() > 1 && $('#mcGrid').dataset.max !== 'a' && (a.height < 360 || a.width < 520)); rsiFit(); });
}
const L_n = () => (MC_LAYOUTS[mcCfg().layout] || MC_LAYOUTS['1']).n;
function mcSplitters() {
  const g = $('#mcGrid'); g.querySelectorAll('.mc-split').forEach(x => x.remove());
  const l = mcCfg().layout, s = MC_SPLIT[l]; if (!s) return;
  const mk = (axis) => {
    const h = document.createElement('div'); h.className = 'mc-split ' + axis; h.dataset.axis = axis; h.dataset.l = l;
    h.title = 'Drag to resize · double-click to reset'; h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', axis === 'c' ? 'vertical' : 'horizontal'); h.tabIndex = 0;
    g.appendChild(h);
  };
  if (s.c != null) mk('c'); if (s.r != null) mk('r');
}
function mcInitSplit() {
  const g = $('#mcGrid'); let D = null;
  const pos = e => (e.touches ? e.touches[0] : e);
  const down = e => {
    const h = e.target.closest('.mc-split'); if (!h) return;
    e.preventDefault(); D = { axis: h.dataset.axis, l: h.dataset.l, r: g.getBoundingClientRect() }; g.classList.add('resizing', 'rs-' + D.axis);
  };
  const move = e => {
    if (!D) return; if (e.cancelable) e.preventDefault();
    const p = pos(e), s = mcSplit(D.l);
    const v = D.axis === 'c' ? (p.clientX - D.r.left) / D.r.width * 100 : (p.clientY - D.r.top) / D.r.height * 100;
    s[D.axis] = Math.round(clamp(v, 25, 80) * 10) / 10; mcApplySplit();
  };
  const up = () => { if (!D) return; g.classList.remove('resizing', 'rs-c', 'rs-r'); D = null; mcApplySplit(); save(); };
  g.addEventListener('mousedown', down); g.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move); window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
  g.addEventListener('dblclick', e => { const h = e.target.closest('.mc-split'); if (!h) return; const s = mcSplit(h.dataset.l); s[h.dataset.axis] = MC_SPLIT[h.dataset.l][h.dataset.axis]; mcApplySplit(); save(); });
  g.addEventListener('keydown', e => {
    const h = e.target.closest('.mc-split'); if (!h) return; const s = mcSplit(h.dataset.l), a = h.dataset.axis;
    const d = (a === 'c' ? { ArrowLeft: -2, ArrowRight: 2 } : { ArrowUp: -2, ArrowDown: 2 })[e.key]; if (!d) return;
    e.preventDefault(); s[a] = clamp(s[a] + d, 25, 80); mcApplySplit(); save();
  });
  window.addEventListener('resize', () => mcApplySplit());
}
function mcCfg() {
  if (!S.set.mc) S.set.mc = { layout: '1', panes: [], syncX: true, linkTf: false };
  const c = S.set.mc;
  c.panes = (c.panes || []).filter(p => p && Engine.META[p.sym]);
  // empty panes fill from the favourites, then the FX pairs in catalog order (the G8 first), never the main chart
  const fill = mcCandidates().filter(s => !c.panes.some(p => p.sym === s));
  while (c.panes.length < 3) c.panes.push({ sym: fill.shift(), tf: S.set.tf });
  return c;
}
// favourites ∪ FX, without the main chart's symbol
function mcCandidates() {
  const fav = (Array.isArray(S.set.fav) ? S.set.fav : []).filter(s => Engine.META[s]);
  return [...new Set([...fav, ...Engine.FX.map(m => m.sym)])].filter(s => s !== S.set.sym);
}
const tfLab = tf => tf >= 60 ? tf / 60 + 'H' : tf + 'm';

/* ---------- pane lifecycle ---------- */
function mcBuild() {
  const c = mcCfg(), L = MC_LAYOUTS[c.layout] || MC_LAYOUTS['1'], grid = $('#mcGrid');
  // destroy old
  MC.panes.forEach(p => { if (p.pager) p.pager.reset(); try { p.chart.remove(); } catch (e) { } p.el.remove(); });
  MC.panes = [];
  grid.dataset.layout = c.layout; delete grid.dataset.max; grid.querySelectorAll('.is-max').forEach(x => x.classList.remove('is-max'));
  document.body.classList.toggle('mc-on', L.n > 1); $('#mcMainMax').hidden = L.n < 2; $('#mcMainMax').classList.remove('on');
  $('.chartp').classList.toggle('mc-multi', L.n > 1); rsiFit();
  $$('#mcSeg [data-l]').forEach(b => b.classList.toggle('on', b.dataset.l === c.layout));
  // the layout cell in the chart header keeps one fixed icon (several layouts); its menu marks the active one of the five
  $('#mcMoreWrap').hidden = L.n < 2; $('#mcOpts').hidden = true;
  mcSplitters(); mcApplySplit();
  for (let i = 0; i < L.n - 1; i++) MC.panes.push(mcPane(i, c.panes[i]));
  MC.panes.forEach(p => grid.appendChild(p.el));
  requestAnimationFrame(() => MC.panes.forEach(p => { mcFull(p, true); }));
}
function mcPane(i, cfg) {
  const el = document.createElement('div');
  el.className = 'mc-pane'; el.style.gridArea = 'bcd'[i]; el.dataset.i = i;
  el.innerHTML = `<div class="mc-head">
      <select class="mc-sym" aria-label="Instrument">${instrOptions(cfg.sym, cfg.sym)}</select>
      <span class="mc-px mono"></span><span class="mc-chg mono"></span><span class="mc-mkt" hidden></span>
      <div class="mc-tf">${MC_TFS.map(([v, l]) => `<button data-tf="${v}" class="${v === cfg.tf ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="mc-pnl mono" hidden></span>
      <span class="mc-sp"></span>
      ${''/* the secondary panes are for reading only: trading is from the main chart and the ticket (decision 45, Victor 10.11.2026) */}
      <button class="mc-ic" data-act="max" title="Focus this chart (Esc to restore)" aria-label="Focus chart"><svg viewBox="0 0 16 16"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg></button>
      <button class="mc-ic" data-act="swap" title="Swap into the main chart (or double-tap the chart)"><svg viewBox="0 0 16 16"><path d="M3 5h9l-2.5-2.5M13 11H4l2.5 2.5"/></svg></button>
    </div><div class="mc-chart"></div><div class="mc-legend mono"></div>`;
  const col = chartColors();
  const ch = LightweightCharts.createChart(el.querySelector('.mc-chart'), { ...chartOpts(col), layout: { ...chartOpts(col).layout, attributionLogo: false }, autoSize: true, rightPriceScale: { borderColor: col.grid, minimumWidth: 64 } });
  const cs = ch.addSeries(LightweightCharts.CandlestickSeries, { upColor: col.up, downColor: col.dn, wickUpColor: col.up, wickDownColor: col.dn, borderVisible: false });
  const ln = color => ch.addSeries(LightweightCharts.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const p = { i, cfg, el, chart: ch, candle: cs, e20: ln(col.ind1), e50: ln(col.info), bars: [], E20: [], E50: [], lines: [], sig: '', pgN: 0, pgMute: 0 };
  // back-paging into the platform's history (histpage.js), one pager per pane; the shared liveRange cache makes two panes on the same instrument and timeframe one series of requests
  if (typeof makePager === 'function') {
    p.pager = makePager({ host: el.querySelector('.mc-chart'), getKey: () => mcPageKey(p), onOlder: () => mcGlue(p) });
    ch.timeScale().subscribeVisibleLogicalRangeChange(r => { if (!p.pgMute) p.pager.maybeLoad(r); });
  }
  // crosshair sync: only the chart under the mouse broadcasts
  el.querySelector('.mc-chart').addEventListener('pointerenter', () => MC.lock = 'p' + i);
  el.querySelector('.mc-chart').addEventListener('pointerdown', () => MC.lock = 'p' + i);
  el.querySelector('.mc-chart').addEventListener('pointerleave', e => { if (e.pointerType === 'touch') return; if (MC.lock === 'p' + i) { MC.lock = null; mcClearX(); } });
  ch.subscribeCrosshairMove(prm => {
    const d = prm.time ? prm.seriesData.get(cs) : null; mcLegend(p, d);
    if (MC.lock !== 'p' + i) return;
    if (prm.time) mcBroadcast(prm.time, p); else mcClearX();
  });
  el.querySelector('.mc-chart').addEventListener('dblclick', () => mcSwap(i));
  let lastTap = 0; el.querySelector('.mc-chart').addEventListener('touchend', e => { const n = performance.now(); if (n - lastTap < 320 && e.changedTouches.length === 1) { e.preventDefault(); mcSwap(i); lastTap = 0; } else lastTap = n; });
  return p;
}
// paging is off where the pane is not the platform's candles: no live feed, a replay (panes draw candles whatever the main chart type)
function mcPageKey(p) {
  const sym = p.cfg.sym, rp = window.RP;
  if (!MC.panes.includes(p) || typeof liveHas !== 'function' || !liveHas(sym) || Engine.isReplayDoc) return null;
  return rp && (rp.role === 'child' || rp.state === 'open' || rp.state === 'loading') ? null : { sym, tf: p.cfg.tf };
}
// older candles arrived: redraw the pane with them in front, the view kept on the same candles
function mcGlue(p) {
  if (!MC.panes.includes(p)) return;
  const ts = p.chart.timeScale(), r = ts.getVisibleLogicalRange(), len = p.bars.length;
  mcFull(p, false);
  const k = p.bars.length - len;
  if (r && k) ts.setVisibleLogicalRange({ from: r.from + k, to: r.to + k });
}
function mcFull(p, fit) {
  const sym = p.cfg.sym, m = M(sym);
  // as on the main chart: a hand-dragged price axis follows the pane again on a new symbol or a reset view
  if (p.candle && (fit || sym !== p.drawnSym)) p.candle.priceScale().applyOptions({ autoScale: true });
  p.drawnSym = sym;
  let agg = Engine.aggregate(sym, p.cfg.tf, 900);
  // the pager owns the aggregate's first bucket (the engine's history starts mid-bucket) and the candles before it; see fullChart in chart.js
  const old = p.pager ? p.pager.older(agg.length > 1 ? agg[1].time : agg.length ? agg[0].time : 0, p.bars) : [];
  if (old.length) { const e = old[old.length - 1].time; let i = 0; while (i < agg.length && agg[i].time <= e) i++; if (i) agg = agg.slice(i); }
  p.pgN = old.length;
  p.bars = p.pgN ? old.concat(agg) : agg;
  p.E20 = []; p.E50 = [];
  p.bars.forEach((b, i) => { p.E20[i] = i ? p.E20[i - 1] + 2 / 21 * (b.close - p.E20[i - 1]) : b.close; p.E50[i] = i ? p.E50[i - 1] + 2 / 51 * (b.close - p.E50[i - 1]) : b.close; });
  p.candle.applyOptions({ priceFormat: { type: 'price', precision: m.digits, minMove: Math.pow(10, -m.digits) } });
  p.candle.setData(p.bars.map(b => ({ ...b })));
  p.e20.setData(p.bars.map((b, i) => ({ time: b.time, value: p.E20[i] })));
  p.e50.setData(p.bars.map((b, i) => ({ time: b.time, value: p.E50[i] })));
  p.e20.applyOptions({ visible: !!S.set.ind.ema20 }); p.e50.applyOptions({ visible: !!S.set.ind.ema50 });
  if (fit) { // a fit is not the user scrolling: the range event it causes pages nothing (two frames, as on the main chart)
    const n = p.bars.length; p.pgMute++; p.chart.timeScale().setVisibleLogicalRange({ from: n - 110, to: n + 6 });
    requestAnimationFrame(() => requestAnimationFrame(() => p.pgMute--));
  }
  p.sig = ''; mcLines(p); mcHead(p); mcLegend(p, null);
}
function mcTickPane(p) {
  const sym = p.cfg.sym, step = p.cfg.tf * 60, src = Engine.candles[sym], last = src[src.length - 1];
  if (!p.bars.length) return;
  const bucket = Math.floor(last.time / step) * step;
  let n = p.bars.length;
  if (bucket > p.bars[n - 1].time) { p.bars.push({ time: bucket, open: last.open, high: last.high, low: last.low, close: last.close }); n++; }
  let o = last.open, h = -Infinity, l = Infinity;
  for (let k = src.length - 1; k >= 0 && src[k].time >= bucket; k--) { o = src[k].open; if (src[k].high > h) h = src[k].high; if (src[k].low < l) l = src[k].low; }
  const b = Object.assign(p.bars[n - 1], { open: o, high: h, low: l, close: last.close }), i = n - 1;
  p.E20[i] = i ? p.E20[i - 1] + 2 / 21 * (b.close - p.E20[i - 1]) : b.close; p.E50[i] = i ? p.E50[i - 1] + 2 / 51 * (b.close - p.E50[i - 1]) : b.close;
  p.candle.update({ ...b }); p.e20.update({ time: b.time, value: p.E20[i] }); p.e50.update({ time: b.time, value: p.E50[i] });
}
function mcHead(p) {
  const sym = p.cfg.sym, q = Engine.quote(sym), el = p.el;
  const ref = p.bars.length ? p.bars[Math.max(0, p.bars.length - Math.round(1440 / p.cfg.tf))].open : q.mid, ch = (q.mid / ref - 1) * 100;
  el.querySelector('.mc-px').textContent = fp(sym, q.mid);
  const ce = el.querySelector('.mc-chg'); ce.textContent = pct(ch, 2); ce.className = 'mc-chg mono ' + cls(ch);
  const ps = S.positions.filter(x => x.sym === sym), pe = el.querySelector('.mc-pnl');
  if (ps.length) { const v = ps.reduce((a, x) => a + posPnl(x).pnl, 0); pe.hidden = false; pe.textContent = `${ps.length} pos ${usdFmt(v, true)}`; pe.className = 'mc-pnl mono ' + cls(v); }
  else pe.hidden = true;
  // a closed market: a short tag in the head (full text as its title), the full text on the legend's first row
  const why = typeof ovlSessionText === 'function' ? ovlSessionText(sym) : '', mk = el.querySelector('.mc-mkt');
  if (mk && (mk.title !== why || mk.hidden === !!why)) { mk.hidden = !why; mk.title = why; mk.textContent = why.startsWith('Off quotes') ? 'Off quotes' : 'Closed'; mk.setAttribute('aria-label', why); }
}
function mcLegend(p, d) {
  const sym = p.cfg.sym, b = d || p.bars[p.bars.length - 1]; if (!b) return;
  const why = typeof ovlSessionText === 'function' ? ovlSessionText(sym) : '';
  p.el.querySelector('.mc-legend').innerHTML = (why ? `<b class="lg-mkt"><em>${escHtml(why)}</em></b>` : '') + `<span>${tfLab(p.cfg.tf)}</span><span><i>O</i> ${fp(sym, b.open)}</span><span><i>H</i> ${fp(sym, b.high)}</span><span><i>L</i> ${fp(sym, b.low)}</span><span><i>C</i> ${fp(sym, b.close)}</span>`;
}
// position / order / level lines, rebuilt only when they change
function mcLines(p) {
  const sym = p.cfg.sym, col = chartColors();
  const ps = S.positions.filter(x => x.sym === sym), os = S.orders.filter(x => x.sym === sym), hl = S.hlines[sym] || [], al = S.alerts.filter(a => a.sym === sym && !a.done);
  const sig = JSON.stringify([ps.map(x => [x.id, x.sl, x.tp]), os.map(x => [x.id, x.price, x.sl, x.tp]), hl, al.map(a => a.price), S.set.theme]);
  if (sig === p.sig) return; p.sig = sig;
  p.lines.forEach(l => { try { p.candle.removePriceLine(l); } catch (e) { } }); p.lines = [];
  const add = (price, color, title, style = 0) => p.lines.push(p.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
  ps.forEach(x => { add(x.entry, x.side === 'buy' ? col.up : col.dn, `#${x.id} ${x.side} ${x.lots}`); if (x.sl != null) add(x.sl, col.dn, 'SL', 2); if (x.tp != null) add(x.tp, col.up, 'TP', 2); });
  os.forEach(x => add(x.price, x.side === 'buy' ? col.up : col.dn, `${x.side} ${x.ot || x.type || 'order'}`, 1)); // pending: the side's colour, dotted
  hl.forEach(v => add(v, col.tx2, '', 2));
  al.forEach(a => add(a.price, col.warn || col.info, 'alert', 3)); // as on the main chart
}
function mcTick(slow) {
  if (!MC.panes.length) return;
  for (const p of MC.panes) { mcTickPane(p); mcLines(p); if (slow) { mcHead(p); if (!MC.lock) mcLegend(p, null); } } // the latest bar (and the market state) only while no pane is hovered: a synced crosshair keeps its bar
  if (!slow) for (const p of MC.panes) { const q = Engine.quote(p.cfg.sym); p.el.querySelector('.mc-px').textContent = fp(p.cfg.sym, q.mid); }
}

/* ---------- crosshair sync ---------- */
function mcBroadcast(t, from) {
  if (!mcCfg().syncX) return;
  const targets = MC.panes.filter(p => p !== from).map(p => ({ ch: p.chart, s: p.candle, bars: p.bars, tf: p.cfg.tf }));
  if (from) targets.push({ ch: chart, s: candle, bars, tf: S.set.tf });
  for (const g of targets) {
    if (!g.bars.length) continue;
    const step = g.tf * 60, bt = Math.floor(t / step) * step;
    if (bt < g.bars[0].time || bt > g.bars[g.bars.length - 1].time) { try { g.ch.clearCrosshairPosition(); } catch (e) { } continue; }
    let lo = 0, hi = g.bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.bars[m].time <= bt) lo = m; else hi = m - 1; }
    try { g.ch.setCrosshairPosition(g.bars[lo].close, g.bars[lo].time, g.s); } catch (e) { }
  }
}
function mcClearX() { [chart, ...MC.panes.map(p => p.chart)].forEach(c => { try { c.clearCrosshairPosition(); } catch (e) { } }); }

/* ---------- actions ---------- */
function mcMax(k) {
  const g = $('#mcGrid'), cur = g.dataset.max;
  g.querySelectorAll('.is-max').forEach(x => x.classList.remove('is-max'));
  $('#mcMainMax').classList.remove('on');
  if (k == null || cur === k) { delete g.dataset.max; }
  else {
    g.dataset.max = k;
    (k === 'a' ? $('#mcGrid > .chart-area') : MC.panes[+k].el).classList.add('is-max');
    if (k === 'a') $('#mcMainMax').classList.add('on');
  }
  MC.panes.forEach(p => p.el.querySelector('[data-act=max]').classList.toggle('on', g.dataset.max === String(p.i)));
  mcApplySplit();
}
function setLayout(l) {
  if (!MC_LAYOUTS[l]) return;
  mcCfg().layout = l; mcBuild(); save();
}
function mcSwap(i) {
  const c = mcCfg(), p = MC.panes[i]; if (!p) return;
  const main = { sym: S.set.sym, tf: S.set.tf }, nw = { ...p.cfg };
  c.panes[i] = main; p.cfg = c.panes[i];
  p.el.querySelector('.mc-sym').innerHTML = instrOptions(main.sym, main.sym); p.el.querySelectorAll('.mc-tf button').forEach(b => b.classList.toggle('on', +b.dataset.tf === main.tf));
  setSymbol(nw.sym); if (nw.tf !== S.set.tf) setTF(nw.tf);
  mcFull(p, true); save();
}
function mcAutoFill() {
  const c = mcCfg(), main = S.set.sym;
  // candidates: favourites and the FX pairs, ranked by |ρ| with the main chart on the last minutes they share (not a clock window)
  const ranked = mcCandidates().map(s => ({ s, r: corrRecent(main, s).r })).filter(x => isFinite(x.r)).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  if (!ranked.length) { toast('Nothing to fill with', `No favourite or FX pair shares enough minutes with ${pretty(main)} to measure a correlation. Panes unchanged.`, 'warn'); return; }
  ranked.slice(0, 3).forEach((x, k) => { c.panes[k] = { sym: x.s, tf: c.linkTf ? S.set.tf : c.panes[k].tf }; });
  if (MC_LAYOUTS[c.layout].n < 2) c.layout = '4';
  mcBuild(); save();
  toast('Filled with related instruments', ranked.slice(0, MC_LAYOUTS[c.layout].n - 1).map(x => `${pretty(x.s)} ${x.r >= 0 ? '+' : ''}${x.r.toFixed(2)}`).join(' · '), 'info');
}
function mcOnMainTf(tf) {
  const c = mcCfg(); if (!c.linkTf) return;
  MC.panes.forEach(p => { p.cfg.tf = tf; p.el.querySelectorAll('.mc-tf button').forEach(b => b.classList.toggle('on', +b.dataset.tf === tf)); mcFull(p, true); });
}
function mcTheme() {
  const col = chartColors();
  MC.panes.forEach(p => {
    p.chart.applyOptions({ ...chartOpts(col), layout: { ...chartOpts(col).layout, attributionLogo: false }, rightPriceScale: { borderColor: col.grid, minimumWidth: 64 } });
    p.candle.applyOptions({ upColor: col.up, downColor: col.dn, wickUpColor: col.up, wickDownColor: col.dn }); p.e20.applyOptions({ color: col.ind1 });
    p.sig = ''; mcLines(p);
  });
}
function mcInd() { MC.panes.forEach(p => { p.e20.applyOptions({ visible: !!S.set.ind.ema20 }); p.e50.applyOptions({ visible: !!S.set.ind.ema50 }); }); }

function initMC() {
  const grid = $('#mcGrid');
  // desktop: the multi-chart options are a section of the layout menu in the chart header; phone: their own button,
  // the menu lives in <body>, placed under it (inside the toolbar its mask and overflow would clip it)
  const optsHome = () => { const desk = !document.body.classList.contains('mnav-on'), host = desk ? $('.lay-pop') : document.body, o = $('#mcOpts'); if (host && o.parentElement !== host) host.appendChild(o); };
  const mcPop = open => {
    optsHome();
    if (!document.body.classList.contains('mnav-on')) { if (!open && $('#layDD.open')) $('#layBtn').click(); return; }
    const o = $('#mcOpts'); o.hidden = !open; $('#mcMore').setAttribute('aria-expanded', open);
    if (open) { const r = $('#mcMore').getBoundingClientRect(); o.style.top = r.bottom + 4 + 'px'; o.style.left = Math.max(6, Math.min(innerWidth - o.offsetWidth - 6, r.right - o.offsetWidth)) + 'px'; }
  };
  window.mcPop = mcPop; optsHome(); addEventListener('resize', optsHome);
  $('#mcMore').addEventListener('click', e => { e.stopPropagation(); mcPop($('#mcOpts').hidden); });
  document.addEventListener('click', e => { if (document.body.classList.contains('mnav-on') && !e.target.closest('#mcMoreWrap, #mcOpts')) mcPop(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') mcPop(false); });
  mcInitSplit();
  $('#mcMainMax').addEventListener('click', () => mcMax('a'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#mcGrid').dataset.max != null) mcMax(null); });
  $('#mcSeg').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (b) setLayout(b.dataset.l); });
  $('#mcOpts').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const c = mcCfg();
    if (b.dataset.o === 'sync') { c.syncX = !c.syncX; b.classList.toggle('on', c.syncX); if (!c.syncX) mcClearX(); toast(`Crosshair sync ${c.syncX ? 'on' : 'off'}`, '', 'info'); }
    if (b.dataset.o === 'link') { c.linkTf = !c.linkTf; b.classList.toggle('on', c.linkTf); if (c.linkTf) mcOnMainTf(S.set.tf); toast(`Timeframe link ${c.linkTf ? 'on' : 'off'}`, c.linkTf ? 'All panes follow the main chart timeframe' : 'Each pane keeps its own timeframe', 'info'); }
    if (b.dataset.o === 'auto') mcAutoFill();
    if (b.dataset.o === 'reset') { c.split = {}; mcApplySplit(); toast('Pane sizes reset', '', 'info'); }
    if (b.dataset.o === 'auto' || b.dataset.o === 'reset') mcPop(false);
    save();
  });
  grid.addEventListener('change', e => {
    const s = e.target.closest('.mc-sym'); if (!s) return; const p = MC.panes[+s.closest('.mc-pane').dataset.i];
    p.cfg.sym = s.value; mcFull(p, true); save();
  });
  grid.addEventListener('click', e => {
    const pe = e.target.closest('.mc-pane'); if (!pe) return; const p = MC.panes[+pe.dataset.i];
    const tb = e.target.closest('.mc-tf button');
    if (tb && tb.classList.contains('on')) { const all = [...pe.querySelectorAll('.mc-tf button')], hid = all.some(b => b !== tb && getComputedStyle(b).display === 'none'); if (!hid) return; const nx = all[(all.indexOf(tb) + 1) % all.length]; nx.click(); return; }
    if (tb && mcCfg().linkTf) { setTF(+tb.dataset.tf); return; }
    if (tb) { p.cfg.tf = +tb.dataset.tf; pe.querySelectorAll('.mc-tf button').forEach(b => b.classList.toggle('on', b === tb)); mcFull(p, true); save(); return; }
    if (e.target.closest('[data-act=swap]')) { mcSwap(p.i); return; }
    if (e.target.closest('[data-act=max]')) { mcMax(String(p.i)); return; }
    const q = e.target.closest('[data-q]');
    if (q) {
      const sym = p.cfg.sym, m = M(sym), qq = Engine.quote(sym), d = q.dataset.q === 'buy' ? 1 : -1, t = S.tk, px = d > 0 ? qq.ask : qq.bid;
      // one-click off (default): only fill in the main ticket for this pane's pair
      if (!S.set.oneClick) { prefillTicket(sym, q.dataset.q, +$('#qLots').value || .01); return; }
      const dv = typeof tkDistFor === 'function' ? tkDistFor(sym) : t; // this pane's instrument, not the ticket's
      openPosition({ sym, side: q.dataset.q, lots: +$('#qLots').value || .01, sl: t.useSL ? px - d * dv.sl * m.pip : null, tp: t.useTP ? px + d * dv.tp * m.pip : null, trail: t.useTrail ? dv.trail : 0 });
    }
  });
  // main chart broadcasts when hovered
  $('#chart').addEventListener('pointerenter', () => MC.lock = 'main');
  $('#chart').addEventListener('pointerdown', () => MC.lock = 'main');
  $('#chart').addEventListener('pointerleave', e => { if (e.pointerType === 'touch') return; if (MC.lock === 'main') { MC.lock = null; mcClearX(); } });
  chart.subscribeCrosshairMove(prm => { if (MC.lock !== 'main' || !MC.panes.length) return; if (prm.time) mcBroadcast(prm.time, null); else mcClearX(); });
  const c = mcCfg();
  $('#mcOpts [data-o=sync]').classList.toggle('on', c.syncX); $('#mcOpts [data-o=link]').classList.toggle('on', c.linkTf);
  mcBuild();
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() === 'g') { const ks = ['1', '2h', '2v', '3', '4'], cur = ks.indexOf(mcCfg().layout); setLayout(ks[(cur + (e.shiftKey ? ks.length - 1 : 1)) % ks.length]); }
  });
}
