'use strict';
/* tradeBerry — chart drawing tools.
   Trendline, ray, parallel channel, Fibonacci retracement and 3-point Fibonacci extension.
   Anchors are stored as {t: unix time, p: price} so drawings survive timeframe changes.
   Rendered on the shared overlay canvas; selectable, draggable, recolourable, deletable.
   Trendlines and rays can raise an alert when price crosses the projected line. Prices are bids (the chart's price),
   symbols may carry a dot (US.500, AAPL.US): drawings are keyed by the symbol as a plain object key. */

const DRAW_TOOLS = { trend: { n: 2, name: 'Trendline' }, ray: { n: 2, name: 'Ray' }, channel: { n: 3, name: 'Channel' }, fib: { n: 2, name: 'Fib retracement' }, fibx: { n: 3, name: 'Fib extension' } };
const DR_COLORS = ['#e8b04a', '#5aa9ff', '#21c17a', '#f0475c', '#b48cff', '#a3acba'];
const FIB_R = [0, .236, .382, .5, .618, .786, 1];
const FIB_T = [1.272, 1.618];
const FIB_X = [0, .618, 1, 1.272, 1.618, 2, 2.618];
const DR = { creating: null, hover: null, sel: null, drag: null, magnet: true, justDragged: 0 };
const drawings = () => { if (!S.drawings) S.drawings = {}; return (S.drawings[S.set.sym] = S.drawings[S.set.sym] || []); };
const isDrawTool = t => !!DRAW_TOOLS[t];
// the overlay canvas spans every pane of the main chart; R:R zones, the measure box and drawings belong to the
// price pane, so whatever spilled below it (RSI pane, time axis) is wiped after each overlay frame
const drawOverlayPanes = drawOverlay;
drawOverlay = function () {
  drawOverlayPanes();
  const cv = $('#ovl'), h0 = pricePaneH(), dpr = devicePixelRatio || 1; if (!cv || !(h0 * dpr < cv.height)) return;
  const g = cv.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, Math.floor(h0 * dpr), cv.width, cv.height); g.restore();
};

/* ---------- coordinate helpers (time <-> fractional bar index) ---------- */
function tToL(t) {
  const n = bars.length; if (!n) return 0; const step = S.set.tf * 60, last = bars[n - 1];
  if (t >= last.time) return n - 1 + (t - last.time) / step;
  if (t <= bars[0].time) return (t - bars[0].time) / step;
  // inside a market break (no bars) the time sits at the next bar: the chart has no room for a closed market
  const i = barIndexAt(t), nx = bars[i + 1]; return i + Math.min(1, (t - bars[i].time) / (S.set.type === 'it' && nx ? nx.time - bars[i].time : step));
}
function lToT(l) {
  const n = bars.length, step = S.set.tf * 60; if (!n) return Engine.simTime;
  if (l >= n - 1) return bars[n - 1].time + (l - (n - 1)) * step;
  if (l < 0) return bars[0].time + l * step;
  const i = Math.floor(l), nx = bars[i + 1]; return bars[i].time + (l - i) * (S.set.type === 'it' && nx ? nx.time - bars[i].time : step);
}
const XY = pt => { const x = chart.timeScale().logicalToCoordinate(tToL(pt.t)), y = candle.priceToCoordinate(pt.p); return x == null || y == null ? null : { x, y }; };
function evPoint(e) {
  const r = $('#chart').getBoundingClientRect(), cx = (e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e).clientX - r.left, cy = (e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e).clientY - r.top;
  return { cx, cy };
}
function toPoint(cx, cy, snap = DR.magnet) {
  const ts = chart.timeScale(); if (cx > ts.width() || cy > pricePaneH()) return null;
  const l = ts.coordinateToLogical(cx); let p = candle.coordinateToPrice(cy); if (l == null || p == null) return null;
  let lx = l;
  if (snap) {
    const i = Math.round(l);
    if (i >= 0 && i < bars.length) {
      const b = disp[i] || bars[i], best = ['open', 'high', 'low', 'close'].map(k => b[k]).reduce((a, v) => Math.abs(candle.priceToCoordinate(v) - cy) < Math.abs(candle.priceToCoordinate(a) - cy) ? v : a);
      if (Math.abs(candle.priceToCoordinate(best) - cy) < 14) { p = best; lx = i; }
    }
  }
  return { t: lToT(lx), p };
}
/* Price of a line through a, b at time t, linear in trading time: the seconds the instrument's market is open
   (Engine.session), as the chart draws it with its breaks collapsed. A 24/7 instrument is linear in clock time; a
   stock's line stays flat overnight and over the weekend. */
function drOpenSecs(sym, x, y) {
  if (!(y > x)) return y < x ? -drOpenSecs(sym, y, x) : 0;
  const m = M(sym); if (!m || m.is247 || typeof Engine.session !== 'function') return y - x;
  let s = 0, t = x;
  for (let i = 0; i < 1000 && t < y; i++) {
    const ss = Engine.session(sym, t); if (!ss) return y - x;
    if (ss.open) { const e = ss.closesAt == null ? y : Math.min(y, ss.closesAt); s += e - t; t = e; }
    else if (ss.opensAt == null) break; else t = ss.opensAt;
  }
  return s;
}
// trading seconds from an anchor, cached per (symbol, anchor) and extended forward as time runs (alerts check every tick)
const DR_OT = new Map();
function drSince(sym, t0, t) {
  const k = sym + '|' + t0, c = DR_OT.get(k);
  if (c && t >= c.t) { if (t > c.t) { c.s += drOpenSecs(sym, c.t, t); c.t = t; } return c.s; }
  const s = drOpenSecs(sym, t0, t);
  if (t >= t0) { DR_OT.set(k, { t, s }); if (DR_OT.size > 500) DR_OT.delete(DR_OT.keys().next().value); }
  return s;
}
function lineAt(a, b, t, sym = S.set.sym) {
  if (b.t === a.t) return a.p;
  const span = drSince(sym, a.t, b.t); if (!span) return a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t);
  return a.p + (b.p - a.p) * drSince(sym, a.t, t) / span;
}
// a price move in the instrument's unit: '+15.0 pips' (FX), '+150.0 pt' (a stock at 0.01, an index at its point)
const drMoveText = (sym, dp) => `${sgn(dp / M(sym).pip, 1)} ${unitWord(sym)}`;

/* ---------- geometry for render + hit test ---------- */
function extendTo(a, b, xMax) { // extend segment a->b to the right edge
  if (Math.abs(b.x - a.x) < 1e-6) return b;
  const dir = b.x >= a.x ? 1 : -1, xe = dir > 0 ? xMax : 0, k = (xe - a.x) / (b.x - a.x);
  return { x: xe, y: a.y + (b.y - a.y) * k };
}
function shapes(d, pts, pw) {
  // returns {lines:[{a,b,dash,w,label,alpha}], fills:[[poly]], labels:[{x,y,text,align}], handles:[xy]}
  const out = { lines: [], fills: [], labels: [], handles: [] }, P = pts.map(XY);
  if (P.some(p => !p)) return out;
  out.handles = P;
  const sym = S.set.sym;
  if (d.type === 'trend' || d.type === 'ray') {
    const ext = d.type === 'ray' || d.ext;
    const end = ext && P[1] ? extendTo(P[0], P[1], pw) : P[1];
    if (!P[1]) return out;
    out.lines.push({ a: P[0], b: end, w: 1.6 });
    if (pts.length === 2) {
      const bars_ = Math.round(tToL(pts[1].t) - tToL(pts[0].t));
      out.labels.push({ x: P[1].x + 6, y: P[1].y - 6, text: `${drMoveText(sym, pts[1].p - pts[0].p)} · ${Math.abs(bars_)} bars${d.alert ? (d.done ? ' · alert fired' : ' · alert on') : ''}`, small: true });
    }
  } else if (d.type === 'channel') {
    if (!P[1]) return out;
    const e1 = d.ext ? extendTo(P[0], P[1], pw) : P[1];
    out.lines.push({ a: P[0], b: e1, w: 1.6 });
    if (P[2]) {
      const off = pts[2].p - lineAt(pts[0], pts[1], pts[2].t, sym), q0 = XY({ t: pts[0].t, p: pts[0].p + off }), q1 = XY({ t: pts[1].t, p: pts[1].p + off });
      const m0 = XY({ t: pts[0].t, p: pts[0].p + off / 2 }), m1 = XY({ t: pts[1].t, p: pts[1].p + off / 2 });
      if (q0 && q1 && m0 && m1) {
        const e2 = d.ext ? extendTo(q0, q1, pw) : q1, em = d.ext ? extendTo(m0, m1, pw) : m1;
        out.lines.push({ a: q0, b: e2, w: 1.6 }, { a: m0, b: em, w: 1, dash: [4, 4], alpha: .7 });
        out.fills.push([P[0], e1, e2, q0]);
      }
    }
  } else if (d.type === 'fib') {
    if (!P[1]) return out;
    const a = pts[0], b = pts[1], x0 = Math.min(P[0].x, P[1].x), x1 = d.ext ? pw : Math.max(P[0].x, P[1].x);
    out.lines.push({ a: P[0], b: P[1], w: 1, dash: [3, 4], alpha: .6 });
    const lv = FIB_R.map(r => ({ r, p: b.p - (b.p - a.p) * r, text: `${(r * 100).toFixed(1).replace('.0', '')}%` }))
      .concat(d.targets !== false ? FIB_T.map(k => ({ r: k, p: a.p + (b.p - a.p) * k, text: `${(k * 100).toFixed(1)}% target`, target: true })) : []);
    lv.forEach((L, i) => {
      const y = candle.priceToCoordinate(L.p); if (y == null) return;
      out.lines.push({ a: { x: x0, y }, b: { x: x1, y }, w: L.r === .618 || L.r === .5 ? 1.4 : 1, alpha: L.target ? .75 : L.r === 0 || L.r === 1 ? .9 : .7, dash: L.target ? [6, 3] : null });
      out.labels.push({ x: x0 + 4, y: y - 3, text: `${L.text}  ${fp(sym, L.p)}`, small: true });
    });
    for (let i = 0; i < FIB_R.length - 1; i++) {
      const ya = candle.priceToCoordinate(lv[i].p), yb = candle.priceToCoordinate(lv[i + 1].p);
      if (ya != null && yb != null && (i === 3 || i === 4)) out.fills.push([{ x: x0, y: ya }, { x: x1, y: ya }, { x: x1, y: yb }, { x: x0, y: yb }]); // golden zone 50–78.6
    }
  } else if (d.type === 'fibx') {
    if (P[1]) out.lines.push({ a: P[0], b: P[1], w: 1, dash: [3, 4], alpha: .7 });
    if (P[2]) {
      out.lines.push({ a: P[1], b: P[2], w: 1, dash: [3, 4], alpha: .7 });
      const A = pts[0], B = pts[1], C = pts[2], x0 = P[2].x, x1 = d.ext ? pw : x0 + Math.max(40, Math.abs(P[1].x - P[0].x));
      FIB_X.forEach(k => {
        const p = C.p + (B.p - A.p) * k, y = candle.priceToCoordinate(p); if (y == null) return;
        out.lines.push({ a: { x: x0, y }, b: { x: x1, y }, w: k === 1 || k === 1.618 ? 1.4 : 1, alpha: .8 });
        out.labels.push({ x: x0 + 4, y: y - 3, text: `${(k * 100).toFixed(1).replace('.0', '')}%  ${fp(sym, p)}`, small: true });
      });
    }
  }
  return out;
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function drawDrawings(g, pw, ph) {
  const list = drawings().slice();
  if (DR.creating) {
    const pts = DR.creating.pts.concat(DR.hover ? [DR.hover] : []);
    if (pts.length) list.push({ ...DR.creating, pts, _preview: true });
  }
  for (const d of list) {
    const sh = shapes(d, d.pts, pw), col = d.color || DR_COLORS[0], sel = DR.sel === d.id;
    for (const f of sh.fills) { g.beginPath(); f.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fillStyle = hexA(col, d.type === 'fib' ? .07 : .08); g.fill(); }
    for (const L of sh.lines) {
      g.beginPath(); g.moveTo(L.a.x, L.a.y); g.lineTo(L.b.x, L.b.y);
      g.strokeStyle = hexA(col, (L.alpha ?? 1) * (d._preview ? .75 : 1)); g.lineWidth = (L.w || 1.4) + (sel ? .8 : 0); g.setLineDash(L.dash || []); g.stroke(); g.setLineDash([]);
    }
    g.font = '500 10.5px JetBrains Mono';
    for (const lb of sh.labels) {
      if (lb.small && !sel && !d._preview && (d.type === 'trend' || d.type === 'ray')) continue; // trend labels only when selected
      const tw = g.measureText(lb.text).width;
      g.fillStyle = hexA('#0a0d11', .55); if (document.documentElement.dataset.theme === 'light') g.fillStyle = 'rgba(255,255,255,.7)';
      g.fillRect(lb.x - 2, lb.y - 10, tw + 4, 13);
      g.fillStyle = col; g.fillText(lb.text, lb.x, lb.y);
    }
    if (d.alert && !d.done && (d.type === 'trend' || d.type === 'ray') && sh.handles[1]) {
      const h = sh.handles[1]; g.fillStyle = col; g.beginPath(); g.arc(h.x, h.y - 12, 3.5, 0, Math.PI * 2); g.fill();
    }
    if (sel || d._preview) for (const h of sh.handles) { g.beginPath(); g.arc(h.x, h.y, 4.5, 0, Math.PI * 2); g.fillStyle = cssv('--s1'); g.fill(); g.lineWidth = 1.6; g.strokeStyle = col; g.stroke(); }
  }
}

/* ---------- hit testing ---------- */
function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0; t = clamp(t, 0, 1); return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }
function hitDrawing(cx, cy) {
  if (cy > pricePaneH()) return null; // drawings live in the price pane, not the RSI pane below
  const pw = chart.timeScale().width(), p = { x: cx, y: cy }, list = drawings();
  // handles of the selected drawing first
  const sd = list.find(d => d.id === DR.sel);
  if (sd) { const sh = shapes(sd, sd.pts, pw); const hi = sh.handles.findIndex(h => Math.hypot(h.x - cx, h.y - cy) < 9); if (hi >= 0) return { d: sd, handle: hi }; }
  for (let k = list.length - 1; k >= 0; k--) {
    const d = list[k], sh = shapes(d, d.pts, pw);
    const hi = sh.handles.findIndex(h => Math.hypot(h.x - cx, h.y - cy) < 8); if (hi >= 0) return { d, handle: hi };
    if (sh.lines.some(L => segDist(p, L.a, L.b) < 6)) return { d, handle: -1 };
  }
  return null;
}

/* ---------- selection toolbar ---------- */
function renderDrawBar() {
  const bar = $('#drawBar'), d = drawings().find(x => x.id === DR.sel);
  if (!d) { bar.hidden = true; return; }
  bar.hidden = false;
  const canAlert = d.type === 'trend' || d.type === 'ray', canExt = d.type !== 'ray';
  bar.innerHTML = `<span class="db-name">${DRAW_TOOLS[d.type].name}</span>
    <span class="db-sw">${DR_COLORS.map(c => `<button data-col="${c}" style="background:${c}" class="${c === d.color ? 'on' : ''}" aria-label="Colour"></button>`).join('')}</span>
    ${canExt ? `<button class="db-b ${d.ext ? 'on' : ''}" data-act="ext" title="Extend to the right">Extend</button>` : ''}
    ${d.type === 'fib' ? `<button class="db-b ${d.targets !== false ? 'on' : ''}" data-act="targets" title="127.2% / 161.8% targets">Targets</button>` : ''}
    ${canAlert ? `<button class="db-b ${d.alert && !d.done ? 'on' : ''}" data-act="alert" title="Alert when price crosses this line (projected forward)">${d.done ? 'Re-arm alert' : 'Alert'}</button>` : ''}
    <button class="db-b" data-act="clone" title="Duplicate">Clone</button>
    <button class="db-b x" data-act="del" title="Delete (Del)">Delete</button>`;
}
function selectDrawing(id) { DR.sel = id; renderDrawBar(); reqOverlay(); }
function deleteSelected() { const l = drawings(), i = l.findIndex(d => d.id === DR.sel); if (i < 0) return; l.splice(i, 1); DR.sel = null; renderDrawBar(); reqOverlay(); save(); toast('Drawing deleted', '', 'info'); }

/* ---------- create / drag ---------- */
function startDrawTool(t) {
  DR.creating = { type: t, pts: [], color: t.startsWith('fib') ? '#e8b04a' : t === 'channel' ? '#5aa9ff' : '#e8b04a', ext: t === 'fib' || t === 'fibx' || t === 'channel' };
  DR.hover = null; selectDrawing(null);
  $('#toolHint').textContent = `${DRAW_TOOLS[t].name}: click point 1 of ${DRAW_TOOLS[t].n} · Esc to cancel`;
}
function drawClick(e) {
  if (!isDrawTool(tool)) return false;
  const { cx, cy } = evPoint(e), pt = toPoint(cx, cy); if (!pt) return true;
  const c = DR.creating || (startDrawTool(tool), DR.creating);
  c.pts.push(pt);
  const need = DRAW_TOOLS[c.type].n;
  if (c.pts.length >= need) {
    const d = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: c.type, pts: c.pts, color: c.color, ext: c.ext, targets: true };
    if (d.type === 'trend' || d.type === 'ray') d.side = Math.sign(Engine.quote(S.set.sym).bid - lineAt(d.pts[0], d.pts[1], Engine.simTime, S.set.sym));
    drawings().push(d); DR.creating = null; DR.hover = null;
    const keep = e.shiftKey; const t = tool;
    setTool(null); if (keep) setTool(t);
    selectDrawing(d.id); save();
  } else $('#toolHint').textContent = `${DRAW_TOOLS[c.type].name}: click point ${c.pts.length + 1} of ${need} · Esc to cancel`;
  reqOverlay();
  return true;
}
function initDraw() {
  const el = $('#chart');
  chart.subscribeCrosshairMove(p => { if (DR.creating && p.point) { DR.hover = toPoint(p.point.x, p.point.y); reqOverlay(); } });
  const down = e => {
    if (tool || drag || DR.creating) return;
    if (e.button != null && e.button !== 0) return;
    const { cx, cy } = evPoint(e), h = hitDrawing(cx, cy); if (!h) return;
    e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
    selectDrawing(h.d.id);
    const l0 = chart.timeScale().coordinateToLogical(cx), p0 = candle.coordinateToPrice(cy);
    DR.drag = { d: h.d, handle: h.handle, l0, p0, orig: h.d.pts.map(p => ({ ...p })), moved: false };
  };
  const move = e => {
    if (!DR.drag) {
      if (!e.touches && !tool) { const { cx, cy } = evPoint(e); const h = hitDrawing(cx, cy); el.classList.toggle('draw-hover', !!h); el.classList.toggle('draw-handle', !!(h && h.handle >= 0)); }
      return;
    }
    if (e.cancelable) e.preventDefault();
    const { cx, cy } = evPoint(e), D = DR.drag; D.moved = true;
    if (D.handle >= 0) { const pt = toPoint(cx, cy, DR.magnet && !e.altKey); if (pt) D.d.pts[D.handle] = pt; }
    else {
      const l = chart.timeScale().coordinateToLogical(cx), p = candle.coordinateToPrice(cy); if (l == null || p == null) return;
      const dl = l - D.l0, dp = p - D.p0;
      D.d.pts = D.orig.map(o => ({ t: lToT(tToL(o.t) + dl), p: o.p + dp }));
    }
    if (D.d.type === 'trend' || D.d.type === 'ray') D.d.side = Math.sign(Engine.quote(S.set.sym).bid - lineAt(D.d.pts[0], D.d.pts[1], Engine.simTime, S.set.sym));
    reqOverlay();
  };
  const up = () => { if (!DR.drag) return; if (DR.drag.moved) { DR.justDragged = performance.now(); save(); } DR.drag = null; };
  el.addEventListener('mousedown', down, true); el.addEventListener('touchstart', down, { capture: true, passive: false });
  el.addEventListener('mousemove', move, true);
  window.addEventListener('mousemove', e => DR.drag && move(e)); window.addEventListener('touchmove', e => DR.drag && move(e), { passive: false });
  window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
  el.addEventListener('click', e => {
    if (drawClick(e)) return;
    if (tool) return;
    if (performance.now() - DR.justDragged < 250) return;
    const { cx, cy } = evPoint(e), h = hitDrawing(cx, cy);
    if (h) selectDrawing(h.d.id); else if (DR.sel) selectDrawing(null);
  });
  $('#drawSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'magnet') { DR.magnet = !DR.magnet; b.classList.toggle('on', DR.magnet); toast(`Magnet ${DR.magnet ? 'on' : 'off'}`, DR.magnet ? 'Points snap to candle open/high/low/close' : 'Free placement', 'info'); return; }
    const t = b.dataset.tool; setTool(tool === t ? null : t);
  });
  $('#drawBar').addEventListener('click', e => {
    const d = drawings().find(x => x.id === DR.sel); if (!d) return;
    const c = e.target.closest('[data-col]'); if (c) { d.color = c.dataset.col; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'ext') d.ext = !d.ext;
    if (a === 'targets') d.targets = d.targets === false;
    if (a === 'alert') {
      if (d.done) { d.done = false; d.alert = true; } else d.alert = !d.alert;
      d.side = Math.sign(Engine.quote(S.set.sym).bid - lineAt(d.pts[0], d.pts[1], Engine.simTime, S.set.sym));
      toast(d.alert ? 'Trendline alert armed' : 'Trendline alert off', d.alert ? `Fires when ${pretty(S.set.sym)} crosses the line (now ${fp(S.set.sym, lineAt(d.pts[0], d.pts[1], Engine.simTime, S.set.sym))})` : '', 'info');
    }
    if (a === 'clone') { const step = S.set.tf * 60 * 5, nd = { ...JSON.parse(JSON.stringify(d)), id: 'd' + Date.now().toString(36), alert: false, done: false }; nd.pts = nd.pts.map(p => ({ t: p.t + step, p: p.p })); drawings().push(nd); DR.sel = nd.id; }
    if (a === 'del') { deleteSelected(); return; }
    renderDrawBar(); reqOverlay(); save();
  });
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') { if (DR.creating) { DR.creating = null; DR.hover = null; reqOverlay(); } else if (DR.sel) selectDrawing(null); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && DR.sel) { e.preventDefault(); deleteSelected(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() === 'l' && !e.shiftKey) setTool(tool === 'trend' ? null : 'trend');
    if (e.key.toLowerCase() === 'f' && !e.shiftKey) setTool(tool === 'fib' ? null : 'fib');
  });
}
// called from setTool
function onToolChange(t) {
  $$('#drawSeg [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (isDrawTool(t)) startDrawTool(t);
  else if (DR.creating) { DR.creating = null; DR.hover = null; reqOverlay(); }
}
// trendline alerts — checked every tick across all symbols, on the bid, only while the instrument quotes (a closed
// market has no price to cross the line with; a gap at the reopening that jumps the line fires once)
const drArmed = d => d.alert && !d.done && (d.type === 'trend' || d.type === 'ray');
function checkDrawAlerts() {
  if (!S.drawings) return;
  for (const [sym, list] of Object.entries(S.drawings)) {
    if (!Array.isArray(list) || !list.some(drArmed) || !M(sym)) continue; // quoting a symbol keeps it simulated: only armed ones
    const q = Engine.quote(sym); if (!q || !q.open) continue;
    const px = q.bid;
    for (const d of list) {
      if (!drArmed(d)) continue;
      const lp = lineAt(d.pts[0], d.pts[1], Engine.simTime, sym), side = Math.sign(px - lp);
      if (d.side && side && side !== d.side) {
        d.done = true;
        toast(`Trendline alert · ${pretty(sym)}`, `Price crossed ${side > 0 ? 'above' : 'below'} the line at ${fp(sym, lp)}`, 'info'); beep('alert');
        if (sym === S.set.sym) { renderDrawBar(); reqOverlay(); }
        save();
      }
      if (side) d.side = side;
    }
  }
}
