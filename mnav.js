/* tradeBerry — phone navigation (≤720px): one focused screen at a time + tool launcher */
(function boot() {
  if (typeof S === 'undefined' || !S || !S.set || typeof setTab !== 'function') return setTimeout(boot, 120);
  const MQ = matchMedia('(max-width:720px)');
  const VIEWS = [
    ['chart', 'Chart', '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>'],
    ['trade', 'Trade', '<path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>'],
    ['markets', 'Markets', '<path d="M4 6h16M4 12h16M4 18h10"/>'],
    ['portfolio', 'Portfolio', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>'],
    ['tools', 'Tools', '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>']
  ];
  const TOOLS = [
    ['bt', 'Backtester', 'Test strategies on the price history'],
    ['obs', 'Observatory', 'Edge check, range cone, exit lab and more'],
    ['behav', 'Behaviour', 'Your trading habits, scored'],
    ['chal', 'Challenge', 'Prop rules and pass odds on your own trades'],
    ['journal', 'Journal', 'Equity curve, stats and notes'],
    ['alerts', 'Alerts', 'Price alerts you have set'],
    ['calendar', 'Calendar', 'Upcoming economic events'],
    ['corr', 'Correlation', 'How the pairs move together'],
    ['vol', 'Volatility', 'Today’s range versus normal'],
    ['lab', 'Risk Lab', 'Monte Carlo stress test'],
    ['calc', 'Calculators', 'Position size, pip value, compounding'],
    ['cmd', 'Command bar', 'Type an order or a command'],
    ['help', 'Help & settings', 'Account, display, one-click, shortcuts, tour'],
    ['install', 'Install app', 'Add trade.Berry to your home screen']
  ];
  const PORT = ['positions', 'orders', 'history'];
  let view = VIEWS.some(v => v[0] === S.set.mv) ? S.set.mv : 'chart';
  const keep = () => { S.set.mv = view; save(); };

  const nav = document.createElement('nav');
  nav.className = 'mnav'; nav.setAttribute('aria-label', 'Sections');
  nav.innerHTML = VIEWS.map(([k, l, ic]) => `<button data-mv="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span>${l}</span>${k === 'portfolio' ? '<i class="mnav-badge" id="mnavPos" hidden>0</i>' : ''}</button>`).join('');
  document.body.appendChild(nav);

  const dock = document.querySelector('.dock');
  const tw = dock.querySelector('.tabs-wrap');
  const tools = document.createElement('div');
  tools.className = 'mtools';
  tools.innerHTML = `<div class="mtools-grid">${TOOLS.map(([k, l, d]) => `<button data-mt="${k}"><b>${l}</b><small>${d}</small></button>`).join('')}</div>`;
  const back = document.createElement('div');
  back.className = 'mtool-bar';
  back.innerHTML = `<button class="mtool-back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>All tools</button><b id="mtoolName"></b>`;
  dock.insertBefore(tools, tw); dock.insertBefore(back, tw);

  const label = k => (TOOLS.find(t => t[0] === k) || [k, k])[1];
  function measure() {
    const tb = document.querySelector('.topbar');
    document.documentElement.style.setProperty('--tbh', (tb ? tb.offsetHeight : 120) + 'px');
  }
  function apply(scroll) {
    document.body.dataset.mv = view;
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mv === view));
    const on = MQ.matches;
    document.body.classList.toggle('mnav-on', on);
    if (!on) return;
    measure();
    if (view === 'portfolio' && !PORT.includes(activeTab)) _setTab('positions');
    if (view === 'tools') {
      const open = document.body.dataset.mtool === 'open' && !PORT.includes(activeTab);
      document.body.dataset.mtool = open ? 'open' : 'grid';
      $('#mtoolName').textContent = open ? label(activeTab) : '';
    }
    if (scroll) window.scrollTo(0, 0);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  const _setTab = window.setTab;
  window.setTab = function (name) {
    _setTab(name);
    if (!MQ.matches) return;
    if (PORT.includes(name)) { if (view !== 'portfolio') { view = 'portfolio'; keep(); apply(true); } }
    else { document.body.dataset.mtool = 'open'; $('#mtoolName').textContent = label(name); if (view !== 'tools') { view = 'tools'; keep(); apply(true); } }
  };
  function go(k) {
    if (k === view && k === 'tools') { document.body.dataset.mtool = 'grid'; window.scrollTo(0, 0); return; }
    view = k; keep(); apply(true);
  }
  nav.addEventListener('click', e => { const b = e.target.closest('button[data-mv]'); if (b) go(b.dataset.mv); });
  tools.addEventListener('click', e => {
    const b = e.target.closest('button[data-mt]'); if (!b) return;
    if (b.dataset.mt === 'cmd') { const c = $('#cmdBtn'); if (c) c.click(); return; }
    if (b.dataset.mt === 'help') { const h = $('#helpBtn'); if (h) h.click(); return; }
    if (b.dataset.mt === 'install') { if (window.installApp) installApp(); return; }
    window.setTab(b.dataset.mt); window.scrollTo(0, 0);
  });
  back.addEventListener('click', () => { document.body.dataset.mtool = 'grid'; window.scrollTo(0, 0); });
  // picking a pair in Markets jumps to its chart
  const wl = document.querySelector('.watch');
  if (wl) wl.addEventListener('click', e => {
    if (!MQ.matches || view !== 'markets' || e.target.closest('input,select,button.star')) return;
    if (e.target.closest('.wl-row')) setTimeout(() => go('chart'), 60);
  });
  // portfolio badge mirrors the positions count
  setInterval(() => {
    const c = $('#cPos'), bd = $('#mnavPos'); if (!c || !bd) return;
    const n = +c.textContent || 0; bd.textContent = n; bd.hidden = !n;
  }, 800);
  MQ.addEventListener('change', () => apply(false));
  window.addEventListener('resize', () => { if (MQ.matches) measure(); });
  document.body.dataset.mtool = 'grid';
  apply(false);
  window.mnavGo = go;
})();
