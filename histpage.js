'use strict';
/* tradeBerry — back-paging of a chart into the broker platform's history (spec istoric-la-cerere). With fewer than HP_EDGE
   candles left of the view, the pager asks liveRange (livefeed.js) for the server window just before the oldest candle
   drawn (1-minute bars below 1H, 1-hour bars from 1H on) and hands the chart candles already at its timeframe. They live
   in the pager's buffer only, never in the engine: the chart draws older(t0) + Engine.aggregate. One pager per chart.
   States: idle | loading | failed (Retry; nothing is asked until then) | start (the platform has nothing older) |
   limit (the buffer cap: a higher timeframe reaches further), each
   with its label at the chart's left edge. getKey() → { sym, tf } or null (paging off). */
const HP_EDGE = 30, HP_WIN = { 1: 604800, 60: 31536000 }, HP_CAP = tf => (tf >= 60 ? 40000 : 20000);
// 1-minute or 1-hour bars into tf-minute candles: the buckets of Engine.aggregate
function hpAgg(src, tf) {
  const step = tf * 60, out = [];
  for (const c of src) {
    const b = Math.floor(c.time / step) * step, last = out[out.length - 1];
    if (!last || last.time !== b) out.push({ time: b, open: c.open, high: c.high, low: c.low, close: c.close });
    else { if (c.high > last.high) last.high = c.high; if (c.low < last.low) last.low = c.low; last.close = c.close; }
  }
  return out;
}
const hpLb = (a, t) => { let l = 0, h = a.length; while (l < h) { const m = (l + h) >> 1; if (a[m].time < t) l = m + 1; else h = m; } return l; };
function makePager({ host, getKey, onOlder }) {
  // buf holds the candles of [lo, hi): every server window of that span was read; hi = the first candle the chart keeps
  // of its own. glued: the chart last drew buf joined to its own candles (no seam gap), so those candles can close the next.
  let ks = '', key = null, buf = [], lo = 0, hi = 0, state = 'idle', ctl = null, near = false, again = null, shown = '', glued = true, seamFail = false;
  const kstr = k => (k ? k.sym + '|' + k.tf : '');
  const lbl = document.createElement('div');
  lbl.className = 'hp-lbl mono'; lbl.hidden = true; lbl.setAttribute('role', 'status');
  host.appendChild(lbl);
  lbl.addEventListener('click', e => { if (e.target.closest('button')) retry(); });
  const TXT = { loading: 'Loading older prices…', failed: 'Older prices unavailable', start: 'Start of platform history', limit: 'Chart limit reached — use a higher timeframe for older prices' };
  function show() {
    // a failed seam shows wherever the view is: the older candles stop short of the chart's own until Retry
    const s = (state === 'loading' || (near && state !== 'idle') || (state === 'failed' && seamFail)) ? state : '';
    if (s === shown) return;
    shown = s; lbl.hidden = !s; lbl.dataset.st = s;
    lbl.innerHTML = s ? `<span>${TXT[s]}</span>` + (s === 'failed' ? '<button type="button">Retry</button>' : '') : '';
  }
  function drop() { if (ctl) ctl.abort(); ctl = null; buf = []; lo = hi = 0; state = 'idle'; again = null; glued = true; seamFail = false; show(); }
  // over the cap the oldest go and paging stops, said by the label (the buffer must join the chart's own candles, so it
  // cannot slide); a new instrument or timeframe starts again
  function capBuf(tf) { const cap = HP_CAP(tf); if (buf.length <= cap) return false; buf.splice(0, buf.length - cap); lo = buf[0].time; state = 'limit'; return true; }
  // a new instrument, timeframe or paging switched off: the buffer belongs to the old key
  function sync() { const k = getKey(), s = kstr(k); if (s !== ks) { drop(); ks = s; key = k; } return key; }
  // one load at a time; an answer that lands after the key changed (or after an abort) is dropped
  function run(from, to, ok, retryFn) {
    if (ctl) ctl.abort();
    const c = ctl = new AbortController(), k = key, k0 = ks, st0 = state;
    state = 'loading'; show();
    liveRange(k.sym, k.tf >= 60 ? 60 : 1, from, to, { signal: c.signal }).then(r => {
      if (c !== ctl) return;
      ctl = null; state = st0 === 'start' || st0 === 'limit' ? st0 : 'idle'; // closing a seam does not undo the start or the limit
      if (kstr(getKey()) === k0) ok(r, k);
      show();
    }, e => {
      if (c !== ctl || (e && e.name === 'AbortError')) return;
      ctl = null; state = kstr(getKey()) === k0 ? 'failed' : 'idle'; again = retryFn; seamFail = retryFn === fillAgain; show();
    });
  }
  // the server window before lo; an empty one widens to two, so liveRange can tell a gap from the platform's start
  function page(span = 1) {
    const W = HP_WIN[key.tf >= 60 ? 60 : 1], to = lo, from = Math.floor((to - 1) / W) * W - (span - 1) * W;
    run(from, to, (r, k) => {
      if (to !== lo) return;
      const nb = hpAgg(r.bars, k.tf).filter(b => b.time < lo);
      if (nb.length || r.start || span >= 3) lo = from;
      if (nb.length) buf = nb.concat(buf);
      const capped = capBuf(k.tf);
      if (r.start && !capped) state = 'start';
      else if (!nb.length && !r.start && span < 3) return page(span + 1);
      if (nb.length) onOlder(nb);
    }, () => page(span));
  }
  // candles between the buffer and the chart's own first one that the chart can no longer give: asked again before gluing
  let fillArgs = null;
  const fillAgain = () => { if (fillArgs && hi === fillArgs[0]) fill(...fillArgs); };
  function fill(a, b) {
    fillArgs = [a, b];
    run(a, b, (r, k) => {
      if (hi !== a) return;
      const nb = hpAgg(r.bars, k.tf).filter(x => x.time >= a && x.time < b);
      buf = buf.concat(nb); hi = b; capBuf(k.tf);
      onOlder(nb);
    }, fillAgain);
  }
  /* older(t0, cur): the buffer cut to before t0 (the first candle the chart keeps of its own), to draw in front of it.
     A gap up to t0 is closed from cur (the candles the chart drew last, same key, joined) or asked from the platform;
     until then the buffer is drawn up to its own end and the chart keeps its own candles. */
  function older(t0, cur) {
    if (t0 === undefined) return buf;
    if (!sync() || !(t0 > 0)) return [];
    if (!buf.length) { if (!ctl) lo = hi = t0; glued = true; return buf; }
    if (t0 <= buf[0].time) { buf = []; lo = hi = t0; glued = true; return buf; }
    if (t0 < hi) { buf = buf.slice(0, hpLb(buf, t0)); hi = t0; }
    else if (t0 > hi) {
      if (glued && cur && cur.length && cur[0].time <= hi) { buf = buf.concat(cur.slice(hpLb(cur, hi), hpLb(cur, t0)).map(b => ({ ...b }))); hi = t0; if (capBuf(key.tf)) show(); }
      else { glued = false; if (!ctl && state !== 'failed') fill(hi, t0); return buf; }
    }
    glued = true;
    return buf;
  }
  function maybeLoad(range) {
    if (range) near = range.from < HP_EDGE;
    const k = getKey();
    if (k && kstr(k) === ks && near && state === 'idle' && lo > 0) page(1);
    show();
  }
  function retry() { if (state !== 'failed' || !key) return; const f = again || (() => page(1)); again = null; seamFail = false; state = 'idle'; f(); show(); }
  function reset() { drop(); ks = ''; key = null; }
  return { older, maybeLoad, retry, reset, get state() { return state; } };
}
