/* tradeBerry — touch gestures: swipe between phone screens, long-press the chart to place an order at that price */
(function boot() {
  if (typeof S === 'undefined' || !S || !S.set || typeof candle === 'undefined' || !candle || !window.mnavGo) return setTimeout(boot, 150);
  const ORDER = ['chart', 'trade', 'markets', 'portfolio', 'tools'];
  const phone = () => document.body.classList.contains('mnav-on');

  /* ---- swipe left/right between the five phone screens ---- */
  const NO_SWIPE = '#chart,.chartp .chart-wrap,.chart-top,.mc-grid,input,select,textarea,.overlay,.lp-pop,.obs-nav,.bh-board-w,canvas,[data-noswipe]';
  let sx = 0, sy = 0, st = 0, track = false;
  const scrollsX = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { if (n.scrollWidth > n.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; } return false; };
  document.addEventListener('touchstart', e => {
    track = false; if (!phone() || e.touches.length !== 1) return;
    const t = e.target; if (t.closest(NO_SWIPE) || scrollsX(t)) return;
    const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = performance.now(); track = true;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!track) return; track = false;
    const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy, dt = performance.now() - st;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * .55 || dt > 650) return;
    const i = ORDER.indexOf(document.body.dataset.mv), j = i + (dx < 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= ORDER.length) { document.querySelector('.grid').animate([{ transform: `translateX(${dx < 0 ? -10 : 10}px)` }, { transform: 'none' }], { duration: 220, easing: 'ease-out' }); return; }
    mnavGo(ORDER[j]); haptic(6);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelector('.grid').animate([{ opacity: .4, transform: `translateX(${dx < 0 ? 28 : -28}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }, { passive: true });

  /* ---- long-press on the chart: pending order or alert at the pressed price ---- */
  const el = document.getElementById('chart');
  let timer = null, lx = 0, ly = 0, pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; } };
  function openAt(cx, cy) {
    const r = el.getBoundingClientRect(), price = candle.coordinateToPrice(cy - r.top);
    if (price == null || !(price > 0)) return;
    // the chart plots the bid: below the bid a buy limit / sell stop, above the ask a sell limit / buy stop
    const sym = S.set.sym, m = M(sym), q = Engine.quote(sym), px = +price.toFixed(m.digits);
    const t = S.tk, raw = (typeof tkCalc === 'function' ? tkCalc('buy').lots : t.lots) || 0;
    const lots = Math.max(volOf(sym)[0], normLots(sym, raw) || 0);
    const below = px < q.bid, above = px > q.ask;
    // closed market, off quotes, close only or not offered: nothing to place, the alert still works
    const why = marketWhy(sym) || (tradeStatus(sym) !== 'full' ? unavailableWhy(sym) : '');
    const opts = [];
    if (why) { /* no order buttons */ } else if (below) opts.push(['buy', 'limit', 'Buy limit'], ['sell', 'stop', 'Sell stop']);
    else if (above) opts.push(['sell', 'limit', 'Sell limit'], ['buy', 'stop', 'Buy stop']);
    haptic(18); close();
    pop = document.createElement('div'); pop.className = 'lp-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Order at price');
    pop.innerHTML = `<div class="lp-h"><b class="mono">${fp(sym, px)}</b><span>${escHtml(pretty(sym))} · ${escHtml(lotsWord(sym, lots))}</span></div>
      ${why ? `<p class="lp-note">${escHtml(why)}.</p>` : opts.map(([sd, ot, l]) => `<button class="lp-b ${sd}" data-sd="${sd}" data-ot="${ot}">${l}</button>`).join('') || '<p class="lp-note">Inside the spread — move further from the price.</p>'}
      <button class="lp-b" data-al="1">Alert at this price</button><button class="lp-x" aria-label="Close">Cancel</button>`;
    document.body.appendChild(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2)) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - h - 70, cy - h - 18)) + 'px';
    pop.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.sd) placeOrder({ sym, side: b.dataset.sd, ot: b.dataset.ot, price: px, lots, ...tkExits() });
      else if (b.dataset.al) { addAlert(sym, px); toast('Alert set', `${pretty(sym)} at ${fp(sym, px)}`, 'info'); }
      close();
    });
    pop.querySelector('.lp-b,.lp-x').focus({ preventScroll: true });
  }
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || (typeof tool !== 'undefined' && tool) || (typeof drag !== 'undefined' && drag)) return;
    const p = e.touches[0]; lx = p.clientX; ly = p.clientY; clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (typeof drag !== 'undefined' && drag) return; openAt(lx, ly); }, 480);
  }, { passive: true });
  el.addEventListener('touchmove', e => { if (!timer) return; const p = e.touches[0]; if (Math.hypot(p.clientX - lx, p.clientY - ly) > 10) { clearTimeout(timer); timer = null; } }, { passive: true });
  ['touchend', 'touchcancel'].forEach(k => el.addEventListener(k, () => { clearTimeout(timer); timer = null; }, { passive: true }));
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.chartLongPress = openAt; // also used by tests
})();
