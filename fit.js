/* tradeBerry — one-screen fitting.
   Every workspace fits the viewport like a desktop terminal: no page scroll on desktop or tablet,
   long content is split into pages, and only lists scroll inside their own card.
   Also: full-screen mode (hides browser chrome). */
(function fit() {
  if (typeof renderBehav !== 'function' || !document.getElementById('behav') || typeof S === 'undefined' || !S || !S.set) return setTimeout(fit, 150);

  /* ---------- Behaviour: three pages that each fit one screen ---------- */
  const BH_PAGES = [['habits', 'Habits'], ['pm', 'Pre-mortem'], ['flags', 'Red flags']];
  const BH_MAP = [[/^Disposition/, 'habits', 1], [/^Tilt guard/, 'habits', 2], [/^Process vs outcome/, 'habits', 3],
    [/^Pre-mortem/, 'pm', 1], [/^Confidence calibration/, 'pm', 2], [/^Mood at entry/, 'pm', 3],
    [/^Red-flag scoreboard/, 'flags', 1], [/^Your trading hours/, 'flags', 2]];
  const bh = document.getElementById('behav');
  // Behaviour text never drops below the 11px step: micro-labels here use --fs-xs instead of --fs-2xs
  bh.style.setProperty('--fs-2xs', 'var(--fs-xs)');
  if (!bh.dataset.pg) bh.dataset.pg = (S.set && S.set.bhPg) || 'habits';
  const _render = renderBehav;
  renderBehav = function () {
    const keep = {};
    bh.querySelectorAll('.bh-card[data-k]').forEach(c => { if (c.scrollTop) keep[c.dataset.k] = c.scrollTop; });
    const r = _render.apply(this, arguments);
    bh.querySelectorAll('.bh-card:not(.bh-score)').forEach(c => {
      const t = (c.querySelector('h3')?.textContent || '').trim();
      const m = BH_MAP.find(([re]) => re.test(t));
      if (m) { c.tabIndex = 0; c.setAttribute('role', 'region'); c.setAttribute('aria-label', t.split(' Research:')[0].slice(0, 60)); c.dataset.pg = m[1]; c.dataset.k = m[1] + m[2]; c.dataset.o = m[2]; if (keep[c.dataset.k]) c.scrollTop = keep[c.dataset.k]; }
    });
    // the page strip opens the panel (first row of the score card); the score label sits with the score itself
    const st = bh.querySelector('.bh-score');
    if (st && !st.querySelector('.bh-pgs')) {
      const counts = Object.fromEntries(BH_PAGES.map(([k]) => [k, bh.querySelectorAll(`.bh-card[data-pg=${k}]`).length]));
      st.insertAdjacentHTML('afterbegin', `<div class="seg bh-pgs" role="tablist" aria-label="Behaviour pages">${BH_PAGES.map(([k, n]) => `<button role="tab" data-bhpg="${k}" aria-selected="${bh.dataset.pg === k}" class="${bh.dataset.pg === k ? 'on' : ''}">${n} <small>${counts[k]}</small></button>`).join('')}</div>`);
    }
    return r;
  };
  bh.addEventListener('click', e => {
    // a text button elsewhere in the panel (e.g. "2 rule suggestions in the Red-flag scoreboard") opens that page and its card
    const go = e.target.closest('[data-bhgo]');
    if (go) { const t = bh.querySelector(`.bh-pgs [data-bhpg=${go.dataset.bhgo}]`); if (t) { t.click(); bh.querySelector(`.bh-card[data-pg=${go.dataset.bhgo}][data-o="1"]`)?.focus(); } return; }
    const b = e.target.closest('[data-bhpg]'); if (!b) return;
    bh.dataset.pg = b.dataset.bhpg; if (S.set) S.set.bhPg = b.dataset.bhpg;
    bh.querySelectorAll('.bh-pgs [data-bhpg]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
  });
  if (typeof activeTab !== 'undefined' && activeTab === 'behav') renderBehav();

  /* ---------- Order book: as many price levels as the panel has room for ---------- */
  // handled in CSS (ladder rows shrink, outer levels clip symmetrically around the spread)

  /* ---------- version label (Help) — tells you exactly which build is running ---------- */
  const acts = document.querySelector('.acct-actions');
  if (acts && !document.getElementById('buildTag')) {
    const v = document.createElement('p'); v.id = 'buildTag'; v.className = 'muted small build-tag';
    v.textContent = `tradeBerry v16.0 · build ${window.MFX_BUILD || 'dev'}`;
    acts.insertAdjacentElement('afterend', v);
  }

  /* ---------- Full-screen mode ---------- */
  const fsOk = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const ctrls = document.querySelector('.topbar .ctrls');
  if (fsOk && ctrls && !document.getElementById('fsBtn')) {
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.id = 'fsBtn'; b.type = 'button';
    b.setAttribute('aria-label', 'Full screen'); b.title = 'Full screen (Shift+F)';
    const ico = on => on
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    b.innerHTML = ico(false);
    const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const toggle = () => {
      if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const d = document.documentElement; const p = (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => toast('Full screen not available', 'Your browser blocked it in this frame — use the published app or press F11', 'info')); }
    };
    b.onclick = toggle;
    const sync = () => { const on = isFs(); b.innerHTML = ico(on); b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); b.title = on ? 'Exit full screen (Shift+F)' : 'Full screen (Shift+F)'; b.classList.toggle('on', on); document.body.classList.toggle('is-fs', on); setTimeout(() => dispatchEvent(new Event('resize')), 60); };
    document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
    const help = ctrls.querySelector('#helpBtn, [aria-label^="Help"], [aria-label^="Shortcuts"]');
    help ? ctrls.insertBefore(b, help) : ctrls.appendChild(b);
    window.toggleFullscreen = toggle;
    addEventListener('keydown', e => {
      if (!e.shiftKey || e.key.toLowerCase() !== 'f') return; if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // any open dialog (overlays incl. #cmd and #help, the pre-mortem, confirms, the tour) keeps the key
      if ([...document.querySelectorAll('.overlay:not([hidden]), dialog[open], [aria-modal="true"]')].some(d => d.getClientRects().length)) return;
      e.preventDefault(); toggle();
    });
  }
})();
