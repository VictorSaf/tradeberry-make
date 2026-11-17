'use strict';
/* tradeBerry — Intrinsic-time candles for the main chart. A new candle starts each time price makes a
   directional change of δ from its last extreme, or extends δ further in the current direction
   (directional-change + overshoot events, Glattfelder, Dupuis & Olsen 2011). Busy markets print many
   candles, quiet markets few: the x-axis becomes event time instead of clock time. */

const ITC = { st: null, off: 0 };
const IT_DELTA = { 1: .0002, 5: .0004, 15: .0008, 60: .0015, 240: .003 };
const itDelta = () => IT_DELTA[S.set.tf] || .0008;
function itStep(st, k) {
  const p = k.close;
  if (!st.cur) st.cur = { time: k.time, open: st.ref, high: Math.max(st.ref, k.high), low: Math.min(st.ref, k.low), close: p };
  else { const c = st.cur; if (k.high > c.high) c.high = k.high; if (k.low < c.low) c.low = k.low; c.close = p; }
  let ev = false;
  if (st.mode > 0) {
    if (p > st.ext) st.ext = p;
    if (p <= st.ext * (1 - st.d)) { st.mode = -1; st.ext = p; ev = 'dc'; }
    else if (p >= st.ref * (1 + st.d)) ev = 'os';
  } else {
    if (p < st.ext) st.ext = p;
    if (p >= st.ext * (1 + st.d)) { st.mode = 1; st.ext = p; ev = 'dc'; }
    else if (p <= st.ref * (1 - st.d)) ev = 'os';
  }
  if (ev) { st.cur.close = p; st.cur.ev = ev; st.bars.push(st.cur); st.cur = null; st.ref = p; }
}
function itBars(sym) {
  const a = Engine.candles[sym], d = itDelta(), st = { sym, d, mode: 1, ext: a[0].close, ref: a[0].close, bars: [], cur: null, lastT: 0 };
  for (let i = 0; i < a.length - 1; i++) { itStep(st, a[i]); st.lastT = a[i].time; }
  ITC.st = st; ITC.off = Math.max(0, st.bars.length - 2200);
  return itView();
}
function itView() {
  const st = ITC.st, a = Engine.candles[st.sym];
  let i = a.length - 1; while (i > 0 && a[i - 1].time > st.lastT) i--;
  for (; i < a.length - 1; i++) if (a[i].time > st.lastT) { itStep(st, a[i]); st.lastT = a[i].time; }
  // the minute still forming is applied to a throw-away copy
  const tmp = { ...st, cur: st.cur ? { ...st.cur } : null, bars: [] }; itStep(tmp, a[a.length - 1]);
  return st.bars.slice(ITC.off).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })).concat(tmp.bars, tmp.cur ? [tmp.cur] : []).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
}
function itChartTick() {
  if (!ITC.st || ITC.st.sym !== S.set.sym || ITC.st.d !== itDelta()) return fullChart(false);
  const nb = itView(), n = bars.length;
  if (nb.length < n || !n || nb[0].time !== bars[0].time) return fullChart(false);
  for (let i = n - 1; i < nb.length; i++) {
    bars[i] = nb[i]; computeIndAt(i); disp[i] = { ...nb[i] }; pushLastPoints(i);
  }
  if (nb.length > n) dirty.markers = true;
}
function itLegend() { return S.set.type === 'it' ? `<span class="it-lab" title="Each candle = one move of δ (directional change or overshoot). Timeframe buttons set δ.">Intrinsic δ ${(itDelta() * 100).toFixed(2)}% · ${bars.length} events</span>` : ''; }
