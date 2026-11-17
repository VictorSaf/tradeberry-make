/* tradeBerry — v11 shell: workspaces (Trade · Markets · Research · Lab · Coach),
   compact chart toolbar menus, fixed-height market panel switcher, symbol details and the quote monitor. */
(function shell() {
  if (typeof S === 'undefined' || !S || !S.set || typeof setTab !== 'function' || !window.wsApply || !document.getElementById('views')) return setTimeout(shell, 150);
  const $s = q => document.querySelector(q), $$s = q => [...document.querySelectorAll(q)];
  const body = document.body;
  const phone = () => body.classList.contains('mnav-on');

  /* ---------------- workspaces ---------------- */
  const VIEWS = {
    trade: { label: 'Trade', tabs: ['positions', 'orders', 'history', 'alerts'] },
    monitor: { label: 'Markets', tabs: ['positions', 'orders', 'history', 'alerts'] },
    research: { label: 'Research', tabs: ['brief', 'obs', 'corr', 'vol', 'calendar'] },
    lab: { label: 'Lab', tabs: ['bt', 'lab', 'calc'] },
    coach: { label: 'Coach', tabs: ['behav', 'chal', 'journal'] }
  };
  const ORDER = Object.keys(VIEWS);
  const homeOf = t => ['trade', 'research', 'lab', 'coach'].find(v => VIEWS[v].tabs.includes(t));
  S.set.lastTab = S.set.lastTab && typeof S.set.lastTab === 'object' ? S.set.lastTab : {};
  let view = VIEWS[S.set.view] ? S.set.view : 'trade';
  const nav = $s('#views');

  // every tab button knows which workspaces show it
  for (const b of $$s('#tabs button[data-tab]')) b.dataset.in = ORDER.filter(v => VIEWS[v].tabs.includes(b.dataset.tab)).join(' ');
  const tl = $s('#tabs .tabs-list') || $s('#tabs');
  const title = document.createElement('span'); title.className = 'tabs-title'; title.id = 'tabsTitle';
  $s('#tabs').insertBefore(title, $s('#tabs').firstChild);

  const _set = window.setTab;
  window.setTab = function (name) {
    if (!phone() && !VIEWS[view].tabs.includes(name)) { const h = homeOf(name); if (h) return setView(h, name); }
    if (!phone()) { S.set.lastTab[view] = name; }
    return _set.apply(this, arguments);
  };
  function setView(v, tab) {
    if (!VIEWS[v]) return;
    const prev = view; view = v; S.set.view = v;
    body.dataset.view = v;
    nav.querySelectorAll('button').forEach(b => { const on = b.dataset.view === v; b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
    title.textContent = v === 'trade' || v === 'monitor' ? '' : VIEWS[v].label;
    tl.setAttribute('aria-label', VIEWS[v].label + ' tools');
    let t = tab || S.set.lastTab[v] || VIEWS[v].tabs[0];
    if (!VIEWS[v].tabs.includes(t)) t = VIEWS[v].tabs[0];
    S.set.lastTab[v] = t;
    if (document.querySelector('.grid').classList.contains('dock-big') && typeof toggleDock === 'function') toggleDock(false);
    if (activeTab !== t || prev !== v) _set(t);
    save();
    if (typeof window.monPanes === 'function') window.monPanes();
    if (v === 'monitor') { buildBoard(); boardTick(true); }
    requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); if (typeof reqOverlay === 'function') reqOverlay(); if (activeTab === 'journal' && typeof renderJournal === 'function') renderJournal(); if (activeTab === 'lab' && typeof runLab === 'function') runLab(); });
  }
  window.setView = setView;
  window.currentView = () => view;
  nav.addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
  nav.addEventListener('keydown', e => {
    const bs = [...nav.querySelectorAll('button')], i = bs.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % bs.length : e.key === 'ArrowLeft' ? (i - 1 + bs.length) % bs.length : -1;
    if (j >= 0) { e.preventDefault(); bs[j].focus(); }
  });
  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || phone()) return;
    const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[e.code];
    if (n == null) return; e.preventDefault(); setView(ORDER[n]);
  });

  /* ---------------- chart toolbar menus ---------------- */
  function dropdown(id) {
    const dd = $s('#' + id), btn = dd.querySelector('.dd-btn'), pop = dd.querySelector('.dd-pop');
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); dd.classList.remove('open'); };
    const open = () => {
      $$s('.dd.open').forEach(o => o !== dd && o.querySelector('.dd-btn').click());
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); dd.classList.add('open');
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left)) + 'px'; pop.style.top = r.bottom + 4 + 'px';
    };
    btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden ? open() : close(); });
    // the menu may live outside its box (the phone's bottom sheet is moved to <body>, out of the toolbar's mask)
    document.addEventListener('pointerdown', e => { if (!pop.hidden && !dd.contains(e.target) && !pop.contains(e.target)) close(); });
    const esc = e => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); btn.focus(); } };
    dd.addEventListener('keydown', esc); pop.addEventListener('keydown', esc);
    // a menu placed under its button closes when what holds the button scrolls (the menu would float away from it);
    // not when its own content or another panel scrolls, nor the phone's bottom sheet (Specifications), not anchored
    const sheet = () => phone() && dd.id === 'insDD';
    addEventListener('resize', () => { if (!sheet()) close(); });
    addEventListener('scroll', e => { const t = e.target; if (!sheet() && (t === document || (t.contains && t.contains(btn)))) close(); }, true);
    return { close };
  }
  const typeDD = dropdown('typeDD'); dropdown('indDD');
  if ($s('#layDD')) { const layDD = dropdown('layDD'); $s('#mcSeg').addEventListener('click', e => { if (e.target.closest('[data-l]')) { layDD.close(); $s('#layBtn').focus(); } }); }
  // instrument details: filled on open from the chart symbol (capture phase, so the menu is placed with its content)
  if ($s('#insDD')) {
    const ins = dropdown('insDD');
    // on a phone the sheet lives in <body>: inside the toolbar it would be clipped by its mask and covered by the chart
    $s('#insBtn').addEventListener('click', () => { const p = $s('#insPop'); if (!p.hidden) return; p.innerHTML = instrCard(S.set.sym); const host = phone() ? body : $s('#insDD'); if (p.parentElement !== host) host.appendChild(p); }, true);
    $s('#insPop').addEventListener('click', e => { if (e.target.closest('.ins-x')) { ins.close(); $s('#insBtn').focus(); } });
  }
  function labels() {
    const tb = $s('#typeSeg button.on'); $s('#typeLbl').textContent = tb ? tb.textContent : 'Candles';
    $s('#indN').textContent = $$s('#indSeg button.on').length;
  }
  $s('#typeSeg').addEventListener('click', () => setTimeout(() => { labels(); typeDD.close(); }, 0));
  $s('#indSeg').addEventListener('click', () => setTimeout(labels, 0));
  labels();

  /* ---------------- market panel switcher (desktop rail) ---------------- */
  const isw = $s('#isw');
  function iswSet(id) {
    if (!document.getElementById(id)) id = 'iDom';
    S.set.isw = id;
    isw.querySelectorAll('button').forEach(b => { const on = b.dataset.i === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; b.setAttribute('aria-controls', b.dataset.i); });
    $$s('.rail > .intel').forEach(sx => { sx.classList.toggle('isw-on', sx.id === id); sx.setAttribute('role', 'tabpanel'); });
  }
  /* a click on the open tab folds the panel to its tab strip (the ticket takes the room); any tab opens it again.
     Kept per browser: a display preference, not account state. Scalping keeps its full-height ladder (CSS). */
  const FOLD_KEY = 'tb.iswFold';
  const foldGet = () => { try { return localStorage.getItem(FOLD_KEY) !== '0'; } catch (e) { return true; } }; // closed until opened (the tab column shows them)
  function iswFold(on) {
    const r = isw.closest('.rail'); if (r) r.classList.toggle('isw-fold', on);
    isw.querySelectorAll('button').forEach(b => { b.setAttribute('aria-expanded', !on); b.title = on ? 'Open this panel' : b.classList.contains('on') ? 'Click again to fold the panel' : ''; });
    try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch (e) { /* private mode: the fold lasts this visit */ }
    if (window.wsVars) wsVars(); // the rail grows or shrinks by the market column
  }
  const folded = () => !!isw.closest('.rail.isw-fold');
  isw.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    if (b.classList.contains('on') && !folded()) { iswFold(true); return; }
    iswSet(b.dataset.i); iswFold(false); save();
  });
  window.iswOpen = id => { iswSet(id); iswFold(false); save(); };
  window.iswFold = on => iswFold(!!on); // the Panels menu (ui.js) shows and hides the market panels with the same fold
  window.iswFolded = folded;
  isw.addEventListener('keydown', e => {
    const bs = [...isw.querySelectorAll('button')], i = bs.indexOf(document.activeElement); if (i < 0) return;
    const j = /^Arrow(Right|Down)$/.test(e.key) ? (i + 1) % bs.length : /^Arrow(Left|Up)$/.test(e.key) ? (i - 1 + bs.length) % bs.length : -1; // a vertical column on the desktop: up / down as well
    if (j >= 0) { e.preventDefault(); bs[j].focus(); iswSet(bs[j].dataset.i); save(); }
  });
  // the open market panel's own close button on its title band (desktop); its tab stays in the column
  $$s('.rail > .intel > .ph').forEach(ph => ph.insertAdjacentHTML('beforeend', '<button type="button" class="intel-x" aria-label="Close the market panel" title="Close the panel (its tab stays in the column)">×</button>'));
  isw.closest('.rail')?.addEventListener('click', e => { if (!e.target.closest('.intel-x')) return; iswFold(true); const b = isw.querySelector('button.on'); if (b) b.focus({ preventScroll: true }); });
  iswSet(S.set.isw || 'iDom');
  isw.setAttribute('aria-orientation', 'vertical');
  iswFold(foldGet());

  /* ---------------- ticket: More in named sections ----------------
     The fields ticket.js puts in More (account after the order, split take profit, trailing, break-even, execution,
     the trade figures) are regrouped into four sections, each with a one-line summary that leads with its key figure.
     The nodes move, nothing is rebuilt: ids, values and the ticket's delegated listeners stay as they are. Which
     section is open is kept per browser. */
  const TKS_KEY = 'tb.tkSec';
  const tksOpen = () => { try { return JSON.parse(localStorage.getItem(TKS_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const fieldOf = q => { const e = $s(q); return e && e.closest('.field'); };
  function tkSections() {
    const more = $s('#tkMore'), wi = $s('#tkWhatIf'), stats = $s('#tkStats');
    if (!more || !wi || !stats) return false;
    if (more.querySelector('.tk-sec')) return true;
    const open = tksOpen();
    const groups = [
      ['acct', 'Account after this order', [wi]],
      ['exits', 'Exits', [fieldOf('#tkSplit'), fieldOf('#useTrail'), $s('#tkBeField')]],
      ['exec', 'Execution', [$s('#tkExecField')]],
      ['math', 'Trade math', [stats]]
    ];
    const foot = more.querySelector(':scope > .foot-note');
    for (const [k, title, nodes] of groups) {
      const d = document.createElement('details'); d.className = 'tk-sec'; d.dataset.sec = k; d.open = !!open[k];
      d.innerHTML = `<summary><span class="tk-sec-t">${title}</span><span class="tk-sec-s" data-sum="${k}"></span></summary>`;
      for (const n of nodes) if (n) d.appendChild(n);
      more.insertBefore(d, foot || null);
      d.addEventListener('toggle', () => { const o = tksOpen(); o[k] = d.open; try { localStorage.setItem(TKS_KEY, JSON.stringify(o)); } catch (e) { /* private mode */ } });
    }
    return true;
  }
  const chkd = q => !!($s(q) && $s(q).checked), val = q => ($s(q) && $s(q).value) || '';
  const statOf = name => { const dt = [...document.querySelectorAll('#tkStats dt')].find(x => x.textContent === name); return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent : ''; };
  function tkSecSum() {
    const put = (k, key, rest) => { const e = $s(`.tk-sec-s[data-sum="${k}"]`); if (!e) return; const h = `<b>${escHtml(key)}</b>${rest ? ' · ' + escHtml(rest) : ''}`; if (e._h !== h) { e.innerHTML = h; e._h = h; } };
    put('acct', ($s('#tkWiSum') && $s('#tkWiSum').textContent) || '—', '');
    const legs = document.querySelectorAll('#tkLegs > *').length;
    put('exits', chkd('#tkSplit') ? `${legs || 2} targets` : 'one target', [chkd('#useTrail') ? `trailing ${val('#tkTrail')}` : 'trailing off', chkd('#tkBe') ? `break-even after ${val('#tkBeAt')}` : 'break-even off'].join(' · '));
    const comm = parseFloat(val('#tkComm')) || 0;
    put('exec', chkd('#tkSlipOn') ? `σ ${val('#tkSlipSd')} pip` : 'no slippage', [`latency ${val('#tkLat') || 0} ms`, comm ? `$${comm}/lot` : 'no commission'].join(' · '));
    const be = statOf('Break-even win rate'), odds = statOf('Odds TP before SL'), tt = statOf('Typical time to resolve');
    put('math', be ? `break-even ${be}` : '—', [odds && `TP first ${odds.split(' ')[0]}`, tt].filter(Boolean).join(' · '));
  }
  (function tkSecInit() {
    if (!tkSections()) return setTimeout(tkSecInit, 200);
    tkSecSum();
    if (typeof renderTicket === 'function' && !renderTicket._sec) { const _rt = renderTicket; window.renderTicket = function () { const k = _rt.apply(this, arguments); tkSecSum(); return k; }; window.renderTicket._sec = true; }
    $s('.ticket').addEventListener('change', () => setTimeout(tkSecSum, 0));
  })();

  /* ---------------- shared market stats ---------------- */
  const pipOf = sym => M(sym).pip;
  const statCache = {};
  function stats(sym) {
    const now = Date.now(), c = statCache[sym];
    if (c && now - c.at < 2000) return c;
    const arr = Engine.candles[sym], n = arr.length, p = pipOf(sym);
    let hi = -Infinity, lo = Infinity;
    for (let i = Math.max(0, n - 1440); i < n; i++) { if (arr[i].high > hi) hi = arr[i].high; if (arr[i].low < lo) lo = arr[i].low; }
    const open = arr[Math.max(0, n - 1441)].close;
    // ATR(14) 1H: Wilder's, on complete hours (shared.js atr1h, the same number as every other panel)
    const a1 = atr1h(sym), atr = a1 != null ? a1 / p : 0;
    // typical day range: mean of the previous five 24h windows
    let typ = 0, d = 0;
    for (let j = 1; j <= 5; j++) {
      const a = n - (j + 1) * 1440, z = n - j * 1440; if (a < 0) break;
      let H = -Infinity, L = Infinity; for (let i = a; i < z; i++) { if (arr[i].high > H) H = arr[i].high; if (arr[i].low < L) L = arr[i].low; }
      typ += (H - L) / p; d++;
    }
    typ = d ? typ / d : 0;
    const spark = []; for (let i = Math.max(0, n - 1440); i < n; i += 30) spark.push(arr[i].close); spark.push(arr[n - 1].close);
    const out = { at: now, hi, lo, open, atr, typ, range: (hi - lo) / p, spark };
    statCache[sym] = out; return out;
  }
  const hourNow = () => { const d = new Date(Engine.simTime * 1000); return d.getUTCHours() + d.getUTCMinutes() / 60; };
  const sessOpen = () => { const h = hourNow(); return SESS.filter(([, b]) => b.some(([a, z]) => h >= a && h < z)).map(s => s[0]); };
  // the instrument's session from the engine (sheet windows in server time): 'Open · closes 22:55', 'Closed · opens Mon 16:35'
  // (local time; UTC in the title), 'Open 24/7'
  const hmL = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const hmU = d => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  function sessOf(sym) {
    const q = Engine.quote(sym), s = Engine.session(sym);
    if (!q.open) {
      if (q.why === 'off quotes') return { open: false, t: 'Off quotes', title: marketWhy(sym) };
      if (q.why === 'no feed') return { open: false, t: 'No feed', title: marketWhy(sym) };
      if (!s || !s.opensAt) return { open: false, t: 'Closed', title: 'Market closed' };
      const d = new Date(s.opensAt * 1000);
      return { open: false, t: `Closed · opens ${DOW3[d.getDay()]} ${hmL(d)}`, title: `Market closed — opens ${DOW3[d.getDay()]} ${hmL(d)} local time / ${DOW3[d.getUTCDay()]} ${hmU(d)} UTC` };
    }
    if (!s || !s.closesAt) return { open: true, t: 'Open 24/7', title: 'Trades every day, all day' };
    const d = new Date(s.closesAt * 1000);
    return { open: true, t: `Open · closes ${hmL(d)}`, title: `Open — closes ${DOW3[d.getDay()]} ${hmL(d)} local time / ${hmU(d)} UTC` };
  }
  const posOn = sym => S.positions.filter(p => p.sym === sym);

  /* ---------------- symbol details under the watchlist ---------------- */
  const det = $s('#wlDet');
  function renderDet() {
    if (!det || !document.querySelector('.watch').getClientRects().length) return;
    const sym = S.set.sym, q = Engine.quote(sym), st = stats(sym), m = M(sym), ps = posOn(sym);
    const net = ps.reduce((a, p) => a + (p.side === 'buy' ? p.lots : -p.lots), 0);
    const where = st.hi > st.lo ? (q.mid - st.lo) / (st.hi - st.lo) * 100 : 50;
    const un = m.unit === 'pt' ? 'pt' : 'p';
    const ses = sessOf(sym);
    det.innerHTML = `<div class="wd-h"><b>${escHtml(pretty(sym))}</b><span class="muted">${m.kind === 'cfd' ? escHtml(m.label) : `${m.base} vs ${m.quote}`}</span></div>
      <div class="wd-rg" title="Where the price sits inside today's range"><span>${fp(sym, st.lo)}</span><i><i style="left:${where.toFixed(1)}%"></i></i><span>${fp(sym, st.hi)}</span></div>
      <dl class="wd-g">
        <div><dt>Day range</dt><dd>${st.range.toFixed(1)}${un} <small>${st.typ ? (st.range / st.typ).toFixed(2) + '× typ' : ''}</small></dd></div>
        <div><dt>ATR 1H</dt><dd>${st.atr.toFixed(1)}${un}</dd></div>
        <div><dt>Spread</dt><dd>${q.spread.toFixed(1)}${un}</dd></div>
        <div><dt>${m.unit === 'pt' ? 'Point' : 'Pip'} / ${m.lotName === 'shares' ? 'share' : 'lot'}</dt><dd>${usdFmt(pipValue(sym, 1))}</dd></div>
        <div><dt>Session</dt><dd title="${escHtml(ses.title)}">${escHtml(ses.t)}</dd></div>
        <div><dt>Net position</dt><dd class="${net > 0 ? 'up' : net < 0 ? 'dn' : ''}">${net ? (net > 0 ? '+' : '−') + lotsFmt(sym, Math.abs(net)) + ' ' + m.lotName : '—'}</dd></div>
      </dl>`;
  }

  /* ---------------- status bar ---------------- */
  function renderStatus() { const e = $s('#sbSess'); if (e) { const o = sessOpen(); e.textContent = !Engine.isOpen('EURUSD') ? 'FX closed (weekend)' : o.length ? o.join(' + ') + ' open' : 'Markets quiet'; } }

  /* ---------------- quote monitor ---------------- */
  const board = $s('#monBoard');
  S.set.mon = S.set.mon && typeof S.set.mon === 'object' ? S.set.mon : { f: 'all', sort: 'name', den: 'compact' };
  const mon = S.set.mon;
  const tiles = {};
  /* Instruments on the board: those the profile offers (plus close-only ones with a position), by the watchlist's
     categories (chart.js CAT_OF) or Favourites. FX, Indices and Commodities also filter by the watchlist's subgroups
     (subOf: Majors / Crosses / Exotics, regions, Metals / Energy / Agriculture); Crypto and Stocks do not (quote
     currency and ~20 sectors say little on a board). Only the tiles on screen are filled (IntersectionObserver); they
     join the engine's hot set (monVisible). */
  const MON_F = ['fav', 'fx', 'index', 'commodity', 'crypto', 'stock'];
  // older boards filtered FX by currency or Crosses
  if (['USD', 'EUR', 'GBP', 'JPY', 'cross'].includes(mon.f)) { mon.sub = mon.f === 'cross' ? 'Crosses' : 'all'; mon.f = 'fx'; }
  if (!MON_F.includes(mon.f)) mon.f = 'all';
  if (typeof mon.sub !== 'string') mon.sub = 'all';
  let monKey = '', subKey = '';
  const monAvail = () => listedInstr().map(m => m.sym).join() + '|' + favs().join();
  const inCat = (m, f) => f === 'fav' ? isFav(m.sym) : CAT_OF[m.group] === f;
  const subLabel = s => s === 'Majors (G8)' ? 'Majors' : s;
  function pairsShown() {
    const all = listedInstr(), have = f => all.some(m => inCat(m, f));
    const f = mon.f !== 'all' && !have(mon.f) ? 'all' : mon.f;
    $$s('#monFilter button').forEach(b => { b.hidden = b.dataset.f !== 'all' && !have(b.dataset.f); b.classList.toggle('on', b.dataset.f === f); });
    let ps = all.filter(m => f === 'all' || inCat(m, f));
    const order = SUB_ORDER[f], subs = order ? order.filter(k => ps.some(m => subOf(m) === k)) : [];
    const sub = subs.includes(mon.sub) ? mon.sub : 'all';
    const el = $s('#monSub');
    if (el) {
      const k = f + '|' + subs.join();
      if (k !== subKey) { subKey = k; el.innerHTML = subs.length > 1 ? `<button data-s="all">All</button>${subs.map(s => `<button data-s="${escHtml(s)}">${escHtml(subLabel(s))}</button>`).join('')}` : ''; }
      el.hidden = subs.length < 2;
      el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === sub));
    }
    if (sub !== 'all') ps = ps.filter(m => subOf(m) === sub);
    ps = ps.map(m => m.sym);
    const ch = s => { const st = stats(s); return (Engine.quote(s).mid / st.open - 1) * 100; };
    if (mon.sort === 'chg') ps.sort((a, b) => ch(b) - ch(a));
    else if (mon.sort === 'abs') ps.sort((a, b) => Math.abs(ch(b)) - Math.abs(ch(a)));
    else if (mon.sort === 'vol') ps.sort((a, b) => (stats(b).range / (stats(b).typ || 1)) - (stats(a).range / (stats(a).typ || 1)));
    else if (mon.sort === 'spr') ps.sort((a, b) => Engine.quote(a).spread - Engine.quote(b).spread);
    return ps;
  }
  const tileVis = new Set();
  let tileIo = null;
  window.monVisible = () => view === 'monitor' && !phone() ? [...tileVis].map(el => el.dataset.sym) : [];
  function buildBoard() {
    if (!board) return;
    board.dataset.den = mon.den;
    const ps = pairsShown(); monKey = monAvail();
    board.innerHTML = ps.map(sym => `<div class="mq${sym === S.set.sym ? ' on' : ''}" data-sym="${sym}" role="group" aria-label="${pretty(sym)} quote">
      <div class="mq-h"><span class="mq-hl"><button class="mq-nm" type="button" title="Show ${escHtml(pretty(sym))} on the chart · Enter or double-click opens Trade">${escHtml(pretty(sym))}</button></span><span class="mq-sp mono" title="Spread in ${M(sym).unit === 'pt' ? 'points' : 'pips'}"></span><span class="mq-chg mono"></span></div>
      <div class="mq-px"><button class="mq-s" data-side="sell" title="Sell ${pretty(sym)} — opens the ticket"><small>Sell</small><span class="mono"></span></button><button class="mq-b" data-side="buy" title="Buy ${pretty(sym)} — opens the ticket"><small>Buy</small><span class="mono"></span></button></div>
      <div class="mq-rg"><span class="mono"></span><i><i></i></i><span class="mono"></span></div>
      <div class="mq-ft"><canvas class="mq-sk" aria-hidden="true"></canvas></div>
      <div class="mq-st mono"><span class="mq-typ" title="Today's range against the average of the previous five days"></span><span class="mq-rng" title="Range of the last 24 hours"></span><span class="mq-atr" title="ATR(14) on 1-hour bars (Wilder)"></span></div>
      <div class="mq-pl mono" hidden><span class="mq-pn"></span><b class="mq-pp"></b></div>
    </div>`).join('');
    for (const k in tiles) delete tiles[k];
    for (const el of board.children) {
      const sym = el.dataset.sym;
      tiles[sym] = { el, chg: el.querySelector('.mq-chg'), bid: el.querySelector('.mq-s span'), ask: el.querySelector('.mq-b span'), sp: el.querySelector('.mq-sp'),
        lo: el.querySelector('.mq-rg span:first-child'), hi: el.querySelector('.mq-rg span:last-child'), dot: el.querySelector('.mq-rg i i'), typ: el.querySelector('.mq-typ'), rng: el.querySelector('.mq-rng'), atr: el.querySelector('.mq-atr'), sk: el.querySelector('.mq-sk'), pl: el.querySelector('.mq-pl'), pn: el.querySelector('.mq-pn'), pp: el.querySelector('.mq-pp'), last: null };
    }
    if (tileIo) tileIo.disconnect();
    tileVis.clear();
    if (!tileIo && 'IntersectionObserver' in window) tileIo = new IntersectionObserver(es => { let n = 0; for (const e of es) { if (e.isIntersecting) { if (!tileVis.has(e.target)) n++; tileVis.add(e.target); } else tileVis.delete(e.target); } if (n) { boardTick(); boardSlow(); } }, { rootMargin: '80px 0px' });
    const box = board.getBoundingClientRect(), top = Math.max(box.top, 0) - 80, bot = Math.min(box.bottom, innerHeight) + 80;
    for (const el of board.children) {
      if (tileIo) tileIo.observe(el); else tileVis.add(el);
      const r = el.getBoundingClientRect(); if (r.height && r.bottom > top && r.top < bot) tileVis.add(el);
    }
    boardSlow();
  }
  function boardTick() {
    if (view !== 'monitor' || phone()) return;
    for (const sym in tiles) {
      if (!tileVis.has(tiles[sym].el)) continue;
      const t = tiles[sym], q = Engine.quote(sym), st = stats(sym), ch = (q.mid / st.open - 1) * 100;
      const bt = bigPx(sym, q.bid);
      if (t.bidH != null && bt !== t.bidH) tickFlash(t.el, Math.sign(q.bid - t.lastBid)); // each change of the price shown
      if (bt !== t.bidH) { t.bid.innerHTML = bt; t.bidH = bt; t.lastBid = q.bid; }
      t.ask.innerHTML = bigPx(sym, q.ask); t.sp.textContent = q.spread.toFixed(1);
      t.chg.textContent = pct(ch); t.chg.className = 'mq-chg mono ' + cls(ch);
      const w = st.hi > st.lo ? (q.mid - st.lo) / (st.hi - st.lo) * 100 : 50; t.dot.style.left = Math.max(0, Math.min(100, w)).toFixed(1) + '%';
    }
  }
  function boardSlow() {
    const pn = $s('#monPosN'); if (pn) { const n = String(S.positions.length); if (pn.textContent !== n) pn.textContent = n; pn.classList.toggle('has', S.positions.length > 0); }
    if (view !== 'monitor' || phone()) return;
    if (monAvail() !== monKey) { buildBoard(); return; } // the profile changed what can be listed
    const c = chartColors();
    for (const sym in tiles) {
      if (!tileVis.has(tiles[sym].el)) continue;
      const t = tiles[sym], st = stats(sym), ps = posOn(sym), m = M(sym);
      t.lo.textContent = fp(sym, st.lo); t.hi.textContent = fp(sym, st.hi);
      const pnl = ps.reduce((a, p) => a + (typeof posPnl === 'function' ? posPnl(p).pnl : 0), 0);
      // last line: left the range against a typical day, centre the 24 h range, right the ATR
      const ty = st.typ ? (st.range / st.typ).toFixed(1) + '× typ' : '—', rg = st.range.toFixed(0) + (m.unit === 'pt' ? 'pt' : 'p');
      if (t.typ.textContent !== ty) t.typ.textContent = ty;
      if (t.rng.textContent !== rg) t.rng.textContent = rg;
      const at = 'ATR ' + st.atr.toFixed(1); if (t.atr.textContent !== at) t.atr.textContent = at;
      // open positions: a line of their own at the bottom (count and net lots on the left, P&L on the right)
      if (t.pl.hidden !== !ps.length) t.pl.hidden = !ps.length;
      if (ps.length) {
        const net = ps.reduce((a, p) => a + (p.side === 'buy' ? 1 : -1) * p.lots, 0);
        const pn = `${ps.length} pos · ${net > 0 ? 'Long' : net < 0 ? 'Short' : 'Flat'}${net ? ' ' + +Math.abs(net).toFixed(2) : ''}`;
        const pp = `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`, pc = 'mq-pp ' + cls(pnl);
        if (t.pn.textContent !== pn) t.pn.textContent = pn; if (t.pp.textContent !== pp) t.pp.textContent = pp; if (t.pp.className !== pc) t.pp.className = pc;
      }
      const ses = sessOf(sym);
      // no session or 'Closed' label on the card: a closed market shows as dimmed prices, the reason in the tooltip
      if (t.el.classList.contains('closed') === !!ses.open) t.el.classList.toggle('closed', !ses.open);
      const tip = ses.open ? '' : ses.title;
      if (t.el.title !== tip) t.el.title = tip;
      t.el.classList.toggle('closed', !ses.open);
      t.el.classList.toggle('on', sym === S.set.sym);
      const cv = t.sk, w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; if (!w || !h) continue;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const pts = st.spark, mn = Math.min(...pts), mx = Math.max(...pts), col = pts[pts.length - 1] >= pts[0] ? c.up : c.dn;
      g.beginPath(); pts.forEach((v, i) => { const x = i / (pts.length - 1) * w, y = h - 2 - (v - mn) / (mx - mn || 1) * (h - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    }
  }
  if (board) {
    board.addEventListener('click', e => {
      const tile = e.target.closest('.mq'); if (!tile) return;
      const side = e.target.closest('[data-side]');
      if (side) { setSymbol(tile.dataset.sym, side.dataset.side); setView('trade'); setTimeout(() => { const l = $s('#tkLots'); if (l) l.focus(); }, 60); return; }
      setSymbol(tile.dataset.sym); boardSlow();
    });
    board.addEventListener('dblclick', e => { const tile = e.target.closest('.mq'); if (tile && !e.target.closest('[data-side]')) setView('trade'); });
    board.addEventListener('keydown', e => { const tile = e.target.closest('.mq'); if (tile && e.key === 'Enter' && e.target.matches('.mq-nm')) { e.preventDefault(); setSymbol(tile.dataset.sym); setView('trade'); } });
    const seg = (id, key, attr) => { const el = $s(id); el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset[attr] === mon[key]));
      el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mon[key] = b.dataset[attr]; el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); save(); buildBoard(); boardTick(); }); };
    // the market panel (rail) and the bottom panel (dock) start hidden on the Monitor; their buttons bring them back
    const paneButton = (id, shown, name, detail) => {
      const b = $s(id), action = shown ? 'Hide' : 'Show';
      b.setAttribute('aria-pressed', String(shown));
      b.setAttribute('aria-label', `${action} ${name}`);
      b.title = `${action} ${detail}`;
      const state = b.querySelector('.mon-tg-state'); if (state) state.textContent = shown ? 'Shown' : 'Show';
    };
    const panes = () => { const on = view === 'monitor'; body.classList.toggle('mon-norail', on && !mon.rail); body.classList.toggle('mon-nodock', on && !mon.dock);
      paneButton('#monRailBtn', !!mon.rail, 'market panel', 'market intelligence');
      paneButton('#monDockBtn', !!mon.dock, 'positions panel', 'positions, orders and history'); };
    window.monPanes = panes; panes();
    $s('#monRailBtn').addEventListener('click', () => { mon.rail = !mon.rail; panes(); save(); window.dispatchEvent(new Event('resize')); });
    $s('#monDockBtn').addEventListener('click', () => { mon.dock = !mon.dock; panes(); save(); window.dispatchEvent(new Event('resize')); });
    $s('#monFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.f !== mon.f) mon.sub = 'all'; });
    seg('#monFilter', 'f', 'f'); seg('#monDen', 'den', 'd');
    $s('#monSub').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mon.sub = b.dataset.s; save(); buildBoard(); boardTick(); });
    const so = $s('#monSort'); so.value = mon.sort; so.addEventListener('change', () => { mon.sort = so.value; save(); buildBoard(); boardTick(); });
  }

  /* ---------------- phone: settings travel into the Tools screen ---------------- */
  const sb = $s('#statusbar'), mainEl = $s('main.grid');
  function placeStatus() {
    const mt = $s('.mtools');
    if (phone() && mt) { if (sb.parentNode !== mt) mt.prepend(sb); }
    else if (sb.previousElementSibling !== mainEl) mainEl.after(sb);
  }
  let wasPhone = phone();
  new MutationObserver(() => { placeStatus(); const p = phone(); if (wasPhone && !p) setView(view); wasPhone = p; }).observe(body, { attributes: true, attributeFilter: ['class'] });

  /* ---------------- account header: Balance and Free margin step into a popover on narrow headers ---------------- */
  const am = $s('#acctMore'), ap = $s('#acctPop');
  if (am && ap) {
    const copy = () => { for (const [from, to] of [['#mBal', '#mBalX'], ['#mFree', '#mFreeX']]) { const a = $s(from), b = $s(to); if (a && b) { b.textContent = a.textContent; b.className = a.className; } } };
    let tm = 0;
    const close = () => { if (ap.hidden) return; ap.hidden = true; am.setAttribute('aria-expanded', 'false'); clearInterval(tm); };
    const open = () => { copy(); ap.hidden = false; am.setAttribute('aria-expanded', 'true'); clearInterval(tm); tm = setInterval(() => safe('account popover', copy), 500); };
    am.addEventListener('click', e => { e.stopPropagation(); ap.hidden ? open() : close(); });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#acctX')) close(); });
    $s('#acctX').addEventListener('keydown', e => { if (e.key === 'Escape' && !ap.hidden) { e.stopPropagation(); close(); am.focus(); } });
    addEventListener('resize', () => { if (!am.offsetParent) close(); });
  }

  /* ---------------- loops ---------------- */
  let n = 0;
  setInterval(() => { safe('quote monitor', boardTick); if (++n % 8 === 0) { safe('quote monitor', boardSlow); safe('symbol details', renderDet); safe('status bar', renderStatus); } }, 250);
  const _ss = window.setSymbol;
  if (typeof _ss === 'function') window.setSymbol = function () { const r = _ss.apply(this, arguments); renderDet(); if (view === 'monitor') boardSlow(); return r; };

  placeStatus(); renderDet(); renderStatus();
  body.dataset.view = view; if (!phone()) setView(view, S.set.lastTab[view]);
})();
