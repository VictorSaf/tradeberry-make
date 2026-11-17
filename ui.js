/* tradeBerry — UI layer: accessibility (this file), workspace layouts, onboarding and motion (appended below) */
(function a11y() {
  if (typeof S === 'undefined' || !S || !S.set || typeof setTab !== 'function') return setTimeout(a11y, 150);
  const $q = (s, r = document) => r.querySelector(s), $$q = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---- page heading + skip links ---- */
  const h1 = document.createElement('h1'); h1.className = 'sr-only'; h1.textContent = 'tradeBerry trading terminal'; ($q('header.topbar') || document.body).prepend(h1);
  const dock = $q('.panel.dock'); if (dock) { const h2 = document.createElement('h2'); h2.className = 'sr-only'; h2.textContent = 'Trading tools'; dock.prepend(h2); }
  const skip = document.createElement('nav'); skip.className = 'skip'; skip.setAttribute('aria-label', 'Skip links');
  skip.innerHTML = '<a href="#chart">Skip to chart</a><a href="#tkLots">Skip to order ticket</a><a href="#tabs">Skip to tools</a>';
  document.body.prepend(skip);
  skip.addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return; e.preventDefault();
    const id = a.getAttribute('href').slice(1);
    if (document.body.classList.contains('mnav-on') && window.mnavGo) mnavGo(id === 'chart' ? 'chart' : id === 'tkLots' ? 'trade' : 'tools');
    let t = document.getElementById(id); if (!t) return;
    // the step-by-step ticket at its start shows Buy / Sell only: the skip link lands on Buy
    if (id === 'tkLots' && !t.offsetParent) { const b = document.getElementById('tkBuyBtn'); if (b && b.offsetParent) { b.focus(); return; } }
    if (id === 'tabs') { const on = $q('#tabs [aria-selected="true"]') || $q('#tabs [role="tab"]'); on && on.focus(); return; }
    if (!t.hasAttribute('tabindex') && !/^(INPUT|SELECT|BUTTON|TEXTAREA|A)$/.test(t.tagName)) t.setAttribute('tabindex', '-1');
    t.focus();
  });

  /* ---- accessible names for every form control (static and rendered later) ---- */
  const NAMES = {
    speedSel: 'Market speed', levSel: 'Leverage', wlSearch: 'Filter markets', qLots: 'Quick trade size in lots',
    tkPrice: 'Entry price', tkLots: 'Order size in lots', tkRisk: 'Risk per trade, percent of equity', tkSL: 'Stop loss distance in pips',
    tkTP: 'Take profit distance in pips', tkRiskUsd: 'Risk per trade, dollars', tkSlPx: 'Stop loss price', tkSlAtr: 'Stop loss distance, multiples of the hourly ATR', tkTpPx: 'Take profit price', tkTpR: 'Take profit, multiples of the stop distance', tkTrail: 'Trailing stop distance in pips', useSL: 'Use stop loss', useTP: 'Use take profit', useTrail: 'Use trailing stop',
    alSym: 'Alert pair', alCond: 'Alert condition', alPx: 'Alert price', cpSym: 'Position size pair', cpAcc: 'Account size', cpRisk: 'Risk percent',
    cpSL: 'Stop distance in pips', pvSym: 'Pip value pair', pvLots: 'Lots', pvLev: 'Leverage', cgStart: 'Starting balance', cgRet: 'Monthly return percent', cgM: 'Months',
    lWin: 'Win rate percent', lRR: 'Reward to risk', lRisk: 'Risk per trade percent', lN: 'Number of trades', cmdInput: 'Command', importFile: 'Import account file',
    sonTicks: 'Tick sounds', sonHeart: 'Heartbeat', sonVol: 'Sonification volume', sonSens: 'Sonification sensitivity'
  };
  const RULE_K = { a: 'left side', c: 'comparison', b: 'right side', v: 'value' };
  const txt = n => (n && n.textContent || '').replace(/\s+/g, ' ').trim();
  const hasName = el => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && [...el.labels].some(l => txt(l))) || el.title;
  function guess(el) {
    if (NAMES[el.id]) return NAMES[el.id];
    // backtest rule rows: operand, condition, operand (the first option would name only the current choice)
    const rule = el.closest('.rule[data-side]');
    if (rule && RULE_K[el.dataset.k]) return `${rule.dataset.side === 'short' ? 'Short' : 'Long'} condition ${+rule.dataset.i + 1}: ${RULE_K[el.dataset.k]}`;
    if (el.placeholder) return el.placeholder;
    const box = el.closest('.m,.ins,.fld,.f,.bt-row3>div,.bt-row>div,.cfg-row,.lab-in,.calc-row,div');
    const lab = box && $q(':scope > label, :scope > span:not(.unit), :scope > small, :scope > b', box);
    if (lab && txt(lab) && txt(lab).length < 60) return txt(lab);
    const prev = el.previousElementSibling; if (prev && txt(prev) && txt(prev).length < 60) return txt(prev);
    if (el.tagName === 'SELECT' && el.options.length) return 'Choose ' + txt(el.options[0]).toLowerCase();
    return el.name || el.id || null;
  }
  function names(root = document) {
    for (const el of $$q('input:not([type=hidden]),select,textarea', root)) if (NAMES[el.id] ? !el.getAttribute('aria-label') : !hasName(el)) { const n = guess(el); if (n) el.setAttribute('aria-label', n); }
    for (const th of $$q('th', root)) if (!txt(th) && !th.querySelector('.sr-only')) th.innerHTML = '<span class="sr-only">Actions</span>';
    // labelled non-interactive boxes need a role for their label to count
    for (const el of $$q('div[aria-label]:not([role]),span[aria-label]:not([role])', root)) el.setAttribute('role', el.querySelector('button,input,select,a,[tabindex]') ? 'group' : 'img');
  }

  /* ---- regions that scroll sideways must be reachable from the keyboard ---- */
  function scrollers() {
    const acct = $q('#acct') || $q('.acct'); if (acct && !acct.hasAttribute('tabindex')) { acct.setAttribute('tabindex', '0'); acct.setAttribute('role', 'region'); acct.setAttribute('aria-label', 'Account summary'); }
    const ct = $q('.chart-top'); if (ct && document.body.classList.contains('mnav-on') && !ct.hasAttribute('tabindex')) { ct.setAttribute('tabindex', '0'); ct.setAttribute('role', 'region'); ct.setAttribute('aria-label', 'Chart tools'); }
  }

  /* ---- dock tabs: real tab semantics + arrow keys ---- */
  const tabBtns = () => $$q('#tabs button[data-tab]');
  function wireTabs() {
    // the tab list holds only tabs; the panel action buttons stay beside it
    const tl = $q('#tabs');
    if (tl.getAttribute('role') === 'tablist') { const w = document.createElement('div'); w.className = 'tabs-list'; w.setAttribute('role', 'tablist'); w.setAttribute('aria-label', 'Trading tools');
      tabBtns().forEach(b => w.appendChild(b)); tl.removeAttribute('role'); tl.prepend(w); }
    for (const b of tabBtns()) {
      const n = b.dataset.tab, pane = $q(`.tab[data-pane="${n}"]`);
      b.setAttribute('role', 'tab'); b.id = b.id || 'tab-' + n;
      if (pane) { pane.id = pane.id || 'pane-' + n; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', b.id); pane.setAttribute('tabindex', '0'); b.setAttribute('aria-controls', pane.id); }
    }
    syncTabs();
  }
  function syncTabs() { for (const b of tabBtns()) { const on = b.dataset.tab === activeTab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; } }
  const _set = window.setTab; window.setTab = function (n) { const r = _set.apply(this, arguments); syncTabs(); return r; };
  $q('#tabs').addEventListener('keydown', e => {
    const list = tabBtns().filter(b => b.offsetParent !== null), i = list.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % list.length : e.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (j < 0) return; e.preventDefault(); list[j].focus(); list[j].scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTab(list[j].dataset.tab);
  });

  /* ---- Enter / Space on custom buttons ---- */
  document.addEventListener('keydown', e => {
    const t = e.target; if (!(e.key === 'Enter' || e.key === ' ') || !t.matches || !t.matches('[role="button"]:not(button):not(a)')) return;
    if (e.key === ' ') e.preventDefault(); if (e.key === ' ' || !t.closest('#wl')) t.click();
  });

  /* ---- dialogs: focus moves in, stays in, and returns to where it was ---- */
  const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const openers = new WeakMap(); let lastOutside = null;
  document.addEventListener('focusin', e => { if (!e.target.closest('.overlay')) lastOutside = e.target; });
  const visible = o => o.isConnected && !o.hidden && getComputedStyle(o).display !== 'none';
  const topDialog = () => $$q('.overlay').filter(visible).pop();
  function onDialog(o) {
    if (visible(o)) {
      if (openers.has(o)) return;
      openers.set(o, o.contains(document.activeElement) ? lastOutside : document.activeElement);
      const box = o.firstElementChild || o; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      const h = box.querySelector('h2,h3,.pm-h,.cmd-h,b'); if (h && !box.getAttribute('aria-label')) box.setAttribute('aria-label', txt(h).slice(0, 80) || 'Dialog');
      requestAnimationFrame(() => { const f = box.querySelector('input:not([type=checkbox]):not([type=hidden]),textarea') || box.querySelector(FOCUSABLE); if (f && !box.contains(document.activeElement)) f.focus({ preventScroll: true }); });
    } else if (openers.has(o)) { const back = openers.get(o); openers.delete(o); if (back && back.isConnected && !topDialog()) back.focus({ preventScroll: true }); }
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return; const o = topDialog(); if (!o) return;
    const f = $$q(FOCUSABLE, o).filter(x => x.offsetParent !== null); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!o.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  const removed = new Set();
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'attributes' && m.target.classList && m.target.classList.contains('overlay')) onDialog(m.target);
      for (const n of m.addedNodes || []) if (n.nodeType === 1 && n.classList.contains('overlay')) onDialog(n);
      for (const n of m.removedNodes || []) if (n.nodeType === 1 && n.classList.contains('overlay') && openers.has(n)) { const back = openers.get(n); openers.delete(n); if (back && back.isConnected) back.focus({ preventScroll: true }); }
    }
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });

  /* ---- the chart canvas gets a live text alternative ---- */
  const chartEl = $q('#chart'); chartEl.setAttribute('role', 'region'); chartEl.setAttribute('aria-roledescription', 'chart'); chartEl.setAttribute('tabindex', '-1');
  function describeChart() {
    const sym = S.set.sym, q = Engine.quote(sym), tf = { 1: '1-minute', 5: '5-minute', 15: '15-minute', 60: '1-hour', 240: '4-hour' }[S.set.tf] || S.set.tf + '-minute';
    const ch = $q('#symChg'); chartEl.setAttribute('aria-label', `${pretty(sym)} ${tf} ${S.set.type === 'candles' ? 'candlestick' : S.set.type} chart. Bid ${fp(sym, q.bid)}, ask ${fp(sym, q.ask)}${ch && txt(ch) ? ', change ' + txt(ch).replace(/\s*24h$/, '') + ' over 24 hours' : ''}.`);
  }

  let pending = 0;
  function schedule() { if (pending) return; pending = setTimeout(() => { pending = 0; names(); scrollers(); }, 250); }
  wireTabs(); names(); scrollers(); describeChart(); setInterval(describeChart, 4000);
  $$q('.overlay').forEach(onDialog);
})();

/* =====================================================================
   Workspace — resizable panels, presets, saved named layouts (desktop)
   ===================================================================== */
(function workspace() {
  if (typeof S === 'undefined' || !S || !S.set || !document.querySelector('.grid .watch')) return setTimeout(workspace, 150);
  const g = document.querySelector('.grid'), watch = g.querySelector('.watch'), rail = g.querySelector('.rail'), dock = g.querySelector('.dock');
  if (!rail || !dock) { window.wsApply = () => {}; window.wsState = () => ({}); return; } // no rail/dock markup: no resizable workspace, dependants still start
  const PRESETS = {
    // each preset is a different workstation: arrangement + chart setup, not only panel sizes
    standard: { label: 'Standard — balanced', wl: 288, rail: 360, dock: 290, mirror: false, mode: '', tf: 15, charts: '1', ind: { ema20: true, ema50: true, bb: false, rsi: true }, tkMore: false, isw: 'iDom',
      hint: '15m chart, ticket with a switchable panel, positions below.' },
    scalping: { label: 'Scalping — ladder + 1m', wl: 240, rail: 600, dock: 180, mirror: false, mode: 'scalp', tf: 1, charts: '1', ind: { ema20: true, ema50: false, bb: false, rsi: false }, tkMore: true,
      hint: '1-minute chart, full-height depth ladder beside the ticket, click a level to place a limit. No RSI pane — more room for price.' },
    analysis: { label: 'Analysis — 4 charts', wl: 288, rail: 300, dock: 220, mirror: false, mode: '', tf: 60, charts: '4', ind: { ema20: true, ema50: true, bb: true, rsi: true }, tkMore: false, isw: 'iStr', iswShow: true,
      hint: 'Four 1H charts of the most related instruments (favourites and FX), Bollinger bands, G8 currency strength in the side panel.' },
    focus: { label: 'Chart focus — no panels', wl: 0, rail: 360, dock: 150, mirror: false, mode: 'focus', tf: 15, charts: '1', ind: { ema20: true, ema50: true, bb: false, rsi: true }, tkMore: false,
      hint: 'Chart fills the screen. Trade from the buy/sell box on the chart; positions stay in a thin strip below.' },
    mirror: { label: 'Mirrored — ticket left', wl: 288, rail: 360, dock: 290, mirror: true, mode: '', tf: 15, charts: '1', ind: { ema20: true, ema50: true, bb: false, rsi: true }, tkMore: false, isw: 'iDom',
      hint: 'Standard with the ticket on the left and the watchlist on the right.' }
  };
  const LIM = { wl: [240, 420], rail: [280, 640], dock: [120, 640] };
  function presetContent(p) {
    if (p.tf && S.set.tf !== p.tf && typeof setTF === 'function') setTF(p.tf);
    if (p.charts && typeof setLayout === 'function' && typeof mcCfg === 'function') {
      const was = mcCfg().layout;
      if (p.charts === '1') { if (was !== '1') setLayout('1'); }
      else if (was !== p.charts) { mcCfg().layout = p.charts; if (typeof mcAutoFill === 'function') { const t = toast; toast = () => {}; try { mcAutoFill(); } finally { toast = t; } } else setLayout(p.charts); }
    }
    if (p.ind) { for (const [k, v] of Object.entries(p.ind)) S.set.ind[k] = v; document.querySelectorAll('#indSeg button').forEach(b => b.classList.toggle('on', !!S.set.ind[b.dataset.ind])); if (typeof applyIndVis === 'function') applyIndVis(); if (typeof legend === 'function') legend(null); const n = document.getElementById('indN'); if (n) n.textContent = Object.values(S.set.ind).filter(Boolean).length; }
    if (p.isw) { if (window.iswOpen) { iswOpen(p.isw); if (!p.iswShow && window.iswFold) iswFold(true); } else document.querySelector(`#isw button[data-i="${p.isw}"]`)?.click(); } // a preset picks its market panel; only Analysis opens it beside the ticket
    const more = document.getElementById('tkMore'); if (more && p.tkMore != null) more.open = !!p.tkMore;
    // the one-form ticket (ticket.js): a preset that opened More opens Costs & checks
    const chk = document.querySelector('.ticket .tk-sec[data-sec=check]'); if (chk && p.tkMore != null) chk.open = !!p.tkMore;
    if (typeof setView === 'function' && typeof currentView === 'function' && currentView() !== 'trade') setView('trade');
  }
  const desk = () => innerWidth > 1080 && !document.body.classList.contains('mnav-on');
  S.set.layouts = Array.isArray(S.set.layouts) ? S.set.layouts : [];
  let cur = { ...PRESETS.standard, ...(S.set.ws || {}) };
  // v15.10: the one-form ticket starts at 360 px; a column still on the old 332 px default moves with it
  if (cur.rail === 332 && cur.mode !== 'scalp') cur.rail = PRESETS.standard.rail;
  // panels on demand (see pvBuild below): which panels show, kept per browser (a display preference, not account state)
  const PV_KEY = 'tb.panels', PV_DEF = { wl: true, tk: true, dock: 'auto', qt: true };
  let pv = (() => { try { const o = JSON.parse(localStorage.getItem(PV_KEY) || '{}'); return { ...PV_DEF, ...(o && typeof o === 'object' ? o : {}) }; } catch (e) { return { ...PV_DEF }; } })();

  // CSS-only part of apply(): cheap enough for every animation frame of a drag
  // the rail on the desktop is ticket | market panel (when open, 264 px) | the 36 px tab column: cur.rail is the ticket's
  // own width, the extra columns are added on top so the ticket keeps its size (scalping lays its rail out itself)
  // below 1440 px there is no room for three columns: an open market panel goes under the ticket (rail-stack), the
  // ticket keeps the rail's width and the tab column stays inside the viewport
  const mkBeside = () => !rail.classList.contains('isw-fold') && pv.tk;
  const railStack = () => desk() && cur.mode !== 'scalp' && !g.classList.contains('pv-railmin') && mkBeside() && innerWidth < 1440;
  const railExt = () => !desk() || cur.mode === 'scalp' || g.classList.contains('pv-railmin') ? 0 : 40 + (mkBeside() && !railStack() ? 268 : 0);
  // the default ticket width (360) is for 1520 px and up; below, the default stays at 332 so the chart and the dock keep
  // their room (a width the user dragged is kept as it is)
  const railOwn = () => cur.rail === PRESETS.standard.rail && innerWidth < 1520 ? 332 : cur.rail;
  function applyVars() {
    g.classList.add('ws'); g.classList.toggle('rail-stack', railStack()); g.classList.toggle('ws-mirror', cur.mirror); g.classList.toggle('ws-nowl', !cur.wl);
    g.classList.toggle('ws-scalp', cur.mode === 'scalp'); g.classList.toggle('ws-focus', cur.mode === 'focus');
    document.documentElement.style.setProperty('--ws-rail-eff', (cur.mode === 'focus' ? 0 : railOwn() + railExt()) + 'px');
    g.style.setProperty('--wl-w', (cur.wl || 0) + 'px'); g.style.setProperty('--rail-w', (railOwn() + railExt()) + 'px'); g.style.setProperty('--dock-h', cur.dock + 'px'); document.documentElement.style.setProperty('--ws-rail', railOwn() + 'px'); document.documentElement.style.setProperty('--ws-dock', cur.dock + 'px');
  }
  function apply(ws, name) {
    cur = { wl: ws.wl, rail: ws.rail, dock: ws.dock, mirror: !!ws.mirror, mode: ws.mode || '' };
    applyVars();
    if (g.classList.contains('dock-big') && name) toggleDock(false);
    if (name !== undefined) g.classList.remove('dock-held'); // a preset or a saved layout: the empty dock folds again
    S.set.ws = cur; if (name !== undefined) S.set.wsName = name; save(); sync(); position();
    setTimeout(() => { if (typeof reqOverlay === 'function') reqOverlay(); if (activeTab === 'journal') renderJournal(); if (activeTab === 'lab') redrawLab(); if (activeTab === 'bt' && typeof drawBtCurve === 'function') drawBtCurve(); }, 80);
  }

  /* header picker — a native select keeps it keyboard and screen-reader friendly */
  const sel = document.createElement('select'); sel.id = 'layoutSel'; sel.className = 'layout-sel'; sel.setAttribute('aria-label', 'Workspace layout'); sel.title = 'Workspace layout — drag panel edges to resize';
  const slot = document.getElementById('sbLayout'); if (slot) slot.appendChild(sel); else { const th = document.getElementById('installBtn') || document.getElementById('themeBtn'); if (th && th.parentNode) th.parentNode.insertBefore(sel, th); else (document.querySelector('.ctrls') || document.body).appendChild(sel); }
  function syncTabs() {
    const t = document.getElementById('wsTabs'); if (!t) return;
    const nm = S.set.wsName || '';
    t.querySelectorAll('button[data-p]').forEach(b => { const on = nm === 'p:' + b.dataset.p; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const c = t.querySelector('.ws-tabs-cur'); if (c) { c.textContent = nm.startsWith('u:') ? nm.slice(2) : nm ? '' : 'Custom'; c.title = c.textContent ? 'Layout: ' + c.textContent : ''; } // a long saved name is cut in the header; whole here and in the status bar's Layout menu
  }
  function sync() {
    const nm = S.set.wsName || '';
    const saved = S.set.layouts.map((l, i) => `<option value="u:${i}" title="${esc(l.name)}"${nm === 'u:' + l.name ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    sel.innerHTML = `<optgroup label="Presets">${Object.entries(PRESETS).map(([k, p]) => `<option value="p:${k}" title="${esc(p.label)}"${nm === 'p:' + k ? ' selected' : ''}>${esc(p.label.split(' — ')[0])}</option>`).join('')}</optgroup>`
      + (saved ? `<optgroup label="My layouts">${saved}</optgroup>` : '')
      + (!nm ? '<option value="" selected title="Custom layout, not saved">Custom</option>' : '')
      + `<optgroup label="Manage"><option value="save">Save layout…</option>${nm.startsWith('u:') ? '<option value="del">Delete layout</option>' : ''}</optgroup>`;
    syncTabs();
    for (const h of handles) { const k = h.dataset.k; h.setAttribute('aria-valuenow', cur[k] || 0); h.setAttribute('aria-valuetext', (cur[k] || 0) + ' pixels'); }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* the presets as a tab strip in the header (desktop): a tab picks its option in the layout select, so the select stays
     the one place that applies a layout (and keeps saving, saved layouts and deleting); a saved or custom layout shows
     its name after the tabs */
  const tabs = document.createElement('div'); tabs.className = 'mini-seg ws-tabs'; tabs.id = 'wsTabs';
  tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Workspace layout');
  tabs.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-p="${k}" aria-pressed="false" title="${esc(p.label)}. ${esc(p.hint)}">${esc(p.label.split(' — ')[0])}</button>`).join('')
    + '<span class="ws-tabs-cur" id="wsTabsCur"></span>';
  // the header's LAYOUT cell (desktop): label, the preset tabs, then the Panels menu (pvBuild adds it)
  const wsCell = document.createElement('div'); wsCell.className = 'ws-cell'; wsCell.id = 'wsCell';
  wsCell.innerHTML = '<span class="ws-lbl" aria-hidden="true">Layout</span>'; wsCell.appendChild(tabs);
  const views = document.getElementById('views'); if (views) views.after(wsCell);
  /* artboard 2 order on the desktop: navigation | layout | tools | account figures. The tools move in the DOM (not with
     CSS order) so the keyboard follows what is seen; below 1081 px they go back after the account, where the phone and
     tablet layouts expect them */
  function hdrOrder() {
    const c = document.querySelector('.topbar>.ctrls'), a = document.getElementById('acct'), x = document.getElementById('acctX'); if (!c || !a || !x) return;
    if (desk()) { if (c.nextElementSibling !== a) a.before(c); } else if (x.nextElementSibling !== c) x.after(c);
  }
  hdrOrder(); addEventListener('resize', hdrOrder);
  new MutationObserver(hdrOrder).observe(document.body, { attributes: true, attributeFilter: ['class'] }); // the phone navigation switches on and off
  tabs.addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (!b) return; sel.value = 'p:' + b.dataset.p; sel.dispatchEvent(new Event('change')); });
  syncTabs();
  let prev = '';
  sel.addEventListener('focus', () => { prev = sel.value; });
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v.startsWith('p:')) { const p = PRESETS[v.slice(2)]; pvSet({ ...PV_DEF }); apply(p, v); presetContent(p); /* a preset picked: every panel shows again */ toast('Layout: ' + p.label.split(' — ')[0], p.hint + ' Drag panel edges to fine-tune, then save it under your own name.', 'info'); }
    else if (v.startsWith('u:')) { const l = S.set.layouts[+v.slice(2)]; if (l) apply(l.ws, 'u:' + l.name); }
    else if (v === 'save') { sel.value = prev; askName(); }
    else if (v === 'del') { const nm = S.set.wsName.slice(2); S.set.layouts = S.set.layouts.filter(l => l.name !== nm); S.set.wsName = ''; save(); sync(); toast('Layout deleted', nm, 'info'); }
  });

  function askName() {
    let o = document.getElementById('wsSave');
    if (!o) { o = document.createElement('div'); o.className = 'overlay'; o.id = 'wsSave'; o.hidden = true; document.body.appendChild(o); }
    o.innerHTML = `<form class="ws-box" aria-label="Save layout"><h2>Save layout</h2><p class="muted small">Panel sizes and side arrangement are kept for this session and included in <b>Export account</b>.</p>
      <label class="ws-f"><span>Name</span><input id="wsName" maxlength="28" required placeholder="e.g. London open" autocomplete="off"></label>
      <div class="ws-q">${['Scalping', 'Analysis', 'News', 'Swing'].map(n => `<button type="button" class="chip" data-n="${n}">${n}</button>`).join('')}</div>
      <div class="ws-act"><button type="button" class="ghost" data-x>Cancel</button><button class="primary btn-pri" type="submit">Save</button></div></form>`;
    o.hidden = false;
    const close = () => { o.hidden = true; };
    o.onclick = e => { if (e.target === o || e.target.closest('[data-x]')) close(); const c = e.target.closest('[data-n]'); if (c) { o.querySelector('#wsName').value = c.dataset.n; o.querySelector('#wsName').focus(); } };
    o.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    o.querySelector('form').onsubmit = e => {
      e.preventDefault(); const nm = o.querySelector('#wsName').value.trim(); if (!nm) return;
      const i = S.set.layouts.findIndex(l => l.name.toLowerCase() === nm.toLowerCase());
      const item = { name: nm, ws: { ...cur } }; if (i >= 0) S.set.layouts[i] = item; else S.set.layouts.push(item);
      S.set.wsName = 'u:' + nm; save(); sync(); close(); toast('Layout saved', `“${nm}” is in the layout menu.`, 'up');
    };
  }

  /* drag handles (also arrow-key resizable) */
  const handles = [['wl', watch, 'col'], ['rail', rail, 'col'], ['dock', dock, 'row']].map(([k, host, dir]) => {
    const h = document.createElement('div'); h.className = 'ws-split ws-' + dir; h.dataset.k = k;
    h.setAttribute('role', 'separator'); h.setAttribute('tabindex', '0'); h.setAttribute('aria-orientation', dir === 'col' ? 'vertical' : 'horizontal');
    h.setAttribute('aria-label', { wl: 'Resize watchlist', rail: 'Resize order ticket column', dock: 'Resize bottom panel' }[k]);
    h.setAttribute('aria-valuemin', LIM[k][0]); h.setAttribute('aria-valuemax', LIM[k][1]);
    if (k === 'rail') h.title = 'Drag to widen or narrow the order ticket (double-click: back to 360 px)';
    g.appendChild(h); return h; // inside <main>: fixed-positioned, so it takes no grid cell
  });
  function position() {
    const on = desk(); for (const h of handles) h.hidden = !on; if (!on) return;
    const W = watch.getBoundingClientRect(), R = rail.getBoundingClientRect(), D = dock.getBoundingClientRect();
    const [hw, hr, hd] = handles;
    hw.hidden = !cur.wl || g.classList.contains('pv-nowl'); hr.hidden = g.classList.contains('pv-railmin'); hd.hidden = g.classList.contains('pv-dockmin'); // a hidden panel has no splitter
    const wlEdge = cur.mirror ? W.left : W.right, railEdge = cur.mirror ? R.right : R.left;
    Object.assign(hw.style, { left: wlEdge - 4 + 'px', top: W.top + 'px', height: W.height + 'px' });
    Object.assign(hr.style, { left: railEdge - 4 + 'px', top: R.top + 'px', height: R.height + 'px' });
    Object.assign(hd.style, { left: D.left + 'px', top: D.top - 4 + 'px', width: D.width + 'px' });
  }
  const clamp = (k, v) => Math.round(Math.max(LIM[k][0], Math.min(k === 'dock' ? Math.min(LIM.dock[1], g.clientHeight - 220) : LIM[k][1], v)));
  function setK(k, v, live) {
    if (g.classList.contains('dock-big') && k === 'dock') toggleDock(false);
    if (k === 'dock') g.classList.add('dock-held'); // a height chosen by hand: an empty Positions tab no longer folds it
    cur = { ...cur, [k]: clamp(k, v) }; S.set.wsName = '';
    if (live) { applyVars(); position(); } else apply(cur); // live = mid-drag: no save, no select rebuild, no chart redraws
  }
  for (const h of handles) {
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); document.documentElement.classList.add('ws-dragging');
      const k = h.dataset.k, start = cur[k], t0 = performance.now(), x0 = e.clientX, y0 = e.clientY;
      let raf = 0, last = null, moved = 0;
      const step = () => {
        raf = 0; if (!last) return; const ev = last; last = null;
        const W = watch.getBoundingClientRect(), R = rail.getBoundingClientRect(), D = dock.getBoundingClientRect();
        if (k === 'wl') setK(k, cur.mirror ? W.right - ev.clientX : ev.clientX - W.left, true);
        if (k === 'rail') setK(k, (cur.mirror ? ev.clientX - R.left : R.right - ev.clientX) - railExt(), true); // the ticket's width: the rail minus its market and tab columns
        if (k === 'dock') setK(k, D.bottom - ev.clientY, true);
      };
      // pointermove only records the point; one layout pass per frame, the heavy apply() once on release
      const mv = ev => { moved = Math.max(moved, Math.abs(ev.clientX - x0), Math.abs(ev.clientY - y0)); if (moved < 3) return; last = { clientX: ev.clientX, clientY: ev.clientY }; if (!raf) raf = requestAnimationFrame(step); };
      const up = ev => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; } step();
        if (cur[k] !== start) apply(cur);
        // a click without movement opens − / Reset / + (WCAG 2.5.7: resizing without dragging)
        else if (ev.type === 'pointerup' && moved < 3 && performance.now() - t0 < 300) setTimeout(() => splitPop(h), 0);
        h.classList.remove('drag'); document.documentElement.classList.remove('ws-dragging'); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('dblclick', () => { const k = h.dataset.k; spClose(false); setK(k, PRESETS.standard[k]); });
    h.addEventListener('keydown', e => {
      const k = h.dataset.k, step = e.shiftKey ? 48 : 16, sign = k === 'dock' ? { ArrowUp: 1, ArrowDown: -1 }[e.key] : { ArrowRight: 1, ArrowLeft: -1 }[e.key] * ((k === 'rail') !== cur.mirror ? -1 : 1);
      if (e.key === 'Home') { e.preventDefault(); setK(k, LIM[k][0]); } else if (e.key === 'End') { e.preventDefault(); setK(k, LIM[k][1]); }
      else if (sign) { e.preventDefault(); setK(k, (cur[k] || LIM[k][0]) + sign * step); }
    });
  }
  // − / Reset / + beside a splitter, opened by a plain click on it (steps as the arrow keys: 16 px)
  const SP_NAME = { wl: 'watchlist', rail: 'ticket column', dock: 'bottom panel' };
  let sp = null, spH = null;
  function spClose(back = true) { if (!sp) return; sp.remove(); sp = null; if (back && spH) spH.focus({ preventScroll: true }); spH = null; }
  function splitPop(h) {
    spClose(false); spH = h; const k = h.dataset.k, nm = SP_NAME[k];
    sp = document.createElement('div'); sp.className = 'split-pop'; sp.setAttribute('role', 'group'); sp.setAttribute('aria-label', `Resize ${nm}`);
    sp.innerHTML = `<button type="button" data-sp="-1" aria-label="Shrink ${nm}">−</button><button type="button" data-sp="0" aria-label="Reset ${nm} size">Reset</button><button type="button" data-sp="1" aria-label="Grow ${nm}">+</button><output aria-live="polite"></output>`;
    const val = () => { sp.querySelector('output').textContent = (cur[k] || 0) + ' px'; };
    sp.addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (!b) return; const d = +b.dataset.sp; if (!d) { setK(k, PRESETS.standard[k]); spClose(); return; } setK(k, (cur[k] || LIM[k][0]) + d * 16); val(); });
    sp.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); spClose(); } });
    document.body.appendChild(sp); val();
    const r = h.getBoundingClientRect(), w = sp.offsetWidth, ht = sp.offsetHeight;
    sp.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    sp.style.top = Math.max(8, Math.min(innerHeight - ht - 8, r.top + r.height / 2 - ht / 2)) + 'px';
    sp.querySelector('[data-sp="1"]').focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', e => { if (sp && !sp.contains(e.target) && e.target !== spH) spClose(false); }, true);
  window.wsSplitPop = k => { const h = handles.find(x => x.dataset.k === k); if (h) splitPop(h); };
  new ResizeObserver(() => position()).observe(g);
  new ResizeObserver(() => position()).observe(dock); // the dock also folds by itself (an empty Positions tab)
  addEventListener('resize', () => { applyVars(); position(); }); // the rail stacks or spreads at 1440 px
  const _td = window.toggleDock; window.toggleDock = function () { const r = _td.apply(this, arguments); requestAnimationFrame(position); return r; };
  /* ---------------- panels on demand ----------------
     Every panel of the trading screen can be hidden and brought back: from the Panels menu in the header, or from the
     labelled tab a hidden panel leaves at its edge. Market watch; New order; the market panels (Depth · Exposure ·
     Strength · Sessions — the rail's fold, shell.js); the positions dock (folded while empty, always open, or folded to
     its tab strip); the quick-trade box on the chart. With New order hidden the market panels take the whole rail;
     with both hidden the rail is a 28 px strip of labelled tabs. Nothing is removed: a hidden panel is one click away.
     Desktop only (the phone has its own navigation). A preset shows every panel again. */
  const MK = [['iDom', 'Depth'], ['iStats', 'Stats']];
  const mkShown = () => !(window.iswFolded && iswFolded());
  function pvSave() { try { localStorage.setItem(PV_KEY, JSON.stringify(pv)); } catch (e) { /* private mode: lasts this visit */ } }
  // one window at a time in the rail (Victor, 31.10.2026): New order or one market panel
  const depthOpen = () => !!rail.querySelector('.intel.isw-on') && !rail.classList.contains('isw-fold');
  const depthOff = () => { if (desk() && depthOpen() && window.iswFold) iswFold(true); };
  function pvSet(o, mk) {
    pv = { ...pv, ...o }; pvSave();
    if (mk != null && window.iswFold) iswFold(!mk);
    pvApply();
  }
  function pvApply() {
    const mk = mkShown(), empty = !S.positions.length;
    g.classList.toggle('pv-nowl', !pv.wl && !!cur.wl);
    g.classList.toggle('pv-notk', !pv.tk);
    g.classList.toggle('pv-railmin', !pv.tk && !mk);
    const tkb = document.querySelector('.rail>.pv-tkbar');
    if (tkb) { tkb.setAttribute('aria-pressed', String(!!pv.tk)); tkb.title = pv.tk ? 'Hide New order' : 'Show New order'; }
    g.classList.toggle('pv-dockmin', dockFolded()); // by choice, or while empty (Folds while empty)
    g.classList.toggle('pv-noqt', !pv.qt);
    if (pv.dock === 'open') g.classList.add('dock-held'); // always open: an empty Positions tab does not fold it
    const m = document.getElementById('pvMenu');
    if (m) {
      m.querySelector('[data-pv=wl]').checked = pv.wl; m.querySelector('[data-pv=tk]').checked = pv.tk; m.querySelector('[data-pv=mk]').checked = mk;
      m.querySelector('[data-pv=qt]').checked = pv.qt; m.querySelector('[data-pv=dock]').value = pv.dock;
      m.querySelector('[data-pv=wl]').disabled = !cur.wl; // a layout without a watchlist (Chart focus) has nothing to show
    }
    const db = document.getElementById('dockMin');
    if (db) { const min = dockFolded(); db.textContent = min ? 'Show panel' : 'Hide panel'; db.setAttribute('aria-expanded', !min); db.title = min ? 'Show the positions panel' : 'Fold the positions panel to its tabs'; }
    const n = document.getElementById('pvN'); if (n) { const h = [!pv.wl && cur.wl, !pv.tk, pv.dock === 'min', !pv.qt].filter(Boolean).length; /* a closed market panel is not hidden: its tab is in the rail's column */ n.textContent = h ? String(h) : ''; n.hidden = !h; const b = document.getElementById('pvBtn'); if (b) b.setAttribute('aria-label', h ? `Panels: ${h} hidden` : 'Panels: show or hide'); }
    applyVars(); requestAnimationFrame(position);
    setTimeout(() => { if (typeof reqOverlay === 'function') reqOverlay(); if (typeof chart !== 'undefined' && chart && typeof resizeChart === 'function') resizeChart(); }, 60);
  }
  // the dock shows only its tab strip when folded by choice, or (Folds while empty) while no position is open
  const dockEmpty = () => { const e = document.getElementById('posEmpty'); return !!e && !e.hidden && !!document.querySelector('.dock .tab.on[data-pane=positions]'); };
  const dockFolded = () => pv.dock === 'min' || (pv.dock === 'auto' && dockEmpty() && !g.classList.contains('dock-held'));
  function dockShow() { if (pv.dock === 'min') pvSet({ dock: 'auto' }); g.classList.add('dock-held'); pvApply(); } // held open for this visit
  function pvBuild() {
    // the labelled tab a hidden watchlist leaves at its edge
    if (!watch.querySelector('.pv-edge')) watch.insertAdjacentHTML('afterbegin', `<button type="button" class="pv-edge" data-pv-show="wl" title="Show the market watch"><span>Market watch</span></button>`);
    // the rail: a band to bring New order back above the market panels, and the strip of tabs when both are hidden
    if (!rail.querySelector('.pv-tkbar')) rail.insertAdjacentHTML('afterbegin', `<button type="button" class="pv-tkbar" data-pv-show="tk" title="Show the order ticket"><span>New order</span><span class="pv-tkbar-s">Show ▾</span></button>`
      + `<div class="pv-edge pv-edge-r" role="group" aria-label="Hidden panels"><button type="button" data-pv-show="tk" title="Show the order ticket"><span>New order</span></button>${MK.map(([id, l]) => `<button type="button" data-pv-mk="${id}" title="Show ${l}"><span>${l}</span></button>`).join('')}</div>`);
    // New order's own hide button at the right of its title band (artboard 2: ›); the edge band brings it back
    const tph = document.querySelector('.rail>.ticket>.ph');
    if (tph && !tph.querySelector('.tk-hide')) tph.insertAdjacentHTML('beforeend', `<button type="button" class="tk-hide" data-pv-hide="tk" aria-label="Hide New order" title="Hide New order (the New order tab on the right edge, or Panels, brings it back)"><span>Hide</span><i aria-hidden="true">›</i></button>`);
    // the dock's own hide / show button, beside Expand panel
    const exp = document.getElementById('dockBtn');
    if (exp && !document.getElementById('dockMin')) exp.parentElement.insertAdjacentHTML('beforeend', `<button type="button" class="ghost sm" id="dockMin" aria-controls="tabs"></button>`); // last in the strip, as it is drawn: the Tab order follows the eye
    // the floating P&L on the dock's strip (a copy of the header figure), so a folded dock still says what is at stake
    if (exp && !document.getElementById('dockPnl')) {
      exp.parentElement.insertAdjacentHTML('afterbegin', `<span class="dock-pnl" aria-label="Floating P&amp;L">P&amp;L <b id="dockPnl" class="mono">—</b></span>`);
      const src = document.getElementById('mPnl'), dst = document.getElementById('dockPnl');
      const copy = () => { if (src && dst) { dst.textContent = src.textContent; dst.className = 'mono ' + [...src.classList].filter(c => c === 'up' || c === 'dn').join(' '); } };
      if (src) new MutationObserver(copy).observe(src, { childList: true, characterData: true, subtree: true, attributes: true }); copy();
    }
    // any tab change (click, keys, a command) re-reads whether the dock folds: only an empty Positions tab folds it
    if (typeof window.setTab === 'function' && !window.setTab._pv) { const _st = window.setTab; window.setTab = function () { const r = _st.apply(this, arguments); setTimeout(pvApply, 0); return r; }; window.setTab._pv = true; }
    // the dock folds and unfolds with the first and last position
    const pe = document.getElementById('posEmpty'); if (pe) new MutationObserver(() => pvApply()).observe(pe, { attributes: true, attributeFilter: ['hidden'] });
    // the Panels menu, after the layout presets
    if (!document.getElementById('pvWrap')) {
      const wrap = document.createElement('div'); wrap.className = 'pv-wrap'; wrap.id = 'pvWrap';
      wrap.innerHTML = `<button type="button" class="icon-btn pv-btn" id="pvBtn" aria-label="Panels: show or hide" title="Panels — show or hide market watch, order ticket, market panels, positions" aria-haspopup="true" aria-expanded="false" aria-controls="pvMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M8 4v16M16 4v16M8 15h8"/></svg><span class="pv-t">Panels</span><span class="pv-car" aria-hidden="true">▾</span><span class="pv-n" id="pvN" hidden></span></button>
        <div class="pv-menu" id="pvMenu" role="group" aria-label="Show panels" hidden>
          <div class="pv-h">Show on the trading screen</div>
          <label><input type="checkbox" data-pv="wl"> Market watch</label>
          <label><input type="checkbox" data-pv="tk"> New order</label>
          <label><input type="checkbox" data-pv="mk"> Depth · Exposure · Strength · Sessions</label>
          <label><input type="checkbox" data-pv="qt"> Quick trade on the chart</label>
          <label class="pv-sel">Positions panel <select data-pv="dock"><option value="auto">Folds while empty</option><option value="open">Always open</option><option value="min">Folded to its tabs</option></select></label>
          <div class="pv-foot">A hidden panel leaves a labelled tab at its edge. A layout preset shows every panel again.</div>
          <button type="button" class="pv-all" data-pv-all>Show all panels</button>
        </div>`;
      // in the LAYOUT cell after the presets (artboard 2); without it, among the header's icon buttons
      const ctrls = document.querySelector('.topbar .ctrls');
      if (wsCell.isConnected) wsCell.appendChild(wrap); else if (ctrls) ctrls.prepend(wrap); else { const v = document.getElementById('views'); if (v) v.after(wrap); }
      const btn = wrap.querySelector('#pvBtn'), menu = wrap.querySelector('#pvMenu');
      const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      btn.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', open); if (open) pvApply(); });
      document.addEventListener('pointerdown', e => { if (!menu.hidden && !wrap.contains(e.target)) close(); }, true);
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); close(); btn.focus(); } });
      menu.addEventListener('change', e => {
        const k = e.target.dataset.pv; if (!k) return;
        if (k === 'mk') pvSet({}, e.target.checked);
        else if (k === 'dock') { if (e.target.value !== 'open') g.classList.remove('dock-held'); pvSet({ dock: e.target.value }); }
        else pvSet({ [k]: e.target.checked });
      });
      menu.querySelector('[data-pv-all]').addEventListener('click', () => { g.classList.remove('dock-held'); pvSet({ ...PV_DEF }, true); });
    }
    document.addEventListener('click', e => {
      // New order in the tab column shows and hides the ticket (on / off); the other edges only show
      const tb = e.target.closest('.rail>.pv-tkbar'); if (tb && desk()) { if (!pv.tk) depthOff(); pvSet({ tk: !pv.tk }); return; }
      const sh = e.target.closest('[data-pv-show]'); if (sh) { if (sh.dataset.pvShow === 'tk') depthOff(); pvSet({ [sh.dataset.pvShow]: true }); return; }
      const hd = e.target.closest('[data-pv-hide]'); if (hd) { pvSet({ [hd.dataset.pvHide]: false }); const bar = document.querySelector('.rail>.pv-tkbar'); if (bar) bar.focus({ preventScroll: true }); return; }
      const mk = e.target.closest('[data-pv-mk]'); if (mk) { if (window.iswOpen) iswOpen(mk.dataset.pvMk); pvApply(); return; }
      if (e.target.closest('#dockMin')) { if (dockFolded()) dockShow(); else { g.classList.remove('dock-held'); pvSet({ dock: 'min' }); } return; }
      if (e.target.closest('#dockBtn') && dockFolded()) { dockShow(); return; } // Expand on a folded dock opens it first (app.js then gives it the room)
      // a tab of a folded dock opens it
      if (e.target.closest('#tabs button[data-tab]')) { const was = pv.dock === 'min'; setTimeout(() => { if (was) dockShow(); else pvApply(); }, 0); } // folded by choice: a tab opens it; folded while empty: only an empty Positions tab keeps it folded
    });
    // the rail's own fold (a click on the open market tab) changes what the rail shows
    // one window at a time: opening a market panel hides the ticket, showing the ticket closes the panel
    const isw = document.getElementById('isw'); if (isw) isw.addEventListener('click', () => setTimeout(() => { if (desk() && depthOpen() && pv.tk) { pv = { ...pv, tk: false }; pvSave(); } pvApply(); }, 0));
    pvApply();
  }
  (function pvInit() { if (!window.iswFold || !document.getElementById('dockBtn')) return setTimeout(pvInit, 200); pvBuild(); })();
  window.pvState = () => ({ ...pv, mk: mkShown() });
  window.wsVars = () => pvApply(); // the rail's market column opened or closed (shell.js): widths follow
  window.pvSet = pvSet;

  window.wsApply = (k) => { pvSet({ ...PV_DEF }); apply(PRESETS[k] || PRESETS.standard, 'p:' + (PRESETS[k] ? k : 'standard')); };
  window.wsState = () => ({ cur, name: S.set.wsName, layouts: S.set.layouts });
  // the watchlist width alone (market watch columns: the expanded list needs room); name '' = a custom layout
  window.wsWl = (w, name) => { if (!cur.wl) return; apply({ ...cur, wl: Math.max(LIM.wl[0], Math.min(LIM.wl[1], Math.round(w))) }, name); };
  apply(cur, S.set.wsName ?? 'p:standard');
})();

/* =====================================================================
   Onboarding — 60-second spotlight tour + actionable empty states
   ===================================================================== */
(function onboarding() {
  if (typeof S === 'undefined' || !S || !S.set || !window.wsApply) return setTimeout(onboarding, 150);
  const phone = () => document.body.classList.contains('mnav-on');
  const go = v => { if (phone() && window.mnavGo) mnavGo(v); };
  // the account type, said when the step shows (not when the tour is built): the same words as the status-bar flag and
  // the account menu (persist.js acctKind) for a demo, a live, a not-yet-known or a browser account
  const acctSay = () => { const k = typeof acctKind === 'function' ? acctKind() : null; return k && k.tour ? ' ' + k.tour : ''; };
  const DESK = [
    ['.panel.watch', 'Markets', () => 'Pick an instrument to load it everywhere: FX, indices, commodities, crypto and stocks.' + (Engine.feedOn ? ' Prices are live from the broker platform.' : '') + acctSay()],
    ['.panel.chartp', 'Chart', 'Drag the dashed SL / TP lines to adjust risk (or type them: Data, bottom right, lists every level with Edit), draw levels and trendlines, or split into 2 or 4 charts with the layout buttons.'],
    ['.panel.ticket', 'Risk-first ticket', 'Set the size in lots and tick SL and TP: before you click, the ticket shows the risk in money, reward : risk and the cost of the order.'],
    ['#views', 'Workspaces', 'Trade is for execution. Monitor is a dense board of every quote. Research, Strategy Lab and Coach each get the full screen. Alt+1 … Alt+5 switches.'],
    ['#tabs', 'Positions & orders', 'Positions, orders, history, alerts and the journal sit at a fixed height under the chart — nothing resizes on its own. Drag the edge to change it.'],
    ['#cmdBtn', 'Command bar', 'Press ⌘K / Ctrl K and type an order such as “buy 1 eurusd sl 20 tp 40”, or jump to any tool.']
  ];
  const PHONE = [
    ['.mnav button[data-mv="chart"]', 'Chart', 'Long-press the chart to place a limit, stop or alert at that exact price. Drag SL / TP lines with your finger.', 'chart'],
    ['.mnav button[data-mv="trade"]', 'Trade', 'The risk-first ticket: size by % risk and see reward : risk before you commit. A short vibration confirms each fill.', 'trade'],
    ['.mnav button[data-mv="markets"]', 'Markets', () => (Engine.feedOn ? 'Every instrument with live platform prices. Tap one to load it.' : 'Every instrument. Tap one to load it.'), 'markets'],
    ['.mnav button[data-mv="portfolio"]', 'Portfolio', 'Open positions, pending orders and history. The badge counts what is open.', 'portfolio'],
    ['.mnav button[data-mv="tools"]', 'Tools', 'Backtester, Observatory, Behaviour coach and more. Swipe left or right anywhere to move between screens.', 'tools']
  ];
  let i = 0, steps = [], spot = null, card = null, opener = null;
  function place() {
    const [sel, title, say] = steps[i]; const t = document.querySelector(sel), body = typeof say === 'function' ? say() : say;
    if (!t || !t.getClientRects().length) { return i < steps.length - 1 ? (i++, place()) : end(); }
    const r = t.getBoundingClientRect(), pad = 6;
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    card.querySelector('.tour-n').textContent = `${i + 1} / ${steps.length}`;
    card.querySelector('.tour-t').textContent = title; card.querySelector('.tour-p').textContent = body;
    card.querySelector('[data-t=back]').disabled = i === 0;
    card.querySelector('[data-t=next]').textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 14;
    let x, y;
    if (phone()) { x = (innerWidth - cw) / 2; y = r.top - ch - m; if (y < 8) y = Math.min(innerHeight - ch - 8, r.bottom + m); }
    else {
      const room = { right: innerWidth - r.right, left: r.left, below: innerHeight - r.bottom, above: r.top };
      if (room.right > cw + m * 2) { x = r.right + m; y = r.top; } else if (room.left > cw + m * 2) { x = r.left - cw - m; y = r.top; }
      else if (room.below > ch + m * 2) { x = r.left; y = r.bottom + m; } else { x = r.left; y = r.top - ch - m; }
      x = Math.max(8, Math.min(innerWidth - cw - 8, x)); y = Math.max(8, Math.min(innerHeight - ch - 8, y));
    }
    Object.assign(card.style, { left: x + 'px', top: y + 'px' });
    card.querySelector('[data-t=next]').focus({ preventScroll: true });
  }
  function show(n) { i = Math.max(0, Math.min(steps.length - 1, n)); const s = steps[i]; if (s[3]) go(s[3]); requestAnimationFrame(() => requestAnimationFrame(place)); }
  function end(done) {
    if (!spot) return; spot.remove(); card.remove(); spot = card = null; removeEventListener('resize', place);
    S.set.tourSeen = true; save(); hideChip();
    if (done) toast('You’re set', 'Reopen the tour any time from Help (?) or the command bar.', 'up');
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }
  window.startTour = () => {
    if (spot) return; opener = document.activeElement; hideChip();
    document.querySelectorAll('.overlay:not([hidden])').forEach(o => { if (o.id === 'help' || o.id === 'cmd') o.hidden = true; });
    steps = phone() ? PHONE : DESK; if (!phone() && window.setView && window.currentView && currentView() !== 'trade') setView('trade');
    spot = document.createElement('div'); spot.className = 'tour-spot'; spot.setAttribute('aria-hidden', 'true');
    card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tourT'); card.setAttribute('aria-describedby', 'tourP');
    card.innerHTML = `<div class="tour-top"><span class="tour-n"></span><button class="tour-x" data-t="skip" aria-label="Close tour">Skip</button></div><b class="tour-t" id="tourT"></b><p class="tour-p" id="tourP" aria-live="polite"></p>
      <div class="tour-act"><button class="ghost" data-t="back">Back</button><button class="tour-next btn-pri" data-t="next">Next</button></div>`;
    document.body.append(spot, card);
    card.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; const k = b.dataset.t; if (k === 'next') i === steps.length - 1 ? end(true) : show(i + 1); if (k === 'back') show(i - 1); if (k === 'skip') end(); });
    card.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); i === steps.length - 1 ? end(true) : show(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
      else if (e.key === 'Tab') { const f = [...card.querySelectorAll('button:not([disabled])')]; const a = f.indexOf(document.activeElement); if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    });
    spot.addEventListener('click', () => end());
    addEventListener('resize', place); show(0);
  };
  // a step on screen when the account type changes is re-said in the new words
  document.addEventListener('tb:acct-kind', () => { if (card) place(); });

  /* gentle, non-blocking invitation (session-scoped, like all state here) */
  let chip = null;
  // desktop: while the invitation shows, a 54 px lane above the status bar is reserved for it (the workspace gives the space back on dismiss)
  const lane = on => { const sb = document.getElementById('statusbar'); document.body.style.setProperty('--tour-sb', (on && sb ? sb.offsetHeight : 0) + 'px'); document.body.classList.toggle('tour-lane', on); window.dispatchEvent(new Event('resize')); };
  // the lane is given back after the fade-out, not on pointerdown: a layout shift between pointerdown and click would swallow the click on a bottom control
  function hideChip() { if (chip) { chip.classList.add('out'); const c = chip; chip = null; setTimeout(() => { c.remove(); if (!chip) lane(false); }, 250); } }
  function offer() {
    if (S.set.tourSeen || S.history.length || S.positions.length || chip) return;
    chip = document.createElement('aside'); chip.className = 'tour-chip'; chip.setAttribute('aria-label', 'Getting started');
    chip.innerHTML = '<span>New to tradeBerry?</span><button class="tour-go btn-pri">Take the 60-second tour</button><button class="tour-no" aria-label="Dismiss">×</button>';
    document.body.appendChild(chip);
    if (!document.body.classList.contains('mnav-on')) lane(true);
    chip.querySelector('.tour-go').onclick = () => startTour();
    chip.querySelector('.tour-no').onclick = () => { S.set.tourSeen = true; save(); hideChip(); };
    setTimeout(hideChip, 12000);
    // the first real click or key on the page is an answer too: the chip steps aside instead of covering controls
    const away = e => { if (chip && !chip.contains(e.target)) { hideChip(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', away, true); } };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', away, true);
  }
  const bootDone = () => document.getElementById('boot')?.classList.contains('done') || !document.getElementById('boot');
  (function wait() { if (!bootDone()) return setTimeout(wait, 300); setTimeout(offer, 1800); })();

  /* help modal + command bar entry points */
  const hg = document.querySelector('#help .help-grid');
  if (hg) { const b = document.createElement('div'); b.className = 'help-tour'; b.innerHTML = '<button class="tour-next btn-pri" type="button">Start the 60-second tour</button><span class="muted small">A quick walk through markets, chart, ticket, tools and layouts.</span>'; hg.parentNode.insertBefore(b, hg); b.querySelector('button').onclick = () => { document.getElementById('help').hidden = true; startTour(); }; }
  const ci = document.getElementById('cmdInput');
  if (ci) ci.addEventListener('keydown', e => { if (e.key === 'Enter' && /^\s*(tour|guide|help tour)\s*$/i.test(ci.value)) { e.preventDefault(); e.stopImmediatePropagation(); ci.value = ''; if (typeof closeCmd === 'function') closeCmd(); else document.getElementById('cmd').hidden = true; startTour(); } }, true);

  /* empty-state actions */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-es]'); if (!b) return; const k = b.dataset.es;
    // the same Teach me as in the account menu: the page on screen, element by element (front · 09.11.2026)
    if (k === 'tour') return typeof teachMe === 'function' ? teachMe() : startTour();
    if (k === 'cmd') return document.getElementById('cmdBtn')?.click();
    if (k === 'ticket' || k === 'limit') { go('trade');
      // New order hidden (its edge tab shows instead): open it first, as a click on that tab does (front · 09.11.2026)
      { const tk = document.querySelector('.rail .ticket.panel'), tb = document.querySelector('.rail>.pv-tkbar'); if (tb && tb.offsetParent && !(tk && tk.offsetParent)) tb.click(); } if (k === 'limit') document.querySelector('#otSeg [data-ot="limit"]')?.click(); const f = document.getElementById(k === 'limit' ? 'tkPrice' : 'tkLots'); f?.scrollIntoView({ block: 'center' }); f?.focus(); f?.closest('.panel')?.animate([{ boxShadow: 'inset 0 0 0 2px var(--acc)' }, { boxShadow: 'inset 0 0 0 0 transparent' }], { duration: 900 }); return; }
    if (k === 'journal') return setTab('journal');
    if (k === 'alpx') { const f = document.getElementById('alPx'); f?.focus(); return; }
    if (k === 'alerttool') { go('chart'); document.querySelector('[data-tool="alert"]')?.click(); toast('Alert tool on', 'Click the chart at the price you want to watch.', 'info'); }
  });
})();

/* =====================================================================
   Motion — small, meaningful feedback on fills, closes and navigation
   ===================================================================== */
(function motion() {
  const body = document.getElementById('posBody'), bal = document.getElementById('mBal');
  if (!body || !bal || typeof S === 'undefined' || !S || !S.positions) return setTimeout(motion, 150);
  const seen = new Set(S.positions.map(p => p.id));
  const flash = (el, cls, ms = 900) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  new MutationObserver(() => {
    let fresh = false;
    for (const tr of body.children) { const id = +tr.dataset.id; if (!seen.has(id)) { seen.add(id); fresh = true; flash(tr, 'row-in', 1400); } }
    for (const id of [...seen]) if (!S.positions.some(p => p.id === id)) seen.delete(id);
    if (fresh) { const t = document.getElementById('tkSubmit'); if (t && !matchMedia('(prefers-reduced-motion: reduce)').matches) t.animate([{ boxShadow: '0 0 0 0 rgba(232,176,74,.7)' }, { boxShadow: '0 0 0 12px rgba(232,176,74,0)' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' }); flash(document.querySelector('.mnav-b'), 'bump', 600); }
  }).observe(body, { childList: true });
  const num = s => +String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-');
  let last = num(bal.textContent);
  new MutationObserver(() => { const v = num(bal.textContent); if (isFinite(v) && isFinite(last) && v !== last && last !== 0) flash(bal, v > last ? 'tick-up' : 'tick-dn', 1100); last = v; }).observe(bal, { childList: true, characterData: true, subtree: true });
})();

/* =====================================================================
   Colour and access (design: .mace/design/accessibility.md) — colour-blind safe palette, red-rises convention,
   hollow candles, non-colour cues, drag-free level editing, chart navigation, focus not hidden by toasts and a
   text alternative for the price chart. Everything here wraps globals by name and keeps their return values.
   ===================================================================== */
// display settings are registered before boot: loadState() fills the defaults, sanitizeState() drops unknown values
Object.assign(DEF.set, { palette: 'std', updn: 'green', candles: 'filled' });
Object.assign(SET_ENUM, { palette: ['std', 'cvd'], updn: ['green', 'red'], candles: ['filled', 'hollow'] });
const a11yLook = () => { const s = (typeof S === 'object' && S && S.set) || {}; return { theme: s.theme === 'light' ? 'light' : 'dark', palette: s.palette === 'cvd' ? 'cvd' : 'std', updn: s.updn === 'red' ? 'red' : 'green', candles: s.candles === 'hollow' ? 'hollow' : 'filled' }; };
// one source for every candlestick series (main chart, multi-chart panes, basket). Hollow: a rising candle is an
// outline, so direction reads without colour
function candleOpts(c) {
  return a11yLook().candles === 'hollow'
    ? { upColor: 'rgba(0,0,0,0)', downColor: c.dn, wickUpColor: c.up, wickDownColor: c.dn, borderVisible: true, borderUpColor: c.up, borderDownColor: c.dn }
    : { upColor: c.up, downColor: c.dn, wickUpColor: c.up, wickDownColor: c.dn, borderVisible: false, borderUpColor: c.up, borderDownColor: c.dn };
}
const TOAST_WARN = /\b\d+% of|limit used|tilt guard|read-only|legs filled|cool-?down|approach/i;
function toastKind(title, body = '', kind = '') {
  const k = String(kind || '').trim(), t = String(title), b = String(body);
  if (/\bmove\b/.test(k)) return k.replace(/\s*\bmove\b\s*/, ' ').trim(); // explicit price / index move
  if (k !== 'up' && k !== 'dn') return k;
  if (/^[+−-]\$/.test(b) || /^(Bought|Sold) /.test(t)) return k; // P&L outcome or a fill's side
  if (k === 'up') return 'ok';
  return TOAST_WARN.test(t) ? 'warn' : 'bad';
}
(function colourContract() {
  // chartColors: info and the state colours come from the tokens too (the palette moves info off blue)
  const _cc = window.chartColors;
  window.chartColors = function () { return { ..._cc.apply(this, arguments), info: cssv('--info') || '#5aa9ff', ok: cssv('--ok'), bad: cssv('--bad'), warn: cssv('--warn'), cpos: cssv('--corr-pos'), cneg: cssv('--corr-neg') }; };
  // applyTheme: attributes first (the tokens resolve from them), then the original, then every candle series and
  // the open drawn panel are recoloured, then one mfx:colors event
  const _at = window.applyTheme;
  window.applyTheme = function () {
    const d = a11yLook(), h = document.documentElement;
    h.dataset.palette = d.palette; h.dataset.updn = d.updn;
    const r = _at.apply(this, arguments);
    if (typeof chart !== 'undefined' && chart && candle) {
      const c = chartColors(), o = candleOpts(c);
      candle.applyOptions(o);
      if (typeof MC === 'object' && MC.panes) MC.panes.forEach(p => p.candle && p.candle.applyOptions(o));
      if (typeof BK === 'object' && BK && BK.series) BK.series.applyOptions(o);
      const redraw = { behav: 'renderBehav', corr: 'renderCorr', vol: 'renderVol', obs: 'renderObs', bt: 'drawBtCurve' }[activeTab];
      if (redraw && typeof window[redraw] === 'function') safe('colours', () => window[redraw]());
    }
    document.dispatchEvent(new CustomEvent('mfx:colors', { detail: d }));
    return r;
  };
  // multi-chart panes created later start with the current candle style
  if (typeof window.mcPane === 'function') { const _mp = window.mcPane; window.mcPane = function () { const p = _mp.apply(this, arguments); if (p && p.candle) p.candle.applyOptions(candleOpts(chartColors())); return p; }; }
  // toasts are coloured by meaning, not by direction: 'up' / 'dn' stay only on a price move or a P&L outcome (a fill,
  // a close, a basket exit, a news move marked 'move'), which recolour with the rising-colour switch by design.
  // Any other 'dn' is a state: 'warn' (a caution, nothing refused) or 'bad' (refused, failed, breached); any other
  // 'up' is 'ok'. State colours never swap.
  const _toast = window.toast;
  window.toast = function (title, body = '', kind = '') { return _toast.call(this, title, body, toastKind(title, body, kind)); };
})();

/* ---- level editor: the drag-free path for SL / TP, pending orders, alerts, levels and the ticket lines ---- */
let pickLevel = null; // { target, prevTool } while the next chart click picks the price
const LV_NAME = { 'pos-sl': 'stop loss', 'pos-tp': 'take profit', ord: 'order price', alert: 'alert', hline: 'level', 'tk-entry': 'entry price', 'tk-sl': 'ticket stop loss', 'tk-tp': 'ticket take profit', 'draw-pt': 'drawing point' };
const lvSym = t => t.kind.startsWith('pos') || t.kind === 'ord' || t.kind === 'alert' ? t.ref.sym : t.sym || S.set.sym;
const lvLive = t => t.kind.startsWith('pos') ? S.positions.some(p => p === t.ref) : t.kind === 'ord' ? S.orders.some(o => o === t.ref) : t.kind === 'alert' ? S.alerts.some(a => a === t.ref && !a.done)
  : t.kind === 'hline' ? Array.isArray(S.hlines[lvSym(t)]) && t.ref < S.hlines[lvSym(t)].length : true;
function lvCurrent(t) {
  const k = t.kind, r = t.ref;
  if (k === 'pos-sl') return r.sl; if (k === 'pos-tp') return r.tp; if (k === 'ord' || k === 'alert') return r.price;
  if (k === 'hline') return (S.hlines[lvSym(t)] || [])[r]; if (k === 'draw-pt') return r.pts[t.i] && r.pts[t.i].p;
  const c = tkCalc(); return k === 'tk-entry' ? c.entry : k === 'tk-sl' ? c.sl : c.tp;
}
function validateLevel(target, price) {
  const k = target.kind, sym = lvSym(target), m = M(sym), q = Engine.quote(sym);
  if (!(typeof price === 'number' && isFinite(price) && price > 0)) return { ok: false, why: 'Enter a valid price' };
  price = +price.toFixed(m.digits);
  const p = target.ref;
  // a stop, a target or a pending price: the core's modify rules (one place for the editor, the dock, the chart and the server)
  if (k === 'pos-sl' || k === 'pos-tp' || k === 'ord') {
    const v = modifyCheck(k === 'ord' ? 'ord' : 'pos', p.id, k === 'pos-sl' ? { sl: price } : k === 'pos-tp' ? { tp: price } : { price });
    if (!v.ok) return { ok: false, why: v.why };
  }
  if (k === 'tk-sl' || k === 'tk-tp') {
    const c = tkCalc(), d = c.side === 'buy' ? 1 : -1, pips = (price - c.entry) * d / m.pip;
    if (Math.abs(pips) < .1) return { ok: false, why: 'Too close to entry' };
    if (k === 'tk-sl' && pips > 0) return { ok: false, why: `Stop loss must be ${d > 0 ? 'below' : 'above'} entry` };
    if (k === 'tk-tp' && pips < 0) return { ok: false, why: `Take profit must be ${d > 0 ? 'above' : 'below'} entry` };
  }
  return { ok: true, price };
}
// applies a valid price with the same side effects as a drag; returns false (and changes nothing) otherwise
function setLevel(target, price) {
  if (!lvLive(target)) return false;
  const v = validateLevel(target, price); if (!v.ok) return false;
  const k = target.kind, r = target.ref, sym = lvSym(target), px = v.price;
  // stops, targets and pending prices through modifyPosition / modifyOrder (a new stop clears the trail, as a drag does)
  if (k === 'pos-sl') return modifyPosition(r.id, { sl: px });
  else if (k === 'pos-tp') return modifyPosition(r.id, { tp: px });
  else if (k === 'ord') return modifyOrder(r.id, { price: px });
  else if (k === 'alert') { if (TradeLink.live) return TradeLink.send('alert', { do: 'edit', id: r.id, price: px, cond: px > Engine.quote(sym).mid ? 'above' : 'below' }).then(x => x.ok); r.price = px; r.cond = px > Engine.quote(sym).mid ? 'above' : 'below'; changed('al'); }
  else if (k === 'hline') { S.hlines[sym][r] = px; changed(); }
  else if (k === 'draw-pt') { r.pts[target.i].p = px; changed(); if (typeof reqOverlay === 'function') reqOverlay(); }
  else if (k === 'tk-entry') { S.tk.price = px; syncTicketInputs(); }
  else { const c = tkCalc(); S.tk[k === 'tk-sl' ? 'sl' : 'tp'] = +(Math.abs(px - c.entry) / M(sym).pip).toFixed(1); S.tk[k === 'tk-sl' ? 'useSL' : 'useTP'] = true; syncTicketInputs(); }
  return true;
}
function removeLevel(t) {
  const k = t.kind, r = t.ref, sym = lvSym(t);
  if (k === 'pos-sl') return modifyPosition(r.id, { sl: null, trail: 0 });
  else if (k === 'pos-tp') return modifyPosition(r.id, { tp: null });
  else if (k === 'alert') { if (TradeLink.live) return TradeLink.send('alert', { do: 'del', id: r.id }).then(x => x.ok); S.alerts = S.alerts.filter(a => a !== r); changed('al'); }
  else if (k === 'hline') { S.hlines[sym].splice(r, 1); changed(); }
}
const lvTitle = t => { const n = LV_NAME[t.kind]; return n[0].toUpperCase() + n.slice(1); };
const lvWho = t => pretty(lvSym(t)) + (t.ref && t.ref.id ? ' #' + t.ref.id : '');
let lvPop = null, lvTarget = null, lvBack = null, lvWatch = 0;
function lvClose(back = true) {
  if (!lvPop) return; lvPop.remove(); lvPop = null; lvTarget = null; clearInterval(lvWatch);
  if (back && lvBack && lvBack.isConnected) lvBack.focus({ preventScroll: true }); lvBack = null;
}
// a non-modal editor: number field with ±1 pip (Shift ±10), live distance, inline reason when refused
function editLevel(target, anchorEl, value) {
  lvClose(false); pickCancel();
  const sym = lvSym(target), m = M(sym), cur = value != null ? value : lvCurrent(target), canRm = /^(pos-sl|pos-tp|alert|hline)$/.test(target.kind) && lvCurrent(target) != null;
  lvTarget = target; lvBack = anchorEl || document.activeElement;
  const el = lvPop = document.createElement('div'); el.className = 'lv-pop'; el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Edit ${LV_NAME[target.kind]} · ${lvWho(target)}`);
  el.innerHTML = `<div class="lv-h"><b></b><span class="muted"></span></div>
    <div class="lv-in"><button type="button" class="lv-st" data-st="-1" aria-label="Lower by 1 pip">−</button><input type="number" inputmode="decimal" aria-label="Price" aria-describedby="lvDist lvWhy"><button type="button" class="lv-st" data-st="1" aria-label="Raise by 1 pip">+</button></div>
    <p class="lv-dist mono" id="lvDist"></p><p class="lv-why" id="lvWhy" role="alert"></p>
    <div class="lv-act"><button type="button" class="cta sm btn-pri" data-a="set">Set</button><button type="button" class="ghost sm" data-a="pick">Pick on chart</button>${canRm ? '<button type="button" class="ghost sm" data-a="rm">Remove</button>' : ''}<button type="button" class="ghost sm" data-a="x">Cancel</button></div>`;
  el.querySelector('.lv-h b').textContent = lvTitle(target); el.querySelector('.lv-h span').textContent = lvWho(target);
  const inp = el.querySelector('input'), why = el.querySelector('.lv-why'), dist = el.querySelector('.lv-dist'), setB = el.querySelector('[data-a=set]');
  inp.step = String(m.pip); inp.value = cur != null && isFinite(cur) ? fp(sym, cur) : fp(sym, Engine.quote(sym).mid);
  const check = () => {
    const v = validateLevel(target, parseFloat(inp.value)), q = Engine.quote(sym);
    inp.setAttribute('aria-invalid', v.ok ? 'false' : 'true'); why.textContent = v.ok ? '' : v.why; setB.disabled = !v.ok;
    if (!v.ok) { dist.textContent = ''; return v; }
    const p = target.ref, pos = target.kind.startsWith('pos'), ref = pos ? (p.side === 'buy' ? q.bid : q.ask) : q.mid, pips = (v.price - ref) / m.pip;
    let s = `${sgn(pips)} pips from market`;
    if (pos) { const d = p.side === 'buy' ? 1 : -1; s += ` · if hit ${usdFmt((v.price - p.entry) * d / m.pip * pipValue(sym, p.lots), true)}`; }
    if (target.kind === 'pos-sl' && p.trail > 0) s += ' · Trailing stop will be turned off';
    dist.textContent = s; return v;
  };
  const gone = () => { lvClose(); toast('Level no longer exists', `${lvWho(target)} was closed, filled or removed`, 'bad'); };
  const set = () => { const v = check(); if (!v.ok) { inp.focus(); return; } if (!lvLive(target)) return gone(); Promise.resolve(setLevel(target, v.price)).then(ok => { if (ok !== false) toast(`${lvTitle(target)} set`, `${lvWho(target)} ${fp(sym, v.price)}`, 'info'); }); lvClose(); };
  inp.addEventListener('input', check);
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); lvClose(); }
    else if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); e.stopPropagation(); set(); }
  });
  el.addEventListener('click', e => {
    const st = e.target.closest('[data-st]');
    if (st) { const v = parseFloat(inp.value) || Engine.quote(sym).mid; inp.value = fp(sym, v + +st.dataset.st * (e.shiftKey ? 10 : 1) * m.pip); check(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'set') set();
    if (a === 'x') lvClose();
    if (a === 'rm') { if (!lvLive(target)) return gone(); Promise.resolve(removeLevel(target)).then(ok => { if (ok !== false) toast(`${lvTitle(target)} removed`, lvWho(target), 'info'); }); lvClose(); }
    if (a === 'pick') pickStart(target);
  });
  document.body.appendChild(el);
  // desktop: under the opener (or at the chart's right edge), clamped to the viewport; phone: a bottom sheet (CSS)
  if (!document.body.classList.contains('mnav-on')) {
    const own = anchorEl && anchorEl.isConnected, a = (own ? anchorEl : $('#chart')).getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let x = own ? a.left : a.right - w - 90, y = own ? a.bottom + 6 : a.top + 40;
    if (y + h > innerHeight - 8) y = (own ? a.top : innerHeight) - h - 6;
    el.style.left = clamp(x, 8, Math.max(8, innerWidth - w - 8)) + 'px'; el.style.top = clamp(y, 8, Math.max(8, innerHeight - h - 8)) + 'px';
  }
  check(); inp.focus(); inp.select();
  lvWatch = setInterval(() => { if (lvPop === el && !lvLive(target)) gone(); }, 500);
}
document.addEventListener('pointerdown', e => { if (lvPop && !lvPop.contains(e.target) && !(lvBack && lvBack.contains && lvBack.contains(e.target))) lvClose(false); }, true);
function pickStart(target) {
  const prevTool = typeof tool !== 'undefined' ? tool : null;
  lvClose(false); setTool(null); pickLevel = { target, prevTool };
  const h = $('#toolHint'); h.textContent = `Click the chart to set the ${LV_NAME[target.kind]} price · Esc to cancel`; h.classList.add('show');
  $('.chart-wrap')?.classList.add('picking');
  if (document.body.classList.contains('mnav-on') && window.mnavGo) mnavGo('chart');
}
function pickCancel() {
  if (!pickLevel) return; const prev = pickLevel.prevTool; pickLevel = null;
  $('.chart-wrap')?.classList.remove('picking'); setTool(prev || null);
}
function pickAt(price) {
  if (!pickLevel) return false; const t = pickLevel.target; pickCancel();
  if (!lvLive(t)) { toast('Level no longer exists', `${lvWho(t)} was closed, filled or removed`, 'bad'); return true; }
  const v = validateLevel(t, price);
  if (!v.ok) { editLevel(t, null, price); return true; } // the editor reopens on the picked price and says why it was refused
  Promise.resolve(setLevel(t, price)).then(ok => { if (ok) toast(`${lvTitle(t)} set`, `${lvWho(t)} ${fp(lvSym(t), v.price)}`, 'info'); else editLevel(t, null, price); });
  return true;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pickLevel) pickCancel(); }, true);

/* ---- canvas text alternative: a summary (aria-describedby) and data tables, built with textContent only ---- */
function a11yFigure(host, spec) {
  if (!host) return;
  if (host.tagName === 'CANVAS') host.setAttribute('role', 'img');
  if (spec.label) host.setAttribute('aria-label', spec.label);
  let box = host._cvAlt;
  if (!box) {
    box = host._cvAlt = document.createElement('div'); box.className = 'cv-alt'; box.id = (host.id || 'cv') + 'Alt'; box.hidden = true;
    const sum = document.createElement('p'); sum.className = 'cv-sum'; sum.id = box.id + 'Sum'; box.appendChild(sum);
    if (spec.mount) spec.mount.appendChild(box); else host.parentNode.insertBefore(box, host.nextSibling);
    host.setAttribute('aria-describedby', sum.id);
  }
  const sum = box.querySelector('.cv-sum'), st = spec.summary || ''; if (sum.textContent !== st) sum.textContent = st;
  if (box.hidden) return; // tables are refreshed only while they are shown
  // patched in place, never rebuilt: a focused Edit button, and a screen reader's place in the table, survive the refresh (WCAG 2.1.1 / 2.4.3)
  const act = document.activeElement, actId = act && box.contains(act) && act.dataset ? act.dataset.cvId : null;
  const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const specs = spec.tables || [];
  let tables = [...box.querySelectorAll(':scope > table')];
  for (const t of tables.slice(specs.length)) t.remove();
  specs.forEach((tb, ti) => {
    let table = tables[ti];
    if (!table) { table = document.createElement('table'); table.className = 'tbl sm'; table.appendChild(document.createElement('caption')); table.createTHead().insertRow(); table.createTBody(); box.appendChild(table); }
    set(table.caption, tb.caption);
    const hr = table.tHead.rows[0];
    while (hr.cells.length > tb.head.length) hr.lastChild.remove();
    tb.head.forEach((h, i) => { let th = hr.cells[i]; if (!th) { th = document.createElement('th'); th.scope = 'col'; hr.appendChild(th); } set(th, h); });
    const body = table.tBodies[0], cols = tb.rows.reduce((k, r) => Math.max(k, r.length), 0) + (tb.edit ? 1 : 0);
    while (body.rows.length > tb.rows.length) body.lastChild.remove();
    tb.rows.forEach((row, ri) => {
      const tr = body.rows[ri] || body.insertRow();
      while (tr.cells.length > cols) tr.lastChild.remove();
      while (tr.cells.length < cols) tr.insertCell();
      row.forEach((v, ci) => set(tr.cells[ci], String(v)));
      for (let ci = row.length; ci < cols - (tb.edit ? 1 : 0); ci++) set(tr.cells[ci], '');
      if (!tb.edit) return;
      const td = tr.cells[cols - 1], t = tb.edit[ri], id = t ? tb.editName[ri] : '';
      let b = td.querySelector('button.cv-edit');
      if (b && b.dataset.cvId !== id) { b.remove(); b = null; }
      if (!t) { set(td, ''); return; }
      if (!b) {
        td.textContent = '';
        b = document.createElement('button'); b.type = 'button'; b.className = 'ghost sm cv-edit'; b.textContent = 'Edit'; b.dataset.cvId = id; b.setAttribute('aria-label', 'Edit ' + id);
        b.addEventListener('click', () => editLevel(b._cvT, b)); td.appendChild(b);
      }
      b._cvT = t; // the latest target: the row may now describe a moved level
    });
  });
  // the focused button went away (its row moved or closed): follow the same level, else stay in the region
  if (actId != null && !box.contains(document.activeElement)) {
    const again = [...box.querySelectorAll('button.cv-edit')].find(x => x.dataset.cvId === actId);
    (again || box).focus({ preventScroll: true });
  }
}
const TF_NAME = tf => ({ 1: '1m', 5: '5m', 15: '15m', 60: '1H', 240: '4H' }[tf] || tf + 'm');
// what the main chart shows, in words and rows. Descriptive only: no forecast, no signal (simulated market)
function chartFigure() {
  const sym = S.set.sym, m = M(sym), q = Engine.quote(sym), n = typeof disp !== 'undefined' ? disp.length : 0;
  const pos = S.positions.filter(p => p.sym === sym), ord = S.orders.filter(o => o.sym === sym), al = S.alerts.filter(a => a.sym === sym && !a.done), hl = S.hlines[sym] || [];
  let hi = -Infinity, lo = Infinity; const r = chart && chart.timeScale().getVisibleLogicalRange();
  if (r && n) for (let i = Math.max(0, Math.floor(r.from)); i <= Math.min(n - 1, Math.ceil(r.to)); i++) { hi = Math.max(hi, disp[i].high); lo = Math.min(lo, disp[i].low); }
  const chg = ($('#symChg')?.textContent || '').trim(), cnt = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const summary = `${pretty(sym)} ${TF_NAME(S.set.tf)}, ${Engine.feedOn ? 'live platform prices' : 'no live prices'}. Last ${fp(sym, q.mid)}${chg && chg !== '—' ? ` (${chg.replace(/\s*24h$/, '')} 24h)` : ''}. ${isFinite(hi) ? `Visible range high ${fp(sym, hi)}, low ${fp(sym, lo)}. ` : ''}${cnt(pos.length, 'position')}, ${cnt(ord.length, 'pending order')}, ${cnt(al.length, 'alert')} on this instrument.`;
  const levels = [], edit = [], editName = [];
  const add = (kind, side, px, pnl, t, nm) => { levels.push([kind, side, px == null ? 'none' : fp(sym, px), px == null ? '—' : sgn((px - q.mid) / m.pip), pnl == null ? '—' : usdFmt(pnl, true)]); edit.push(t); editName.push(nm); };
  for (const p of pos) {
    const d = p.side === 'buy' ? 1 : -1, at = px => px == null ? null : (px - p.entry) * d / m.pip * pipValue(sym, p.lots), who = `#${p.id}`, sd = p.side.toUpperCase();
    add(`Entry #${p.id}`, sd, p.entry, posPnl(p).pnl, null, '');
    add('Stop loss', sd, p.sl, at(p.sl), { kind: 'pos-sl', ref: p }, `stop loss ${who}`);
    add('Take profit', sd, p.tp, at(p.tp), { kind: 'pos-tp', ref: p }, `take profit ${who}`);
  }
  for (const o of ord) add(`${o.ot[0].toUpperCase() + o.ot.slice(1)} order #${String(o.id).replace(/^.*-(\d+)$/, '$1')}`, o.side.toUpperCase(), o.price, null, { kind: 'ord', ref: o }, `order price #${String(o.id).replace(/^.*-(\d+)$/, '$1')}`);
  for (const a of al) add(`Alert ${a.cond} #${a.id}`, '—', a.price, null, { kind: 'alert', ref: a }, `alert #${a.id}`);
  hl.forEach((px, i) => add(`Level ${i + 1}`, '—', px, null, { kind: 'hline', ref: i, sym }, `level ${i + 1}`));
  const rows = [];
  for (let i = n - 1; i >= Math.max(0, n - 20); i--) { const b = disp[i], pv = i ? disp[i - 1].close : b.open; rows.push([dts(b.time), fp(sym, b.open), fp(sym, b.high), fp(sym, b.low), fp(sym, b.close), pct((b.close / pv - 1) * 100, 3)]); }
  return { summary, tables: [
    { caption: `Levels on ${pretty(sym)}`, head: ['Kind', 'Side', 'Price', 'Pips from mid', 'P&L at level', 'Action'], rows: levels.length ? levels : [['No positions, orders, alerts or levels', '', '', '', '']], edit: levels.length ? edit : [null], editName },
    { caption: `Last ${rows.length} bars, ${pretty(sym)} ${TF_NAME(S.set.tf)}, newest first`, head: ['Time (UTC)', 'Open', 'High', 'Low', 'Close', 'Change'], rows }
  ] };
}

(function accessUi() {
  const boot = document.getElementById('boot');
  if (typeof S === 'undefined' || !S || !S.set || typeof chart === 'undefined' || !chart || (boot && !boot.classList.contains('done'))) return setTimeout(accessUi, 150);
  const body = document.body, wrap = $('.chart-wrap');

  /* settings: a Display group under Help → Settings, applied on change */
  const OPTS = {
    palette: [['std', 'Standard (green / red)'], ['cvd', 'Colour-blind safe (blue / orange)']],
    updn: [['green', 'Green rises, red falls'], ['red', 'Red rises, green falls']],
    candles: [['filled', 'Filled'], ['hollow', 'Hollow when rising']]
  };
  const ROWS = [['palette', 'paletteSet', 'Colour palette', 'Blue/orange stays distinct for red-green colour blindness. Signs and arrows are shown in both. Hollow candles (below) work with either palette.'],
    ['updn', 'updnSet', 'Rising colour', 'Red-rises is the convention in mainland China and Taiwan. Errors and warnings keep their colours.'],
    ['candles', 'candleSet', 'Candles', 'Hollow rising candles tell direction without colour.']];
  const DONE = { palette: { std: 'Standard palette', cvd: 'Colour-blind safe palette (blue / orange)' }, updn: { green: 'Green rises, red falls', red: 'Red rises, green falls' }, candles: { filled: 'Filled candles', hollow: 'Rising candles are hollow' } };
  const hs = $('#help .help-set');
  if (hs && !$('#paletteSet')) {
    const g = document.createElement('div'); g.className = 'set-disp'; g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', 'dispH');
    g.innerHTML = '<h4 id="dispH">Display</h4>' + ROWS.map(([k, id, t, d]) => `<div class="set-row set-sel"><span><label for="${id}"><b>${t}</b></label><small class="muted" id="${id}D">${d}</small></span><select id="${id}" aria-describedby="${id}D">${OPTS[k].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`).join('');
    hs.appendChild(g);
    g.addEventListener('change', e => { const r = ROWS.find(x => x[1] === e.target.id); if (r) setDisplay(r[0], e.target.value); });
  }
  const syncSel = () => { const d = a11yLook(); for (const [k, id] of ROWS) { const s = document.getElementById(id); if (s && s.value !== d[k]) s.value = d[k]; } };
  window.setDisplay = (k, v) => { if (!SET_ENUM[k] || !SET_ENUM[k].includes(v)) return false; S.set[k] = v; applyTheme(); save(); syncSel(); toast('Display updated', DONE[k][v], 'info'); return true; };
  document.addEventListener('mfx:colors', syncSel); syncSel();

  /* command bar: palette, rising colour, candles */
  const CMDS = { 'palette cvd': ['palette', 'cvd'], 'palette colour-blind': ['palette', 'cvd'], 'palette color-blind': ['palette', 'cvd'], 'colour-blind': ['palette', 'cvd'], colorblind: ['palette', 'cvd'], 'palette standard': ['palette', 'std'], 'palette std': ['palette', 'std'],
    'red up': ['updn', 'red'], 'red rises': ['updn', 'red'], 'green up': ['updn', 'green'], 'green rises': ['updn', 'green'], 'hollow candles': ['candles', 'hollow'], 'filled candles': ['candles', 'filled'] };
  const _pc = window.parseCmd;
  if (typeof _pc === 'function') window.parseCmd = function (raw) {
    const c = CMDS[String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')];
    return c ? { desc: c[0] === 'palette' ? (c[1] === 'cvd' ? 'Colour-blind safe palette' : 'Standard palette') : DONE[c[0]][c[1]], run: () => setDisplay(c[0], c[1]) } : _pc.apply(this, arguments);
  };
  if (typeof CMD_EX !== 'undefined' && Array.isArray(CMD_EX)) CMD_EX.push('palette cvd', 'red up', 'hollow candles');

  /* reset keeps the display settings: they are preferences, not account state (like the theme) */
  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('#resetAcct')) return;
    const keep = { palette: S.set.palette, updn: S.set.updn, candles: S.set.candles };
    setTimeout(() => { if (S.set.palette !== keep.palette || S.set.updn !== keep.updn || S.set.candles !== keep.candles) { Object.assign(S.set, keep); applyTheme(); save(); } }, 0);
  }, true);

  /* non-colour cues: R:R bar, depth-ladder rows, pressed state of the segmented buttons */
  const rr = $('#rrBar'); if (rr) rr.setAttribute('role', 'img');
  const _rt = window.renderTicket;
  window.renderTicket = function () {
    const k = _rt.apply(this, arguments);
    if (rr && k) { const l = k.riskUsd > 0 && k.rewUsd != null ? `Risk ${usdFmt(k.riskUsd)}, reward ${usdFmt(k.rewUsd)}, R:R 1:${(k.rewUsd / k.riskUsd).toFixed(2)}` : k.riskUsd > 0 ? `Risk ${usdFmt(k.riskUsd)}, no take profit` : 'No stop loss: risk is not defined'; if (rr.getAttribute('aria-label') !== l) rr.setAttribute('aria-label', l); }
    return k;
  };
  const _rd = window.renderDom;
  if (typeof _rd === 'function') window.renderDom = function () {
    const r = _rd.apply(this, arguments);
    // the action is spoken after the visible size and price (an aria-label would hide them, WCAG 2.5.3)
    for (const row of document.querySelectorAll('#dom .dom-row[data-price]')) {
      let sr = row.querySelector('.dom-act'); if (!sr) { sr = document.createElement('span'); sr.className = 'sr-only dom-act'; row.appendChild(sr); }
      const l = row.dataset.side === 'bid' ? ', bid. Click: buy limit here, Shift-click: sell stop' : ', ask. Click: sell limit here, Shift-click: buy stop';
      if (sr.textContent !== l) sr.textContent = l;
    }
    return r;
  };
  const SEGS = '#sideSeg button,#otSeg button,#sizeMode button,#tfSeg button,#typeSeg button,#indSeg button,#toolSeg button[data-tool]:not([data-tool=clear])';
  const pressed = () => { for (const b of document.querySelectorAll(SEGS)) { const on = b.classList.contains('on') ? 'true' : 'false'; if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); } };
  for (const s of new Set([...document.querySelectorAll(SEGS)].map(b => b.parentNode))) new MutationObserver(pressed).observe(s, { subtree: true, attributes: true, attributeFilter: ['class'] });
  pressed();

  /* SL / TP cells in Positions: reachable with Tab, Enter starts the existing inline edit */
  for (const pb of [$('#posBody'), $('#ordBody')]) { // Orders: the SL / TP of a pending order (UX-92)
    const cells = () => { for (const td of pb.querySelectorAll('td[data-edit]:not([tabindex])')) { td.tabIndex = 0; if (pb.id === 'posBody') td.title = 'Click or press Enter to edit'; } };
    new MutationObserver(cells).observe(pb, { childList: true }); cells();
    pb.addEventListener('keydown', e => { if (e.target.matches && e.target.matches('td[data-edit]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); } });
  }

  /* chart: pick-on-chart click, navigation without dragging, text alternative */
  // picking takes the press before the line drag and the drawing tools see it, so a line under the pointer cannot swallow it
  wrap.addEventListener('pointerdown', e => {
    if (!pickLevel || !e.target.closest('#chart')) return;
    const y = e.clientY - $('#chart').getBoundingClientRect().top; if (y > pricePaneH()) return;
    e.stopPropagation(); e.preventDefault(); const px = candle.coordinateToPrice(y); if (px != null) pickAt(px);
  }, true);
  const nav = document.createElement('div'); nav.className = 'chart-nav'; nav.setAttribute('role', 'toolbar'); nav.setAttribute('aria-label', 'Chart navigation');
  nav.innerHTML = [['back', '‹', 'Scroll back'], ['fwd', '›', 'Scroll forward'], ['out', '−', 'Zoom out'], ['in', '+', 'Zoom in'], ['latest', '⟲', 'Back to latest']].map(([k, g, l]) => `<button type="button" data-nav="${k}" aria-label="${l}" title="${l}">${g}</button>`).join('')
    + '<button type="button" class="cv-tg" aria-expanded="false" aria-controls="chartAlt" title="The chart as text: levels and the last 20 bars">Data</button>';
  wrap.appendChild(nav);
  nav.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('cv-tg')) { const box = $('#chartAlt'), open = box.hidden; box.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.classList.toggle('on', open); figure(true); return; }
    const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(), n = disp.length; if (!r) return;
    const w = r.to - r.from, k = b.dataset.nav;
    if (k === 'back') ts.setVisibleLogicalRange({ from: r.from - w * .2, to: r.to - w * .2 });
    if (k === 'fwd') ts.setVisibleLogicalRange({ from: r.from + w * .2, to: r.to + w * .2 });
    if (k === 'in') ts.setVisibleLogicalRange({ from: r.to - Math.max(10, w * .8), to: r.to });
    if (k === 'out') ts.setVisibleLogicalRange({ from: r.to - w * 1.25, to: r.to });
    if (k === 'latest') ts.setVisibleLogicalRange({ from: n - 160, to: n + 8 });
  });
  const ch = $('#chart');
  a11yFigure(ch, { summary: '', mount: wrap });
  const box = ch._cvAlt; box.id = 'chartAlt'; box.querySelector('.cv-sum').id = 'chartAltSum'; ch.setAttribute('aria-describedby', 'chartAltSum');
  box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Chart data'); box.tabIndex = 0;
  let figT = 0, figKey = '';
  function figure(force) {
    const key = S.set.sym + ':' + S.set.tf, now = Date.now();
    if (!force && key === figKey && now - figT < (box.hidden ? 2000 : 1000)) return;
    figT = now; figKey = key;
    a11yFigure(ch, chartFigure());
  }
  setInterval(() => safe('chart text', () => figure(false)), 500); figure(true);
  const _ss = window.setSymbol; window.setSymbol = function () { pickCancel(); const r = _ss.apply(this, arguments); figT = 0; return r; };

  /* other drawn canvases: an image role and a name; library and decorative ones are hidden */
  const CV = { eqCanvas: 'Equity curve, closed trades', btCanvas: 'Backtest equity curve', wfCanvas: 'Walk-forward equity by fold', labCanvas: 'Monte Carlo equity paths' };
  const canv = () => {
    for (const c of document.querySelectorAll('canvas:not([role]):not([aria-hidden])')) {
      if (c.closest('#chart,.mc-chart,.tv-lightweight-charts') || c.matches('.spark,.mq-sk,.ovl')) { c.setAttribute('aria-hidden', 'true'); continue; }
      const h = c.closest('.tab,.panel,section')?.querySelector('h2,h3,h4');
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', CV[c.id] || (h && h.textContent.trim().slice(0, 80)) || 'Chart');
    }
  };
  let cvT = 0; new MutationObserver(() => { clearTimeout(cvT); cvT = setTimeout(canv, 300); }).observe(body, { subtree: true, childList: true }); canv();

  /* focus not hidden (2.4.11): the toasts step aside while a focused control sits under them */
  const ts = $('#toasts'); let yT = 0;
  const under = el => { if (!ts.children.length || !el || el === body || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(), q = ts.getBoundingClientRect(); return r.width > 0 && r.right > q.left && r.left < q.right && r.bottom > q.top && r.top < q.bottom; };
  document.addEventListener('focusin', e => { if (ts.contains(e.target)) return; const hit = under(e.target); ts.classList.toggle('yield', hit); clearTimeout(yT); if (hit) yT = setTimeout(() => ts.classList.remove('yield'), 4000); });
  document.addEventListener('focusout', () => { clearTimeout(yT); yT = setTimeout(() => { if (!under(document.activeElement)) ts.classList.remove('yield'); }, 0); });
})();

/* ---------- the user menu: an avatar cell at the right end of the header; account details, Export / Import / Reset,
   Help, Sign out. It reads the account from what cloud.js shows (#cloudPill, #cloudNote) and clicks the existing
   controls, so signing out, the sync and the account tools keep their one implementation ---------- */
(function userMenu() {
  const bar = document.querySelector('.topbar'); if (!bar || document.getElementById('userWrap')) return;
  bar.insertAdjacentHTML('beforeend', `<div class="user-wrap" id="userWrap">
    <button type="button" class="user-btn" id="userBtn" aria-haspopup="true" aria-expanded="false" aria-controls="userPop" aria-label="Account menu" title="Account"><span class="user-av" id="userAv" aria-hidden="true"></span><span class="user-dot" id="userDot" aria-hidden="true"></span></button>
    <div class="user-pop" id="userPop" role="menu" aria-label="Account" aria-describedby="userKind" hidden>
      <div class="user-kind" id="userKind"></div>
      <div class="user-hd"><b id="userName"></b><span id="userSt"></span><p id="userNote"></p></div>
      <button type="button" role="menuitem" data-u="helpBtn">Settings &amp; shortcuts</button>
      <button type="button" role="menuitem" data-u="exportBtn">Export account</button>
      <button type="button" role="menuitem" data-u="importBtn">Import account</button>
      <button type="button" role="menuitem" data-u="resetAcct">Reset demo account</button>
      <button type="button" role="menuitem" data-u="adminBtn">Administration</button>
      <button type="button" role="menuitemcheckbox" aria-checked="false" data-oc title="On: the chart Buy/Sell buttons, Shift+B/S and a click on a Depth level send an order immediately. Off: they only fill in the order ticket">One-click trading <span class="user-st"></span></button>
      <button type="button" role="menuitem" data-teach title="A guided walk through the page that is open: what each part shows, how to read it, how to use it">Teach me</button>
      <button type="button" role="menuitem" data-guide hidden>Guide</button>
      <button type="button" role="menuitem" data-u="helpBtn">Help &amp; shortcuts</button>
      <button type="button" role="menuitem" data-u="signOutBtn" class="user-out">Sign out</button>
    </div></div>`);
  const btn = document.getElementById('userBtn'), pop = document.getElementById('userPop');
  /* the written guide of the page that is open (guides/<page>.html): a key per page as Teach me uses it (the Monitor,
     else the open tool); a page without a guide yet shows no entry. Add a page here when its guide is written. */
  // the Observatory has one guide per tool (guides/obs-<view>.html); guides/obs.html is its overview
  const GUIDES = { brief: 'Market Brief', corr: 'Correlation', vol: 'Volatility', bt: 'Backtester', lab: 'Risk Lab', calc: 'Calculators', behav: 'Behaviour', journal: 'Journal', chal: 'Challenge', 'obs-const': 'Constellation', 'obs-regime': 'Regime map', 'obs-dc': 'Intrinsic time', 'obs-deja': 'Déjà vu',
    'obs-rp': 'Recurrence', 'obs-drv': 'Drivers', 'obs-clock': 'Volatility clock', 'obs-tap': 'Tapestry', 'obs-bask': 'Baskets',
    'obs-scan': 'Edge check', 'obs-cone': 'Range cone', 'obs-exit': 'Exit lab',
    positions: 'Positions', orders: 'Orders', history: 'History', alerts: 'Alerts' }; // these four share guides/trade.html (UX-83)
  const guideKey = () => {
    const v = typeof currentView === 'function' ? currentView() : 'trade', t = typeof activeTab === 'string' ? activeTab : '';
    if (v === 'monitor') return 'monitor';
    if (t === 'obs') { let ov = ''; try { ov = typeof obsCfg === 'function' ? obsCfg().view : ''; } catch (e) { /* not built yet */ } return 'obs-' + (ov || 'const'); }
    return t;
  };
  const openGuide = k => window.open('guides/' + (/^(positions|orders|history|alerts)$/.test(k) ? 'trade' : k) + '.html', '_blank'); /* no noopener: the guide's Back button returns to this tab */
  // the Guide button at the end of the tool strip (#tabs): the guide of the tool on screen; hidden where none is written yet
  // Hints switch (front 15.11.2026): a small "?" switch, on = yellow with a black ?, off = black with a yellow ?; remembered in this browser
  // the same switch twice: in the tool strip (left of Guide) and in the Monitor band (the Monitor has no strip); one remembered state
  const tipsSw = ['tipsOn', 'tipsMon'].map(id => document.getElementById(id)).filter(Boolean);
  if (tipsSw.length) {
    let off = false; try { off = localStorage.getItem('tb-hints') === '0'; } catch (e) {}
    const apply = on => { tipsSw.forEach(b => b.setAttribute('aria-checked', String(on))); document.body.classList.toggle('no-hints', !on); const t = document.getElementById('brTip'); if (t && !on) t.style.display = 'none'; };
    apply(!off);
    tipsSw.forEach(b => b.addEventListener('click', () => { const on = b.getAttribute('aria-checked') !== 'true'; apply(on); try { localStorage.setItem('tb-hints', on ? '1' : '0'); } catch (e) {} }));
  }
  const gBtn = document.getElementById('guideBtn');
  function syncGuideBtn() {
    if (!gBtn) return;
    const k = guideKey(), name = GUIDES[k], mg = document.querySelector('.mtool-guide');
    const tg = document.getElementById('tipsTgl'); if (tg) tg.hidden = /^(positions|orders|history|alerts)$/.test(k); // the strip switch is on every page that has the strip, except the four Trade dock tabs (their strip keeps its cells, DSP7)
    gBtn.hidden = !name || /^(positions|orders|history|alerts)$/.test(k); if (mg) mg.hidden = !name; // on the Trade dock the guide opens from the account menu (the strip keeps its cells)
    if (!name || gBtn.dataset.k === k) return;
    gBtn.dataset.k = k; gBtn.title = `Guide: how to read, interpret and use ${name} (opens in a new tab)`; gBtn.setAttribute('aria-label', 'Guide: ' + name);
    if (!/^(positions|orders|history|alerts)$/.test(k)) guideIntro(k); // the Trade page opens without the one-second intro
  }
  /* opening a page that has a guide (Victor, 09.11.2026): for 1 s only the Guide button shows, in its place, without
     its left rule, zooming from 2x to 1x; then the rest of the window fades in. A cover over the app with a copy of the button (which opens the guide) on top.
     Not under the Opening Note, a Teach me walk, in automated browsers (the tests) or where the button is not on screen. */
  function guideIntro(k) {
    if (navigator.webdriver || document.querySelector('.guide-intro, .tour-card') || document.documentElement.classList.contains('onote-open')) return;
    const r = gBtn.getBoundingClientRect(); if (!r.width || !r.height) return;
    const cov = document.createElement('div'); cov.className = 'guide-intro'; cov.setAttribute('aria-hidden', 'true');
    const b = gBtn.cloneNode(true); b.removeAttribute('id'); b.tabIndex = -1;
    Object.assign(b.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0 });
    b.addEventListener('click', () => openGuide(k));
    cov.append(b); document.body.append(cov);
    setTimeout(() => { cov.classList.add('out'); setTimeout(() => cov.remove(), 450); }, 1000);
  }
  if (gBtn) gBtn.addEventListener('click', () => { if (gBtn.dataset.k) openGuide(gBtn.dataset.k); });
  // follow every switch of tool or page (setTab is wrapped by other modules too: the chain stays, see CLAUDE.md)
  if (typeof window.setTab === 'function') { const st = window.setTab; window.setTab = function () { const r = st.apply(this, arguments); safe('guide button', syncGuideBtn); return r; }; }
  // switching tool inside the Observatory (its left list) changes the guide too
  // in the same task as the click (the page's own handlers ran first, on the way up): the intro cover lands before
  // the new page paints, so it does not flash on screen for a frame; the timeout catches pages that switch a tick later
  document.addEventListener('click', e => { if (e.target.closest('#views, #tabs, .mnav, .obs-nav, .mtools-grid')) { safe('guide button', syncGuideBtn); setTimeout(() => safe('guide button', syncGuideBtn), 0); } });
  const ini = n => { const p = String(n || '').split(/[\s._@-]+/).filter(Boolean); return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '') || ''; };
  const ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4"/><path d="M4.5 20a7.5 7.5 0 0115 0"/></svg>';
  function sync() {
    const pill = document.getElementById('cloudPill'), out = document.getElementById('signOutBtn');
    const signed = !!(pill && !pill.hidden && out && !out.hidden);
    const [name, st] = signed ? pill.textContent.split(' · ') : ['Local account', 'Saved in this browser'];
    const i = signed ? ini(name).toUpperCase() : '';
    const av = document.getElementById('userAv'); if (av.dataset.k !== i) { av.dataset.k = i; av.innerHTML = i ? i.replace(/[<>&]/g, '') : ICON; }
    document.getElementById('userName').textContent = name;
    document.getElementById('userSt').textContent = st || '';
    document.getElementById('userNote').textContent = signed ? (document.getElementById('cloudNote')?.textContent || '') : 'Not signed in: the account lives in this browser only. Export keeps a copy.';
    const dot = document.getElementById('userDot'); dot.hidden = !signed;
    dot.dataset.st = !signed ? '' : pill.classList.contains('st-bad') ? 'bad' : /Saving/.test(st || '') ? 'busy' : 'ok';
    btn.title = signed ? `${name} · ${st}` : 'Account (local)';
    pop.querySelector('.user-out').hidden = !signed;
    // Reset is there only while its control is (a signed-in page: on a demo account only)
    for (const b of pop.querySelectorAll('[data-u]')) if (b.dataset.u !== 'signOutBtn') { const el = document.getElementById(b.dataset.u); b.hidden = !el || (b.dataset.u === 'resetAcct' && el.hidden); if (el && b.dataset.u === 'importBtn' && b.textContent !== el.textContent) b.textContent = el.textContent; }
    // the state may not be loaded yet (the menu is built at boot): the switches show once it is
    const ss = typeof S !== 'undefined' && S && S.set ? S.set : null, oc = pop.querySelector('[data-oc]'), ocOn = !!(ss && ss.oneClick);
    syncGuideBtn();
    const gk = guideKey(), gb = pop.querySelector('[data-guide]');
    gb.hidden = !GUIDES[gk]; if (GUIDES[gk]) { gb.dataset.guide = gk; gb.textContent = 'Guide: ' + GUIDES[gk]; gb.title = `How to read, interpret and use ${GUIDES[gk]} (opens in a new tab)`; }
    oc.hidden = !ss || !document.getElementById('oneClickSet'); oc.setAttribute('aria-checked', String(ocOn)); oc.lastElementChild.textContent = ocOn ? 'On' : 'Off';
    // the menu's Pre-mortem master switch is gone (Behaviour turns pre-mortems on and off): clear a saved "off" so nobody stays stuck without a control
    if (ss && typeof pmCfg === 'function' && pmCfg().off) { pmCfg().off = false; save(); }
    fit();
  }
  /* the account type, the first row (not a menu item, so screen readers hear it as the menu's description:
     aria-describedby on #userPop): the status bar that also says it is hidden below 1081 px and on the phone, so the
     menu says it on every width, in the same words as the status-bar flag. Written from persist.js's 'tb:acct-kind'
     event (the one signal of a change of type) and once here at build; the look is styles.css #userKind. */
  function kindRow(k) {
    const kd = document.getElementById('userKind'); if (!kd) return;
    const txt = k ? k.line : '', ttl = k ? k.title : '';
    if (kd.textContent !== txt) kd.textContent = txt;
    if (kd.title !== ttl) kd.title = ttl;
    kd.dataset.kind = k ? k.key : ''; kd.hidden = !txt;
    if (txt) pop.setAttribute('aria-describedby', 'userKind'); else pop.removeAttribute('aria-describedby');
    fit();
  }
  const items = () => [...pop.querySelectorAll('[role^=menuitem]:not([hidden])')];
  const close = f => { if (pop.hidden) return; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (f) btn.focus(); };
  /* the menu hangs from the right edge of the avatar (styles.css; on the phone it is fixed under the header). fit() moves
     it by the overflow so it stays inside the window: sideways at every width (between the phone and the desktop,
     761-1080 px, the avatar sits at the left end of the header, so the menu would open off its left edge), below the
     read-only banner (#persistBanner, fixed at the top, z-index 2000) while that shows, so the account-type row is not
     under it, and no taller than the room left (it scrolls inside). Applied on opening, on every resize while it is
     open and when its rows change (sync, kindRow). */
  function fit() {
    if (pop.hidden) return;
    const st = pop.style, sc = pop.scrollTop;
    st.left = st.right = st.top = st.maxHeight = st.overflowY = '';
    const cs = getComputedStyle(pop), r = pop.getBoundingClientRect(), W = document.documentElement.clientWidth || innerWidth;
    let dx = 0;
    if (r.right > W) dx = W - r.right;
    if (r.left + dx < 0) dx = -r.left;
    if (dx) { st.right = (parseFloat(cs.right) || 0) - dx + 'px'; st.left = 'auto'; }
    const ban = document.getElementById('persistBanner'), b = ban && !ban.hidden ? ban.getBoundingClientRect() : null;
    let top = r.top;
    if (b && b.height && b.bottom > r.top) { top = b.bottom + 1; st.top = (parseFloat(cs.top) || 0) + (top - r.top) + 'px'; }
    if (top + r.height > innerHeight) { st.maxHeight = Math.max(120, innerHeight - top - 4) + 'px'; st.overflowY = 'auto'; pop.scrollTop = sc; }
  }
  addEventListener('resize', () => safe('user menu', fit));
  const open = () => { sync(); pop.hidden = false; fit(); btn.setAttribute('aria-expanded', 'true'); items()[0]?.focus(); };
  btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden ? open() : close(true); });
  pop.addEventListener('click', e => { if (e.target.closest('[data-oc]')) { const cb = document.getElementById('oneClickSet'); cb.checked = !S.set.oneClick; cb.dispatchEvent(new Event('change')); sync(); return; } if (e.target.closest('[data-teach]')) { close(false); if (typeof teachMe === 'function') teachMe(); return; } const g = e.target.closest('[data-guide]'); if (g) { close(false); openGuide(g.dataset.guide); return; } const b = e.target.closest('[data-u]'); if (!b) return; close(false); document.getElementById(b.dataset.u)?.click(); });
  pop.addEventListener('keydown', e => {
    const l = items(), i = l.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); l[(i + (e.key === 'ArrowDown' ? 1 : l.length - 1)) % l.length]?.focus(); }
    else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#userWrap')) close(false); });
  document.addEventListener('tb:acct-kind', e => safe('user menu', () => kindRow(e.detail)));
  kindRow(typeof acctKind === 'function' ? acctKind() : null);
  sync(); setInterval(() => safe('user menu', sync), 2000);
})();
