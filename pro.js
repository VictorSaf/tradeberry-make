'use strict';
/* tradeBerry — pro layer: chart overlay (R:R zones, measure tool), depth-of-market ladder,
   watchlist sparklines, trade coach, account export/import. */

/* ============ chart overlay ============ */
let measure = null; // {a:{l,price}, b:{l,price}, live}
let ovlRaf = 0;
const reqOverlay = () => { if (!ovlRaf) ovlRaf = requestAnimationFrame(() => { ovlRaf = 0; drawOverlay(); }); };
function barIndexAt(t) {
  const step = S.set.tf * 60, b = S.set.type === 'it' ? t : Math.floor(t / step) * step;
  let lo = 0, hi = bars.length - 1;
  if (!bars.length) return 0;
  if (b <= bars[0].time) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].time <= b) lo = m; else hi = m - 1; }
  return lo;
}
function drawOverlay() {
  const cv = $('#ovl'), el = $('#chart'); if (!cv || !chart) return;
  const w = el.clientWidth, h = el.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const ts = chart.timeScale(), pw = ts.width(), ph = h - ts.height();
  if (!(pw > 0 && ph > 0)) return;
  g.save(); g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
  const c = chartColors(), sym = S.set.sym, Y = p => candle.priceToCoordinate(p);
  const band = (x0, y0, y1, col, a) => { if (y0 == null || y1 == null) return; g.fillStyle = col + a; g.fillRect(x0, Math.min(y0, y1), pw - x0, Math.abs(y1 - y0)); };
  if (S.set.ind.zones !== false) {
    for (const p of S.positions) {
      if (p.sym !== sym) continue;
      const x0 = Math.max(0, ts.logicalToCoordinate(barIndexAt(p.open)) ?? 0), ye = Y(p.entry);
      if (p.sl != null) band(x0, ye, Y(p.sl), c.dn, '33');
      if (p.tp != null) band(x0, ye, Y(p.tp), c.up, '33');
    }
    // the next order's zones only while the user works in the ticket (UX 09.11 F7: ticket.js tkPreviewActive)
    const preview = typeof tkPreviewActive !== 'function' || tkPreviewActive();
    const k = preview ? tkCalc() : { sl: null, tp: null }, lastX = ts.logicalToCoordinate(bars.length - 1) ?? pw;
    const x0 = clamp(lastX - 70, 0, pw - 40), ye = Y(k.entry);
    if (k.sl != null) band(x0, ye, Y(k.sl), c.dn, '24');
    if (k.tp != null) band(x0, ye, Y(k.tp), c.up, '24');
    if (k.sl != null && k.tp != null && ye != null) {
      const rr = k.rewUsd / k.riskUsd, yt = Y(k.tp);
      const label = Number.isFinite(rr) ? `1 : ${rr.toFixed(2)}` : '1 : —'; // never NaN (UX F13)
      g.font = '600 10.5px JetBrains Mono'; const tw = g.measureText(label).width;
      const ly = clamp((ye + yt) / 2, 10, ph - 10);
      const lx = Math.max(2, x0 - tw - 16);
      g.fillStyle = c.bg + 'e6'; g.strokeStyle = c.up + '88'; g.lineWidth = 1; g.fillRect(lx, ly - 9, tw + 10, 17); g.strokeRect(lx + .5, ly - 8.5, tw + 9, 16);
      g.fillStyle = c.up; g.fillText(label, lx + 5, ly + 4);
    }
  }
  if (typeof drawDrawings === 'function') drawDrawings(g, pw, ph);
  // a closed market is stated in the chart legend (chart.js legend()), not painted here over the OHLC readout
  if (measure) {
    const xa = ts.logicalToCoordinate(measure.a.l), xb = ts.logicalToCoordinate(measure.b.l), ya = Y(measure.a.price), yb = Y(measure.b.price);
    if (xa != null && xb != null && ya != null && yb != null) {
      const up = measure.b.price >= measure.a.price, col = up ? c.up : c.dn;
      g.fillStyle = col + '22'; g.strokeStyle = col; g.lineWidth = 1;
      g.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
      g.setLineDash([4, 3]); g.strokeRect(Math.min(xa, xb) + .5, Math.min(ya, yb) + .5, Math.abs(xb - xa), Math.abs(yb - ya)); g.setLineDash([]);
      g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
      const lines = measureText(sym, measure.a.price, measure.b.price, Math.round(measure.b.l - measure.a.l));
      g.font = '600 11px JetBrains Mono';
      const bw = Math.max(...lines.map(s => g.measureText(s).width)) + 16, bh = 56;
      let bx = xb + 10, by = yb + (up ? -bh - 6 : 6);
      bx = clamp(bx, 4, pw - bw - 4); by = clamp(by, 4, ph - bh - 4);
      g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, bh, 6) : g.rect(bx, by, bw, bh); g.fill();
      g.fillStyle = '#fff'; lines.forEach((s, i) => { g.font = (i ? '500 ' : '700 ') + '11px JetBrains Mono'; g.fillText(s, bx + 8, by + 17 + i * 16); });
    }
  }
  g.restore();
}
// the measure tool's label: the move in the instrument's unit (pips / pt), bars and time, money per lot (per share)
function measureText(sym, a, b, nb) {
  const m = M(sym), d = b - a, pips = d / m.pip, n = Math.abs(nb), mins = n * S.set.tf;
  const dur = mins >= 1440 ? `${(mins / 1440).toFixed(1)}d` : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return [`${sgn(pips, 1)} ${unitWord(sym)}  ${pct(d / a * 100, 3)}`, `${n} bar${n === 1 ? '' : 's'} · ${dur}`, `${usdFmt(pips * pipValue(sym, 1), true)} per ${m.lotName === 'shares' ? 'share' : 'lot'}`];
}
// '' while the instrument quotes, else 'Market closed — opens …' / 'Off quotes — …' (trade.js marketWhy)
// the closed / off-quotes state of a symbol in words, for the chart legend and the multi-chart panes
const ovlSessionText = sym => (M(sym) && marketWhy(sym)) || '';
function measurePoint(param) {
  if (!param.point) return null;
  const price = candle.coordinateToPrice(param.point.y), l = chart.timeScale().coordinateToLogical(param.point.x);
  return price == null || l == null ? null : { l: Math.round(l), price };
}
function initOverlay() {
  chart.timeScale().subscribeVisibleLogicalRangeChange(reqOverlay);
  chart.subscribeCrosshairMove(p => { if (measure?.live && p.point) { const q = measurePoint(p); if (q) { measure.b = q; reqOverlay(); } } });
  new ResizeObserver(reqOverlay).observe($('#chart'));
  $('#chart').addEventListener('wheel', reqOverlay, { passive: true });
  $('#chart').addEventListener('click', e => {
    if (tool !== 'measure') return;
    const r = $('#chart').getBoundingClientRect();
    measureClick({ point: { x: e.clientX - r.left, y: e.clientY - r.top } });
  });
}
// returns true if the click was consumed
function overlayClick(param) {
  if (tool === 'measure' || (typeof isDrawTool === 'function' && isDrawTool(tool))) return true; // handled by native click for reliability
  if (!tool && measure && !measure.live && performance.now() - (measure.done || 0) > 400) { measure = null; reqOverlay(); }
  return false;
}
function measureClick(param) {
  {
    const q = measurePoint(param); if (!q) return true;
    if (!measure || !measure.live) { measure = { a: q, b: q, live: true }; $('#toolHint').textContent = 'Click again to finish measuring · Esc to cancel'; }
    else { measure.b = q; measure.live = false; measure.done = performance.now(); setTool(null); }
    reqOverlay(); return true;
  }
}

/* ============ depth of market ============ */
const DOM_N = 14;
let domStep = 1, domBuilt = false, domFor = '';
/* The ladder's base step: one displayed unit (pip / point) scaled to the sheet's default spread, so the levels are not
   one platform point apart when the spread is hundreds of them (US.500 300 pt → 1.00, GOLD 225 pt → 1.00, BTCUSD
   32,000 pt → 100.00, EURUSD 1.2 pips → 1 pip). The step buttons multiply it. */
const domBase = sym => { const m = M(sym), sp = m.p.spread[0] * m.point / m.pip; return m.pip * 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, sp)) + 1e-9)); };
// the step buttons in the instrument's terms: 1p/5p/10p on FX at one pip, else the price step (1.00 / 5.00 / 10.00)
function domStepLabels(sym) {
  const m = M(sym), base = domBase(sym), fx = m.unit !== 'pt' && Math.abs(base - m.pip) < m.pip / 1e6;
  for (const b of $$('#domStep button')) {
    const st = +b.dataset.st, px = st * base, u = Math.round(px / m.pip);
    b.textContent = fx ? `${st}p` : px.toFixed(m.digits);
    b.title = `Ladder step ${nf0.format(u)} ${m.unit === 'pt' ? 'pt' : u === 1 ? 'pip' : 'pips'} (${px.toFixed(m.digits)})`;
  }
}
function buildDom() {
  const rows = [];
  for (let i = 0; i < DOM_N * 2 + 1; i++) {
    rows.push(i === DOM_N
      ? `<div class="dom-row mid" data-i="${i}"><span class="spr mono" id="domSpr"></span></div>`
      : `<div class="dom-row ${i < DOM_N ? 'ask' : 'bid'}" data-i="${i}" role="button" tabindex="0"><span class="q bq"><i style="border-radius:var(--r-xs) 0 0 var(--r-xs)"></i><em></em></span><span class="dp mono"></span><span class="q aq"><i style="border-radius:0 var(--r-xs) var(--r-xs) 0"></i><em></em></span><span class="mk"></span></div>`);
  }
  $('#dom').innerHTML = rows.join('');
  // the sizes are drawn for orientation only: the simulated book has no queue and a fill never depends on size (decision 28)
  // it sits in the panel's title band, under the title (styles.css ds-trade)
  if (!$('#domIll')) { const n = document.createElement('div'); n.id = 'domIll'; n.className = 'dom-ill'; n.textContent = 'Illustrative depth — fills ignore size'; const ph = $('#iDom>.ph'); if (ph) ph.appendChild(n); else $('#dom').before(n); }
  domBuilt = true;
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => safe('depth fit', fitDom)).observe($('#dom'));
  fitDom();
}
// show only whole rows: drop outer levels evenly around the spread until the ladder fits its box
// (at least one level per side; the room for more is set by the rail layout in CSS)
function fitDom() {
  const box = $('#dom'), rows = box.children; if (!rows.length) return;
  const show = k => { for (let i = 0; i < rows.length; i++) rows[i].style.display = Math.abs(i - DOM_N) <= k ? '' : 'none'; };
  show(DOM_N);
  if (!box.offsetParent) return;
  let k = DOM_N;
  // 1 px of tolerance on rounded edges: fractional device pixels (tablets at 820 px) must not cost a whole level
  const cut = () => { const b = box.getBoundingClientRect(), t = rows[DOM_N - k].getBoundingClientRect(), u = rows[DOM_N + k].getBoundingClientRect(); return Math.round(t.top) < Math.round(b.top) - 1 || Math.round(u.bottom) > Math.round(b.bottom) + 1; };
  while (k > 1 && cut()) show(--k);
}
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function renderDom() {
  if (!domBuilt) buildDom();
  const sym = S.set.sym, m = M(sym), q = Engine.quote(sym), step = domStep * domBase(sym), t = Engine.simTime;
  if (domFor !== sym) { domFor = sym; domStepLabels(sym); }
  // outside its session the ladder keeps the last prices, dimmed, and its centre says when the market opens
  const why = marketWhy(sym) || unavailableWhy(sym), box = $('#dom');
  if (box.classList.contains('dom-closed') !== !!why) { box.classList.toggle('dom-closed', !!why); box.style.opacity = why ? '.55' : ''; for (const r of box.children) if (r.getAttribute('role') === 'button') r.setAttribute('aria-disabled', why ? 'true' : 'false'); }
  box.title = why;
  const fx = m.kind !== 'cfd', shares = m.lotName === 'shares';
  const sizeTxt = v => fx ? v.toFixed(1) + 'M' : shares ? String(Math.max(1, Math.round(v * 100))) : v.toFixed(1);
  const levels = [];
  const a0 = Math.ceil(q.ask / step - 1e-9) * step, b0 = Math.floor(q.bid / step + 1e-9) * step;
  for (let i = DOM_N - 1; i >= 0; i--) levels.push({ side: 'ask', price: a0 + i * step, dist: i });
  levels.push(null);
  for (let i = 0; i < DOM_N; i++) levels.push({ side: 'bid', price: b0 - i * step, dist: i });
  const size = L => { const idx = Math.round(L.price / step); return (1.5 + L.dist * 1.1 * domStep ** .3) * (.45 + hash(idx + (L.side === 'ask' ? 7 : 0))) * (.8 + .4 * Math.sin(t / 9 + idx * 1.7)); };
  const sizes = levels.map(L => L ? size(L) : 0), max = Math.max(...sizes);
  const mine = L => {
    const tags = [], near = p => p != null && Math.abs(p - L.price) < step / 2;
    for (const o of S.orders) if (o.sym === sym && near(o.price)) tags.push(`<b class="${o.side}">${o.side === 'buy' ? 'B' : 'S'} ${o.lots.toFixed(2)}</b>`);
    for (const p of S.positions) if (p.sym === sym) { if (near(p.entry)) tags.push(`<b class="${p.side}">#${p.id}</b>`); if (near(p.sl)) tags.push('<b class="sl">SL</b>'); if (near(p.tp)) tags.push('<b class="tp">TP</b>'); }
    return tags.join('');
  };
  const rows = $('#dom').children;
  levels.forEach((L, i) => {
    const r = rows[i];
    // the centre: the spread and the true midpoint (quote().mid is the bid: the simulated price is the bid)
    // one line (CSS ellipsis when the rail is narrow); the full text is the row's title
    // the figures of the open band are bold (artboard 2): same text, the numbers in <b>
    if (!L) {
      const spr = q.spread.toFixed(1), mid = ((q.bid + q.ask) / 2).toFixed(m.digits + 1), uw = unitWord(sym, true);
      const tx = why ? (why.startsWith('Market closed — ') ? 'closed · ' + why.slice(16) : why) : `spread ${spr} ${uw} · mid ${mid}`, sp = r.querySelector('#domSpr');
      if (sp.textContent !== tx) { if (why) sp.textContent = tx; else sp.innerHTML = `spread <b>${spr}</b> ${escHtml(uw)} · mid <b>${mid}</b>`; r.title = tx; }
      return;
    }
    r.dataset.price = L.price.toFixed(m.digits); r.dataset.side = L.side;
    r.querySelector('.dp').textContent = L.price.toFixed(m.digits);
    const cell = r.querySelector(L.side === 'bid' ? '.bq' : '.aq'), other = r.querySelector(L.side === 'bid' ? '.aq' : '.bq');
    cell.querySelector('i').style.width = (sizes[i] / max * 100) + '%'; cell.querySelector('em').textContent = sizeTxt(sizes[i]);
    other.querySelector('i').style.width = '0'; other.querySelector('em').textContent = '';
    r.querySelector('.mk').innerHTML = mine(L);
  });
}
function domClick(e) {
  const r = e.target.closest('.dom-row'); if (!r || !r.dataset.price) return;
  const price = +r.dataset.price, sym = S.set.sym, t = S.tk;
  // closed market (or off quotes) and instruments not offered: nothing to fill in or send, and the toast says why
  { const na = unavailableWhy(sym); if (na) { toast('Order blocked', na, 'dn'); beep('err'); return; } }
  { const w = marketWhy(sym); if (w) { closedReject(sym, w); return; } }
  // bid levels: buy limit (shift: sell stop) · ask levels: sell limit (shift: buy stop)
  const bidSide = r.dataset.side === 'bid';
  const side = bidSide ? (e.shiftKey ? 'sell' : 'buy') : (e.shiftKey ? 'buy' : 'sell');
  const ot = e.shiftKey ? 'stop' : 'limit';
  // One-click off: the level only fills in the ticket (side, type, price); the order button sends it
  if (!S.set.oneClick) {
    Object.assign(t, { side, ot, price });
    syncTicketInputs(); const k = renderTicket(), bl = tkBlocks(k);
    if (document.body.classList.contains('mnav-on') && typeof window.mnavGo === 'function') window.mnavGo('trade');
    const b = $('#tkSubmit'); b.scrollIntoView({ block: 'nearest' }); if (!bl.length) b.focus({ preventScroll: true });
    toast('Ticket ready — not sent', bl.length ? bl[0].why : `${side === 'buy' ? 'Buy' : 'Sell'} ${ot} ${tkLotsText(sym, k.lots)} ${pretty(sym)} at ${fp(sym, price)}: press the order button to send. One-click trading is off (account menu).`, 'info');
    return;
  }
  // One-click on: size it as the ticket would size this very order, without changing the ticket
  const keep = { side: t.side, ot: t.ot, price: t.price };
  // a stop or target held as a price (ticket.js tkHold) is measured from this order's entry
  const why = typeof tkHold === 'function' ? tkHold(side, ot, price) : ''; if (why) { toast('Order blocked', why + '.', 'dn'); beep('err'); return; }
  Object.assign(t, { side, ot, price }); let k; try { k = tkCalc(); } finally { Object.assign(t, keep); }
  // a ticket size that cannot go (under the minimum, over the maximum) is refused with its reason, never replaced by
  // another size (UX 09.11 round 2, #2)
  const sw = typeof tkSizeWhy === 'function' ? tkSizeWhy(k) : ''; if (sw) { toast('Order blocked', `Order size: ${sw} — set it in the ticket.`, 'dn'); beep('err'); return; }
  placeOrder({ sym, side, ot, price, lots: k.lots, ...tkExits() });
}

/* ============ watchlist sparklines ============ */
function renderSparks() {
  const c = chartColors();
  for (const row of $('#wl').children) {
    const cv = row.querySelector('canvas.spark'); if (!cv) continue;
    const w = row.clientWidth, h = row.clientHeight, dpr = devicePixelRatio || 1; if (!w) continue;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const arr = Engine.candles[row.dataset.sym], n = arr.length, pts = [];
    for (let i = Math.max(0, n - 1440); i < n; i += 24) pts.push(arr[i].close);
    pts.push(arr[n - 1].close);
    const mn = Math.min(...pts), mx = Math.max(...pts), col = pts[pts.length - 1] >= pts[0] ? c.up : c.dn;
    const X = i => i / (pts.length - 1) * w, Yv = v => h - 4 - (v - mn) / (mx - mn || 1) * (h - 12);
    g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(X(i), Yv(v)) : g.moveTo(X(i), Yv(v)));
    g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col + '40'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fill();
  }
}

/* ============ trade coach ============ */
// The market is a zero-drift random walk: gaps between pairs or sessions are mostly noise.
// Below COACH_MIN trades a group gets no verdict; below COACH_N it is shown with "may be chance".
const COACH_MIN = 10, COACH_N = 30;
const coachEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const coachN = n => `n=${n}${n < COACH_N ? ', may be chance' : ''}`;
// a win rate with its 95% Wilson interval and n (wrTxt, shared.js), flagged below COACH_N
const coachWr = arr => `${wrTxt(arr.filter(x => x.pnl > 0).length, arr.length)}${arr.length < COACH_N ? ', may be chance' : ''}`;
const SESS_OF = t => { const h = new Date(t * 1000).getUTCHours(); return h >= 12 && h < 16 ? 'London/NY overlap' : h >= 7 && h < 12 ? 'London' : h >= 16 && h < 21 ? 'New York' : 'Asia'; };
function coachInsights() {
  // one trade = one position (partial closes grouped, the protection credit left out); its P&L is net of commission
  const h = tradesOf(S.history).map(x => ({ ...x, pnl: x.net }));
  if (h.length < 3) return [{ tone: 'info', t: `Close ${3 - h.length} more trade${h.length === 2 ? '' : 's'} and the coach will start reading your behaviour — hold times, revenge trades, best pairs and sessions.` }];
  const out = [], wr = arr => arr.length ? arr.filter(x => x.pnl > 0).length / arr.length * 100 : 0, net = arr => arr.reduce((s, x) => s + x.pnl, 0);
  const group = f => { const g = {}; h.forEach(x => (g[f(x)] = g[f(x)] || []).push(x)); return Object.entries(g); };
  const pairs = group(x => x.sym).map(([k, v]) => [k, net(v), v.length]).filter(x => x[2] >= COACH_MIN).sort((a, b) => b[1] - a[1]);
  if (pairs.length > 1) {
    const [bk, bv, bn] = pairs[0], [wk, wv, wn] = pairs[pairs.length - 1];
    if (bv > 0) out.push({ tone: 'info', t: `Best pair so far: <b>${pretty(bk)}</b>, ${usdFmt(bv, true)} over ${bn} trades (${coachN(bn)}).` });
    if (wv < 0) out.push({ tone: 'info', t: `Weakest pair so far: <b>${pretty(wk)}</b>, ${usdFmt(wv)} over ${wn} trades (${coachN(wn)}). Check whether spread or size explain it before blaming the pair.` });
  }
  const W = h.filter(x => x.pnl > 0), Lz = h.filter(x => x.pnl <= 0);
  const hold = arr => arr.reduce((s, x) => s + (x.close - x.open), 0) / Math.max(1, arr.length) / 60;
  const fm = m => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m.toFixed(0)}m`;
  // hold times only from positions that are flat (a still-open remainder has no hold time yet)
  const Wc = W.filter(x => x.complete), Lc = Lz.filter(x => x.complete);
  if (Wc.length >= COACH_MIN && Lc.length >= COACH_MIN) {
    const hw = hold(Wc), hl = hold(Lc);
    if (hl > hw * 1.3) out.push({ tone: 'bad', t: `You hold losers <b>${(hl / Math.max(hw, .1)).toFixed(1)}×</b> longer than winners (${fm(hl)} vs ${fm(hw)}; ${coachN(Math.min(Wc.length, Lc.length))}). Classic loss aversion — let stops do their job.` });
    else if (hw > hl * 1.3) out.push({ tone: 'good', t: `You let winners run (${fm(hw)}) and cut losers fast (${fm(hl)}; ${coachN(Math.min(Wc.length, Lc.length))}). Keep doing that.` });
  }
  const aw = W.length ? net(W) / W.length : 0, al = Lz.length ? -net(Lz) / Lz.length : 0;
  if (aw && al > aw * 1.5) out.push({ tone: 'bad', t: `Average loss (${usdFmt(al)}) is ${(al / aw).toFixed(1)}× your average win. You'd need a ${(al / (al + aw) * 100).toFixed(0)}% win rate just to break even.` });
  const longs = h.filter(x => x.side === 'buy'), shorts = h.filter(x => x.side === 'sell');
  if (longs.length >= COACH_MIN && shorts.length >= COACH_MIN && Math.abs(wr(longs) - wr(shorts)) >= 20) {
    const better = wr(longs) > wr(shorts) ? 'long' : 'short', B = better === 'long' ? longs : shorts, O = better === 'long' ? shorts : longs;
    out.push({ tone: 'info', t: `You win ${wrTxt(B.filter(x => x.pnl > 0).length, B.length)} of <b>${better}s</b> vs ${wrTxt(O.filter(x => x.pnl > 0).length, O.length)} of ${better === 'long' ? 'shorts' : 'longs'}${Math.min(B.length, O.length) < COACH_N ? ' — may be chance' : ''}.` });
  }
  const noSL = h.filter(x => x.r == null);
  if (noSL.length) out.push({ tone: noSL.length / h.length > .3 ? 'bad' : 'info', t: `${noSL.length} of ${h.length} trades had no stop loss (net ${usdFmt(net(noSL), true)}). Unprotected trades are where accounts blow up.` });
  const byOpen = [...h].sort((a, b) => a.open - b.open), closes = [...h].sort((a, b) => a.close - b.close);
  const revenge = byOpen.filter(x => closes.some(y => y !== x && y.pnl < 0 && y.close <= x.open && x.open - y.close < REVENGE_MIN * 60));
  if (revenge.length >= 2) out.push({ tone: 'info', t: `${revenge.length} trades were opened within ${REVENGE_MIN} minutes of a loss${revenge.length >= COACH_MIN ? ` — they win ${coachWr(revenge)}` : ''}. Quick re-entries after a loss are how revenge trading starts.` });
  const sess = group(x => SESS_OF(x.open)).filter(([, v]) => v.length >= COACH_MIN).map(([k, v]) => [k, net(v), v, v.length]).sort((a, b) => b[1] - a[1]);
  if (sess.length > 1) out.push({ tone: 'info', t: `Best session so far: <b>${sess[0][0]}</b> (${usdFmt(sess[0][1], true)}, wins ${coachWr(sess[0][2])}). Weakest: ${sess[sess.length - 1][0]} (${usdFmt(sess[sess.length - 1][1], true)}, wins ${coachWr(sess[sess.length - 1][2])}).` });
  return out.slice(0, 7);
}
/* Coach, compact (Victor, 31.10.2026): one line per insight (its first clause, a tone mark), Details opens a floating
   panel with every insight in full and the tables behind them (pair, session, side, holds, stops, re-entries) */
function coachShort(t) {
  // first sentence, figures kept (front 15.11.2026: the $ and the counts stay on the line); a "may be chance" tail becomes a ‡ mark
  const i = t.indexOf('. ', 12); let x = (i > 0 ? t.slice(0, i) : t).replace(/\.$/, ''), few = false;
  if (/,? may be chance/.test(x)) { few = true; x = x.replace(/,? may be chance/, '').replace(/\s*\(n=\d+\)/, '').replace(/\s*\(\)/, ''); }
  if ((x.match(/<b>/g) || []).length > (x.match(/<\/b>/g) || []).length) x += '</b>';
  return x + (few ? ' <i class="coach-few" title="Small sample: may be chance">‡</i>' : '');
}
function coachDetails() {
  const h = tradesOf(S.history).map(x => ({ ...x, pnl: x.net })), net = a => a.reduce((s, x) => s + x.pnl, 0);
  const wins = a => a.filter(x => x.pnl > 0).length, fm = m => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m.toFixed(0)}m`;
  const hold = a => a.length ? fm(a.reduce((s, x) => s + (x.close - x.open), 0) / a.length / 60) : '—';
  const pc = v => Math.round(v * 100) + '%', up = v => v >= 0 ? 'up' : 'dn';
  const by = f => { const g = {}; h.forEach(x => (g[f(x)] = g[f(x)] || []).push(x)); return Object.entries(g).sort((a, b) => net(b[1]) - net(a[1])); };
  // one table for every breakdown: a band per group, one header; the interval in its own column, a thin sample is flagged
  const row = ([k, v], gname) => { const ci = wilson(wins(v), v.length), few = v.length < COACH_N;
    return `<tr${few ? ' class="cd-few"' : ''}><th scope="row" data-rich="cg:${gname}|${String(k).replace(/<[^>]+>/g, '').replace(/"/g, '')}">${k}</th><td class="mono">${v.length}</td><td class="mono ${up(net(v))}">${usdFmt(net(v), true)}</td><td class="mono">${v.length ? pc(wins(v) / v.length) : '—'}</td><td class="mono cd-ci">${ci ? `${pc(ci.lo)}–${pc(ci.hi)}` : '—'}${few ? '<i title="fewer than 30 trades: may be chance">‡</i>' : ''}</td><td class="mono ${up(net(v))}">${usdFmt(net(v) / v.length, true)}</td></tr>`; };
  const groups = [['Pair', by(x => pretty(x.sym))], ['Session · open time, UTC', by(x => SESS_OF(x.open))], ['Side', by(x => x.side === 'buy' ? 'Long' : 'Short')]];
  const table = `<table class="cd-tbl"><thead><tr><th scope="col">Breakdown</th><th scope="col" data-rich="gl:Trades" data-tip="Trades|Number of trades in the group.">Trades</th><th scope="col" data-rich="gl:Net" data-tip="Net|Total result of the group, after commission.">Net</th><th scope="col" data-rich="gl:Win rate" data-tip="Win rate|Share of the group that closed in profit.">Win rate</th><th scope="col" data-rich="gl:95% interval" data-tip="95% interval|Where the true win rate plausibly lies. A wide interval means the sample is too small to conclude.">95% interval</th><th scope="col" data-rich="gl:Avg" data-tip="Avg|Average result per trade in the group.">Avg</th></tr></thead>${groups.map(([t, rows]) => `<tbody><tr class="cd-band"><th colspan="6" scope="rowgroup">By ${t.toLowerCase()}</th></tr>${rows.map(r => row(r, t.split(' ')[0])).join('')}</tbody>`).join('')}</table>
    <p class="cd-legend">‡ fewer than ${COACH_N} trades — may be chance · a group needs ${COACH_MIN}+ trades before the coach gives it a verdict</p>`;
  const W = h.filter(x => x.pnl > 0), L = h.filter(x => x.pnl <= 0), Wc = W.filter(x => x.complete), Lc = L.filter(x => x.complete);
  const byOpen = [...h].sort((a, b) => a.open - b.open), closes = [...h].sort((a, b) => a.close - b.close);
  const rev = byOpen.filter(x => closes.some(y => y !== x && y.pnl < 0 && y.close <= x.open && x.open - y.close < REVENGE_MIN * 60)), noSL = h.filter(x => x.r == null);
  const ci = wilson(W.length, h.length);
  const CT = { 'Trades': 'Closed trades, partial closes counted once, net of commission.', 'Net': 'Total result of the closed trades after commission.', 'Win rate': 'Share of trades that closed in profit, with its 95% interval. The interval is wide when n is small.', 'Avg win': 'Average profit of the winning trades.', 'Avg loss': 'Average loss of the losing trades. Compare with the average win.', 'Hold W / L': 'Average time a winner and a loser stayed open. Losers held much longer than winners is loss aversion. Only fully closed positions count.', 'No stop loss': 'Trades opened without a stop loss, and their net result. They have no R and an unbounded risk.', 'Re-entries': 'Trades opened within the revenge window after a loss, and how they ended. A low win rate here is the signature of revenge trading.' };
  const cell = (l, v, sub, cls) => `<div data-rich="cd:${l}" data-tip="${escHtml(l + '|' + (CT[l] || ''))}" tabindex="0"><dt>${l}</dt><dd><b class="mono ${cls || ''}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  const sum = `<dl class="cd-sum">${cell('Trades', h.length, 'closed, net of commission')}${cell('Net', usdFmt(net(h), true), '', up(net(h)))}`
    + `${cell('Win rate', h.length ? pc(W.length / h.length) : '—', ci ? `95% ${pc(ci.lo)}–${pc(ci.hi)} · n=${h.length}` : '')}`
    + `${cell('Avg win', W.length ? usdFmt(net(W) / W.length) : '—', '', W.length ? 'up' : '')}${cell('Avg loss', L.length ? usdFmt(-net(L) / L.length) : '—', '', L.length ? 'dn' : '')}`
    + `${cell('Hold W / L', `${hold(Wc)} / ${hold(Lc)}`, 'flat positions only')}${cell('No stop loss', `${noSL.length}/${h.length}`, noSL.length ? 'net ' + usdFmt(net(noSL), true) : '', noSL.length ? 'cd-warn' : '')}`
    + `${cell('Re-entries', rev.length, rev.length ? `within ${REVENGE_MIN} min of a loss · wins ${wrTxt(wins(rev), rev.length)}` : `within ${REVENGE_MIN} min of a loss`)}</dl>`;
  // every trade, newest first, with its notes editable here (they live on the trade's first history row, as in
  // Trade notes) and every figure the journal keeps on it
  const tr = tradesOf(S.history).sort((a, b) => b.close - a.close);
  const dt = t => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' '), flagN = k => (typeof FLAG_NAMES === 'object' && FLAG_NAMES[k]) || k;
  const revIds = new Set(rev.map(x => x.id + '|' + x.open));
  const trades = `<table class="cd-tbl cd-trades"><thead><tr><th scope="col" data-rich="gl:Closed" data-tip="Closed|When the trade closed (UTC).">Closed</th><th scope="col" data-rich="gl:Trade" data-tip="Trade|Side, size and instrument. Warnings that applied at entry are counted next to it.">Trade</th><th scope="col" data-rich="gl:Entry → exit" data-tip="Entry → exit|Average entry and exit price.">Entry → exit</th><th scope="col" data-rich="gl:Pips / pt" data-tip="Pips / pt|Distance gained or lost: pips on FX, points on other instruments.">Pips / pt</th><th scope="col" data-rich="gl:R" data-tip="R|Result in multiples of the money risked at the stop. No stop, no R.">R</th><th scope="col" data-rich="gl:Net" data-tip="Net|Total result of the group, after commission.">Net</th><th scope="col" data-rich="gl:Hold" data-tip="Hold|How long the trade was open.">Hold</th><th scope="col" data-rich="gl:Exit" data-tip="Exit|How the trade closed: by hand, stop loss, take profit, trailing stop or another rule.">Exit</th><th scope="col" data-rich="gl:Note" data-tip="Note|Your note, saved on the trade and shown in Trade notes.">Note</th></tr></thead><tbody>${tr.map(x => {
    const i = S.history.indexOf(x.rows[x.rows.length - 1]), fl = [...(x.ctx || []).map(flagN), x.r == null ? 'No stop loss' : '', revIds.has(x.id + '|' + x.open) ? `Within ${REVENGE_MIN} min of a loss` : ''].filter((v, k, a) => v && a.indexOf(v) === k);
    return `<tr data-i="${i}"><td class="mono" data-rich="jt:${i}">${dt(x.close)}</td><th scope="row" data-rich="jt:${i}"><span class="cd-sd ${x.side === 'buy' ? 'up' : 'dn'}">${x.side === 'buy' ? 'Buy' : 'Sell'}</span> ${x.lots.toFixed(2)} ${coachEsc(pretty(x.sym))}${x.parts > 1 ? ` <small>${x.parts} parts${x.complete ? '' : ', still open'}</small>` : ''}${fl.length ? `<span class="cd-fl" title="${coachEsc(fl.join(' · '))}">${fl.length} warning${fl.length > 1 ? 's' : ''}</span>` : ''}</th>`
      + `<td class="mono">${fp(x.sym, x.entry)} → ${fp(x.sym, x.exit)}</td><td class="mono ${up(x.pips)}">${x.pips >= 0 ? '+' : ''}${(+x.pips).toFixed(1)}</td><td class="mono">${x.r == null ? '—' : (x.r >= 0 ? '+' : '') + x.r.toFixed(2) + 'R'}</td>`
      + `<td class="mono ${up(x.net)}" title="${x.comm ? `net of ${usdFmt(x.comm)} commission` : 'net P&L'}${x.swap ? ` · swap ${usdFmt(x.swap, true)}` : ''}">${usdFmt(x.net, true)}</td><td class="mono">${fm((x.close - x.open) / 60)}</td><td class="cd-ex">${coachEsc(x.reason || '—')}</td>`
      + `<td><input data-j="note" aria-label="Note" placeholder="What did you see? What would you change?" value="${coachEsc(x.note || '')}"></td></tr>`;
  }).join('')}</tbody></table>`;
  return { sum, table, trades, n: h.length };
}
function coachOpen() {
  let el = $('#coachDlg');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'coachDlg'; document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-cf]')) el.hidden = true; });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; } });
    // notes typed here are the journal's: same field on the same history row, then the journal redraws
    el.addEventListener('change', e => { const r = e.target.closest('tr[data-i]'), f = e.target.dataset.j; if (!r || !f) return; const h = S.history[+r.dataset.i]; if (!h) return; h[f] = e.target.value; save(); if (typeof renderJournal === 'function') renderJournal(); });
  }
  const ins = coachInsights(), d = coachDetails();
  el.innerHTML = `<div class="modal cf-modal cd-modal" role="dialog" aria-modal="true" aria-labelledby="cdT">
    <div class="ph"><h2 id="cdT">Coach · details</h2><span class="muted small">${d.n} closed trade${d.n === 1 ? '' : 's'} · a group needs ${COACH_MIN}+ trades for a verdict, ${COACH_N}+ before a gap means much</span><button type="button" class="cd-x" data-cf="cancel" aria-label="Close">Close</button></div>
    ${d.n ? d.sum : ''}
    <div class="cd-body${d.n ? '' : ' cd-one'}"><section class="cd-col"><h4 data-rich="j:coach">Insights</h4><ul class="cd-ins">${ins.map((i, n) => `<li class="${i.tone}" data-rich="ci:${n}" tabindex="0">${i.t}</li>`).join('')}</ul></section>
      ${d.n ? `<section class="cd-col cd-wide">${d.table}</section><section class="cd-col cd-tr"><h4 data-rich="j:notes">Trades · ${d.n} · newest first · notes save to the journal</h4>${d.trades}</section>` : ''}</div></div>`;
  el.hidden = false; el.querySelector('[data-cf=cancel]').focus({ preventScroll: true });
}
// a hover for each Coach line: the full sentence, and how to use it
function coachTip(t) {
  const plain = t.replace(/<[^>]+>/g, ''), use = [
    [/^Suggested rule/, 'A warning that goes with worse results for you. Turn it into a rule: pause and write the pre-mortem before such a trade.'],
    [/^Costliest warning/, 'The context at entry that has cost you the most so far. Fix this one first.'],
    [/^Disposition effect/, 'You close winners readily and hold losers. Let stops close the losers.'],
    [/^Best pair/, 'Where your results are best. A small sample can be chance: look at the number of trades before leaning on it.'],
    [/^Weakest pair/, 'Check spread, size and timing before blaming the pair.'],
    [/hold losers/, 'Holding losers longer than winners is loss aversion. Let the stop do the job.'],
    [/let winners run/i, 'Winners run longer than losers: keep doing it.'],
    [/Average loss/, 'A large average loss needs a high win rate to break even.'],
    [/of longs|of shorts|\bwin\b.*(long|short)/, 'A gap between long and short results; small samples are often chance.'],
    [/no stop loss/, 'Trades without a stop have an unbounded loss and no R. Set one before you enter.'],
    [/within \d+ minutes of a loss/, 'Quick re-entries after a loss are how revenge trading starts. Take a break after a loss.'],
    [/^Best session/, 'The session (by open time, UTC) where you do best. Consider concentrating there.'],
  ].find(([re]) => re.test(plain));
  return 'Insight|' + plain + (use ? ' ' + use[1] : '');
}
function renderCoach() {
  const el = $('#coach'); if (!el) return;
  const h = `<div class="coach-h"><h3 data-rich="j:coach" data-tip="Coach|Reads your closed trades and points at habits: what costs you, what works. Each line is the short form; a ‡ means the sample is small and may be chance. Details opens every insight and the tables behind them.">Coach</h3><button type="button" class="coach-more" data-coach="more" aria-haspopup="dialog">Details</button></div><ul class="coach-l">${coachInsights().map((i, n) => `<li class="${i.tone}" data-rich="ci:${n}" data-tip="${escHtml(coachTip(i.t))}" tabindex="0">${coachShort(i.t)}</li>`).join('')}</ul>`;
  if (el._h !== h) { el.innerHTML = h; el._h = h; }
  if (!el._b) { el._b = 1; el.addEventListener('click', e => { if (e.target.closest('[data-coach=more]')) coachOpen(); }); }
}

/* ============ export / import ============ */
function exportAccount() {
  const data = JSON.stringify({ app: 'meridian-fx', version: 1, exported: new Date().toISOString(), state: S }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `tradeberry-account-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Account exported', `${S.positions.length} positions · ${S.history.filter(h => !h.nbp).length} closed trades`, 'info');
}
function importAccount(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const j = JSON.parse(fr.result), st = j.state || j;
      const bad = msg => Object.assign(new Error(msg), { user: true });
      if (!st || !Array.isArray(st.positions) || !Array.isArray(st.history) || typeof st.balance !== 'number') throw bad('it has no positions, history and balance');
      // imported files are untrusted: drop prototype keys and refuse numbers that are not finite.
      // Free-text fields keep their text exactly (every render site escapes them; sanitizeState caps lengths).
      // Every other string loses markup characters, because some number and enum fields reach innerHTML unchecked.
      const FREE = new Set(['reason', 'note', 'own', 'kill', 'mine', 'flags', 'codes', 'broke', 'name', 'label', 'text', 'title', 'wsName', 'ctx', 'news', 'tags']);
      const clean = (v, path = 'state', key = '') => typeof v === 'number' ? (Number.isFinite(v) ? v : (() => { throw bad(`${path} is not a finite number`); })())
        : typeof v === 'string' ? (FREE.has(key) ? v : v.replace(/[<>"'`]/g, ''))
        : Array.isArray(v) ? v.map((x, i) => clean(x, `${path}[${i}]`, key))
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k)).map(([k, x]) => [k.replace(/[<>"'`]/g, ''), clean(x, `${path}.${k}`, k)])) : v;
      if (j.app && j.app !== 'meridian-fx') throw bad('it was exported by another app');
      if (j.version != null && j.version > 1) { toast('Import failed', `This file was exported by a newer version (format ${j.version}).`, 'dn'); return; }
      // a fresh object from the cleaned copy: the original keeps its own __proto__ key, which Object.assign would apply as a prototype
      // a signed-in page: the account is the server's; the file gives only the interface preferences (settings, ticket,
      // watchlist, drawings, lines, pre-mortem and tilt), the balance, positions, orders and history stay as they are
      if (TradeLink.live) {
        const keep = {}; for (const k of ACCT_KEYS) if (S[k] !== undefined) keep[k] = S[k];
        const exec = {}; for (const k of SET_EXEC) exec[k] = S.set[k];
        const pr = prefsOf(clean(st));
        loadState({ ...JSON.parse(JSON.stringify(S)), ...pr, set: { ...S.set, ...(pr.set || {}), ...exec } });
        Object.assign(S, keep); Object.assign(S.set, exec); save();
        applyTheme(); syncTicketInputs(); fullChart(true); changed('pos', 'ord', 'hist', 'al');
        if (typeof syncLevSel === 'function') syncLevSel(); $('#help').hidden = true;
        toast('Preferences imported', 'Settings, ticket, watchlist, drawings and lines from the file. The account on the server (balance, positions, orders, history) is not changed by an import.', 'info');
        return;
      }
      const n0 = st.positions.length + st.history.length + (Array.isArray(st.orders) ? st.orders.length : 0) + (Array.isArray(st.alerts) ? st.alerts.length : 0);
      loadState(clean(st)); save();
      const dropped = n0 - (S.positions.length + S.history.length + S.orders.length + S.alerts.length);
      applyTheme(); syncTicketInputs(); fullChart(true); changed('pos', 'ord', 'hist', 'al');
      if (typeof syncLevSel === 'function') syncLevSel(); $('#help').hidden = true;
      toast('Account imported', `Balance ${usdFmt(S.balance)} · ${S.history.filter(h => !h.nbp).length} trades${dropped > 0 ? ` · ${dropped} invalid record${dropped > 1 ? 's' : ''} skipped` : ''}`, 'info');
    } catch (e) {
      // loadState says what it refused ("Not a valid tradeBerry account state: …"); our own checks carry user = true
      const why = e && (e.user || /^Not a valid tradeBerry account state/.test(e.message)) ? e.message : e instanceof SyntaxError ? 'it is not valid JSON' : '';
      toast('Import failed', why ? `That file was not imported: ${why}.` : 'That file is not a tradeBerry account export', 'dn');
      if (e && !e.user && !(e instanceof SyntaxError)) console.warn('[Meridian] import failed', e);
    }
  };
  fr.readAsText(file);
}

/* ============ order model in the dock and on the chart ============
   panels.js and chart.js draw the base rows and lines; these wrappers add what the order model knows (stop-limit,
   triggered, time in force, OCO, split targets, break-even) and a receipt button for every fill. */
if (typeof renderOrders === 'function') {
  const base = renderOrders;
  renderOrders = function () {
    const rebuilt = dirty.ord; base();
    if (!rebuilt) return;
    for (const tr of $('#ordBody').children) {
      const o = S.orders.find(x => String(x.id) === tr.dataset.id), tag = tr.querySelector('.tag'); if (!o || !tag) continue;
      tag.textContent = `${o.side} ${ordType(o)}`;
      const extra = [o.limit != null ? `limit ${fp(o.sym, o.limit)}${o.status === 'triggered' ? ' · triggered' : ''}` : '', o.tif && o.tif !== 'GTC' ? tifText(o) : '', o.oca ? 'OCO' : ''].filter(Boolean).join(' · ');
      if (extra) { const sp = document.createElement('div'); sp.className = 'muted small'; sp.textContent = extra; tag.parentElement.appendChild(sp); }
      const c = tr.children;
      const u = M(o.sym) && M(o.sym).unit === 'pt' ? 'pt' : 'p';
      if (!(o.slPips > 0) && o.trail > 0 && c[5]) c[5].textContent = `trail ${o.trail}${u}`;
      if (o.tps && c[6]) { c[6].textContent = o.tps.map(r => r.pips + u).join(' / '); c[6].title = o.tps.map((r, i) => `TP${i + 1}: ${r.pips} ${unitWord(o.sym)}, ${r.pct}% of the size`).join(' · '); }
    }
  };
}
if (typeof renderPositions === 'function') {
  const base = renderPositions;
  renderPositions = function () {
    const rebuilt = dirty.pos; base();
    for (const tr of $('#posBody').children) {
      const p = S.positions.find(x => x.id === +tr.dataset.id); if (!p) continue;
      // the server account keeps the receipts in S.fills only: the row finds its opening fill there (UX-41)
      const pf = p.fills && p.fills.length ? p.fills : (S.fills || []).filter(f => f.pos === p.id && f.sym === p.sym).map(f => f.fid).reverse();
      if (rebuilt && pf.length && Number.isInteger(pf[0])) { const a = tr.querySelector('.acts'); if (a && !a.querySelector('[data-fid]')) a.insertAdjacentHTML('afterbegin', `<button type="button" data-fid="${pf[0]}" data-tip="Show the receipt of the opening fill" aria-label="Show the receipt of the opening fill for #${p.id}">Fill</button>`); }
      const sl = tr.querySelector('[data-edit=sl]'), tp = tr.querySelector('[data-edit=tp]');
      if (sl && !sl.querySelector('input') && p.sl != null && p.beSl === p.sl && !/BE$/.test(sl.textContent)) sl.textContent += ' BE';
      if (tp && !tp.querySelector('input') && p.tps && p.tps.length > 1) { const t = `${fp(p.sym, p.tp)} +${p.tps.length - 1}`; if (tp.textContent !== t) { tp.textContent = t; tp.title = p.tps.map(l => `${l.leg} ${fp(p.sym, l.price)} · ${lotsWord(p.sym, l.lots)}`).join('\n') + '\nClick to edit the nearest target'; } }
      else if (tp && tp.title !== 'Click to edit') tp.title = 'Click to edit';
    }
  };
}
if (typeof renderHistory === 'function') {
  const base = renderHistory;
  renderHistory = function () {
    const rebuilt = dirty.hist; base();
    if (!rebuilt) return;
    [...$('#histBody').children].forEach((tr, i) => {
      const h = S.history[i], f = h && Array.isArray(h.fills) && h.fills.length ? h.fills[h.fills.length - 1] : h ? ((S.fills || []).find(x => x.pos === h.id && x.sym === h.sym) || {}).fid : null;
      // the receipt sits with the close's reason (since UX 09.11 F14 the last cells are Costs and Net)
      const cell = (tr.querySelector('td[data-c="costs"]') || {}).previousElementSibling || tr.lastElementChild;
      if (h && !h.nbp && Number.isInteger(f) && cell) cell.insertAdjacentHTML('beforeend', ` <button type="button" class="link" data-fid="${f}" aria-label="Fill receipt">Receipt</button>`);
    });
  };
}
if (typeof rebuildLines === 'function') {
  const base = rebuildLines;
  rebuildLines = function () {
    base();
    const sym = S.set.sym, c = chartColors(), add = (opt, kind, ref, leg) => lines.push({ line: candle.createPriceLine({ lineWidth: 1, axisLabelVisible: true, ...opt }), kind, ref, leg, drag: false });
    for (const L of [...lines]) {
      const r = L.ref;
      if (L.kind === 'pos-tp' && r.tps) L.line.applyOptions({ title: `${r.tps[0].leg} #${r.id}` });
      if (L.kind === 'pos-sl' && r.beSl != null && r.sl === r.beSl) L.line.applyOptions({ title: `BE #${r.id}` });
      if (L.kind === 'ord' && (r.limit != null || r.oca)) L.line.applyOptions({ title: `${r.side.toUpperCase()} ${r.limit != null ? 'STP-LMT' : r.ot.toUpperCase()} ${lotsFmt(r.sym, r.lots)}${r.oca ? ' OCO' : ''}` });
    }
    for (const p of S.positions.filter(p => p.sym === sym && p.tps)) p.tps.slice(1).forEach(l => add({ price: l.price, color: c.up, lineStyle: 2, title: `${l.leg} #${p.id}` }, 'pos-tpx', p));
    for (const o of S.orders.filter(o => o.sym === sym && o.limit != null)) add({ price: o.limit, color: c.info + '88', lineStyle: 1, title: `LMT${o.status === 'triggered' ? ' (working)' : ''}` }, 'ord-lmt', o);
    const k = tkCalc();
    if (k.stopLimit) for (const L of lines) if (L.kind === 'tk-entry') L.line.applyOptions({ title: `${k.side.toUpperCase()} STP-LMT` });
    if (k.stopLimit) add({ price: k.limit, color: c.info + '88', lineStyle: 2, title: 'LMT' }, 'tk-lmt', null);
    if (k.tps) k.tps.slice(1).forEach((l, i) => add({ price: l.price, color: c.up + 'aa', lineStyle: 2, title: l.leg }, 'tk-tpx', null, i + 1));
  };
}
// a trail-only ticket draws its stop at entry ∓ trail: dragging that line sets the trail distance
if (typeof applyDrag === 'function') {
  const base = applyDrag;
  applyDrag = function (L, price) {
    if (L && L.kind === 'tk-sl') { const k = tkCalc(); if (k.trailOnly) { S.tk.trail = Math.max(1, Math.round(Math.abs(k.entry - price) / k.m.pip)); syncTicketInputs(); return; } }
    return base(L, price);
  };
}
if (typeof linesTick === 'function') {
  const base = linesTick;
  linesTick = function (k) {
    base(k);
    for (const L of lines) {
      if (L.kind === 'tk-tpx' && k && k.tps && k.tps[L.leg]) L.line.applyOptions({ price: k.tps[L.leg].price });
      else if (L.kind === 'tk-lmt' && k && k.stopLimit) L.line.applyOptions({ price: k.limit });
      else if (L.kind === 'pos-sl' && L.ref.sl != null && L.ref.trailNow) L.line.applyOptions({ title: `TRAIL #${L.ref.id}` });
    }
  };
}

function bindPro() {
  $('#dom').addEventListener('click', domClick);
  $('#dom').addEventListener('keydown', e => { if (e.key === 'Enter') domClick(e); });
  $('#domStep').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; domStep = +b.dataset.st; $$('#domStep button').forEach(x => x.classList.toggle('on', x === b)); renderDom(); });
  for (const id of ['#posBody', '#histBody']) $(id).addEventListener('click', e => { const b = e.target.closest('[data-fid]'); if (b) { e.stopPropagation(); renderReceipt(+b.dataset.fid); } });
  $('#exportBtn').addEventListener('click', exportAccount);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importAccount(f); e.target.value = ''; });
}
