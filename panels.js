'use strict';
/* tradeBerry — dock, intelligence, calendar, correlation & volatility, journal, risk lab, calculators. Classic script sharing globals with app.js; loaded right after it. */
/* ============ dock: positions / orders / history / alerts ============ */
const uShort = sym => M(sym).unit === 'pt' ? 'pt' : 'p'; // compact unit after a number: '20p' on FX, '20pt' on a CFD
function renderPositions() {
  const body = $('#posBody');
  if (dirty.pos) {
    body.innerHTML = S.positions.map(p => `<tr data-id="${p.id}">
      <td class="sym" data-sym="${p.sym}">${pretty(p.sym)} <span class="muted small">#${p.id}</span></td>
      <td><span class="tag ${p.side}">${p.side}</span></td><td>${p.lots.toFixed(2)}</td><td>${fp(p.sym, p.entry)}</td>
      <td data-c="px"></td><td class="editable" data-edit="sl" title="Click to edit"></td><td class="editable" data-edit="tp" title="Click to edit"></td>
      <td data-c="pips"></td><td data-c="pnl"></td>
      <td><div class="acts"><button data-act="half" title="Close half">½</button><button data-act="be" title="Move stop to break-even">BE</button><button data-act="rev" title="Reverse position">Rev</button><button class="x" data-act="close" title="Close">✕</button></div></td></tr>`).join('');
    $('#posEmpty').hidden = S.positions.length > 0; $('#cPos').textContent = S.positions.length;
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
    const pi = tr.querySelector('[data-c=pips]'); pi.textContent = sgn(r.pips); pi.className = cls(r.pips);
    const pn = tr.querySelector('[data-c=pnl]'); pn.textContent = usdFmt(r.pnl, true); pn.className = cls(r.pnl); pn.title = p.swap ? `includes swap ${usdFmt(p.swap, true)}` : '';
    for (const f of ['sl', 'tp']) { const td = tr.querySelector(`[data-edit=${f}]`); if (!td.querySelector('input')) td.textContent = p[f] != null ? fp(p.sym, p[f]) + (f === 'sl' && p.trail ? ' ↻' : '') : '—'; }
  }
  if (ft) {
    ft.hidden = !S.positions.length;
    const n = S.positions.length, th = ft.querySelector('th'); th.textContent = `Total · ${n} position${n === 1 ? '' : 's'}`;
    ft.querySelector('[data-c=tlots]').textContent = tl.toFixed(2);
    const pn = ft.querySelector('[data-c=tpnl]'); pn.textContent = usdFmt(tp, true); pn.className = cls(tp); pn.title = 'Floating P&L of all open positions, swaps included';
  }
  const ov = $('#positionOverview');
  if (ov) {
    ov.hidden = !S.positions.length;
    if (S.positions.length) {
      const gross = S.positions.reduce((n, p) => n + notionalUsd(p.sym, p.lots), 0);
      const protectedN = S.positions.filter(p => p.sl != null || p.trail).length;
      const winners = S.positions.filter(p => posPnl(p).pnl > 0).length;
      const pp = $('#poPnl'); pp.textContent = usdFmt(tp, true); pp.className = 'mono ' + cls(tp);
      $('#poExposure').textContent = gross >= 1e6 ? '$' + (gross / 1e6).toFixed(2) + 'M' : '$' + (gross / 1000).toFixed(0) + 'k';
      $('#poProtected').textContent = `${protectedN} / ${S.positions.length}`;
      $('#poWinners').textContent = `${winners} / ${S.positions.length}`;
      const read = $('#poRead'), all = protectedN === S.positions.length;
      read.textContent = all ? 'Every position has defined protection' : `${S.positions.length - protectedN} position${S.positions.length - protectedN === 1 ? '' : 's'} without a protective stop`;
      read.className = all ? 'st-ok' : 'st-warn';
    }
  }
}
function renderOrders() {
  if (dirty.ord) {
    $('#ordBody').innerHTML = S.orders.map(o => `<tr data-id="${o.id}"><td class="sym" data-sym="${o.sym}">${pretty(o.sym)}</td><td><span class="tag ${o.side}">${o.side} ${o.ot}</span></td><td>${o.lots.toFixed(2)}</td><td data-c="price">${fp(o.sym, o.price)}</td><td data-c="dist"></td><td>${o.slPips ? o.slPips + uShort(o.sym) : '—'}</td><td>${o.tpPips ? o.tpPips + uShort(o.sym) : '—'}</td><td><div class="acts"><button class="x" data-act="cancel">Cancel</button></div></td></tr>`).join('');
    $('#ordEmpty').hidden = S.orders.length > 0; $('#cOrd').textContent = S.orders.length; dirty.ord = false;
  }
  for (const tr of $('#ordBody').children) {
    const o = S.orders.find(x => x.id === +tr.dataset.id); if (!o) continue;
    const q = Engine.quote(o.sym), ref = o.side === 'buy' ? q.ask : q.bid;
    tr.querySelector('[data-c=dist]').textContent = (Math.abs(o.price - ref) / M(o.sym).pip).toFixed(1) + ' ' + unitWord(o.sym);
    tr.querySelector('[data-c=price]').textContent = fp(o.sym, o.price);
  }
}
function renderHistory() {
  if (!dirty.hist) return;
  // a protection row is a balance credit: no side tag, no size
  $('#histBody').innerHTML = S.history.slice(0, 200).map(h => `<tr${h.nbp ? ' class="nbp"' : ''}><td>${dts(h.close)}</td><td class="sym" data-sym="${h.sym}">${pretty(h.sym)}</td><td>${h.nbp ? '—' : `<span class="tag ${h.side}">${h.side}</span>`}</td><td>${h.nbp ? '—' : h.lots.toFixed(2)}</td><td>${fp(h.sym, h.entry)}</td><td>${fp(h.sym, h.exit)}</td><td class="${cls(h.pips)}">${sgn(h.pips)}</td><td class="${cls(h.r || 0)}">${h.r != null ? sgn(h.r, 2) + 'R' : '—'}</td><td class="${cls(h.pnl)}">${usdFmt(h.pnl, true)}</td><td class="muted">${escHtml(h.reason)}</td></tr>`).join('');
  $('#histEmpty').hidden = S.history.length > 0;
  dirty.hist = false; dirty.journal = true;
}
function renderAlerts() {
  syncInstrSelect($('#alSym'));
  if (dirty.al) {
    $('#alBody').innerHTML = S.alerts.map(a => `<tr data-id="${a.id}"><td class="sym" data-sym="${a.sym}">${pretty(a.sym)}</td><td>${a.cond}</td><td>${fp(a.sym, a.price)}</td><td data-c="dist"></td><td>${a.done ? `<span class="tag lo">Triggered ${hhmm(a.at)}</span>` : '<span class="tag md">Active</span>'}</td><td><div class="acts"><button class="x" data-act="del">✕</button></div></td></tr>`).join('');
    $('#alEmpty').hidden = S.alerts.length > 0; $('#cAl').textContent = S.alerts.filter(a => !a.done).length; dirty.al = false;
  }
  for (const tr of $('#alBody').children) {
    const a = S.alerts.find(x => x.id === +tr.dataset.id); if (!a) continue;
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
  $('#mMargin').textContent = usdFmt(a.mg); $('#mFree').textContent = usdFmt(a.free);
  syncLevSel(); // also after an import that set #levSel to a bare number
  const lv = $('#mLevel'); lv.textContent = isFinite(a.level) ? nf0.format(a.level) + '%' : '—'; lv.className = a.level < 150 ? 'dn' : '';
  const d = $('#mDD'); d.textContent = pct(-dd, 2); d.className = dd > .01 ? 'dn' : '';
  $('#simClock').textContent = new Date(Engine.simTime * 1000).toISOString().slice(11, 19) + ' UTC';
  const q = Engine.quote(S.set.sym), arr = Engine.candles[S.set.sym], ref = arr[Math.max(0, arr.length - 1441)].close, ch = (q.mid / ref - 1) * 100;
  $('#symMid').innerHTML = bigPx(S.set.sym, q.mid);
  const c = $('#symChg'); c.innerHTML = `${pct(ch)} <span class="chg-per">24h</span>`; c.className = 'chg mono ' + cls(ch);
  // Decision context: the five numbers that matter before opening the ticket.
  const m = M(S.set.sym), ctxMarket = $('#ctxMarket');
  if (ctxMarket) {
    ctxMarket.textContent = q.open ? 'Open' : q.why === 'off quotes' ? 'Off quotes' : 'Closed';
    ctxMarket.className = q.open ? 'st-ok' : 'st-warn';
    $('#ctxSpread').textContent = q.spread.toFixed(1) + uShort(S.set.sym);
    const at = atr1h(S.set.sym);
    $('#ctxAtr').textContent = at != null ? (at / m.pip).toFixed(1) + uShort(S.set.sym) : '—';
    const day = arr.slice(-1440), hi = Math.max(...day.map(x => x.high)), lo = Math.min(...day.map(x => x.low));
    $('#ctxRange').textContent = isFinite(hi - lo) ? ((hi - lo) / m.pip).toFixed(1) + uShort(S.set.sym) : '—';
    const net = S.positions.filter(p => p.sym === S.set.sym).reduce((n, p) => n + (p.side === 'buy' ? p.lots : -p.lots), 0);
    const ex = $('#ctxExposure'); ex.textContent = net ? `${net > 0 ? '+' : '−'}${Math.abs(net).toFixed(2)} ${m.lotName}` : 'Flat'; ex.className = 'mono ' + cls(net);
  }
  const dm = $('#dockMargin'); if (dm) dm.textContent = a.eq > 0 ? pct(a.mg / a.eq * 100, 1, false) : '—';
  const ddd = $('#dockDd'); if (ddd) { ddd.textContent = pct(-dd, 2); ddd.className = 'mono ' + (dd > .01 ? 'dn' : ''); }
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
  if (p) { const side = p.base === top ? 'buy' : 'sell'; idea.dataset.sym = p.sym; idea.dataset.side = side; idea.innerHTML = `Strongest <b>${top}</b> vs weakest <b>${bot}</b> → ${side === 'buy' ? 'long' : 'short'} bias on <b>${pretty(p.sym)}</b>. Click to load.`; }
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

/* ============ economic calendar (simulated) ============ */
const TEMPL = [
  ['USD', 'Non-Farm Payrolls', 'hi', 'K', 150, 60], ['USD', 'CPI m/m', 'hi', '%', .3, .15], ['USD', 'Fed Chair Testimony', 'hi', '', null, null], ['USD', 'ISM Services PMI', 'md', '', 52.5, 1.5], ['USD', 'Initial Jobless Claims', 'md', 'K', 225, 12, true], ['USD', 'Retail Sales m/m', 'md', '%', .4, .4],
  ['EUR', 'ECB Rate Decision', 'hi', '%', 2.0, 0], ['EUR', 'German ZEW Sentiment', 'md', '', 12, 8], ['EUR', 'Flash PMI Composite', 'md', '', 50.4, 1.2],
  ['GBP', 'CPI y/y', 'hi', '%', 3.1, .25], ['GBP', 'Retail Sales m/m', 'md', '%', .2, .5], ['JPY', 'BoJ Policy Statement', 'hi', '', null, null], ['JPY', 'Tokyo Core CPI y/y', 'md', '%', 2.2, .2],
  ['AUD', 'Employment Change', 'hi', 'K', 25, 20], ['CAD', 'Employment Change', 'hi', 'K', 20, 18], ['NZD', 'GDP q/q', 'md', '%', .4, .3], ['CHF', 'CPI m/m', 'md', '%', .1, .15], ['USD', 'Crude Oil Inventories', 'lo', 'M', -1.2, 2.5]
];
const CAL = { events: [], nextT: 0 };
function fmtNum(v, unit) { if (v == null) return '—'; const d = unit === 'K' ? 0 : unit === '%' ? (Math.abs(v) < 1 ? 1 : 2) : 1; const t = v.toFixed(d); return (+t === 0 ? Math.abs(+t).toFixed(d) : t) + unit; }
function genEvent(t) {
  const [ccy, name, impact, unit, base, sd, inv] = TEMPL[Math.floor(Math.random() * TEMPL.length)];
  const fc = base == null ? null : base + (Math.random() - .5) * (sd || .1);
  const prev = fc == null ? null : fc + (Math.random() - .5) * (sd || .1) * 1.4;
  return { id: Math.random().toString(36).slice(2), t, ccy, name, impact, unit, fc, prev, sd, inv, done: false, actual: null };
}
function calTick() {
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
const CALF = { imp: { hi: true, md: true, lo: true }, ccy: '' };
function calFilterBar() {
  let f = $('#calF'); if (f) return f;
  const wrap = $('#calBody').closest('.tab'); if (!wrap) return null;
  f = document.createElement('div'); f.id = 'calF'; f.className = 'cal-f';
  f.innerHTML = `<span class="muted small">Impact</span><div class="mini-seg" role="group" aria-label="Impact">${[['hi', 'High'], ['md', 'Med'], ['lo', 'Low']].map(([k, l]) => `<button data-imp="${k}" class="on" aria-pressed="true">${l}</button>`).join('')}</div><label class="muted small cal-ccy">Currency <select id="calCcy" aria-label="Currency"><option value="">All</option></select></label><span class="muted small cal-n" id="calN"></span>`;
  wrap.prepend(f);
  f.addEventListener('click', e => { const b = e.target.closest('[data-imp]'); if (!b) return; const k = b.dataset.imp; CALF.imp[k] = !CALF.imp[k]; b.classList.toggle('on', CALF.imp[k]); b.setAttribute('aria-pressed', CALF.imp[k]); renderCalendar(); });
  f.querySelector('#calCcy').addEventListener('change', e => { CALF.ccy = e.target.value; renderCalendar(); });
  return f;
}
function renderCalendar() {
  const f = calFilterBar(), sel = f && f.querySelector('#calCcy');
  const all = CAL.events.slice().sort((a, b) => a.t - b.t), ccys = [...new Set(all.map(e => e.ccy))].sort();
  if (sel && sel.dataset.k !== ccys.join()) { sel.dataset.k = ccys.join(); if (CALF.ccy && !ccys.includes(CALF.ccy)) ccys.push(CALF.ccy); sel.innerHTML = '<option value="">All</option>' + ccys.map(c => `<option${c === CALF.ccy ? ' selected' : ''}>${c}</option>`).join(''); }
  const rows = all.filter(e => CALF.imp[e.impact] !== false && (!CALF.ccy || e.ccy === CALF.ccy));
  if (f) f.querySelector('#calN').textContent = rows.length === all.length ? `${all.length} events` : `${rows.length} of ${all.length} events`;
  // compact rows at their natural height (no stretching to the pane); the next release is the panel's hero row
  const next = rows.find(e => !e.done);
  // actual vs forecast is shown as a neutral arrow: above or below forecast is not good or bad for a position
  $('#calBody').innerHTML = rows.map(e => {
    const d = e.actual != null && e.fc != null ? e.actual - e.fc : 0, arr = !e.done || !d ? '' : `<span class="cal-d" title="${d > 0 ? 'Above' : 'Below'} forecast">${d > 0 ? '▲' : '▼'}</span>`;
    return `<tr class="${e.done ? 'cal-done' : e === next ? 'cal-next' : ''}"><td>${dts(e.t)}</td><td${e === next ? ' title="Next release"' : ''}>${e.done ? 'released' : fmtIn(e.t - Engine.simTime)}</td><td><b>${e.ccy}</b></td><td class="l cal-ev">${escHtml(e.name)}</td><td><span class="tag ${e.impact}">${{ hi: 'High', md: 'Med', lo: 'Low' }[e.impact]}</span></td><td>${fmtNum(e.fc, e.unit)}</td><td>${fmtNum(e.prev, e.unit)}</td><td>${e.done ? fmtNum(e.actual, e.unit) + arr : ''}</td></tr>`;
  }).join('') || `<tr><td colspan="8" class="empty">No events match these filters.</td></tr>`;
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
      if (c.dataset.tip && !c.dataset.more) { c.dataset.more = 1; const a = c.dataset.a, b2 = c.dataset.b, other = [[240, '4H'], [1440, '1D'], [4320, '3D']].filter(([w]) => w >= CORR_RET_MIN[CORR.ret]).map(([w, l]) => { const v = CORR.set === 'all' ? corrPair(a, b2, w).r : Engine.corr(corrRet(a, w), corrRet(b2, w)); return `${l} ${Number.isFinite(v) ? nfx(v, 2) : '—'}`; }).join(' · '); c.dataset.tip += ` Windows: ${other}.`; }
    });
    $('#corr').addEventListener('mouseleave', () => $$('#corr .hx').forEach(x => x.classList.remove('hx')));
  }
  $$('#corrRet button').forEach(b => b.classList.toggle('on', +b.dataset.ret === CORR.ret)); $$('#corrOrd button').forEach(b => b.classList.toggle('on', b.dataset.ord === CORR.ord));
  if (cs) cs.querySelectorAll('button').forEach(b => { const on = b.dataset.cs === CORR.set; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const ps0 = corrSyms(), lb = S.set.corrLb || 1440, mine = CORR.set === 'all';
  // G8 pairs share every minute: the engine's own index-aligned returns; Yours: each pair paired on common minutes
  // over the lookback ending at the last minute both have a bar (corrPair), so a closed market reads its last session
  const R = mine ? null : Object.fromEntries(ps0.map(s => [s, corrRet(s, lb)])), C = mine ? {} : null;
  const memo = {}, rx = (a, b) => { const k = a < b ? a + '|' + b : b + '|' + a; return memo[k] || (memo[k] = mine ? corrPair(a, b, lb, C) : { r: Engine.corr(R[a], R[b]), n: Math.min(R[a].length, R[b].length) }); };
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
function journalStats() {
  const all = S.history, h = tradesOf(all), wins = h.filter(x => x.net > 0), losses = h.filter(x => x.net <= 0);
  const gw = wins.reduce((s, x) => s + x.net, 0), gl = -losses.reduce((s, x) => s + x.net, 0);
  const rs = h.filter(x => x.r != null).map(x => x.r);
  // the curve: the balance after each trade's last close (protection credits included). It starts from what the
  // balance was before the oldest kept entry (history is capped at 500): the commission of a still-open position was
  // paid at its open and is no closed trade's, so it is added back
  const openComm = S.positions.reduce((s, p) => s + (+p.comm || 0), 0);
  const start = S.balance + openComm - all.reduce((s, x) => s + netPnl(x), 0), last = new Map(h.map(x => [x.rows[0], x]));
  const ev = []; for (const x of [...all].reverse()) { if (x.nbp) ev.push({ v: netPnl(x), t: x.close, nbp: true }); else if (last.has(x)) ev.push({ v: last.get(x).net, t: x.close }); }
  let eq = start, peak = start, mdd = 0; const curve = [start], curveT = [ev.length ? all[all.length - 1].open ?? ev[0].t : 0];
  for (const e of ev) { eq += e.v; curve.push(eq); curveT.push(e.t); }
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
    avgWinR: wr.length ? wr.reduce((a, b) => a + b, 0) / wr.length : null, avgLossR: lr.length ? -lr.reduce((a, b) => a + b, 0) / lr.length : null, rN: rs.length
  };
}
// the win rate with its 95% Wilson interval (shared.js wrTxt): the rate large, the interval and n under it
const WR_TIP = 'Share of winning trades with its 95% Wilson interval: with few trades the true rate can sit anywhere in that range';
function wrHtml(k, n) { const w = wrTxt(k, n), i = w.indexOf(' '); return `${w.slice(0, i)}<small style="display:block;font-size:var(--fs-xs);font-weight:400;color:var(--tx3)">${w.slice(i)}</small>`; }
function renderJournal() {
  const s = journalStats(), any = s.n > 0, D = '—';
  const k = [['Net P&L', any ? usdFmt(s.net, true) : D, cls(s.net)], ['Trades', s.n], ['Win rate', any ? wrHtml(s.nWin, s.n) : D], ['Profit factor', !any || !s.nWin && !s.nLoss ? D : isFinite(s.pf) ? s.pf.toFixed(2) : '∞'],
  ['Avg win', s.nWin ? usdFmt(s.avgW, true) : D, s.nWin ? 'up' : ''], ['Avg loss', s.nLoss ? usdFmt(s.avgL, true) : D, s.nLoss && s.avgL ? 'dn' : ''], ['Expectancy', any ? usdFmt(s.exp, true) : D, cls(s.exp)], ['Avg R', s.avgR != null ? sgn(s.avgR, 2) + 'R' : D],
  ['Max drawdown', s.curve.length > 1 ? pct(-s.mdd, 2) : D, s.mdd ? 'dn' : ''], ['Best / worst', any ? `<span class="${cls(s.best)}">${usdFmt(s.best, true).replace('.00', '')}</span> / <span class="${cls(s.worst)}">${usdFmt(s.worst, true).replace('.00', '')}</span>` : D]];
  // emphasis tiers: Net P&L is the hero, the rest are key figures
  $('#kpis').innerHTML = k.map(([a, b, c], i) => `<div class="kpi ${i ? 'key' : 'hero'}${a === 'Best / worst' ? ' wide' : ''}"${a === 'Win rate' ? ` title="${WR_TIP}"` : ''}><label>${a}</label><b class="${c || ''}">${b}</b></div>`).join('');
  drawCurve($('#eqCanvas'), s.curve, s.curveT);
  renderCoach();
  const SET = ['', 'Breakout', 'Trend', 'Pullback', 'Reversal', 'Range', 'News', 'Impulse'];
  // one row per trade (a table: Symbol | Side | P&L | Setup | Note); its note and setup live on the trade's first
  // history row (tradesOf reads them from there)
  const NOTE_PH = 'What did you see? What would you change?';
  const items = s.trades.slice(0, 40).map(h => {
    const i = S.history.indexOf(h.rows[h.rows.length - 1]), side = h.side === 'buy' ? 'buy' : 'sell';
    const parts = h.parts > 1 ? `${h.parts} parts${h.complete ? '' : ', still open'}` : '';
    return `<div class="jitem" data-i="${i}"><div class="top"><span class="jsym">${escHtml(pretty(h.sym))}${parts ? ` <span class="muted small" title="${parts}">${parts}</span>` : ''}</span><span class="jside"><span class="tag ${side}">${side}</span></span><span class="jpnl ${cls(h.net)}" title="${h.comm ? `net of ${usdFmt(h.comm)} commission` : 'net P&L'}">${usdFmt(h.net, true)}</span></div><div class="row"><select data-j="setup" aria-label="Setup">${SET.map(x => `<option ${x === h.setup ? 'selected' : ''} value="${x}">${x || 'Setup…'}</option>`).join('')}</select><input data-j="note" aria-label="Note" placeholder="${NOTE_PH}" title="${NOTE_PH}" value="${escHtml(h.note || '')}"></div></div>`;
  });
  $('#jList').innerHTML = items.length ? '<div class="jhead" aria-hidden="true"><span>Symbol</span><span>Side</span><span>P&amp;L</span><span>Setup</span><span>Note</span></div>' + items.join('')
    : '<div class="muted small">Close trades to start journaling. Tag each setup to see what each one costs or pays, net of costs.</div>';
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
    let e = 1, peak = 1, mdd = 0, ruined = false; const path = k < 40 ? [1] : null; const snap = [];
    for (let i = 0; i < N; i++) {
      e *= Math.random() < p ? 1 + risk * rr : 1 - risk;
      peak = Math.max(peak, e); mdd = Math.max(mdd, 1 - e / peak); if (e < .5) ruined = true;
      if (path) path.push(e); snap.push(e);
    }
    paths.push(snap); finals.push(e); dds.push(mdd); if (ruined) ruin++; if (mdd > .2) dd20++;
  }
  const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(f * (s.length - 1))]; };
  const bands = [.05, .25, .5, .75, .95].map(f => [1, ...Array.from({ length: N }, (_, i) => q(paths.map(pp => pp[i]), f))]);
  const expR = p * rr - (1 - p);
  const out = [['Expectancy', sgn(expR, 2) + 'R / trade', cls(expR)], ['Median result', pct((q(finals, .5) - 1) * 100, 1), cls(q(finals, .5) - 1)], ['5th pct', pct((q(finals, .05) - 1) * 100, 1), cls(q(finals, .05) - 1)], ['95th pct', pct((q(finals, .95) - 1) * 100, 1), cls(q(finals, .95) - 1)],
  ['Profitable paths', pct(finals.filter(f => f > 1).length / P * 100, 1, false)], ['Median max DD', pct(-q(dds, .5) * 100, 1), 'dn'], ['P(DD > 20%)', pct(dd20 / P * 100, 1, false)], ['Risk of ruin (−50%)', pct(ruin / P * 100, 1, false), ruin ? 'dn' : 'up']];
  // emphasis tiers: the median result is the hero; the tail, the typical drawdown and ruin are the key figures
  out.unshift(...out.splice(1, 1)); // the hero reads first
  const tier = { 'Median result': 'lo-hero','5th pct': 'lo-key', 'Median max DD': 'lo-key', 'Risk of ruin (−50%)': 'lo-key' };
  $('#labOut').innerHTML = out.map(([a, b, c]) => `<div class="${tier[a] || 'lo-sec'}"><label>${a}</label><b class="${c || ''}">${b}</b></div>`).join('');
  drawFan($('#labCanvas'), bands, paths.slice(0, 40));
}
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
  const prof = sym => { const j = jurOf(S.set); return `${j.none ? 'Sheet' : j.name} 1:${effLev(sym)}`; };
  const err = t => `<div class="calc-err" role="status"><span>${t}</span></div>`, note = t => `<div class="calc-note"><span>${t}</span></div>`;
  // position size: floored to the sheet's volume step (never more risk than asked), every figure from the size shown
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
      + row('Margin at profile', `${usdFmt(n1 / effLev(s1))} (${escHtml(prof(s1))})`) + warn.map(err).join('');
  }
  // margin: the account's effective leverage on the instrument (the sheet's, or the user's choice up to its maximum,
  // capped by the jurisdiction). A jurisdiction cap fixes the field; without one any what-if up to the sheet maximum
  const s2 = $('#pvSym').value, l2 = +$('#pvLots').value, m2 = M(s2), lvEl = $('#pvLev'), j2 = jurOf(S.set);
  if (!m2) { $('#pvOut').innerHTML = err('Pick an instrument.'); return; }
  const n2 = notionalUsd(s2, l2), free = !!j2.none, ceil = free ? m2.p.lev[1] : effLev(s2), key = levKey() + '|' + s2;
  if (lvEl.dataset.k !== key || !free) { lvEl.dataset.k = key; lvEl.value = effLev(s2); }
  lvEl.readOnly = !free; lvEl.max = ceil;
  lvEl.title = free ? `No jurisdiction cap: any leverage up to 1:${ceil}, the instrument sheet maximum` : `Set by the ${j2.name} cap (Settings) on the sheet's 1:${sheetLev(s2)}`;
  const tg = $('#pvLevTag'); if (tg) tg.textContent = free ? `Sheet 1:${effLev(s2)} · maximum 1:${ceil}` : prof(s2);
  const lev = lvEl.value.trim() === '' ? NaN : +lvEl.value;
  const bad2 = !(l2 > 0) ? 'Lots must be above 0.' : !(lev >= 1) ? 'Leverage must be at least 1:1.' : lev > ceil ? `Above the 1:${ceil} ceiling for ${escHtml(pretty(s2))}: the instrument sheet maximum.` : '';
  $('#pvOut').innerHTML = bad2 ? err(bad2) : row(vName(s2), usdFmt(pipValue(s2, l2)), 1) + row('Units', units(s2, l2)) + row('Margin', usdFmt(n2 / lev)) + row('Notional', usdFmt(n2)) + row('Spread cost', usdFmt(Engine.quote(s2).spread * pipValue(s2, l2)))
    + (lev !== effLev(s2) ? note(`Your account uses 1:${effLev(s2)} on ${escHtml(pretty(s2))} (${escHtml(free ? 'sheet, no jurisdiction cap' : j2.name)}); this figure is a what-if.`) : '');
  const st = +$('#cgStart').value, ret = +$('#cgRet').value / 100, mo = +$('#cgM').value, fin = st * Math.pow(1 + ret, mo);
  $('#cgOut').innerHTML = row('Final balance', usdFmt(fin), 1) + row('Total gain', usdFmt(fin - st, true)) + row('Total return', pct((fin / st - 1) * 100, 1)) + row('Annualised', pct((Math.pow(1 + ret, 12) - 1) * 100, 1));
}
