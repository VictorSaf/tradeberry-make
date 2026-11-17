'use strict';
/* tradeBerry — dock, intelligence, calendar, correlation & volatility, journal, risk lab, calculators. Classic script sharing globals with app.js; loaded right after it. */
/* ============ dock: positions / orders / history / alerts ============ */
const uShort = sym => M(sym).unit === 'pt' ? 'pt' : 'p'; // compact unit after a number: '20p' on FX, '20pt' on a CFD
// commands sent to the execution server and not answered yet (tradelink.js): no money is shown before the server's report
const sentRows = (kind, cols) => typeof TradeLink === 'object' && TradeLink.live ? TradeLink.sent(kind).map(c => `<tr class="tl-sent"><td colspan="${cols}"><span class="tag md">Sent</span> ${escHtml(c.label)} <span class="muted small">waiting for the execution server</span></td></tr>`).join('') : '';
/* F8, F10: '½' and 'BE' say whether they can act now. Grey (aria-disabled: still focusable, the reason in the tip and in
   the accessible name) when they cannot: '½' when half the position is under the instrument's minimum (halfLots, trade.js:
   0 = not possible), 'BE' when the price is not past the entry or the stop is already at or beyond break-even (BE_WHY,
   app.js: the reasons its refusal gives). A grey 'BE' still answers a click with that refusal; a grey '½' is held here,
   since half of the minimum size would close it all. */
// the size '½' closes is exactly halfLots(p) (trade.js), the lots the close sends: the tip never names another figure
const halfOf = p => { const h = +halfLots(p); return Number.isFinite(h) && h > 0 ? h : 0; };
function beWhy(p) {
  const q = Engine.quote(p.sym), d = p.side === 'buy' ? 1 : -1;
  if (p.sl != null && p.sl === p.entry) return 'at';
  if (p.sl != null && d * (p.sl - p.entry) > 0) return 'tighter';
  return (d > 0 ? q.bid > p.entry : q.ask < p.entry) ? '' : 'early';
}
function setAct(b, off, tip, label) {
  if (b.dataset.tip !== tip) { b.dataset.tip = tip; b.setAttribute('aria-label', label); }
  if (off) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
}
function actState(tr, p) {
  const hb = tr.querySelector('[data-act=half]'), bb = tr.querySelector('[data-act=be]');
  if (hb) {
    const h = halfOf(p), lf = v => lotsFmt(p.sym, v);
    if (h) setAct(hb, false, `Close half: ${lf(h)} of ${lf(p.lots)} lots`, `½: close ${lf(h)} of ${lf(p.lots)} lots`);
    else setAct(hb, true, `Minimum size: use Close (${lf(p.lots)} lots cannot be halved)`, '½ unavailable: minimum size, use Close');
  }
  if (bb) {
    const w = beWhy(p), why = w && typeof BE_WHY === 'object' && BE_WHY[w] ? BE_WHY[w][0] : 'Price is not past entry yet';
    if (!w) setAct(bb, false, 'Move the stop-loss to the entry price (break-even)', 'BE: move the stop-loss to the entry price (break-even)');
    else setAct(bb, true, why, 'BE unavailable: ' + why);
  }
}
// a grey '½' does nothing but say why (capture phase: before app.js's row handler, which would close the position)
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#posBody [data-act=half][aria-disabled=true]'); if (!b) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const p = S.positions.find(x => x.id === +b.closest('tr').dataset.id);
  if (p) toast("Can't close half", `${pretty(p.sym)} #${p.id} is at the minimum size (${lotsFmt(p.sym, p.lots)}): use Close to close it all`, 'info');
}, true);
function renderPositions() {
  const body = $('#posBody');
  if (dirty.pos) {
    body.innerHTML = S.positions.map(p => `<tr data-id="${p.id}">
      <td class="sym" data-sym="${p.sym}">${pretty(p.sym)} <span class="muted small">#${p.id}</span><span class="pos-sub muted small"><span class="pos-ent">@ ${fp(p.sym, p.entry)}</span><span class="pos-pp"></span></span></td>
      <td><span class="tag ${p.side}">${p.side}</span></td><td>${p.lots.toFixed(2)}</td><td>${fp(p.sym, p.entry)}</td>
      <td data-c="px"></td><td class="editable" data-edit="sl" title="Click to edit"></td><td class="editable" data-edit="tp" title="Click to edit"></td>
      <td data-c="pips"></td><td data-c="pnl"></td>
      <td class="acts-c"><div class="acts"><button data-act="half">½</button><button data-act="be">BE</button><button data-act="rev" data-tip="Close this position and open the same size the other way" aria-label="Rev: close this position and open the same size the other way">Rev</button><button class="x" data-act="close" data-tip="Close this position at market" aria-label="Close this position at market">✕</button></div></td></tr>`).join('') + sentRows('pos', 10);
    $('#posEmpty').hidden = S.positions.length > 0 || body.querySelector('.tl-sent') != null; $('#cPos').textContent = S.positions.length; { const tb = $('#tab-positions'); if (tb) tb.classList.toggle('has', S.positions.length > 0); }
    dirty.pos = false;
  }
  // the total row: lots and P&L of every open position, in the same cells as the rows above (the column hides apply)
  const tb = body.closest('table');
  let ft = tb && tb.tFoot; if (tb && !ft) { ft = tb.createTFoot(); ft.id = 'posFoot'; ft.innerHTML = `<tr><th scope="row" class="l">Total</th><td></td><td data-c="tlots"></td><td></td><td></td><td></td><td></td><td></td><td data-c="tpnl"></td><td></td></tr>`; }
  let tl = 0, tp = 0;
  for (const tr of body.children) {
    const p = S.positions.find(x => x.id === +tr.dataset.id); if (!p) continue;
    const r = posPnl(p); tl += p.lots; tp += r.pnl;
    tr.querySelector('[data-c=px]').textContent = fp(p.sym, r.exit);
    const pi = tr.querySelector('[data-c=pips]'); pi.textContent = sgn(r.pips); pi.className = cls(r.pips); const sp = tr.querySelector('.pos-pp'); if (sp) { const v = sgn(r.pips) + (M(p.sym).unit === 'pt' ? 'pt' : 'p'); if (sp.textContent !== v) sp.textContent = v; }
    const pn = tr.querySelector('[data-c=pnl]'); pn.textContent = usdFmt(r.pnl, true); pn.className = cls(r.pnl); pn.title = p.swap ? `includes swap ${usdFmt(p.swap, true)}` : '';
    actState(tr, p);
    for (const f of ['sl', 'tp']) { const td = tr.querySelector(`[data-edit=${f}]`); if (!td.querySelector('input')) td.textContent = p[f] != null ? fp(p.sym, p[f]) + (f === 'sl' && p.trail ? ' ↻' : '') : ''; td.classList.toggle('unset', p[f] == null); if (p[f] == null) td.setAttribute('aria-label', f === 'sl' ? 'No stop-loss set' : 'No take-profit set'); else td.removeAttribute('aria-label'); }
  }
  if (ft) {
    ft.hidden = !S.positions.length;
    const n = S.positions.length, th = ft.querySelector('th'); th.textContent = `Total · ${n} position${n === 1 ? '' : 's'}`;
    ft.querySelector('[data-c=tlots]').textContent = tl.toFixed(2);
    const pn = ft.querySelector('[data-c=tpnl]'); pn.textContent = usdFmt(tp, true); pn.className = cls(tp); pn.title = 'Floating P&L of all open positions, swaps included';
  }
}
/* F12: a pending order's SL / TP in prices, as Positions shows them. The order holds them as distances from its fill
   (slPips, tpPips); the price is where they land if it fills at the order price, the distance stays in the tip. */
function ordExit(o, f) {
  const n = +o[f + 'Pips']; if (!(n > 0)) return `<td class="editable unset" data-edit="${f}" title="Click to set a ${f === 'sl' ? 'stop-loss' : 'take-profit'}">—</td>`;
  const m = M(o.sym), d = (o.side === 'buy' ? 1 : -1) * (f === 'sl' ? -1 : 1), px = o.price + d * n * m.pip;
  const tip = `${f === 'sl' ? 'Stop-loss' : 'Take-profit'} ${n} ${unitWord(o.sym)} from the fill: ${fp(o.sym, px)} if it fills at the order price`;
  return `<td class="editable" data-edit="${f}" data-c="${f}" title="${escHtml(tip)} · click to edit">${fp(o.sym, px)}<span class="sr-only"> (${n} ${unitWord(o.sym)} from the fill)</span></td>`;
}
function renderOrders() {
  if (dirty.ord) {
    $('#ordBody').innerHTML = S.orders.map(o => `<tr data-id="${escHtml(o.id)}"><td class="sym" data-sym="${o.sym}">${pretty(o.sym)}</td><td><span class="tag ${o.side}">${o.side} ${o.ot}</span></td><td>${o.lots.toFixed(2)}</td><td data-c="price">${fp(o.sym, o.price)}</td><td data-c="dist"></td>${ordExit(o, 'sl')}${ordExit(o, 'tp')}<td><div class="acts"><button class="x" data-act="cancel">Cancel</button></div></td></tr>`).join('') + sentRows('ord', 8);
    $('#ordEmpty').hidden = S.orders.length > 0 || $('#ordBody .tl-sent') != null; $('#cOrd').textContent = S.orders.length; dirty.ord = false; { const tb = $('#tab-orders'); if (tb) tb.classList.toggle('has', S.orders.length > 0); }
  }
  for (const tr of $('#ordBody').children) {
    const o = S.orders.find(x => String(x.id) === tr.dataset.id); if (!o) continue;
    const q = Engine.quote(o.sym), ref = o.side === 'buy' ? q.ask : q.bid;
    tr.querySelector('[data-c=dist]').textContent = (Math.abs(o.price - ref) / M(o.sym).pip).toFixed(1) + ' ' + unitWord(o.sym);
    tr.querySelector('[data-c=price]').textContent = fp(o.sym, o.price);
  }
}
/* F14: what a closed trade cost and what it left. A trade row (core/account.js closePos, the same on the server) has pnl =
   price move + swap, swap (credit +, charge −), comm (the commission of the part closed, booked on the balance apart from
   pnl) and slip (in the exit price already). The columns: P&L (gross) = the price move alone, Costs = swap − commission,
   Net = pnl − commission (what reached the balance). A row without comm (older saves) shows '—' for Costs and Net. */
const okAmt = v => typeof v === 'number' && Number.isFinite(v);
function histMoney(h) {
  const swap = okAmt(h.swap) ? h.swap : 0, gross = h.pnl - swap;
  if (h.nbp) return { gross: h.pnl, costs: null, net: h.pnl, why: 'Balance credit (negative balance protection): no trading costs' };
  if (!okAmt(h.comm)) return { gross, costs: null, net: null, why: `Commission not recorded for this trade; P&L with swap ${usdFmt(h.pnl, true)}` };
  const sl = okAmt(h.slip) && typeof slipWords === 'function' ? ` · exit slippage ${slipWords(h.slip, h.sym)} (in the exit price)` : '';
  return { gross, costs: swap - h.comm, net: h.pnl - h.comm, why: `Commission ${usdFmt(-h.comm, true)} · swap ${usdFmt(swap, true)}${sl}` };
}
// the head (index.html) gets the time zone, the gross label and the two cost columns once
function histHead() {
  const tr = document.querySelector('#histBody')?.closest('table')?.tHead?.rows[0]; if (!tr || tr.dataset.costs) return;
  tr.dataset.costs = '1';
  tr.cells[0].textContent = 'Closed (UTC)';
  tr.cells[8].textContent = 'P&L (gross)'; tr.cells[8].title = 'Price move only, before swap and commission';
  const th = (t, tip) => { const c = document.createElement('th'); c.textContent = t; c.title = tip; tr.appendChild(c); };
  th('Comm + swap', 'Swap minus commission. Spread and slippage are not here: they are in the entry and exit prices (see the Receipt of the row)');
  th('Net', 'What reached the balance: P&L (gross) + costs');
}
function renderHistory() {
  if (!dirty.hist) return;
  histHead();
  // a protection row is a balance credit: no side tag, no size
  $('#histBody').innerHTML = S.history.slice(0, 200).map(h => { const $m = histMoney(h), why = escHtml($m.why); return `<tr${h.nbp ? ' class="nbp"' : ''}><td>${dts(h.close)}</td><td class="sym" data-sym="${h.sym}">${pretty(h.sym)}</td><td>${h.nbp ? '—' : `<span class="tag ${h.side}">${h.side}</span>`}</td><td>${h.nbp ? '—' : h.lots.toFixed(2)}</td><td>${fp(h.sym, h.entry)}</td><td>${fp(h.sym, h.exit)}</td><td class="${cls(h.pips)}">${sgn(h.pips)}</td><td class="${cls(h.r || 0)}">${h.r != null ? sgn(h.r, 2) + 'R' : '—'}</td><td class="${cls($m.gross)}" title="${escHtml('With swap: ' + usdFmt(h.pnl, true))}">${usdFmt($m.gross, true)}</td><td class="muted">${escHtml(h.reason)}${/stop/i.test(h.reason || '') && okAmt(h.slip) && (h.gap || h.slip >= 5) ? ` <b class="dn">· gap ${h.slip.toFixed(1)}</b>` : ''}</td><td data-c="costs" class="muted" title="${why}">${$m.costs == null ? '—' : usdFmt($m.costs, true)}</td><td data-c="net" class="${$m.net == null ? 'muted' : cls($m.net)}" title="${why}">${$m.net == null ? '—' : usdFmt($m.net, true)}</td></tr>`; }).join('');
  $('#histEmpty').hidden = S.history.length > 0;
  dirty.hist = false; dirty.journal = true;
}
function renderAlerts() {
  syncInstrSelect($('#alSym'));
  if (dirty.al) {
    $('#alBody').innerHTML = S.alerts.map(a => `<tr data-id="${escHtml(a.id)}"><td class="sym" data-sym="${a.sym}">${pretty(a.sym)}</td><td>${a.cond}</td><td>${fp(a.sym, a.price)}</td><td data-c="dist"></td><td>${a.done ? `<span class="tag lo">Triggered ${hhmm(a.at)}</span>` : '<span class="tag md">Active</span>'}</td><td><div class="acts"><button class="x" data-act="del">✕</button></div></td></tr>`).join('');
    $('#alEmpty').hidden = S.alerts.length > 0; $('#cAl').textContent = S.alerts.filter(a => !a.done).length; { const tb = $('#tab-alerts'); if (tb) tb.classList.toggle('has', S.alerts.some(a => !a.done)); } dirty.al = false;
  }
  for (const tr of $('#alBody').children) {
    const a = S.alerts.find(x => String(x.id) === tr.dataset.id); if (!a) continue;
    tr.querySelector('[data-c=dist]').textContent = ((a.price - Engine.quote(a.sym).mid) / M(a.sym).pip).toFixed(1) + ' ' + unitWord(a.sym);
  }
}
// the dock strip below 1280 px keeps its buttons pinned at the right (styles.css ab2-dock): the tabs' right scroll
// arrow sits just left of them, so it needs their width
(function dockStripR() {
  const r = document.querySelector('.dock .tabs-r'), w = r && r.closest('.tabs-wrap');
  if (!r || !w || typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => w.style.setProperty('--dock-r', r.offsetWidth + 'px')).observe(r);
})();
function renderAccount() {
  const a = account();
  S.peak = Math.max(S.peak || INIT_BAL, a.eq);
  const dd = (S.peak - a.eq) / S.peak * 100;
  $('#mBal').textContent = usdFmt(S.balance); $('#mEq').textContent = usdFmt(a.eq);
  const pn = $('#mPnl'); pn.textContent = usdFmt(a.fl, true); pn.className = cls(a.fl);
  document.body.classList.toggle('link-down', typeof TradeLink === 'object' && TradeLink.live && !TradeLink.up);
  document.body.classList.toggle('pnl-stale', (typeof TradeLink === 'object' && TradeLink.live && !TradeLink.up) || !!document.querySelector('#feedPill.feed-down')); // figures as last seen (UX-22, UX-23)
  $('#mMargin').textContent = usdFmt(a.mg); { const fr = $('#mFree'); fr.textContent = usdFmt(a.free); fr.className = a.free < 0 ? 'dn' : ''; }
  syncLevSel(); // also after an import that set #levSel to a bare number
  const lv = $('#mLevel'); lv.textContent = isFinite(a.level) ? nf0.format(a.level) + '%' : '—'; lv.className = a.level < 100 ? 'dn lv-call' : a.level < 150 ? 'dn' : '';
  // under 100% the cell says what happens next, for as long as it lasts (UX-5): a toast would be gone in seconds
  { const lb = lv.previousElementSibling, t = a.level < 100 ? 'Stop-out at 50%' : 'Margin level'; if (lb && lb.textContent !== t) lb.textContent = t; }
  const d = $('#mDD'); d.textContent = pct(-dd, 2); d.className = dd > .01 ? 'dn' : '';
  $('#simClock').textContent = new Date(Engine.simTime * 1000).toISOString().slice(11, 19) + ' UTC';
  const q = Engine.quote(S.set.sym), arr = Engine.candles[S.set.sym], ref = arr[Math.max(0, arr.length - 1441)].close, ch = (q.mid / ref - 1) * 100;
  $('#symMid').innerHTML = bigPx(S.set.sym, q.mid);
  const c = $('#symChg'); c.innerHTML = `${pct(ch)} <span class="chg-per">24h</span>`; c.className = 'chg mono ' + cls(ch);
}

/* ============ intelligence ============ */
function renderStrength() {
  const st = Engine.strength(S.set.strLb), max = Math.max(...st.map(x => Math.abs(x.s)), 1);
  $('#strength').innerHTML = st.map(x => {
    // a signed reading, not a gain or a loss: the diverging tokens, the sign written out
    const w = Math.abs(x.s) / max * 50, col = x.s >= 0 ? 'var(--div-pos)' : 'var(--div-neg)';
    return `<div class="str-row"><b>${x.c}</b><div class="str-track"><div class="str-fill" style="left:${x.s >= 0 ? 50 : 50 - w}%;width:${w}%;background:${col}"></div></div><span>${sgn(x.s, 0)} bp</span></div>`;
  }).join('') + '<div class="sess-note">G8 currencies, measured through their 16 pairs</div>';
  const top = st[0].c, bot = st[st.length - 1].c;
  const p = Engine.PAIRS.find(p => (p.base === top && p.quote === bot) || (p.base === bot && p.quote === top));
  const idea = $('#strIdea');
  if (p) { const side = p.base === top ? 'buy' : 'sell'; idea.dataset.sym = p.sym; idea.dataset.side = side; idea.innerHTML = `Strongest <b>${top}</b> vs weakest <b>${bot}</b> → strength gap on <b>${pretty(p.sym)}</b>. Click to load.`; }
  else { idea.dataset.sym = ''; idea.innerHTML = `Strongest <b>${top}</b> vs weakest <b>${bot}</b> · no listed pair for this combination.`; }
}
/* Net exposure in USD notional. A pair splits into its two currencies (any of the 15, the G8 and the others). Any
   other instrument is an exposure to its type: stocks by sector ('stock:Technology'), the rest by group (metal,
   energy, agri, index, rates, crypto), one row each in USD (`inst` keeps the per-instrument split for the tooltip),
   and, when it is quoted in another currency than USD, to that currency as well: long DE.30 is long EUR. The same
   split feeds the Market Brief and the basket tool. */
const ASSET_GRP = { metal: 'Metals', energy: 'Energy', agri: 'Agriculture', index: 'Indices', rates: 'Rates', crypto: 'Crypto' };
const assetKey = m => m.group === 'stock' ? 'stock:' + (m.sector || 'Other') : m.group;
const assetName = k => k.startsWith('stock:') ? 'Stocks · ' + k.slice(6) : ASSET_GRP[k] || k;
function exposureOf(positions = S.positions) {
  const ccy = {}, asset = {}, inst = {}, add = (o, k, v) => { if (isFinite(v)) o[k] = (o[k] || 0) + v; };
  for (const p of positions) {
    const m = M(p.sym); if (!m) continue;
    const d = p.side === 'buy' ? 1 : -1, n = notionalUsd(p.sym, p.lots);
    if (m.kind === 'cfd') { add(asset, assetKey(m), d * n); add(inst, m.sym, d * n); if (m.quote && m.quote !== 'USD') add(ccy, m.quote, d * n); continue; }
    add(ccy, m.base, d * n); add(ccy, m.quote, -d * n);
  }
  return { ccy, asset, inst };
}
const expK = v => `${v < 0 ? '−' : '+'}${Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : (Math.abs(v) / 1000).toFixed(0) + 'k'}`;
function renderExposure() {
  const { ccy, asset, inst } = exposureOf(), by = o => Object.entries(o).filter(([, v]) => Math.abs(v) > 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const rows = by(ccy), arows = by(asset), irows = by(inst);
  if (!rows.length && !arows.length) { $('#exposure').innerHTML = '<div class="empty-sm">Flat. Open positions to see your true currency exposure — e.g. long EUR/USD + long GBP/USD = double short USD.</div>'; return; }
  const max = Math.max(...rows.concat(arows).map(r => Math.abs(r[1])));
  const bar = (name, v, title = '') => { const w = Math.abs(v) / max * 50; return `<div class="str-row${title ? ' exp-in' : ''}"${title ? ` title="${escHtml(title)}"` : ''}><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</b><div class="str-track"><div class="str-fill" style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'}"></div></div><span>${expK(v)}</span></div>`; };
  $('#exposure').innerHTML = rows.map(([c, v]) => bar(c, v)).join('') +
    (arows.length ? `<div class="exp-sub" title="Net USD notional of your positions outside FX: stocks by sector, the rest by type">Asset exposure (USD)</div>` + arows.map(([g, v]) => bar(assetName(g), v,
      `${assetName(g)}, net ${v >= 0 ? 'long' : 'short'} ${usdFmt(Math.abs(v))}: ` + irows.filter(([s]) => assetKey(M(s)) === g).map(([s, x]) => `${M(s).short} ${x >= 0 ? 'long' : 'short'} ${usdFmt(Math.abs(x))}`).join(', '))).join('') : '');
}
const SESS = [['Sydney', [[21, 24], [0, 6]]], ['Tokyo', [[0, 9]]], ['London', [[7, 16]]], ['New York', [[12, 21]]]];
function renderSessions() {
  const d = new Date(Engine.simTime * 1000), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const open = SESS.filter(([, b]) => b.some(([a, z]) => h >= a && h < z)).map(s => s[0]);
  $('#sessions').innerHTML = SESS.map(([n, bands]) => {
    const o = open.includes(n);
    return `<div class="sess-row"><span class="nm"><i class="dot ${o ? 'open' : ''}"></i>${n}</span><div class="sess-track">${bands.map(([a, z]) => `<div class="sess-band ${o ? 'open' : ''}" style="left:${a / 24 * 100}%;width:${(z - a) / 24 * 100}%"></div>`).join('')}<div class="sess-now" style="left:${h / 24 * 100}%"></div></div></div>`;
  }).join('') + `<div class="sess-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div class="sess-note">${open.length > 1 ? `<b>${open.join(' + ')}</b> overlap — peak liquidity and volatility.` : open.length ? `${open[0]} session active.` : 'Between sessions — thin liquidity.'}</div>`;
  $('#sessNow').textContent = hhmm(Engine.simTime) + ' UTC';
}

/* ============ economic calendar ============
   With the platform's live prices: the week's real calendar (ForexFactory, /api/calendar, server/calendar.js), read at
   boot and every 30 minutes; times, impact, forecast and previous as published, no actual values, no effect on prices.
   On the simulated market (no feed: offline, tests, replays) the simulated calendar below drives the news moves. */
const TEMPL = [
  ['USD', 'Non-Farm Payrolls', 'hi', 'K', 150, 60], ['USD', 'CPI m/m', 'hi', '%', .3, .15], ['USD', 'Fed Chair Testimony', 'hi', '', null, null], ['USD', 'ISM Services PMI', 'md', '', 52.5, 1.5], ['USD', 'Initial Jobless Claims', 'md', 'K', 225, 12, true], ['USD', 'Retail Sales m/m', 'md', '%', .4, .4],
  ['EUR', 'ECB Rate Decision', 'hi', '%', 2.0, 0], ['EUR', 'German ZEW Sentiment', 'md', '', 12, 8], ['EUR', 'Flash PMI Composite', 'md', '', 50.4, 1.2],
  ['GBP', 'CPI y/y', 'hi', '%', 3.1, .25], ['GBP', 'Retail Sales m/m', 'md', '%', .2, .5], ['JPY', 'BoJ Policy Statement', 'hi', '', null, null], ['JPY', 'Tokyo Core CPI y/y', 'md', '%', 2.2, .2],
  ['AUD', 'Employment Change', 'hi', 'K', 25, 20], ['CAD', 'Employment Change', 'hi', 'K', 20, 18], ['NZD', 'GDP q/q', 'md', '%', .4, .3], ['CHF', 'CPI m/m', 'md', '%', .1, .15], ['USD', 'Crude Oil Inventories', 'lo', 'M', -1.2, 2.5]
];
const CAL = { events: [], nextT: 0, src: 'sim', at: 0, err: '' };
const calKey = e => e.t + '|' + e.ccy + '|' + e.name;
let calNext = 0, calBusy = false;
function calLoad() {
  if (calBusy) return; calBusy = true;
  fetch('/api/calendar', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.json().then(j => { if (!r.ok || !j || !Array.isArray(j.events)) throw new Error((j && j.error) || 'Calendar unavailable (' + r.status + ')'); return j; }))
    .then(j => {
      const old = new Map(CAL.events.map(e => [calKey(e), e])), now = Engine.simTime;
      CAL.events = j.events.filter(e => e && Number.isFinite(e.t) && /^[A-Z]{3}$/.test(e.ccy)).map(e => {
        const o = old.get(calKey(e)) || {};
        // a release that was already out when the calendar loaded is history: no toast, no news tag on positions (behav.js)
        // the feed is a third party's (server/calendar.js): its words reach innerHTML here and in brief.js, so no markup
        // characters get in (security audit 09.11.2026, F01); fmtNum's output is escaped where it is shown as well
        const txt = v => (typeof v === 'string' ? v.replace(/[<>"'`]/g, '') : '');
        return { id: calKey(e), t: e.t, ccy: e.ccy, name: txt(e.name) + (e.holiday && !/holiday/i.test(e.name) ? ' (holiday)' : ''), impact: ['hi', 'md', 'lo'].includes(e.impact) ? e.impact : 'lo', unit: '', fc: txt(e.fc), prev: txt(e.prev), actual: null, done: e.t <= now, real: true, _bh: o._bh || (e.t <= now ? 1 : 0), _seen: o._seen || e.t <= now };
      });
      CAL.src = 'live'; CAL.at = j.at || Date.now(); CAL.err = j.stale ? 'stale' : '';
      if (typeof renderCalendar === 'function') renderCalendar();
    })
    .catch(e => { CAL.err = e.message || 'Calendar unavailable'; if (CAL.src !== 'live') { CAL.src = 'down'; CAL.events = []; } })
    .finally(() => { calBusy = false; calNext = Date.now() + (CAL.src === 'live' ? 30 : 2) * 60000; });
}
function fmtNum(v, unit) { if (typeof v === 'string') return v || '—'; if (v == null) return '—'; const d = unit === 'K' ? 0 : unit === '%' ? (Math.abs(v) < 1 ? 1 : 2) : 1; const t = v.toFixed(d); return (+t === 0 ? Math.abs(+t).toFixed(d) : t) + unit; }
function genEvent(t) {
  const [ccy, name, impact, unit, base, sd, inv] = TEMPL[Math.floor(Math.random() * TEMPL.length)];
  const fc = base == null ? null : base + (Math.random() - .5) * (sd || .1);
  const prev = fc == null ? null : fc + (Math.random() - .5) * (sd || .1) * 1.4;
  return { id: Math.random().toString(36).slice(2), t, ccy, name, impact, unit, fc, prev, sd, inv, done: false, actual: null };
}
function calTick() {
  if (Engine.feedOn) {
    // real calendar: no generated events, no price or spread effects; a high-impact release says so when it is due
    if (CAL.src === 'sim') { CAL.events = []; CAL.src = 'down'; }
    if (Date.now() >= calNext) calLoad();
    for (const e of CAL.events) if (!e.done && Engine.simTime >= e.t) {
      e.done = true;
      if (!e._seen && e.impact === 'hi') { e._seen = true; const exposed = S.positions.some(p => M(p.sym).newsCcy.includes(e.ccy)); toast(`${e.ccy} ${e.name}`, `Scheduled release now${exposed ? ' · you are exposed' : ''} — expect wider spreads for a few minutes`, 'info'); beep('news'); }
    }
    return;
  }
  if (!CAL.nextT) CAL.nextT = Engine.simTime + 15 * 60;
  while (CAL.events.filter(e => !e.done).length < 10) { CAL.events.push(genEvent(CAL.nextT)); CAL.nextT += (35 + Math.random() * 110) * 60; }
  // high-impact releases widen the spreads of their currency ×2–4 from 2 minutes before to 2 minutes after
  for (const e of CAL.events) if (e.impact === 'hi' && !e.wide && Engine.simTime >= e.t - 120 && Engine.simTime < e.t + 120) { e.wide = 2 + Math.random() * 2; Engine.setNewsMult(e.ccy, e.wide, e.t + 120); }
  for (const e of CAL.events) {
    if (e.done || Engine.simTime < e.t) continue;
    e.done = true;
    const z = Math.max(-3, Math.min(3, (Math.random() + Math.random() + Math.random() - 1.5) * 2));
    e.actual = e.fc == null ? null : e.fc + z * (e.sd || .1) * .6;
    const size = { hi: .0022, md: .0009, lo: .0003 }[e.impact] * (e.fc == null ? (Math.random() - .5) * 2.4 : z * .6 * (e.inv ? -1 : 1));
    Engine.jump(e.ccy, size);
    e.move = size;
    if (e.impact !== 'lo') {
      const exposed = S.positions.some(p => M(p.sym).newsCcy.includes(e.ccy)); // the currencies whose news move the instrument
      toast(`${e.ccy} ${e.name}`, e.actual != null ? `Actual ${fmtNum(e.actual, e.unit)} vs ${fmtNum(e.fc, e.unit)} forecast${exposed ? ' · you are exposed' : ''}` : `Released${exposed ? ' · you are exposed' : ''}`, size >= 0 ? 'up move' : 'dn move');
      if (e.impact === 'hi') beep('news');
    }
  }
  const past = CAL.events.filter(e => e.done);
  if (past.length > 8) CAL.events = CAL.events.filter(e => !e.done || past.slice(-8).includes(e));
}
const fmtIn = s => s < 0 ? '—' : s < 3600 ? `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
// calendar filters live for the session only (not part of the exported state)
const CALF = { imp: { hi: true, md: true, lo: true }, ccy: (() => { try { return localStorage.getItem('tb-cal-ccy') || ''; } catch (e) { return ''; } })(), loOpen: false };
// Med and High releases due within 24 hours count down to the second; the rest keep the short form
const CAL_CD = 86400;
const fmtCd = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}h ${String(m).padStart(2, '0')}m ${x}s` : `${m}m ${x}s`; };
const calIn = e => { const s = e.t - Engine.simTime; return e.impact !== 'lo' && s >= 0 && s < CAL_CD ? `<span class="cal-cd" data-cd="${e.t}">${fmtCd(s)}</span>` : fmtIn(s); };
// the countdowns tick every second between the calendar's 2-second redraws
setInterval(() => { const b = document.getElementById('calBody'); if (!b || !b.offsetParent) return; b.querySelectorAll('[data-cd]').forEach(el => { const t = fmtCd(+el.dataset.cd - Engine.simTime); if (el.textContent !== t) el.textContent = t; }); }, 250);
function calFilterBar() {
  let f = $('#calF'); if (f) return f;
  const wrap = $('#calBody').closest('.tab'); if (!wrap) return null;
  f = document.createElement('div'); f.id = 'calF'; f.className = 'cal-f';
  f.innerHTML = `<span class="muted small">Impact</span><div class="mini-seg" role="group" aria-label="Impact">${[['hi', 'High'], ['md', 'Med'], ['lo', 'Low']].map(([k, l]) => `<button data-imp="${k}" class="on" aria-pressed="true">${l}</button>`).join('')}</div><label class="muted small cal-ccy">Currency <select id="calCcy" aria-label="Currency"><option value="">All</option></select></label><span class="muted small cal-n" id="calN"></span>`;
  wrap.prepend(f);
  f.addEventListener('click', e => { const b = e.target.closest('[data-imp]'); if (!b) return; const k = b.dataset.imp; CALF.imp[k] = !CALF.imp[k]; b.classList.toggle('on', CALF.imp[k]); b.setAttribute('aria-pressed', CALF.imp[k]); renderCalendar(); });
  f.querySelector('#calCcy').addEventListener('change', e => { CALF.ccy = e.target.value; try { localStorage.setItem('tb-cal-ccy', CALF.ccy); } catch (x) {} renderCalendar(); });
  return f;
}
// small flags for the calendar's currencies (inline SVG: emoji flags are letters on Windows)
const CAL_FLAG = (() => {
  const star = (cx, cy, r, f) => `<polygon fill="${f}" points="${[...Array(10)].map((_, i) => { const a = Math.PI / 5 * i - Math.PI / 2, q = i % 2 ? r * .4 : r; return `${(cx + q * Math.cos(a)).toFixed(2)},${(cy + q * Math.sin(a)).toFixed(2)}`; }).join(' ')}"/>`;
  const uk = '<rect width="60" height="30" fill="#012169"/><path d="M0,0 60,30M60,0 0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 60,30M60,0 0,30" stroke="#C8102E" stroke-width="2"/><path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6"/>';
  const canton = `<svg width="10" height="5" viewBox="0 0 60 30" preserveAspectRatio="none">${uk}</svg>`;
  const f = (vb, body) => `<svg class="cal-flg" viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
  return {
    USD: f('0 0 19 10', '<rect width="19" height="10" fill="#B22234"/>' + [1, 3, 5, 7, 9, 11].map(i => `<rect y="${(i * 10 / 13).toFixed(2)}" width="19" height="${(10 / 13).toFixed(2)}" fill="#fff"/>`).join('') + '<rect width="7.6" height="5.38" fill="#3C3B6E"/>'),
    EUR: f('0 0 15 10', '<rect width="15" height="10" fill="#039"/>' + [...Array(12)].map((_, i) => star(7.5 + 3 * Math.cos(Math.PI / 6 * i), 5 + 3 * Math.sin(Math.PI / 6 * i), .6, '#FC0')).join('')),
    GBP: f('0 0 60 30', uk),
    JPY: f('0 0 15 10', '<rect width="15" height="10" fill="#fff"/><circle cx="7.5" cy="5" r="3" fill="#BC002D"/>'),
    AUD: f('0 0 20 10', '<rect width="20" height="10" fill="#012169"/>' + canton + star(5, 7.5, 1.5, '#fff') + [[15, 8.3], [12.6, 4.4], [15, 1.9], [17.2, 3.9]].map(([x, y]) => star(x, y, .75, '#fff')).join('')),
    NZD: f('0 0 20 10', '<rect width="20" height="10" fill="#012169"/>' + canton + [[15, 8.3], [12.6, 4.4], [15, 1.9], [17.2, 3.9]].map(([x, y]) => star(x, y, .85, '#C8102E')).join('')),
    CAD: f('0 0 20 10', '<rect width="20" height="10" fill="#D52B1E"/><rect x="5" width="10" height="10" fill="#fff"/><polygon fill="#D52B1E" points="10,1.6 10.9,3.4 12.6,2.9 12,5 13.4,5.5 10.4,7.3 10.4,8.8 9.6,8.8 9.6,7.3 6.6,5.5 8,5 7.4,2.9 9.1,3.4"/>'),
    CHF: f('0 0 15 10', '<rect width="15" height="10" fill="#DA291C"/><rect x="6.5" y="2" width="2" height="6" fill="#fff"/><rect x="4.5" y="4" width="6" height="2" fill="#fff"/>'),
    CNY: f('0 0 15 10', '<rect width="15" height="10" fill="#DE2910"/>' + star(2.6, 2.6, 1.6, '#FFDE00') + [[5, 1], [6, 2], [6, 3.4], [5, 4.4]].map(([x, y]) => star(x, y, .5, '#FFDE00')).join('')),
  };
})();
const calFlag = c => CAL_FLAG[c] || '<span class="cal-flg cal-flg-x" aria-hidden="true"></span>';
/* Med and High releases open an explanation of the indicator: what it is, how to read it, how it can move the market.
   The explanations were researched once (09.11.2026) for every recurring Medium/High ForexFactory event and are kept in
   indicators.json, read on the first click; titles match exactly, then without Prelim/Flash/Final… and m/m-y/y. */
let CI_DB = null, CI_LOAD = null;
const ciLoad = () => CI_LOAD || (CI_LOAD = fetch('indicators.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => (CI_DB = Array.isArray(j) ? j : j.indicators || [])).catch(e => { CI_LOAD = null; throw e; }));
const ciBase = t => t.toLowerCase().replace(/\b(prelim|preliminary|flash|final|revised|advance|second estimate|third estimate)\b/g, '').replace(/\b(m\/m|q\/q|y\/y|3m\/3m|annualized|ann)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function ciFind(ccy, name) {
  const db = (CI_DB || []).filter(x => x.ccy === ccy), t = name.replace(/ \(holiday\)$/, '');
  return db.find(x => (x.titles || []).includes(t))
    || db.find(x => (x.patterns || []).some(p => { try { return new RegExp(p).test(t); } catch (e) { return false; } }))
    || db.find(x => (x.titles || []).some(y => ciBase(y) === ciBase(t))) || null;
}
function ciOpen(ev) {
  let el = $('#ciDlg');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'ciDlg'; document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-cf]')) ciClose(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); ciClose(); } });
  }
  const imp = { hi: 'High', md: 'Med' }[ev.impact] || 'Low', when = `${dts(ev.t)} UTC · ${ev.done ? 'released' : 'in ' + fmtIn(ev.t - Engine.simTime)}`;
  const nums = [['Forecast', fmtNum(ev.fc, ev.unit)], ['Previous', fmtNum(ev.prev, ev.unit)]];
  const show = body => {
    el.innerHTML = `<div class="modal cf-modal ci-modal" role="dialog" aria-modal="true" aria-labelledby="ciT">
      <div class="ph"><span class="tag ${ev.impact}">${imp}</span><h2 id="ciT">${calFlag(ev.ccy)}${ev.ccy} · ${escHtml(ev.name)}</h2><button type="button" class="cd-x" data-cf="cancel" aria-label="Close">Close</button></div>
      <dl class="ci-sum"><div><dt>Release</dt><dd>${when}</dd></div>${nums.map(([k, v]) => `<div><dt>${k}</dt><dd>${escHtml(v || '—')}</dd></div>`).join('')}</dl>
      <div class="ci-body">${body}</div></div>`;
    el.hidden = false; el.querySelector('[data-cf=cancel]').focus({ preventScroll: true });
  };
  const li = a => `<ul>${(a || []).map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>`;
  const fill = () => {
    const x = ciFind(ev.ccy, ev.name);
    if (!x) return show(`<p class="ci-none">No explanation for this release yet. The library covers the recurring Medium and High events; this one is not in it.</p>`);
    const better = { higher: 'A result above the forecast is usually read as good for the currency, below as bad.', lower: 'A result below the forecast is usually read as good for the currency, above as bad.' }[x.better];
    show(`<h3>${escHtml(x.name)}</h3><p class="ci-meta">${escHtml(x.source || '')}${x.freq ? ' · ' + escHtml(x.freq) : ''}</p>
      <section><h4>What it is</h4><p>${escHtml(x.what || '')}</p></section>
      <section><h4>How to read it</h4>${li(x.read)}${better ? `<p class="ci-better">${better}</p>` : ''}</section>
      <section><h4>How it can move the market</h4>${li(x.market)}</section>
      ${(x.sources || []).length ? `<p class="ci-src">Sources: ${x.sources.map(u => { let h = u; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch (e) {} return /^https?:\/\//.test(u) ? `<a href="${escHtml(u)}" target="_blank" rel="noopener">${escHtml(h)}</a>` : ''; }).filter(Boolean).join(' · ')}</p>` : ''}`);
  };
  ciOpen.ret = document.activeElement;
  if (CI_DB) fill(); else { show('<p class="ci-none">Loading the explanation…</p>'); ciLoad().then(fill, () => show('<p class="ci-none">The explanations could not be loaded. Check the connection and try again.</p>')); }
}
function ciClose() { const el = $('#ciDlg'); if (el) el.hidden = true; const r = ciOpen.ret; if (r && r.isConnected) r.focus({ preventScroll: true }); else { const k = r && r.dataset && r.dataset.ci; const b = k && [...document.querySelectorAll('#calBody .cal-x')].find(x => x.dataset.ci === k); if (b) b.focus({ preventScroll: true }); } }
function renderCalendar() {
  const f = calFilterBar(), sel = f && f.querySelector('#calCcy');
  const all = CAL.events.slice().sort((a, b) => a.t - b.t), ccys = [...new Set(all.map(e => e.ccy))].sort();
  if (sel && sel.dataset.k !== ccys.join()) { sel.dataset.k = ccys.join(); if (CALF.ccy && !ccys.includes(CALF.ccy)) ccys.push(CALF.ccy); sel.innerHTML = '<option value="">All</option>' + ccys.map(c => `<option${c === CALF.ccy ? ' selected' : ''}>${c}</option>`).join(''); }
  const match = all.filter(e => CALF.imp[e.impact] !== false && (!CALF.ccy || e.ccy === CALF.ccy));
  if (f) f.querySelector('#calN').textContent = match.length === all.length ? `${all.length} events` : `${match.length} of ${all.length} events`;
  // low-impact releases fold into one faded line; a click on it lists them in their places
  const los = match.filter(e => e.impact === 'lo'), rows = CALF.loOpen ? match : match.filter(e => e.impact !== 'lo');
  const body = $('#calBody');
  if (!body.dataset.lo) { body.dataset.lo = '1'; body.addEventListener('click', e => { const x = e.target.closest('.cal-x'); if (x) { const ev = CAL.events.find(v => calKey(v) === x.dataset.ci); if (ev) ciOpen(ev); return; } if (!e.target.closest('.cal-lo-g')) return; CALF.loOpen = !CALF.loOpen; renderCalendar(); }); body.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.cal-lo-g')) { e.preventDefault(); CALF.loOpen = !CALF.loOpen; renderCalendar(); $('#calBody .cal-lo-g')?.focus(); } }); }
  const loLeft = los.filter(e => !e.done).length;
  const loRow = los.length ? `<tr class="cal-lo-g${CALF.loOpen ? ' open' : ''}" tabindex="0" role="button" aria-expanded="${CALF.loOpen}" title="${CALF.loOpen ? 'Fold the low-impact releases into one line' : 'List the low-impact releases'}"><td colspan="8"><span class="cal-lo-c" aria-hidden="true">${CALF.loOpen ? '▾' : '▸'}</span><span class="tag lo">Low</span> Low impact · ${los.length} release${los.length > 1 ? 's' : ''}${loLeft < los.length ? ` (${loLeft} still to come)` : ''}<span class="cal-lo-a">${CALF.loOpen ? 'Hide' : 'Show'}</span></td></tr>` : '';
  // compact rows at their natural height (no stretching to the pane); the next release is the panel's hero row
  const next = rows.find(e => !e.done);
  // actual vs forecast is shown as a neutral arrow: above or below forecast is not good or bad for a position
  body.innerHTML = loRow + rows.map(e => {
    const d = e.actual != null && e.fc != null ? e.actual - e.fc : 0, arr = !e.done || !d ? '' : `<span class="cal-d" title="${d > 0 ? 'Above' : 'Below'} forecast">${d > 0 ? '▲' : '▼'}</span>`;
    return `<tr class="cal-${e.impact}${e.done ? ' cal-done' : e === next ? ' cal-next' : ''}"><td>${dts(e.t)}</td><td${e === next ? ' title="Next release"' : ''}>${e.done ? 'released' : calIn(e)}</td><td class="cal-c">${calFlag(e.ccy)}<b>${e.ccy}</b></td><td class="l cal-ev">${e.impact === 'lo' ? escHtml(e.name) : `<button type="button" class="link cal-x" data-ci="${escHtml(calKey(e))}" aria-haspopup="dialog" title="What this indicator is and how it can move the market">${escHtml(e.name)}</button>`}</td><td><span class="tag ${e.impact}">${{ hi: 'High', md: 'Med', lo: 'Low' }[e.impact]}</span></td><td>${escHtml(fmtNum(e.fc, e.unit))}</td><td>${escHtml(fmtNum(e.prev, e.unit))}</td><td${e.real && e.done ? ' title="Actual values are not in the free calendar feed"' : ''}>${e.done ? fmtNum(e.actual, e.unit) + arr : ''}</td></tr>`;
  }).join('') || (loRow ? '' : `<tr><td colspan="8" class="empty">${CAL.src === 'down' ? `Economic calendar unavailable${CAL.err ? ' (' + escHtml(CAL.err) + ')' : ''}. It is tried again in a couple of minutes.` : 'No events match these filters.'}</td></tr>`);
  const foot = $('#calFoot');
  if (foot) foot.textContent = CAL.src === 'sim' ? 'Built-in practice events, not the real calendar (no live prices). When an event releases, the surprise versus forecast moves its currency — plan stops around high-impact releases.'
    : `Real economic calendar for this week, from ForexFactory${CAL.at ? ', read ' + new Date(CAL.at).toISOString().slice(11, 16) + ' UTC' : ''}${CAL.err === 'stale' ? ' (the feed did not answer; last good copy)' : ''}. Times, impact, forecast and previous as published; actual values are not in this feed. Spreads widen around high-impact releases.`;
}

/* ============ correlation & volatility ============ */
// diverging blue (inverse) ↔ orange (together), neutral surface at 0: red/green stay reserved for buy/sell and P&L; the mix
// stops at 55% so cell text keeps 4.5:1 on the strongest cells (at 61% the dark theme fell to 4.46:1)
const corrBg = r => `color-mix(in srgb,var(${r >= 0 ? '--div-pos' : '--div-neg'}) ${Math.round(Math.min(1, Math.abs(r)) * 55)}%,transparent)`;
// G8: the 16 pairs of the G8 currencies; Yours: favourites ∪ held (positions, orders, alerts) ∪ visible (chart,
// multi-chart panes, watchlist rows the engine keeps hot), at most 30 (session-only choice)
const CORR = { set: 'fx', ord: 'def', ret: 1 }, CORR_MAX = 30, CORR_MIN_N = 30;
// returns over k minutes need enough of them in the window: 15-minute returns from 1D up, hourly from 3D up
const CORR_RET_MIN = { 1: 240, 15: 1440, 60: 4320 };
function mySyms() {
  const out = [], add = s => { if (typeof s === 'string' && M(s) && !out.includes(s)) out.push(s); };
  add(S.set.sym);
  (Array.isArray(S.set.fav) ? S.set.fav : []).forEach(add);
  S.positions.forEach(p => add(p.sym)); S.orders.forEach(o => add(o.sym)); (S.alerts || []).filter(a => !a.done).forEach(a => add(a.sym));
  ((S.set.mc && S.set.mc.panes) || []).forEach(p => add(p && p.sym));
  Engine.hotSet.forEach(add);
  return out;
}
const corrSyms = () => CORR.set === 'all' ? mySyms().slice(0, CORR_MAX) : Engine.PAIRS.map(p => p.sym);
/* Instruments with different sessions do not share every minute: their returns are paired on the minutes both
   have a bar (within the lookback), each return taken from the previous common minute. Fewer than 30 common
   returns: no figure. */
function corrSeries(sym, lb, end = Engine.simTime, k = CORR.ret || 1) {
  const arr = Engine.candles[sym] || [], t0 = end - lb * 60, out = [], step = k * 60;
  let i = arr.length - 1; while (i >= 0 && arr[i].time > end) i--;
  for (; i >= 0 && arr[i].time >= t0; i--) if (k === 1 || arr[i].time % step === 0) out.push(arr[i]);
  return out.reverse();
}
// the G8 pairs share every minute: k-minute log returns of the last lb minutes, index-aligned
function corrRet(sym, lb, k = CORR.ret || 1) {
  if (k === 1) return Engine.returns(sym, lb);
  const a = Engine.candles[sym], c = a.slice(-lb - 1).map(x => x.close), r = [];
  for (let i = k; i < c.length; i += k) r.push(Math.log(c[i] / c[i - k]));
  return r;
}
const CORR_GAP = 300; // s: up to a few missing bars still count as one step; a session gap does not
function corrAligned(A, B) {
  // A step longer than CORR_GAP between common minutes (a session close, a closed market) is not a minute return:
  // pairing it would let one overnight move dominate r, so the chain restarts after the gap
  const mb = new Map(B.map(c => [c.time, c.close])), xa = [], xb = []; let pa = null, pb = null, pt = null;
  const gap = CORR_GAP + ((CORR.ret || 1) - 1) * 60;
  for (const c of A) { const v = mb.get(c.time); if (v == null) continue; if (pa != null && c.time - pt <= gap) { xa.push(Math.log(c.close / pa)); xb.push(Math.log(v / pb)); } pa = c.close; pb = v; pt = c.time; }
  return { r: xa.length >= CORR_MIN_N ? Engine.corr(xa, xb) : NaN, n: xa.length };
}
/* A pair is measured over the lookback that ends at the last minute both had a bar, so a market that is closed
   now (FX at the weekend) is still read on its last session instead of an empty window. */
const corrLast = s => { const a = Engine.candles[s]; return a && a.length ? a[a.length - 1].time : -Infinity; };
// cache (optional): series per symbol and end, shared across the pairs of one matrix render
function corrPair(a, b, lb = S.set.corrLb || 1440, cache = null) {
  const end = Math.min(Engine.simTime, corrLast(a), corrLast(b));
  if (!isFinite(end)) return { r: NaN, n: 0, end };
  const ser = s => { if (!cache) return corrSeries(s, lb, end); const k = s + '@' + end; return cache[k] || (cache[k] = corrSeries(s, lb, end)); };
  return { ...corrAligned(ser(a), ser(b)), end };
}
/* The last n minutes both instruments have a bar, however far back (sessions, a weekend): for ranking that must
   not depend on the clock, e.g. a stock a few minutes after its open. Session gaps still restart the chain. */
const CORR_FILL_N = 240;
function corrRecent(a, b, n = CORR_FILL_N) {
  const A = Engine.candles[a] || [], B = Engine.candles[b] || [], xa = [], xb = [];
  let i = A.length - 1, j = B.length - 1; const end = Engine.simTime;
  while (i >= 0 && A[i].time > end) i--; while (j >= 0 && B[j].time > end) j--;
  while (i >= 0 && j >= 0 && xa.length <= n) {
    if (A[i].time === B[j].time) { xa.push(A[i]); xb.push(B[j]); i--; j--; } else if (A[i].time > B[j].time) i--; else j--;
  }
  return corrAligned(xa.reverse(), xb.reverse());
}
/* G8 matrix: the last lb minutes of trading both pairs share, matched minute by minute (k-minute returns on the
   clock's k-minute marks). Each pair's own last lb bars are NOT aligned with another's: on live prices every pair
   misses different minutes, and pairing them by position shifted the series and pulled ρ towards 0. */
function corrTrading(a, b, lb = S.set.corrLb || 1440, k = CORR.ret || 1) {
  const A = Engine.candles[a] || [], B = Engine.candles[b] || [], xa = [], xb = [], step = k * 60, need = Math.floor(lb / k) + 1;
  let i = A.length - 1, j = B.length - 1; const end = Engine.simTime;
  while (i >= 0 && A[i].time > end) i--; while (j >= 0 && B[j].time > end) j--;
  while (i >= 0 && j >= 0 && xa.length < need) {
    if (A[i].time === B[j].time) { if (k === 1 || A[i].time % step === 0) { xa.push(A[i]); xb.push(B[j]); } i--; j--; } else if (A[i].time > B[j].time) i--; else j--;
  }
  return corrAligned(xa.reverse(), xb.reverse());
}
function corrCluster(ps, rOf) {
  const n = ps.length, D = ps.map((a, i) => ps.map((b, j) => i === j ? 0 : Math.sqrt(Math.max(0, 2 * (1 - Math.abs(Number.isFinite(rOf(a, b)) ? rOf(a, b) : 0))))));
  const inT = Array(n).fill(false), best = Array(n).fill(Infinity), par = Array(n).fill(-1), adj = ps.map(() => []); best[0] = 0;
  for (let k = 0; k < n; k++) { let u = -1; for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i; inT[u] = true; if (par[u] >= 0) { adj[u].push(par[u]); adj[par[u]].push(u); } for (let v = 0; v < n; v++) if (!inT[v] && D[u][v] < best[v]) { best[v] = D[u][v]; par[v] = u; } }
  const seen = new Set(), ord = [], dfs = u => { seen.add(u); ord.push(u); adj[u].filter(v => !seen.has(v)).sort((x, y) => D[u][x] - D[u][y]).forEach(dfs); };
  dfs(Math.max(0, ps.indexOf(S.set.sym))); ps.forEach((_, i) => { if (!seen.has(i)) dfs(i); });
  return ord.map(i => ps[i]);
}
const corrWord = r => { const a = Math.abs(r); return a >= .7 ? (r > 0 ? 'Strongly correlated: close to the same trade' : 'Strongly inversely correlated: buying one and selling the other is close to the same trade') : a >= .4 ? (r > 0 ? 'Moderately correlated: they share part of their moves' : 'Moderately inversely correlated') : a >= .2 ? 'Weakly related' : 'Practically unrelated: a good diversifier against each other'; };
function renderCorr() {
  const cs = $('#corrSet');
  if (cs && !cs._b) {
    cs._b = 1; cs.addEventListener('click', e => { const b = e.target.closest('button[data-cs]'); if (!b) return; CORR.set = b.dataset.cs; renderCorr(); });
    const fx = cs.querySelector('[data-cs="fx"]'), all = cs.querySelector('[data-cs="all"]');
    if (fx) { fx.textContent = 'G8'; fx.title = 'The 16 pairs of the G8 currencies'; }
    if (all) { all.textContent = 'Yours'; all.title = `Your favourites, held and visible instruments (up to ${CORR_MAX}), paired on the minutes they share`; }
    const ctl = $('.corr-ctrl');
    ctl.insertAdjacentHTML('beforeend', `<span class="muted small">returns</span><div class="mini-seg" id="corrRet" role="group" aria-label="Return length">${[[1, '1m', 'One-minute returns: the most data, but on a real feed they understate correlation (quotes do not update in the same instant: the Epps effect).'], [15, '15m', '15-minute returns: closer to how positions feel; needs the 1D or 3D window.'], [60, '1h', 'Hourly returns: the steadiest picture; needs the 3D window.']].map(([v, l, d]) => `<button data-ret="${v}" data-tip="${escHtml(`${l} returns|${d}`)}">${l}</button>`).join('')}</div><span class="muted small">order</span><div class="mini-seg" id="corrOrd" role="group" aria-label="Order">${[['def', 'Default', 'The usual order: USD pairs, then the crosses.'], ['clu', 'Cluster', 'Correlated pairs next to each other, so the groups show as blocks along the diagonal.']].map(([v, l, d]) => `<button data-ord="${v}" data-tip="${escHtml(`${l} order|${d}`)}">${l}</button>`).join('')}</div>`);
    $('#corrRet').addEventListener('click', e => { const b = e.target.closest('[data-ret]'); if (!b) return; CORR.ret = +b.dataset.ret; const need = CORR_RET_MIN[CORR.ret]; if ((S.set.corrLb || 1440) < need) { S.set.corrLb = need; $$('#corrSeg button').forEach(x => x.classList.toggle('on', +x.dataset.lb === need)); toast('Window widened', `${b.textContent} returns need at least the ${need === 4320 ? '3D' : '1D'} window`, 'info'); save(); } renderCorr(); });
    $('#corrOrd').addEventListener('click', e => { const b = e.target.closest('[data-ord]'); if (!b) return; CORR.ord = b.dataset.ord; renderCorr(); });
    $('#corrSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b && +b.dataset.lb < CORR_RET_MIN[CORR.ret]) { CORR.ret = 1; } }, true);
    // the row and column of the cell under the pointer, and its explanation with the other windows
    $('#corr').addEventListener('mouseover', e => {
      const c = e.target.closest('#corr > div[data-a]'); $$('#corr .hx').forEach(x => x.classList.remove('hx'));
      if (!c) return; const i = c.dataset.i, j = c.dataset.j; $$(`#corr > [data-i="${i}"], #corr > [data-j="${j}"], #corr > [data-row="${i}"], #corr > [data-col="${j}"]`).forEach(x => x.classList.add('hx'));
      if (c.dataset.tip && !c.dataset.more) { c.dataset.more = 1; const a = c.dataset.a, b2 = c.dataset.b, other = [[240, '4H'], [1440, '1D'], [4320, '3D']].filter(([w]) => w >= CORR_RET_MIN[CORR.ret]).map(([w, l]) => { const v = CORR.set === 'all' ? corrPair(a, b2, w).r : corrTrading(a, b2, w).r; return `${l} ${Number.isFinite(v) ? nfx(v, 2) : '—'}`; }).join(' · '); c.dataset.tip += ` Windows: ${other}.`; }
    });
    $('#corr').addEventListener('mouseleave', () => $$('#corr .hx').forEach(x => x.classList.remove('hx')));
  }
  $$('#corrRet button').forEach(b => b.classList.toggle('on', +b.dataset.ret === CORR.ret)); $$('#corrOrd button').forEach(b => b.classList.toggle('on', b.dataset.ord === CORR.ord));
  if (cs) cs.querySelectorAll('button').forEach(b => { const on = b.dataset.cs === CORR.set; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const ps0 = corrSyms(), lb = S.set.corrLb || 1440, mine = CORR.set === 'all';
  // G8 pairs share every minute: the engine's own index-aligned returns; Yours: each pair paired on common minutes
  // over the lookback ending at the last minute both have a bar (corrPair), so a closed market reads its last session
  const C = mine ? {} : null;
  const memo = {}, rx = (a, b) => { const k = a < b ? a + '|' + b : b + '|' + a; return memo[k] || (memo[k] = mine ? corrPair(a, b, lb, C) : corrTrading(a, b, lb)); };
  const ps = CORR.ord === 'clu' ? corrCluster(ps0, (a, b) => rx(a, b).r) : ps0;
  // the summary: strongest links, the most independent instrument, and what your own positions share
  const links = []; ps.forEach((a, i) => ps.slice(i + 1).forEach(b => { const r = rx(a, b).r; if (Number.isFinite(r)) links.push([a, b, r]); }));
  links.sort((x, y) => Math.abs(y[2]) - Math.abs(x[2]));
  const avgOf = v => v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; // panels.js loads before obs.js's mean
  const indep = ps.map(a => [a, avgOf(ps.filter(b => b !== a).map(b => Math.abs(rx(a, b).r)).filter(Number.isFinite))]).filter(x => Number.isFinite(x[1])).sort((x, y) => x[1] - y[1])[0];
  const held = [...new Set(S.positions.map(p => p.sym))].filter(x => ps.includes(x)), clash = links.filter(([a, b, r]) => held.includes(a) && held.includes(b) && Math.abs(r) > .7);
  const sameWay = (a, b, r) => { const pa = S.positions.find(p => p.sym === a), pb = S.positions.find(p => p.sym === b); return pa && pb ? ((pa.side === pb.side) === (r > 0) ? 'adding up' : 'offsetting') : ''; };
  const lk = ([a, b, r]) => `<span class="corr-lk" tabindex="0" data-tip="${escHtml(`${pretty(a)} ↔ ${pretty(b)} · ρ ${nfx(r, 2)}|${corrWord(r)}.`)}"><b>${escHtml(pretty(a))}</b>–<b>${escHtml(pretty(b))}</b> <span class="mono ${r > 0 ? 'cpos' : 'cneg'}">${nfx(r, 2)}</span></span>`;
  const sum = $('#corrSum') || (() => { $('.corr-ctrl').insertAdjacentHTML('afterend', '<div class="corr-sum" id="corrSum"></div>'); return $('#corrSum'); })();
  sum.innerHTML = `<p class="corr-intro">How alike each pair of instruments moves: <span class="brx-n term" tabindex="0" data-tip="${escHtml('ρ (correlation)|From −1 to +1. +1: the two move as one; −1: always opposite; 0: unrelated. Computed on the returns of the chosen length over the window.')}">ρ</span> near +1 = the same trade, near −1 = the same trade in reverse, near 0 = a diversifier.</p>
    <div class="corr-ins"><div><label>Strongest links</label>${links.slice(0, 5).map(lk).join('') || '—'}</div>
      <div><label>Most independent</label>${indep ? `<span class="corr-lk" tabindex="0" data-tip="${escHtml(`${pretty(indep[0])}|Its average |ρ| with the others is ${indep[1].toFixed(2)}, the lowest here: the best diversifier against the rest.`)}"><b>${escHtml(pretty(indep[0]))}</b> <span class="mono">avg |ρ| ${indep[1].toFixed(2)}</span></span>` : '—'}</div>
      <div><label>Your positions</label>${!held.length ? '<span class="muted small">No open position on these instruments; held ones get an outline.</span>' : clash.length ? clash.slice(0, 3).map(x => `${lk(x)} <span class="tag ${sameWay(...x) === 'adding up' ? 'sell' : ''}">${sameWay(...x)}</span>`).join('') : `<span class="small">${held.length} held · no pair of them beyond |ρ| 0.7: risk is spread.</span>`}</div></div>`;
  const ctrl = $('.corr-ctrl');
  if (ctrl && !$('#corrLeg')) ctrl.insertAdjacentHTML('beforeend', `<div class="corr-leg" id="corrLeg" aria-label="Colour scale"><span>−1 inverse</span><i style="background:linear-gradient(90deg,${corrBg(-1)},${corrBg(-.5)},transparent,${corrBg(.5)},${corrBg(1)})"></i><span>+1 together</span><span class="corr-leg-d"><b>1.00</b> same pair</span></div>`);
  const heldSet = new Set(S.positions.map(p => p.sym)), mark = s => (heldSet.has(s) ? ' held' : '') + (s === S.set.sym ? ' cur' : '');
  const g = $('#corr'); g.style.gridTemplateColumns = `64px repeat(${ps.length},minmax(38px,1fr))`; g.style.gridTemplateRows = `auto repeat(${ps.length},minmax(22px,1fr))`;
  const P = s => escHtml(pretty(s));
  let h = '<div></div>' + ps.map((s, j) => `<div class="h${mark(s)}" data-col="${j}">${M(s).kind === 'cfd' ? P(s) : P(s).replace('/', '<br>')}</div>`).join('');
  ps.forEach((a, i) => {
    h += `<div class="h${mark(a)}" data-row="${i}" style="justify-content:start">${P(a)}</div>`;
    ps.forEach((b, j) => {
      if (a === b) { h += `<div class="d" data-tip="${P(a)} with itself: 1.00|The diagonal: every instrument with itself.">1.00</div>`; return; }
      const x = rx(a, b);
      // the window a Yours pair was read on: the lookback up to now, or up to the last minute both traded
      const lbW = lb % 1440 ? fmtDur(lb) : lb === 1440 ? 'day' : lb / 1440 + ' days';
      const win = !mine ? '' : !isFinite(x.end) ? ' (no bars yet)' : x.end < Engine.simTime - 60 ? ` in the ${lbW} up to ${new Date(x.end * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC, when the earlier of the two last traded` : ` in the last ${lbW}`;
      const up = j > i ? ' u' : '';
      if (!Number.isFinite(x.r)) { h += `<div class="${up}" data-i="${i}" data-j="${j}" data-tip="${P(a)} vs ${P(b)}: only ${x.n} common ${CORR.ret === 1 ? 'minute' : CORR.ret + '-minute'} returns${win}, fewer than ${CORR_MIN_N} (their sessions barely overlap)" style="color:var(--tx3)">—</div>`; return; }
      const r = x.r, al = Math.abs(r);
      h += `<div class="${up}" data-i="${i}" data-j="${j}" data-a="${a}" data-b="${b}" data-tip="${P(a)} vs ${P(b)}: ${r.toFixed(2)}${mine ? ` over ${x.n} common ${CORR.ret === 1 ? 'minutes' : 'returns'}${win}` : ''}|${corrWord(r)}." style="background:${corrBg(r)};color:${al > .3 ? 'var(--tx)' : 'var(--tx2)'}">${nfx(r, 2)}</div>`;
    });
  });
  g.innerHTML = h;
}
/* One ranked row per instrument: ATR bar (one hue, magnitude only) and where price sits in its 24h range. Pips and
   points do not compare across classes, so rows rank by ATR as a percentage of price and show both numbers. The
   rows: the 16 G8 pairs plus your favourites, held and visible instruments (not all 265: each one listed is kept
   simulated). */
const VOL_MAX = 60;
const volSyms = () => [...new Set([...Engine.PAIRS.map(p => p.sym), ...mySyms()])].slice(0, VOL_MAX);
const VOL = { sort: 'atr' };
function renderVol() {
  const data = volSyms().map(s => {
    // Wilder's ATR(14) on complete hours (shared.js atr1h, the one ATR every panel shows); no row under 15 hours
    const p = M(s), a1 = atr1h(p.sym); if (a1 == null) return null;
    const atr = a1 / p.pip;
    // the last 24 hours of bars (a market closed for longer: its last bar)
    const arr = Engine.candles[p.sym]; if (!arr.length) return null;
    let day = []; for (let i = arr.length - 1; i >= 0 && arr[i].time >= Engine.simTime - 86400; i--) day.push(arr[i]);
    if (!day.length) day = [arr[arr.length - 1]];
    const hi = Math.max(...day.map(c => c.high)), lo = Math.min(...day.map(c => c.low)), cur = arr[arr.length - 1].close;
    // the normal: the same hours of the day earlier in the week (shared.js atrNorm1h)
    const wAtr = atrNorm1h(p.sym), vsWk = wAtr ? a1 / wAtr : null;
    const range = (hi - lo) / p.pip;
    return { sym: p.sym, atr, atrPct: atr * p.pip / cur * 100, range, rangePct: (hi - lo) / cur * 100, rangeX: atr ? range / atr : null, pos: (cur - lo) / (hi - lo || 1), vsWk, hi, lo };
  }).filter(d => d && Number.isFinite(d.atrPct));
  const max = Math.max(...data.map(d => d.atrPct)) || 1, tone = v => v == null ? '' : v > 1.25 ? 'wn' : v < .8 ? 'info' : '';
  const sorts = { atr: (a, b) => b.atrPct - a.atrPct, norm: (a, b) => (b.vsWk || 0) - (a.vsWk || 0), pos: (a, b) => Math.abs(b.pos - .5) - Math.abs(a.pos - .5) };
  data.sort(sorts[VOL.sort] || sorts.atr);
  // the summary: most and least volatile, the market against its week, and who sits at an end of the day's range
  const byAtr = data.slice().sort(sorts.atr), top = byAtr[0], calm = byAtr[byAtr.length - 1], ws = data.map(d => d.vsWk).filter(v => v != null), mkt = ws.length ? ws.reduce((x, y) => x + y, 0) / ws.length : null;
  const nearHi = data.filter(d => d.pos >= .9), nearLo = data.filter(d => d.pos <= .1), names = l => l.slice(0, 5).map(d => escHtml(pretty(d.sym))).join(', ') + (l.length > 5 ? ` +${l.length - 5}` : '');
  const held = new Set(S.positions.map(p => p.sym)), nMine = data.filter(d => !Engine.PAIRS.some(p => p.sym === d.sym)).length;
  const tip = (t, x) => ` tabindex="0" data-tip="${escHtml(`${t}|${x}`)}"`;
  const head = `<div class="vol-top"><p class="vol-intro">How much each instrument moves: the <span class="brx-n term"${tip('ATR(14) on 1H', 'Average true range: how much one hour moves on average, gaps included (Wilder, 14 complete hours). As a % of price it compares a JPY pair, a stock and an index.')}>ATR</span> of one hour against the week, and where price sits in the last 24 hours. Click a row to open it.</p>
    <div class="vol-sum">
      <div${tip('Most and least volatile', `${pretty(top.sym)} moves ${top.atrPct.toFixed(2)}% an hour, ${pretty(calm.sym)} ${calm.atrPct.toFixed(2)}%.`)}><label>Most / least volatile</label><b>${escHtml(pretty(top.sym))}</b> <span class="mono">${top.atrPct.toFixed(2)}%</span> · <b>${escHtml(pretty(calm.sym))}</b> <span class="mono">${calm.atrPct.toFixed(2)}%</span></div>
      <div${tip('The market against its week', mkt == null ? 'Not enough history.' : `On average the hourly ATR is ${mkt.toFixed(2)}× the same hours earlier in the week. Above 1.25× the market is busier than usual, below 0.8× quieter.`)}><label>Market vs its week</label>${mkt == null ? '—' : `<span class="brx-t ${tone(mkt)}">${mkt.toFixed(2)}× ${mkt > 1.25 ? 'busier than usual' : mkt < .8 ? 'quieter than usual' : 'normal'}</span>`}</div>
      <div${tip('At an end of the day', 'Instruments in the top or bottom 10% of their last 24 hours: at the high or the low of the day.')}><label>At the 24h high / low</label>${nearHi.length ? `<span class="small">high: ${names(nearHi)}</span>` : ''}${nearLo.length ? `<span class="small">low: ${names(nearLo)}</span>` : ''}${!nearHi.length && !nearLo.length ? '<span class="small muted">none</span>' : ''}</div>
    </div>
    <div class="vol-ctl"><span class="muted small">${data.length} instruments · the 16 G8 pairs${nMine ? ` + ${nMine} of yours` : ''} (favourites, held, visible)</span><span class="muted small">sort</span><div class="mini-seg" id="volSort" role="group" aria-label="Sort">${[['atr', 'Volatility', 'Highest hourly ATR as a % of price first.'], ['norm', 'vs week', 'Furthest above its own week first.'], ['pos', 'At an end', 'Closest to the 24h high or low first.']].map(([v, l, d]) => `<button data-vs="${v}" class="${VOL.sort === v ? 'on' : ''}" data-tip="${escHtml(`${l}|${d}`)}">${l}</button>`).join('')}</div></div></div>`;
  $('#volBody').innerHTML = head + `<div class="vhead"><span>Instrument</span><span${tip('ATR(14) 1H', 'One hour of movement: % of price (the bar, against the most volatile here) and in pips or points.')}>ATR(14) 1H</span><span${tip('ATR, % of price', 'One hour of ATR as a percentage of price: compares a JPY pair, a stock and an index.')}>% of price</span><span${tip('ATR, pips / points', 'One hour of ATR in pips (FX) or points (CFDs).')}>Pips / pt</span><span${tip('vs week', "The hourly ATR now against the same hours of the day earlier in the week, so a busy afternoon is compared with other afternoons. Above 1.25× busier, below 0.8× quieter than usual.")}>vs week</span><span${tip('24h range', 'High minus low of the last 24 hours: in pips, % of price, and as a multiple of one hour of ATR.')}>24h range</span><span${tip('24h range, % and × ATR', 'The same range as a % of price and as a multiple of one hour of ATR.')}>% · × 1H</span><span class="l"${tip('Price in the 24h range', '0% = at the low of the last 24 hours, 100% = at its high.')}>Price in 24h range</span></div>` + data.map(d => {
    const r = d.atrPct / max, pp = clamp(d.pos, 0, 1) * 100, u = unitWord(d.sym), us = uShort(d.sym), fx = v => fp(d.sym, v), end = pp >= 90 ? 'hi' : pp <= 10 ? 'lo' : '';
    const rowTip = `${pretty(d.sym)}|ATR ${d.atrPct.toFixed(2)}% (${d.atr.toFixed(1)} ${u}) an hour${d.vsWk ? `, ${d.vsWk.toFixed(2)}× its week` : ''}. 24h range ${d.range.toFixed(0)} ${u} (${d.rangePct.toFixed(2)}%, ${d.rangeX ? d.rangeX.toFixed(1) + '× one hour' : '—'}) from ${fx(d.lo)} to ${fx(d.hi)}; price at ${pp.toFixed(0)}%.${held.has(d.sym) ? ' You hold a position on it.' : ''} Click to open it on the chart.`;
    return `<div class="vcard${held.has(d.sym) ? ' held' : ''}${d.sym === S.set.sym ? ' cur' : ''}" data-sym="${d.sym}" role="button" tabindex="0" data-tip="${escHtml(rowTip)}"><b class="t">${escHtml(pretty(d.sym))}</b><div class="vatr"><span class="vbc"><span class="vbar"><i style="width:${r * 100}%"></i></span></span><span class="vpct">${d.atrPct.toFixed(2)}%</span><span class="vun">${d.atr.toFixed(1)} ${u}</span></div><span class="vwk">${d.vsWk ? `<span class="brx-t ${tone(d.vsWk)}">${d.vsWk.toFixed(2)}×</span>` : '—'}</span><span class="vrng"><span class="vr1">${d.range.toFixed(0)}${us}</span><small>${d.rangePct.toFixed(2)}% · ${d.rangeX ? d.rangeX.toFixed(1) + '×' : '—'}</small></span><div class="vpos"><span>L</span><div class="vtrack"><i style="left:${pp}%"></i></div><span>H</span><em class="${end ? 'vend' : ''}">${pp.toFixed(0)}%${end ? ` ${end === 'hi' ? 'high' : 'low'}` : ''}</em></div></div>`;
  }).join('');
  const vs = $('#volSort'); if (vs) vs.onclick = e => { const b2 = e.target.closest('[data-vs]'); if (!b2) return; VOL.sort = b2.dataset.vs; renderVol(); };
}

/* ============ journal ============ */
// one trade = one position (tradesOf: partial closes merged) at net P&L (pnl − commission, shared.js)
// the money a trade risked at its open: stored on newer trades, otherwise P&L ÷ R (R is P&L over the risk at the stop)
const tradeRisk = t => t.risk > 0 ? t.risk : t.r && Number.isFinite(t.r) && t.pnl ? Math.abs(t.pnl / t.r) : null;
function journalStats() {
  const all = S.history, h = tradesOf(all), wins = h.filter(x => x.net > 0), losses = h.filter(x => x.net <= 0);
  const gw = wins.reduce((s, x) => s + x.net, 0), gl = -losses.reduce((s, x) => s + x.net, 0);
  const rs = h.filter(x => x.r != null).map(x => x.r);
  // the curve: the balance after each trade's last close (protection credits included). It starts from what the
  // balance was before the oldest kept entry (history is capped at 500): the commission of a still-open position was
  // paid at its open and is no closed trade's, so it is added back
  const openComm = S.positions.reduce((s, p) => s + (+p.comm || 0), 0);
  const start = S.balance + openComm - all.reduce((s, x) => s + netPnl(x), 0), last = new Map(h.map(x => [x.rows[0], x]));
  const ev = []; for (const x of [...all].reverse()) { if (x.nbp) ev.push({ v: netPnl(x), t: x.close, nbp: true }); else if (last.has(x)) ev.push({ v: last.get(x).net, t: x.close, risk: tradeRisk(last.get(x)) }); }
  let eq = start, peak = start, mdd = 0; const curve = [start], curveT = [ev.length ? all[all.length - 1].open ?? ev[0].t : 0];
  const riskPcts = []; // the risk each trade actually took at its open, as % of the balance before it
  for (const e of ev) { if (e.risk > 0 && eq > 0) riskPcts.push(e.risk / eq * 100); eq += e.v; curve.push(eq); curveT.push(e.t); }
  // negative balance protection: the closes just before a protection row that took the balance below zero are shown
  // at zero, since the client never owed that money (the curve and drawdown stop at −100% of the balance)
  for (let i = curve.length - 1, prot = false; i > 0; i--) { if (ev[i - 1].nbp) prot = true; else if (prot && curve[i] < 0) curve[i] = 0; else prot = false; }
  for (const v of curve) { peak = Math.max(peak, v); mdd = Math.max(mdd, peak > 0 ? (peak - v) / peak : 0); }
  const wr = rs.filter(r => r > 0), lr = rs.filter(r => r <= 0);
  return {
    n: h.length, nWin: wins.length, nLoss: losses.length, net: gw - gl, winRate: h.length ? wins.length / h.length * 100 : 0, pf: gl ? gw / gl : gw ? Infinity : 0,
    avgW: wins.length ? gw / wins.length : 0, avgL: losses.length ? -gl / losses.length : 0, exp: h.length ? (gw - gl) / h.length : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, mdd: mdd * 100, curve, curveT, trades: h,
    best: h.length ? Math.max(...h.map(x => x.net)) : 0, worst: h.length ? Math.min(...h.map(x => x.net)) : 0,
    avgWinR: wr.length ? wr.reduce((a, b) => a + b, 0) / wr.length : null, avgLossR: lr.length ? -lr.reduce((a, b) => a + b, 0) / lr.length : null, rN: rs.length,
    winRateR: rs.length ? wr.length / rs.length * 100 : null, riskMed: riskPcts.length ? riskPcts.slice().sort((a, b) => a - b)[Math.floor((riskPcts.length - 1) / 2)] : null, riskN: riskPcts.length
  };
}
// the win rate with its 95% Wilson interval (shared.js wrTxt): the rate large, the interval and n under it
const WR_TIP = 'Share of winning trades with its 95% Wilson interval: with few trades the true rate can sit anywhere in that range';
const AVGR_TIP = 'Average R|Average result in R, where 1R is the money at risk when the trade opened (entry to stop). Only trades that had a stop have an R, so n can be lower than Trades; the other figures use every trade.';
// front 15.11.2026: a hover explanation for every figure on the Journal: what it is, how to read it, what to watch for
function jKpiTips(s) {
  const f = v => usdFmt(v, true), n = s.n, any = n > 0; if (!any) return {};
  const W = s.nWin, L = s.nLoss, gw = s.avgW * W, gl = Math.abs(s.avgL * L), pay = s.avgL ? s.avgW / Math.abs(s.avgL) : null;
  return {
    'Net P&L': `Net P&L|Everything the closed trades made or lost, after commission (swap included). Open positions are not counted. It is the result, not the quality: read it together with the trade count and the drawdown.`,
    'Trades': `Trades|Closed trades. A position closed in several parts counts once. Everything on this page is computed from them, and below about 30 trades most figures can be chance.`,
    'Win rate': `Win rate|${W} of ${n} trades closed in profit. The range in brackets is the 95% interval: with ${n} trades the true rate can sit anywhere in it. A low win rate is fine if the average win is clearly larger than the average loss.`,
    'Profit factor': `Profit factor|Gross profit ${usdFmt(gw)} divided by gross loss ${usdFmt(gl)}. Above 1 the book makes money; 1.0 is break-even. Under about 1.3 it is thin: a wider spread or a few slips can erase it. Very high values on few trades are usually luck.`,
    'Avg win': `Average win|Total of the winning trades divided by their count (${W}). Compare with the average loss: it tells how much each win pays against each loss.`,
    'Avg loss': `Average loss|Total of the losing trades divided by their count (${L}). If it is much larger than the average win, you need a high win rate to survive: that usually means stops are too wide or losers are held too long.`,
    'Expectancy': `Expectancy|The average result per trade: win rate × average win − loss rate × average loss = ${f(s.exp)}${pay ? `. Average win is ${pay.toFixed(1)}× the average loss` : ''}. Positive means the habit pays on average; its size next to the average loss shows how much room there is.`,
    'Avg R': AVGR_TIP,
    'Max drawdown': `Maximum drawdown|The deepest fall of the balance from a peak, over the closed trades: ${pct(-s.mdd, 2)}. It is the worst stretch you had to sit through. Open positions are not included. Plan for a future one at least this large.`,
    'Best / worst': `Best / worst trade|The largest win and the largest loss, net of commission. If the best trade is a big share of Net P&L, the result depends on a few trades. A worst trade far beyond the average loss means a stop was missing or moved.`
  };
}
function wrHtml(k, n) { const w = wrTxt(k, n), i = w.indexOf(' '); return `${w.slice(0, i)}<small style="display:block;font-size:var(--fs-xs);font-weight:400;color:var(--tx3)">${w.slice(i)}</small>`; }
let jFil = 'all', jLim = 40;
const JFT = {"all": "All trades|Every closed trade, newest first.", "loss": "Losses|Trades that closed at zero or below, net of commission. Read the notes on these first: what repeats?", "nostop": "No stop|Trades opened without a stop loss. Their R is unknown, so they are left out of Avg R. They carry the risk of an unbounded loss.", "reentry": "After a loss|Trades opened within the revenge window after a losing trade closed. A habit of quick re-entries is how revenge trading starts."};
function renderJournal() {
  const s = journalStats(), any = s.n > 0, D = '—';
  const k = [['Net P&L', any ? usdFmt(s.net, true) : D, cls(s.net)], ['Trades', s.n], ['Win rate', any ? wrHtml(s.nWin, s.n) : D], ['Profit factor', !any || !s.nWin && !s.nLoss ? D : isFinite(s.pf) ? s.pf.toFixed(2) : '∞'],
  ['Avg win', s.nWin ? usdFmt(s.avgW, true) : D, s.nWin ? 'up' : ''], ['Avg loss', s.nLoss ? usdFmt(s.avgL, true) : D, s.nLoss && s.avgL ? 'dn' : ''], ['Expectancy', any ? usdFmt(s.exp, true) : D, cls(s.exp)], ['Avg R', s.avgR != null ? `${sgn(s.avgR, 2)}R<small style="display:block;font-size:var(--fs-xs);font-weight:400;color:var(--tx3)">n=${s.rN}${s.rN < s.n ? ` of ${s.n}` : ''}</small>` : D],
  ['Max drawdown', s.curve.length > 1 ? pct(-s.mdd, 2) : D, s.mdd ? 'dn' : ''], ['Best / worst', any ? `<span class="${cls(s.best)}">${usdFmt(s.best, true).replace('.00', '')}</span> / <span class="${cls(s.worst)}">${usdFmt(s.worst, true).replace('.00', '')}</span>` : D]];
  // emphasis tiers: Net P&L is the hero, the rest are key figures
  const KT = jKpiTips(s);
  $('#kpis').innerHTML = k.map(([a, b, c], i) => `<div class="kpi ${i ? 'key' : 'hero'}${a === 'Best / worst' ? ' wide' : ''}"${KT[a] ? ` data-tip="${escHtml(KT[a])}" data-rich="kpi:${escHtml(a)}" tabindex="0"` : ''}><label>${a}</label><b class="${c || ''}">${b}</b></div>`).join('');
  drawCurve($('#eqCanvas'), s.curve, s.curveT);
  renderCoach();
  const SET = ['', 'Breakout', 'Trend', 'Pullback', 'Reversal', 'Range', 'News', 'Impulse'];
  // one row per trade (a table: Symbol | Side | P&L | Note); its note lives on the trade's first
  // history row (tradesOf reads them from there)
  const NOTE_PH = 'What did you see? What would you change?';
  // front 15.11.2026: filters (all / losses / no stop / re-entry) and a "show more" past 40 rows
  const closesJ = [...s.trades].sort((x, y) => x.close - y.close), reJ = new Set(s.trades.filter(x => closesJ.some(y => y !== x && y.net < 0 && y.close <= x.open && x.open - y.close < REVENGE_MIN * 60)));
  const JF = [['all', 'All', () => true], ['loss', 'Losses', x => x.net <= 0], ['nostop', 'No stop', x => x.r == null], ['reentry', 'After a loss', x => reJ.has(x)]];
  if (!JF.some(f => f[0] === jFil)) jFil = 'all';
  const shown = s.trades.filter(JF.find(f => f[0] === jFil)[2]), cnt = f => s.trades.filter(f[2]).length;
  const dtJ = t => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
  const items = shown.slice(0, jLim).map(h => {
    const i = S.history.indexOf(h.rows[h.rows.length - 1]), side = h.side === 'buy' ? 'buy' : 'sell';
    const parts = h.parts > 1 ? `${h.parts} parts${h.complete ? '' : ', still open'}` : '';
    return `<div class="jitem" data-i="${i}"><div class="top"><span class="jsym" data-rich="jp:${escHtml(h.sym)}">${escHtml(pretty(h.sym))}${parts ? ` <span class="muted small" title="${parts}">${parts}</span>` : ''}<span class="jdt muted" data-rich="jt:${i}" data-tip="Closed|When the trade closed (UTC). Click for the full story of the trade, including how long it was open.">${dtJ(h.close)}</span></span><span class="jside" data-rich="js:${h.side}"><span class="tag ${side}">${side}</span></span><span class="jpnl ${cls(h.net)}" data-rich="jt:${i}" data-tip="Net P&L|${h.comm ? `Result after ${usdFmt(h.comm)} commission${h.swap ? ' and swap' : ''}.` : 'Result of the trade.'}${h.r != null ? ` ${sgn(h.r, 2)}R: the result in multiples of the money risked at the stop.` : ' No stop was set, so there is no R.'}">${usdFmt(h.net, true)}</span></div><div class="row"><input data-j="note" aria-label="Note" placeholder="${NOTE_PH}" title="${NOTE_PH}" value="${escHtml(h.note || '')}"></div></div>`;
  });
  const bar = `<div class="seg jfil" role="group" aria-label="Filter trades">${JF.map(f => `<button type="button" data-jf="${f[0]}" data-rich-tip="jf:${f[0]}" data-tip="${escHtml(JFT[f[0]])}" class="${f[0] === jFil ? 'on' : ''}" aria-pressed="${f[0] === jFil}">${f[1]} <small>${cnt(f)}</small></button>`).join('')}</div>`;
  const more = shown.length > jLim ? `<div class="jmore small muted">Showing ${jLim} of ${shown.length} · <button type="button" class="link" data-jmore="1">Show more</button></div>` : '';
  $('#jList').innerHTML = bar + (items.length ? '<div class="jhead" aria-hidden="true"><span data-rich="gl:Symbol">Symbol</span><span data-rich="gl:Side">Side</span><span data-rich="gl:P&amp;L">P&amp;L</span><span data-rich="gl:Note">Note</span></div>' + items.join('') + more
    : s.trades.length ? '<div class="muted small">No trades match this filter.</div>' : '<div class="muted small">Close trades to start journaling. Write a note on each trade: what you saw, what you would change.</div>');
  dirty.journal = false;
}
// step = the axis step: labels keep enough precision that neighbouring gridlines never read the same
const usdK = (v, step) => {
  const a = Math.abs(v), sg = v < 0 && a >= .5 ? '−' : '';
  if (step != null && step < 100) return sg + '$' + nf0.format(a);
  if (a < 1e4) return sg + '$' + nf0.format(a);
  const kd = a >= 1e6 && (step == null || step >= 1e4) ? 0 : step == null || step >= 1000 ? (step >= 1000 && step % 1000 === 0 ? 0 : 1) : step % 100 === 0 ? 1 : 2;
  return sg + '$' + (a / 1e3).toFixed(kd) + 'k';
};
// equity curve: y axis in dollars, x axis in sim time, dashed baseline at the starting balance, last point marked;
// hover shows the balance after the nearest trade
function drawCurve(cv, pts, ts, hi = -1) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv._eq = [pts, ts];
  if (!cv._eqHover) {
    cv._eqHover = true;
    const at = e => { const [p, t] = cv._eq, r = cv.getBoundingClientRect(), L = 58, R = 14; drawCurve(cv, p, t, Math.round(clamp((e.clientX - r.left - L) / Math.max(1, r.width - L - R), 0, 1) * (p.length - 1))); };
    cv.addEventListener('mousemove', at); cv.addEventListener('mouseleave', () => drawCurve(cv, ...cv._eq));
  }
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const c = chartColors(); if (pts.length < 2) { g.fillStyle = c.tx; g.font = '12px General Sans'; g.fillText('Your equity curve appears after your first closed trade.', 10, h / 2); return; }
  const base = pts[0], mn = Math.min(...pts), mx = Math.max(...pts), pad = (mx - mn) * .12 || 50, lo = mn - pad, top = mx + pad;
  const L = 58, R = 14, T = 10, B = 22;
  const X = i => L + i / (pts.length - 1) * (w - L - R), Y = v => T + (top - v) / (top - lo) * (h - T - B);
  g.font = '10px JetBrains Mono'; g.textBaseline = 'middle';
  // y grid: about 4 round steps
  const raw = (top - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), stepV = [1, 2, 2.5, 5, 10].map(m => m * mag).find(m => m >= raw);
  g.lineWidth = 1;
  for (let v = Math.ceil(lo / stepV) * stepV; v <= top; v += stepV) {
    const y = Math.round(Y(v)) + .5; g.strokeStyle = c.grid; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillStyle = c.tx; g.textAlign = 'right'; g.fillText(usdK(v, stepV), L - 6, y);
  }
  // x axis: first, middle and last trade time
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = c.tx;
  const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  xl.forEach((i, k) => { if (!ts || ts[i] == null) return; g.textAlign = k === 0 ? 'left' : k === xl.length - 1 ? 'right' : 'center'; g.fillText(dts(ts[i]), X(i), h - 6); });
  // baseline at the starting balance
  const yb = Math.round(Y(base)) + .5; g.strokeStyle = c.tx2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(L, yb); g.lineTo(w - R, yb); g.stroke(); g.setLineDash([]);
  g.textAlign = 'right'; g.textBaseline = Y(pts[pts.length - 1]) < yb ? 'top' : 'bottom'; g.fillStyle = c.tx2; g.fillText('start ' + usdK(base, stepV), w - R - 4, g.textBaseline === 'top' ? yb + 3 : yb - 3);
  // the curve on the indicator hue (amber is selection only), a 2px line with no area fill
  const ind = cssv('--ind1') || c.tx2;
  g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = ind; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  // highlighted point: the hovered one, else the last; its label carries the signed change from the start
  const i = hi >= 0 ? hi : pts.length - 1, v = pts[i], px = X(i), py = Y(v), d = v - base;
  if (hi >= 0) { g.strokeStyle = c.tx2; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(px) + .5, T); g.lineTo(Math.round(px) + .5, h - B); g.stroke(); }
  g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fillStyle = ind; g.fill(); g.lineWidth = 2; g.strokeStyle = c.bg; g.stroke();
  const t1 = usdK(v), t2 = (d < 0 ? '−' : d > 0 ? '+' : '') + usdK(Math.abs(d)) + (hi >= 0 && i ? ` · trade ${i}` : '');
  g.font = '600 11px JetBrains Mono'; const tw = Math.max(g.measureText(t1).width, (g.font = '10px JetBrains Mono', g.measureText(t2).width)) + 12;
  const bx = clamp(px - tw - 8 < L ? px + 8 : px - tw - 8, L, w - R - tw), by = clamp(py - 34, T, h - B - 32);
  g.fillStyle = c.bg + 'e6'; g.fillRect(bx, by, tw, 30); g.strokeStyle = c.line; g.lineWidth = 1; g.strokeRect(bx + .5, by + .5, tw - 1, 29);
  g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = cssv('--tx'); g.font = '600 11px JetBrains Mono'; g.fillText(t1, bx + 6, by + 3);
  g.font = '10px JetBrains Mono'; g.fillStyle = d > 0 ? c.up : d < 0 ? c.dn : c.tx2; g.fillText(t2, bx + 6, by + 16);
}

/* ============ risk lab ============ */
function runLab() {
  const p = clamp(+$('#lWin').value / 100, .01, .99), rr = Math.max(.1, +$('#lRR').value), risk = clamp(+$('#lRisk').value / 100, .0005, .5), N = clamp(Math.round(+$('#lN').value), 10, 2000);
  const P = 1000, paths = [], finals = [], dds = []; let ruin = 0, dd20 = 0;
  for (let k = 0; k < P; k++) {
    let e = 1, peak = 1, mdd = 0, ruined = false; const snap = [];
    for (let i = 0; i < N; i++) {
      e *= Math.random() < p ? 1 + risk * rr : 1 - risk;
      peak = Math.max(peak, e); mdd = Math.max(mdd, 1 - e / peak); if (e < .5) ruined = true;
      snap.push(e);
    }
    paths.push(snap); finals.push(e); dds.push(mdd); if (ruined) ruin++; if (mdd > .2) dd20++;
  }
  const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(f * (s.length - 1))]; };
  const bands = [.05, .25, .5, .75, .95].map(f => [1, ...Array.from({ length: N }, (_, i) => q(paths.map(pp => pp[i]), f))]);
  const expR = p * rr - (1 - p);
  const out = [['Expectancy', sgn(expR, 2) + 'R / trade', cls(expR)], ['Median result', pct((q(finals, .5) - 1) * 100, 1), cls(q(finals, .5) - 1)], ['5th pct', pct((q(finals, .05) - 1) * 100, 1), cls(q(finals, .05) - 1)], ['95th pct', pct((q(finals, .95) - 1) * 100, 1), cls(q(finals, .95) - 1)],
  ['Profitable paths', pct(finals.filter(f => f > 1).length / P * 100, 1, false)], ['Median max DD', pct(-q(dds, .5) * 100, 1), 'dn'], ['P(DD > 20%)', pct(dd20 / P * 100, 1, false)], ['Risk of ruin (−50%)', pct(ruin / P * 100, 1, false), ruin ? 'dn' : '']];
  // emphasis tiers: the median result is the hero; the tail, the typical drawdown and ruin are the key figures
  out.unshift(...out.splice(1, 1)); // the hero reads first
  const tier = { 'Median result': 'lo-hero','5th pct': 'lo-key', 'Median max DD': 'lo-key', 'Risk of ruin (−50%)': 'lo-key' };
  $('#labOut').innerHTML = out.map(([a, b, c]) => `<div class="${tier[a] || 'lo-sec'}"><label>${a}</label><b class="${c || ''}">${b}</b></div>`).join('') + '<p class="note" style="grid-column:1/-1">Hypothetical: 1,000 random paths from the inputs above. Not a forecast of your results.</p>';
  LAB_LAST = { bands, samples: paths.slice(0, 40) };
  drawFan($('#labCanvas'), LAB_LAST.bands, LAB_LAST.samples);
}
// a resize or a return to the tab redraws the same 1,000 paths; only Run (or new inputs) draws new random ones
let LAB_LAST = null;
function redrawLab() { if (LAB_LAST) drawFan($('#labCanvas'), LAB_LAST.bands, LAB_LAST.samples); else runLab(); }
function drawFan(cv, bands, samples) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const c = chartColors(), n = bands[0].length;
  const lo = Math.min(...bands[0]) * .97, hi = Math.max(...bands[4]) * 1.03;
  const X = i => 44 + i / (n - 1) * (w - 56), Y = v => h - 22 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (h - 38);
  // neutral chrome: axis labels on the muted ink (c.tx is --tx3), bands in the secondary grey, the median in full ink
  // (amber is selection only); the legend carries a swatch per mark
  const ink = cssv('--tx'), band = c.tx2;
  g.font = '10px JetBrains Mono'; g.fillStyle = c.tx; g.strokeStyle = c.grid; g.lineWidth = 1;
  Array.from({ length: 5 }, (_, i) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * (i + .5) / 5)).forEach(v => { g.beginPath(); g.moveTo(44, Y(v)); g.lineTo(w - 12, Y(v)); g.stroke(); g.fillText(((v - 1) * 100).toFixed(0) + '%', 4, Y(v) + 3); });
  g.fillText('trade 0', 44, h - 6); g.textAlign = 'right'; g.fillText(`trade ${n - 1}`, w - 12, h - 6); g.textAlign = 'left';
  g.lineWidth = 1; g.strokeStyle = band + '26';
  samples.forEach(s => { g.beginPath(); [1, ...s].forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke(); });
  const area = (a, b, col) => { g.beginPath(); a.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Y(b[i])); g.closePath(); g.fillStyle = col; g.fill(); };
  area(bands[0], bands[4], band + '24'); area(bands[1], bands[3], band + '48');
  g.beginPath(); bands[2].forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
  // legend, right-aligned: a line swatch for the median, filled swatches for the two bands
  const leg = [['median', 'line', ink], ['25–75%', 'box', band + '48'], ['5–95%', 'box', band + '24']];
  let lx = w - 12; g.textBaseline = 'middle';
  for (let k = leg.length - 1; k >= 0; k--) {
    const [t, kind, col] = leg[k], tw = g.measureText(t).width;
    lx -= tw; g.fillStyle = c.tx2; g.fillText(t, lx, 12); lx -= 16;
    if (kind === 'line') { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, 12); g.lineTo(lx + 12, 12); g.stroke(); }
    else { g.fillStyle = col; g.fillRect(lx, 7, 12, 10); g.strokeStyle = c.line; g.lineWidth = 1; g.strokeRect(lx + .5, 7.5, 11, 9); }
    lx -= 12;
  }
  g.textBaseline = 'alphabetic';
}

/* ============ calculators ============ */
function renderCalcs() {
  const row = (a, b, big) => `<div class="${big ? 'big' : ''}"><span>${a}</span><b>${b}</b></div>`;
  syncInstrSelect($('#cpSym')); syncInstrSelect($('#pvSym'));
  // units of the asset behind a size, from the sheet: base currency on FX, shares, Ounces / Barrels, or money per point
  const units = (sym, lots) => {
    const m = M(sym), u = lots * m.size;
    if (m.kind !== 'cfd') return `${nf0.format(u)} ${m.base}`;
    if (m.lotName === 'shares') return `${nf0.format(u)} share${u === 1 ? '' : 's'}`;
    if (m.sizeUnit === 'point') return m.pip === 1 ? `${CCY_SIGN[m.quote] || m.quote + ' '}${nf2.format(u)} per point` : ptWorth(sym, lots);
    return `${nf2.format(u)} ${m.sizeUnit || 'units'}`;
  };
  const vName = sym => M(sym).unit === 'pt' ? 'Point value' : 'Pip value';
  const prof = sym => { const j = jurOf(S.set); return `${j.none ? (S.set.lev == null ? 'Sheet' : 'Your choice') : j.name} 1:${effLev(sym)}`; };
  const err = t => `<div class="calc-err" role="status"><span>${t}</span></div>`, note = t => `<div class="calc-note"><span>${t}</span></div>`;
  // position size: floored to the sheet's volume step (never more risk than asked), every figure from the size shown
  // a new instrument starts from the same default stop as New order, in its own unit (pips, or the platform point on CFDs)
  const slEl = $('#cpSL'), s0 = $('#cpSym').value;
  if (slEl && M(s0) && slEl.dataset.s !== s0) { slEl.dataset.s = s0; if (typeof tkDefaults === 'function') { const d = tkDefaults(s0).sl; if (d > 0) slEl.value = d; } }
  const s1 = $('#cpSym').value, acc = +$('#cpAcc').value, r = +$('#cpRisk').value, sl = +$('#cpSL').value, m1 = M(s1);
  const cu = $('#cpUnit'); if (cu) cu.textContent = unitWord(s1);
  const bad1 = !m1 ? 'Pick an instrument.' : !(acc > 0) ? 'Account must be above 0.' : !(r > 0) ? 'Risk % must be above 0.' : !(sl > 0) ? `Stop must be above 0 ${unitWord(s1)}.` : '';
  if (bad1) $('#cpOut').innerHTML = err(bad1);
  else {
    const [vMin, vMax, vStep] = m1.p.vol, pv = pipValue(s1, 1), riskUsd = acc * r / 100;
    const lots = +(Math.floor(riskUsd / (sl * pv) / vStep + 1e-9) * vStep).toFixed(lotDec(s1)), atRisk = lots * sl * pv, n1 = notionalUsd(s1, lots), warn = [], vw = volWhy(s1, lots);
    if (lots < vMin - 1e-9) warn.push(`Below the sheet's minimum: ${vw} — this risk and stop allow no position.`);
    else if (lots > vMax + 1e-9) warn.push(`${vw}: an order this size is refused.`);
    if (n1 > acc * MAX_NOTIONAL_X) warn.push(`Notional ${usdFmt(n1)} is above the per-order cap of ${MAX_NOTIONAL_X}× equity (${usdFmt(acc * MAX_NOTIONAL_X)}): an order this size is refused.`);
    $('#cpOut').innerHTML = row('Position size', escHtml(lotsWord(s1, lots)), 1) + row('Units', units(s1, lots)) + row('Amount at risk', usdFmt(atRisk)) + row(vName(s1), usdFmt(pv * lots))
      + row('Margin at profile', `${usdFmt(n1 / effLev(s1))} (${escHtml(prof(s1))})`) + warn.map(err).join('')
      + (warn.length ? '' : `<button type="button" class="ghost sm" id="cpToTk" data-sym="${escHtml(s1)}" data-lots="${lots}" data-sl="${sl}">Send size and stop to the ticket</button>`);
  }
  // margin: the account's effective leverage on the instrument (the sheet's, or the user's choice up to its maximum,
  // capped by the jurisdiction). A jurisdiction cap fixes the field; without one any what-if up to the sheet maximum
  const s2 = $('#pvSym').value, l2 = +$('#pvLots').value, m2 = M(s2), lvEl = $('#pvLev'), j2 = jurOf(S.set);
  if (!m2) { $('#pvOut').innerHTML = err('Pick an instrument.'); return; }
  const n2 = notionalUsd(s2, l2), free = !!j2.none, ceil = free ? m2.p.lev[1] : effLev(s2), key = levKey() + '|' + s2;
  if (lvEl.dataset.k !== key || !free) { lvEl.dataset.k = key; lvEl.value = effLev(s2); }
  lvEl.readOnly = !free; lvEl.max = ceil;
  lvEl.title = free ? `No EU limit (ESMA caps ${esmaCapText(s2)}): any leverage up to 1:${ceil}, the instrument sheet maximum` : `Set by the ${j2.name} cap (Settings) on the sheet's 1:${sheetLev(s2)}`;
  const tg = $('#pvLevTag'); if (tg) tg.textContent = free ? `${S.set.lev == null ? 'Sheet' : 'Your choice'} 1:${effLev(s2)} · maximum 1:${ceil}` : prof(s2); // set.lev null = the sheet default
  const lev = lvEl.value.trim() === '' ? NaN : +lvEl.value;
  const bad2 = !(l2 > 0) ? 'Lots must be above 0.' : !(lev >= 1) ? 'Leverage must be at least 1:1.' : lev > ceil ? `Above the 1:${ceil} ceiling for ${escHtml(pretty(s2))}: the instrument sheet maximum.` : '';
  // amounts under a cent keep two significant digits instead of rounding to $0.00; the sheet's volume limits are checked
  const money = v => Math.abs(v) > 0 && Math.abs(v) < .01 ? '$' + v.toLocaleString('en-US', { maximumSignificantDigits: 2 }) : usdFmt(v);
  const [mn2, mx2] = m2.p.vol, vw2 = l2 > 0 ? volWhy(s2, l2) : '';
  const lim2 = !bad2 && l2 < mn2 - 1e-9 ? err(`Below the sheet's minimum: ${vw2} — an order this size is refused.`) : !bad2 && l2 > mx2 + 1e-9 ? err(`${vw2}: an order this size is refused.`) : '';
  $('#pvOut').innerHTML = bad2 ? err(bad2) : row(vName(s2), money(pipValue(s2, l2)), 1) + row('Units', units(s2, l2)) + row('Margin', money(n2 / lev)) + row('Notional', money(n2)) + row('Spread cost', money(Engine.quote(s2).spread * pipValue(s2, l2))) + lim2
    + (lev !== effLev(s2) ? note(`Your account uses 1:${effLev(s2)} on ${escHtml(pretty(s2))} (${escHtml(free ? `no EU limit (ESMA caps ${esmaCapText(s2)})` : j2.name)}); this figure is a what-if.`) : '');
  const st = +$('#cgStart').value, ret = +$('#cgRet').value / 100, mo = +$('#cgM').value, fin = st * Math.pow(1 + ret, mo);
  const bad3 = !(st > 0) ? 'Start must be above 0.' : !(ret > -1) ? 'Monthly return must be above −100%.' : !(mo >= 1 && Number.isInteger(mo)) ? 'Months must be a whole number, 1 or more.' : '';
  if (bad3) { $('#cgOut').innerHTML = err(bad3); return; }
  $('#cgOut').innerHTML = row('Final balance', usdFmt(fin), 1) + row('Total gain', usdFmt(fin - st, true)) + row('Total return', pct((fin / st - 1) * 100, 1)) + row('Annualised', pct((Math.pow(1 + ret, 12) - 1) * 100, 1)) + '<p class="note">Arithmetic only: assumes the same return every month, with no losing months. Real results vary.</p>';
}

/* Position size → ticket (UX-84): the size and the stop go to New order; nothing is sent */
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#cpToTk'); if (!b) return;
  const sym = b.dataset.sym; if (!M(sym)) return;
  if (S.set.sym !== sym) setSymbol(sym);
  Object.assign(S.tk, { sm: 'lots', lots: +b.dataset.lots, sl: +b.dataset.sl, useSL: true });
  syncTicketInputs();
  const tv = document.querySelector('#views [data-view="trade"]'); if (tv) tv.click();
  toast('Ticket ready — not sent', `${lotsWord(sym, +b.dataset.lots)} ${pretty(sym)} with a stop of ${b.dataset.sl} ${unitWord(sym)}: choose the side and send.`, 'info');
});
