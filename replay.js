/* tradeBerry — deterministic market replay (see .mace/design/replay.md).
   The replay runs in its own document: the same index.html in a same-origin iframe over the app, with its own
   Engine, account (S), calendar and caches. So the replay account cannot reach the main one, nothing computed in
   the replay survives a step back (going back rebuilds the document from a checkpoint), and the main account and
   its market are frozen (Engine.hold) while Replay is open.
   Host (the main app): Replay button, launcher, the iframe, the message protocol, rewinds.
   Child (the replay document): no browser storage, the transport bar, seeks, checkpoints, the seeded calendar.
   Messages: { mfx:'rp', v:1, rid, type, data }, accepted only from the expected window, same origin, current rid. */
const RP = window.RP = { role: 'off', state: 'idle', spec: null, speed: 60, cps: [], seek: null, error: '' };

/* A replay link: ?replay=sim&seed=N&start=T&r=7 rates&ev=V. Returns null without ?replay=sim, else { spec } or
   { error }. No silent defaults: a wrong link must not start another market than the one it promises. */
function rpParseUrl(search) {
  const q = new URLSearchParams(search || '');
  if (q.get('replay') !== 'sim') return null;
  const seed = q.get('seed') || '', start = q.get('start') || '', r = q.get('r') || '', ev = q.get('ev') || '';
  if (!/^\d{1,10}$/.test(seed) || +seed > 4294967295) return { error: 'The seed must be a whole number from 0 to 4294967295.' };
  if (!/^\d{9,11}$/.test(start) || +start < 946684800 || +start > 4102444800) return { error: 'The start time is not valid.' };
  const rates = r.split(',');
  if (rates.length !== 7 || !rates.every(x => /^\d+(\.\d+)?(e-?\d+)?$/i.test(x) && Number.isFinite(+x) && +x >= 1e-4 && +x <= 1e5)) return { error: 'The link needs seven exchange rates.' };
  if (!/^\d{1,3}$/.test(ev)) return { error: 'The engine version in the link is not valid.' };
  return { spec: { kind: 'sim', seed: +seed, start: Math.floor(+start / 60) * 60, rates: rates.map(Number), ev: +ev } };
}
// '' when a BarSet is valid, else the reason (the engine checks it again before it plays it)
function rpValidateBarSet(bs) { return Engine.checkBarSet(bs); }
/* The main session's own 1-minute bars [from, to) as a BarSet (all 16 pairs, NaN where a minute is missing).
   The bar still forming is never included. */
function rpBarSetFromSession(from, to) {
  const src = Engine.candles, first = src.EURUSD[0].time;
  from = Math.max(first, Math.floor((from ?? first) / 60) * 60);
  to = Math.min(Math.floor(Engine.simTime / 60) * 60, Math.floor((to ?? Engine.simTime) / 60) * 60);
  const n = Math.max(0, (to - from) / 60), pairs = {};
  for (const p of Engine.PAIRS) {
    const c = { o: new Float64Array(n).fill(NaN), h: new Float64Array(n).fill(NaN), l: new Float64Array(n).fill(NaN), c: new Float64Array(n).fill(NaN) };
    for (const b of src[p.sym]) { if (b.time < from || b.time >= to) continue; const i = (b.time - from) / 60; c.o[i] = b.open; c.h[i] = b.high; c.l[i] = b.low; c.c[i] = b.close; }
    pairs[p.sym] = c;
  }
  return { format: 'mfx-bars', v: 1, step: 60, t0: from, n, pairs, source: { kind: 'session' } };
}

(function () {
  const ORIGIN = location.origin;
  const isRid = v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
  const utc = t => new Date(t * 1000).toISOString();
  const hm = t => utc(t).slice(11, 16);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longT = t => { const d = new Date(t * 1000); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${utc(t).slice(11, 19)} UTC`; };
  const dur = s => { s = Math.max(0, Math.round(s / 60)); const h = Math.floor(s / 60), m = s % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const listAnd = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };
  const INFO_SIM = 'Replay from a seed: the same seed and start always give the same prices.';
  const INFO_BARS = "Replay of your session's prices as 1-minute bars. Movement inside each minute is reconstructed (open → low → high → close on up bars, open → high → low → close on down bars).";
  const tagText = sp => sp.kind === 'sim' ? `REPLAY · seed ${sp.seed}` : 'REPLAY · your session (1m bars)';

  if (Engine.isReplayDoc) child(); else host();

  /* ================= host: the main app ================= */
  function host() {
    RP.role = 'host';
    let frameEl = null, wrap = null, rid = null, spec = null, barset = null, pending = null, readyT = 0, opener = null, theme = 'dark';
    const hex = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); };

    const btn = el('button', { class: 'icon-btn', id: 'rpBtn', type: 'button', title: 'Market replay', 'aria-label': 'Market replay' },
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg>');
    const help = document.getElementById('helpBtn');
    if (help) help.before(btn);
    btn.addEventListener('click', () => RP.launcher());

    function simSpec(o) {
      const rates = o.rates || Engine.refRates || Engine.CCY.map(c => 1 / Engine.usd(c));
      return { kind: 'sim', seed: o.seed, start: Math.floor(o.start / 60) * 60, end: Math.floor(o.start / 60) * 60 + Engine.RP_MAX_SPAN, rates: rates.slice(), rateDate: o.rateDate || (o.rates ? 'link' : Engine.rateDate) };
    }
    function checkSim(sp) {
      if (!Number.isInteger(sp.seed) || sp.seed < 0 || sp.seed > 4294967295) return 'The seed must be a whole number from 0 to 4294967295.';
      if (!Number.isInteger(sp.start) || sp.start < 946684800 || sp.start > 4102444800) return 'The start time is not valid.';
      if (!Array.isArray(sp.rates) || sp.rates.length !== 7 || !sp.rates.every(v => Number.isFinite(v) && v >= 1e-4 && v <= 1e5)) return 'Seven exchange rates are needed.';
      return '';
    }
    // opts: { kind:'sim', seed, start, rates?, rateDate? } | { kind:'bars', start?, from?, to? }. Returns false when refused.
    RP.open = function (opts = {}) {
      if (frameEl) { toast('Replay already open', 'Close the current replay first.', 'info'); return false; }
      let sp, bs = null;
      if (opts.kind === 'bars') {
        bs = rpBarSetFromSession(opts.from, opts.to);
        const last = bs.t0 + 60 * bs.n - 1, start = Math.floor((opts.start ?? Math.max(bs.t0 + 240 * 60, last + 1 - 6 * 3600)) / 60) * 60;
        sp = { kind: 'bars', start, end: last, seed: null, rates: null, rateDate: '' };
        const e = bs.n < 300 ? 'Not enough recorded prices yet (needs 4 hours).' : rpValidateBarSet(bs) || (start < bs.t0 || start > last - 60 ? 'The start is outside the recorded prices.' : '');
        if (e) { toast('Replay not started', e, 'dn'); return false; }
      } else {
        sp = simSpec(opts);
        const e = checkSim(sp); if (e) { toast('Replay not started', e, 'dn'); return false; }
      }
      spec = sp; barset = bs; pending = null;
      opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      wrap = el('div', { id: 'rpHost' });
      wrap.style.cssText = 'position:fixed;inset:0;z-index:90;background:var(--bg)';
      document.body.appendChild(wrap);
      Engine.hold = true;
      mount();
      return true;
    };
    function mount() {
      rid = hex(); window.__mfxRpRid = rid;
      if (frameEl) frameEl.remove();
      frameEl = el('iframe', { title: 'Market replay' });
      frameEl.style.cssText = 'width:100%;height:100%;border:0;display:block;background:var(--bg)';
      frameEl.src = location.pathname + '?replay=1&rid=' + rid; // set before insertion: the child must see the rid at once
      wrap.appendChild(frameEl);
      RP.state = 'loading';
      clearTimeout(readyT);
      readyT = setTimeout(() => { if (RP.state === 'loading') fail('Replay could not start.'); }, 20000);
      frameEl.focus();
    }
    function fail(msg) {
      RP.state = 'error'; RP.error = msg;
      if (!wrap) return;
      const box = el('div', { role: 'alert' });
      box.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);background:var(--s1);border:1px solid var(--dn);border-radius:var(--r-lg);padding:12px 16px;display:flex;gap:12px;align-items:center;color:var(--tx);max-width:calc(100% - 32px)';
      box.innerHTML = '<span></span><button class="ghost sm" type="button">Close replay</button>';
      box.querySelector('span').textContent = msg;
      box.querySelector('button').addEventListener('click', () => RP.close());
      wrap.appendChild(box);
      box.querySelector('button').focus();
    }
    RP.close = function () {
      clearTimeout(readyT);
      if (wrap) wrap.remove();
      wrap = frameEl = null; spec = barset = pending = null;
      delete window.__mfxRpRid; rid = null;
      if (!Engine.hold) return;
      Engine.hold = false;
      RP.state = 'idle';
      const f = opener && opener.isConnected ? opener : btn; opener = null;
      try { f.focus(); } catch (e) { btn.focus(); }
      toast('Replay closed', 'Your main account is unchanged.', 'info');
    };
    const post = (type, data) => { try { frameEl.contentWindow.postMessage({ mfx: 'rp', v: 1, rid, type, data }, ORIGIN); } catch (e) { console.error('[Meridian] replay message failed:', e); } };
    addEventListener('message', e => {
      if (!frameEl || e.origin !== ORIGIN || e.source !== frameEl.contentWindow) return;
      const m = e.data;
      if (!m || m.mfx !== 'rp' || m.v !== 1 || m.rid !== rid || !isRid(m.rid)) return;
      const d = m.data && typeof m.data === 'object' ? m.data : {};
      if (m.type === 'hello') post('payload', pending ? { kind: 'resume', spec, pack: pending, barset, theme } : { kind: spec.kind, spec, barset, theme });
      else if (m.type === 'ready') { clearTimeout(readyT); RP.state = 'open'; }
      else if (m.type === 'rewind') { if (d.pack && d.pack.spec && d.pack.eng) { pending = d.pack; mount(); } }
      else if (m.type === 'close') RP.close();
      else if (m.type === 'error') { clearTimeout(readyT); fail(typeof d.message === 'string' ? d.message.slice(0, 200) : 'Replay could not start.'); }
    });

    /* ---------- launcher ---------- */
    let dlg = null, linkRates = null;
    RP.launcher = function (pre = {}, how = {}) {
      if (frameEl) { toast('Replay already open', 'Close the current replay first.', 'info'); return; }
      if (!dlg) build();
      const now = Math.floor(Engine.simTime / 60) * 60, start = pre.start ?? now, iso = utc(start);
      linkRates = pre.rates || null;
      dlg.querySelector('#rpSeed').value = pre.seed ?? Math.floor(Math.random() * 1e6);
      dlg.querySelector('#rpDate').value = iso.slice(0, 10);
      dlg.querySelector('#rpTime').value = iso.slice(11, 16);
      dlg.querySelector('#rpFrom').hidden = !how.fromLink;
      const ver = dlg.querySelector('#rpVer');
      ver.hidden = !(how.fromLink && pre.ev !== Engine.VERSION);
      ver.textContent = ver.hidden ? '' : `This link was made with market engine v${pre.ev}. This version builds a different market from the same seed.`;
      dlg.querySelector('#rpRates').textContent = linkRates ? 'Anchored to the rates in the link.' : `Anchored to the G8 levels of the broker-platform snapshot (${Engine.rateDate}). Replays cover the 16 G8 pairs.`;
      dlg.querySelector('#rpErr').textContent = '';
      // the bars choice: the main session's recorded 1-minute prices
      const sel = dlg.querySelector('#rpBarsStart'), to = Math.floor(Engine.simTime / 60) * 60;
      const opts = [[6, '6 hours ago'], [12, '12 hours ago'], [24, '24 hours ago'], [72, '3 days ago']].map(([h, l]) => `<option value="${to - h * 3600}">${l} (${hm(to - h * 3600)} UTC)</option>`);
      sel.innerHTML = opts.join('');
      setSrc(pre.kind === 'bars' ? 'bars' : 'sim');
      dlg.hidden = false;
      dlg.querySelector('[data-x]').focus();
    };
    function setSrc(k) {
      dlg.querySelectorAll('[data-src]').forEach(b => { const on = b.dataset.src === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      // the sections carry their own display, so they are switched through it (not through [hidden])
      dlg.querySelector('#rpSim').style.display = k === 'sim' ? 'grid' : 'none'; dlg.querySelector('#rpBars').style.display = k === 'bars' ? 'grid' : 'none';
      dlg.querySelector('#rpCopy').style.display = k === 'sim' ? '' : 'none';
      dlg.dataset.src = k;
    }
    function readSim() {
      const seedS = dlg.querySelector('#rpSeed').value.trim(), d = dlg.querySelector('#rpDate').value, tm = dlg.querySelector('#rpTime').value;
      if (!/^\d{1,10}$/.test(seedS) || +seedS > 4294967295) return { error: 'The seed must be a whole number from 0 to 4294967295.' };
      const t = Date.parse(`${d}T${tm}:00Z`) / 1000;
      if (!Number.isFinite(t)) return { error: 'Pick a start date and time (UTC).' };
      return { opts: { kind: 'sim', seed: +seedS, start: t, rates: linkRates || undefined } };
    }
    function build() {
      dlg = el('div', { class: 'overlay', id: 'rpDlg', hidden: '' });
      dlg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rpDlgT" style="width:min(520px,94vw)">
        <div class="ph"><h2 id="rpDlgT">Market replay</h2><button class="icon-btn" type="button" data-x aria-label="Close">✕</button></div>
        <p>Replay rebuilds the market and plays it forward at your pace. What lies ahead is not computed or shown until you reach it.</p>
        <p id="rpFrom" hidden style="color:var(--info)">Opened from a replay link</p>
        <div class="warn" id="rpVer" hidden></div>
        <div style="padding:0 12px;display:grid;gap:12px">
          <div class="mini-seg" role="radiogroup" aria-label="Source"><button type="button" role="radio" data-src="sim">Seed replay</button><button type="button" role="radio" data-src="bars">Your session (1m bars)</button></div>
          <div id="rpSim" style="display:grid;gap:10px">
            <label style="display:grid;gap:4px"><span class="muted">Seed</span><span style="display:flex;gap:6px"><input id="rpSeed" class="search" inputmode="numeric" autocomplete="off" style="flex:1"><button class="ghost sm" type="button" id="rpRand">Random</button></span></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><label style="display:grid;gap:4px"><span class="muted">Start date (UTC)</span><input type="date" id="rpDate" class="search"></label><label style="display:grid;gap:4px"><span class="muted">Start time (UTC)</span><input type="time" id="rpTime" class="search"></label></div>
            <div class="mini-seg" id="rpAgo" role="group" aria-label="Quick start"><button type="button" data-ago="24">24 h ago</button><button type="button" data-ago="48">48 h ago</button><button type="button" data-ago="72">72 h ago</button></div>
            <span class="muted" id="rpRates"></span>
          </div>
          <div id="rpBars" style="display:none;gap:6px"><label style="display:grid;gap:4px"><span class="muted">Start</span><select id="rpBarsStart"></select></label>
            <span class="muted">Your own session's prices, replayed as recorded 1-minute bars; the movement inside each minute is reconstructed.</span></div>
          <p class="muted" style="margin:0">Same seed and start give the same market every time. The replay account starts at $100,000 and is separate; your main account is frozen while Replay is open. Replays last up to 3 days of market time.</p>
          <p id="rpErr" role="alert" style="margin:0;color:var(--bad)"></p>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="ghost" type="button" data-x2>Cancel</button><button class="ghost" type="button" id="rpCopy">Copy link</button><button class="btn-pri" type="button" id="rpGo">Start replay</button></div>
        </div></div>`;
      document.body.appendChild(dlg);
      const close = () => { dlg.hidden = true; btn.focus(); };
      dlg.addEventListener('click', e => {
        if (e.target === dlg || e.target.closest('[data-x],[data-x2]')) return close();
        const s = e.target.closest('[data-src]'); if (s) setSrc(s.dataset.src);
      });
      dlg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
      // quick start: the date and time fields set to that many hours before the market's clock now
      dlg.querySelector('#rpAgo').addEventListener('click', e => {
        const b = e.target.closest('[data-ago]'); if (!b) return;
        const iso = utc(Math.floor(Engine.simTime / 60) * 60 - +b.dataset.ago * 3600);
        dlg.querySelector('#rpDate').value = iso.slice(0, 10); dlg.querySelector('#rpTime').value = iso.slice(11, 16);
        dlg.querySelectorAll('#rpAgo [data-ago]').forEach(x => x.classList.toggle('on', x === b));
      });
      // a date or time typed by hand is no longer one of the quick starts
      for (const id of ['#rpDate', '#rpTime']) dlg.querySelector(id).addEventListener('input', () => dlg.querySelectorAll('#rpAgo .on').forEach(x => x.classList.remove('on')));
      dlg.querySelector('#rpRand').addEventListener('click', () => { dlg.querySelector('#rpSeed').value = Math.floor(Math.random() * 4294967296); });
      dlg.querySelector('#rpGo').addEventListener('click', () => {
        const err = dlg.querySelector('#rpErr');
        if (dlg.dataset.src === 'bars') { dlg.hidden = true; if (!RP.open({ kind: 'bars', start: +dlg.querySelector('#rpBarsStart').value })) dlg.hidden = false; return; }
        const r = readSim(); if (r.error) { err.textContent = r.error; return; }
        dlg.hidden = true; if (!RP.open(r.opts)) dlg.hidden = false;
      });
      dlg.querySelector('#rpCopy').addEventListener('click', () => {
        const r = readSim(), err = dlg.querySelector('#rpErr'); if (r.error) { err.textContent = r.error; return; }
        const sp = simSpec(r.opts), url = `${location.origin}${location.pathname}?replay=sim&seed=${sp.seed}&start=${sp.start}&r=${sp.rates.join(',')}&ev=${Engine.VERSION}`;
        const ok = () => toast('Replay link copied', 'Anyone opening it gets the same market.', 'info');
        try { navigator.clipboard.writeText(url).then(ok, () => { err.textContent = url; }); } catch (e) { err.textContent = url; }
      });
    }
    // a replay link opens the launcher prefilled, never a replay by itself
    const link = rpParseUrl(location.search);
    if (link) (function after() {
      const b = document.getElementById('boot');
      if (b && !b.classList.contains('done')) return setTimeout(after, 150);
      if (link.error) toast('Replay link not valid', link.error, 'dn');
      else RP.launcher(link.spec, { fromLink: true });
    })();
  }

  /* ================= child: the replay document ================= */
  function child() {
    RP.role = 'child'; RP.state = 'loading';
    document.documentElement.dataset.replay = '1';
    // the replay account lives in memory only: persist.js (next script) finds no storage and runs session-only,
    // so the replay can neither read nor overwrite the main account, nor talk to its tabs
    for (const k of ['indexedDB', 'localStorage', 'sessionStorage', 'BroadcastChannel']) {
      try { Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('No storage in a replay', 'SecurityError'); } }); } catch (e) { /* not configurable here */ }
    }
    const rid = new URLSearchParams(location.search).get('rid');
    let barset = null; // the recorded bars stay in this closure (the engine holds its own copy, also private)
    let theme = 'dark';
    const send = (type, data = {}) => { try { parent.postMessage({ mfx: 'rp', v: 1, rid, type, data }, ORIGIN); } catch (e) { console.error('[Meridian] replay message failed:', e); } };
    const bootMsg = msg => { const m = document.querySelector('.boot-msg'); if (m) m.textContent = msg; };
    bootMsg('Building replay market…');
    function fail(msg) {
      RP.state = 'error'; RP.error = msg;
      bootMsg(msg);
      const b = document.querySelector('.boot-inner');
      if (b && !b.querySelector('.rp-x')) { const x = el('button', { class: 'ghost rp-x', type: 'button' }, 'Close replay'); x.style.marginTop = '12px'; x.addEventListener('click', () => send('close')); b.appendChild(x); }
      send('error', { message: msg });
    }
    addEventListener('message', e => {
      if (e.origin !== ORIGIN || e.source !== parent) return;
      const m = e.data;
      if (!m || m.mfx !== 'rp' || m.v !== 1 || m.rid !== rid || m.type !== 'payload' || RP.spec) return;
      const d = m.data || {};
      try {
        theme = d.theme === 'light' ? 'light' : 'dark';
        if (d.kind === 'resume') {
          const pk = d.pack;
          RP.speed = Engine.RP_SPEEDS.includes(pk.ui && pk.ui.speed) ? pk.ui.speed : RP.speed;
          CAL.events = Array.isArray(pk.cal && pk.cal.events) ? pk.cal.events : []; CAL.nextT = +(pk.cal && pk.cal.nextT) || 0;
          RP.cps = Array.isArray(pk.cps) ? pk.cps : [];
          store.set(JSON.parse(pk.acct)); // boot loads it through sanitizeState, like any outside state
          Engine.configure({ mode: 'resume', pack: pk, barset: d.barset || null });
          RP.spec = pk.spec;
        } else if (d.kind === 'sim') {
          const s = d.spec;
          Engine.configure({ mode: 'sim', seed: s.seed, start: s.start, end: s.end, rates: s.rates, rateDate: s.rateDate });
          RP.spec = s;
        } else if (d.kind === 'bars') {
          const s = d.spec;
          Engine.configure({ mode: 'bars', barset: d.barset, start: s.start, end: s.end });
          RP.spec = s;
        } else throw new Error('Replay: unknown source');
        barset = d.barset || null;
      } catch (err) { fail(err && err.message ? String(err.message).slice(0, 200) : 'Replay could not start.'); }
    });
    send('hello', {});

    /* ---------- deterministic calendar, checkpoints, triggers on every step ---------- */
    const realCal = window.calTick;
    let calArm = true, inCal = false;
    // the main loop calls calTick every frame: in a replay it runs only at boot and on the 15 s chunk grid, with
    // Math.random taken from the seeded 'cal' stream for the call, so releases (and their price jumps) fall on the
    // same steps every time
    window.calTick = function () { if (!calArm) return; calArm = false; chunk(); };
    function chunk() {
      checkpoint();
      if (Engine.mode === 'sim' && typeof realCal === 'function') {
        const mr = Math.random; Math.random = Engine.rng('cal'); inCal = true;
        try { realCal(); } finally { Math.random = mr; inCal = false; }
      }
      if (typeof checkDrawAlerts === 'function') safe('drawing alerts', checkDrawAlerts);
    }
    function checkpoint() {
      const sp = Engine.replay, t = Engine.simTime;
      if (!sp || (t - sp.start) % Engine.RP_CP || RP.cps.some(c => c.t === t)) return;
      RP.cps.push({ t, eng: Engine.rpSnap(), cal: JSON.parse(JSON.stringify(CAL)), acct: JSON.stringify(S) });
    }
    Engine.on('chunk', () => safe('replay calendar', chunk));
    // orders, stops, trailing, stop-out and alerts see every simulated second (the wick a 1m bar draws): the 'q'
    // listener in trade.js, the same one the live market uses for its sub-steps
    Engine.on('end', () => { if (RP.state === 'playing') { Engine.replaySpeed = 0; setState('ended'); realToast('End of replay', 'Step back to a checkpoint or close the replay.', 'info'); } });

    /* ---------- wrappers (called by global name) ---------- */
    const realToast = window.toast, realBeep = window.beep;
    window.toast = function (title) {
      if (RP.seek) { if (inCal) RP.seek.news++; else RP.seek.log.push(String(title)); return; }
      return realToast.apply(this, arguments);
    };
    window.beep = function () { if (RP.seek) return; return realBeep.apply(this, arguments); };
    if (typeof tkBlocks === 'function') {
      const tb = tkBlocks;
      window.tkBlocks = function (k) { const b = tb(k); if (RP.state === 'seeking') b.unshift({ btn: 'Jumping — wait', why: 'The replay is jumping forward; orders wait until it stops.' }); return b; };
    }
    const op = window.openPosition;
    window.openPosition = function (o) { if (RP.state === 'seeking' && !(o && o.auto)) return null; return op.apply(this, arguments); };

    /* ---------- player ---------- */
    let live = null, ui = {};
    function setState(s) {
      const from = RP.state; RP.state = s;
      if (live && from !== s) {
        const sp = Engine.replay, t = Engine.simTime;
        live.textContent = s === 'paused' ? `Paused at ${hm(t)} UTC` : s === 'playing' ? `Playing at ${RP.speed}×` : s === 'seeking' && RP.seek ? `Playing forward to ${hm(RP.seek.to)} UTC` : s === 'ended' ? 'End of replay' : '';
        if (s === 'paused' && sp && t >= sp.end) live.textContent = 'End of replay';
      }
      dispatchEvent(new CustomEvent('mfx:replay', { detail: { type: 'state', from, to: s } }));
      paint();
    }
    RP.play = () => { if (RP.state !== 'paused' || Engine.atEnd) return; Engine.replaySpeed = RP.speed; setState('playing'); };
    RP.pause = () => { if (RP.state !== 'playing') return; Engine.replaySpeed = 0; setState('paused'); };
    RP.toggle = () => RP.state === 'playing' ? RP.pause() : RP.play();
    RP.setSpeed = v => { if (!Engine.RP_SPEEDS.includes(v)) return; RP.speed = v; if (RP.state === 'playing') Engine.replaySpeed = v; paint(); };
    RP.step = () => { const st = S.set.tf * 60; seekTo(Math.ceil((Engine.simTime + 1) / st) * st); };
    RP.jumpBy = sec => RP.jumpTo(Engine.simTime + sec);
    RP.jumpTo = t => { t = Math.floor(t); if (t > Engine.simTime) seekTo(t); else if (t < Engine.simTime) RP.back(t); };
    const HOURS = { tokyo: 0, london: 7, ny: 12 };
    RP.next = kind => {
      const now = Engine.simTime;
      if (kind in HOURS) { let d = Math.floor(now / 86400) * 86400 + HOURS[kind] * 3600; if (d <= now) d += 86400; return seekTo(d); }
      if (kind === 'event') { const e = CAL.events.filter(x => !x.done && x.impact === 'hi' && x.t - 120 > now).sort((a, b) => a.t - b.t)[0]; if (e) seekTo(e.t - 120); }
    };
    RP.cancel = () => { if (RP.seek) RP.seek.cancel = true; };
    function seekTo(target) {
      if (RP.state === 'playing') RP.pause();
      if (RP.state !== 'paused') return;
      const sp = Engine.replay; target = Math.min(Math.floor(target), sp.end);
      if (!(target > Engine.simTime)) return;
      Engine.replaySpeed = 0;
      RP.seek = { from: Engine.simTime, to: target, cancel: false, log: [], news: 0 };
      setState('seeking');
      const slice = () => {
        const s = RP.seek, t0 = performance.now();
        // whole chunks (or up to the target): a cancel stops on the 15 s grid, like play does
        while (Engine.simTime < s.to && !s.cancel) {
          const off = (Engine.simTime - sp.start) % Engine.RP_CHUNK, n = Math.min(s.to - Engine.simTime, Engine.RP_CHUNK - off);
          if (!Engine.stepFixed(n)) break;
          if (performance.now() - t0 > 25) break;
        }
        if (Engine.simTime < s.to && !s.cancel && !Engine.atEnd) { paint(); setTimeout(slice, 0); return; }
        finish();
      };
      slice();
    }
    function finish() {
      const s = RP.seek; RP.seek = null;
      setState(Engine.atEnd ? 'ended' : 'paused');
      safe('chart', () => fullChart(false));
      changed('pos', 'ord', 'hist', 'al');
      const n = s.log.length, uniq = [...new Set(s.log)];
      const body = (n ? `${plural(n, 'account event')} while jumping: ${uniq.slice(0, 3).join('; ')}${uniq.length > 3 ? ` and ${uniq.length - 3} more` : ''}` : 'Nothing happened in your account')
        + (s.news ? ` · ${plural(s.news, 'news release')}` : '');
      realToast(`Jumped to ${hm(Engine.simTime)} UTC`, body, 'info');
      if (Engine.atEnd) realToast('End of replay', 'Step back to a checkpoint or close the replay.', 'info');
    }
    /* Back to a checkpoint (15 min grid): the replay document is rebuilt from it, so prices, account, calendar and
       every cache are exactly what they were then. What was done after it is counted and confirmed first. */
    RP.back = cpT => {
      if (RP.state === 'playing') RP.pause();
      if (RP.state !== 'paused' && RP.state !== 'ended') return;
      const lim = cpT == null ? Engine.simTime - 1 : cpT;
      const cp = RP.cps.filter(c => c.t <= lim && c.t < Engine.simTime).sort((a, b) => b.t - a.t)[0];
      if (!cp) return;
      const was = JSON.parse(cp.acct), has = (arr, key) => new Set((arr || []).map(key));
      const hk = h => `${h.id}:${h.close}:${h.lots}`, hs = has(was.history, hk), ps = has(was.positions, p => p.id), os = has(was.orders, o => o.id), as = has(was.alerts, a => a.id);
      const lost = [
        [S.history.filter(h => !h.nbp && !hs.has(hk(h))).length, 'replay trade'], [S.positions.filter(p => !ps.has(p.id)).length, 'open position'],
        [S.orders.filter(o => !os.has(o.id)).length, 'pending order'], [S.alerts.filter(a => !as.has(a.id)).length, 'alert']
      ].filter(x => x[0] > 0).map(([k, w]) => plural(k, w));
      if (!lost.length) return rewind(cp);
      const prev = RP.state; setState('confirm');
      askConfirm({ title: `Go back to ${hm(cp.t)} UTC?`, body: `${listAnd(lost)} made after it will be discarded.`, ok: 'Go back', onOk: () => rewind(cp) });
      const d = document.getElementById('confirmDlg');
      const mo = new MutationObserver(() => { if (d.hidden) { mo.disconnect(); if (RP.state === 'confirm') setState(prev); } });
      mo.observe(d, { attributes: true, attributeFilter: ['hidden'] });
    };
    function rewind(cp) {
      const candles = {};
      for (const p of Engine.PAIRS) {
        const a = Engine.candles[p.sym].slice(0, cp.eng.lens[p.sym]);
        if (a.length && cp.eng.last[p.sym]) a[a.length - 1] = { ...cp.eng.last[p.sym] };
        candles[p.sym] = a;
      }
      setState('loading');
      send('rewind', { pack: { spec: RP.spec, t: cp.t, eng: cp.eng, cal: cp.cal, acct: cp.acct, candles, cps: RP.cps.filter(c => c.t <= cp.t), ui: { speed: RP.speed } } });
    }
    RP.close = () => {
      if (RP.state === 'playing') RP.pause();
      const n = S.history.filter(h => !h.nbp).length, np = S.positions.length;
      if (!n && !np) return send('close');
      askConfirm({ title: 'Close replay?', body: `The replay account and its ${plural(n, 'trade')}${np ? ` and ${plural(np, 'open position')}` : ''} are discarded. Your main account is unchanged.`, ok: 'Close replay', onOk: () => send('close') });
    };
    RP.summary = () => {
      const h = S.history.filter(x => !x.nbp), net = h.reduce((s, x) => s + x.pnl, 0), wins = h.filter(x => x.pnl > 0).length;
      let eq = S.balance - net, peak = eq, dd = 0;
      for (const x of [...h].reverse()) { eq += x.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
      return { trades: h.length, wins, net, maxDD: dd, open: S.positions.length };
    };

    /* ---------- the transport bar ---------- */
    function boot() {
      const b = document.getElementById('boot');
      if (RP.state === 'error') return;
      if (!b || !b.classList.contains('done')) return setTimeout(boot, 50);
      if (S.set.theme !== theme) { S.set.theme = theme; safe('theme', applyTheme); }
      S.set.tourSeen = true; document.querySelectorAll('.tour-chip').forEach(x => x.remove());
      const sp = Engine.replay;
      const feed = document.getElementById('feedPill');
      if (feed) { feed.textContent = tagText(RP.spec || sp); feed.title = sp.kind === 'sim' ? INFO_SIM : INFO_BARS; }
      const speed = document.getElementById('speedSel'); if (speed) (speed.closest('label') || speed).style.display = 'none';
      document.querySelectorAll('.acct-actions').forEach(x => { x.style.display = 'none'; });
      const acct = document.getElementById('acct');
      if (acct && !acct.querySelector('.rp-acct')) acct.prepend(el('span', { class: 'rp-acct', title: 'Replay account — separate from your main account' }, 'Replay account'));
      bar(sp);
      setState(Engine.atEnd ? 'ended' : 'paused');
      send('ready', {});
      setInterval(paint, 250);
    }
    setTimeout(boot, 0);

    function bar(sp) {
      const sim = sp.kind === 'sim';
      const r = el('div', { id: 'rpBar', role: 'toolbar', 'aria-label': 'Replay controls' });
      const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
      r.innerHTML = `<span class="pill" id="rpTag" tabindex="0" title="${escHtml(sim ? INFO_SIM : INFO_BARS)}">${escHtml(tagText(RP.spec || sp))}</span>
        <button class="icon-btn rp-b" type="button" id="rpBack" aria-label="Back 15 minutes" title="Back to the previous checkpoint (15 min grid). Shift+click: back to start">${ic('M11 7l-5 5 5 5M18 7l-5 5 5 5')}</button>
        <button class="btn-pri rp-b" type="button" id="rpPlay" aria-pressed="false" aria-label="Play" title="Play / pause (Space)"></button>
        <button class="icon-btn rp-b" type="button" id="rpStep" aria-label="Step to the next bar" title="Step to the close of the current chart bar (→)">${ic('M7 6l6 6-6 6M16 6v12')}</button>
        <span class="mini-seg" role="radiogroup" aria-label="Replay speed">${Engine.RP_SPEEDS.map(v => `<button type="button" class="rp-b" role="radio" data-sp="${v}" aria-checked="false">${v}×</button>`).join('')}</span>
        <select id="rpJump" aria-label="Jump forward" title="Jump forward (J)"><option value="">Jump…</option><option value="900">+15 min</option><option value="3600">+1 hour</option><option value="14400">+4 hours</option>
          <option value="tokyo">Next Tokyo open (00:00 UTC)</option><option value="london">Next London open (07:00 UTC)</option><option value="ny">Next New York open (12:00 UTC)</option>${sim ? '<option value="event">2 min before next high-impact release</option>' : ''}<option value="end">End of replay</option></select>
        <input type="range" id="rpScrub" aria-label="Replay position" min="${sp.start}" max="${sp.end}" step="any" value="${Engine.simTime}">
        <span class="mono" id="rpClock"></span>
        <button class="ghost sm rp-b" type="button" id="rpSum" aria-expanded="false" aria-controls="rpSumPop">Summary</button>
        <button class="ghost sm rp-b" type="button" id="rpClose">✕ Close replay</button>
        <span class="sr-only" aria-live="polite" id="rpLive"></span>`;
      const top = document.querySelector('header.topbar');
      if (top) top.after(r); else document.body.prepend(r);
      live = r.querySelector('#rpLive');
      ui = { play: r.querySelector('#rpPlay'), step: r.querySelector('#rpStep'), back: r.querySelector('#rpBack'), jump: r.querySelector('#rpJump'), scrub: r.querySelector('#rpScrub'), clock: r.querySelector('#rpClock'), sum: r.querySelector('#rpSum'), close: r.querySelector('#rpClose'), sp: [...r.querySelectorAll('[data-sp]')] };
      ui.play.addEventListener('click', () => RP.toggle());
      ui.step.addEventListener('click', () => RP.step());
      ui.back.addEventListener('click', e => e.shiftKey ? RP.back(sp.start) : RP.back());
      ui.sp.forEach(b => b.addEventListener('click', () => RP.setSpeed(+b.dataset.sp)));
      ui.jump.addEventListener('change', () => {
        const v = ui.jump.value; ui.jump.value = '';
        if (!v) return;
        if (v === 'end') RP.jumpTo(Engine.replay.end); else if (/^\d+$/.test(v)) RP.jumpBy(+v); else RP.next(v);
      });
      // the slider never previews: on release, ahead of the cursor plays forward, behind goes back to a checkpoint
      let drag = false;
      ui.scrub.addEventListener('pointerdown', () => { drag = true; });
      ui.scrub.addEventListener('change', () => { drag = false; const t = Math.round(+ui.scrub.value); if (t > Engine.simTime) RP.jumpTo(t); else if (t < Engine.simTime) RP.back(t); else paint(); });
      ui.scrub.addEventListener('keydown', e => {
        const k = e.key, act = { ArrowRight: () => RP.jumpBy(900), PageUp: () => RP.jumpBy(900), ArrowUp: () => RP.jumpBy(900), ArrowLeft: () => RP.back(), PageDown: () => RP.back(), ArrowDown: () => RP.back(), Home: () => RP.back(sp.start), End: () => RP.jumpTo(sp.end) }[k];
        if (act) { e.preventDefault(); e.stopPropagation(); act(); }
      });
      ui.sum.addEventListener('click', toggleSummary);
      ui.close.addEventListener('click', () => RP.close());
      // keyboard: only when nothing else has focus (the body, the chart, the bar itself)
      document.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const tg = e.target, free = tg === document.body || tg === document.documentElement || tg === r || (tg.closest && tg.closest('#chart'));
        if (e.key === 'Escape') { const p = document.getElementById('rpSumPop'); if (p && !p.hidden) { p.hidden = true; ui.sum.setAttribute('aria-expanded', 'false'); ui.sum.focus(); } return; }
        if (!free) return;
        const k = e.key;
        if (k === ' ') { e.preventDefault(); RP.toggle(); }
        else if (k === 'ArrowRight') { e.preventDefault(); e.shiftKey ? RP.jumpBy(900) : RP.step(); }
        else if (k === 'ArrowLeft') { e.preventDefault(); RP.back(); }
        else if (k === 'Home') { e.preventDefault(); RP.back(sp.start); }
        else if (k === '[' || k === ']') { const i = Engine.RP_SPEEDS.indexOf(RP.speed) + (k === ']' ? 1 : -1); if (i >= 0 && i < Engine.RP_SPEEDS.length) RP.setSpeed(Engine.RP_SPEEDS[i]); }
        else if (k.toLowerCase() === 'j') { e.preventDefault(); ui.jump.focus(); }
      }, true);
      ui._drag = () => drag;
    }
    function toggleSummary() {
      let p = document.getElementById('rpSumPop');
      if (!p) {
        p = el('div', { id: 'rpSumPop', role: 'dialog', 'aria-label': 'Replay summary', hidden: '' });
        document.body.appendChild(p);
      }
      const open = p.hidden;
      if (open) {
        // a two-column bordered table; Net P&L is the key figure (direction colour, sign kept in the text)
        const s = RP.summary(), net = s.net > 0 ? ' up' : s.net < 0 ? ' dn' : '';
        const rows = [['Net P&L', usdFmt(s.net, true), 'rp-key' + net], ['Replay trades', `${s.trades} (${s.wins} won)`, ''], ['Largest drawdown (closed trades)', usdFmt(-s.maxDD), ''], ['Open positions', String(s.open), '']];
        p.innerHTML = `<div class="rp-sum-h"><b>Replay summary</b></div><table class="tbl rp-sum-t"><tbody>${rows.map(([k, v, c]) => `<tr><th scope="row">${escHtml(k)}</th><td class="mono${c ? ' ' + c : ''}">${escHtml(v)}</td></tr>`).join('')}</tbody></table>
          <div class="rp-sum-act"><button class="ghost sm" type="button" data-go="journal">Open Journal</button></div>
          <small class="muted">Replay account — separate from your main account. Practice data, not investment advice.</small>`;
        p.querySelector('[data-go]').addEventListener('click', () => { p.hidden = true; ui.sum.setAttribute('aria-expanded', 'false'); setTab('journal'); });
      }
      p.hidden = !open; ui.sum.setAttribute('aria-expanded', String(open));
    }
    function paint() {
      if (!ui.play) return;
      const sp = Engine.replay, t = Engine.simTime, st = RP.state, busy = st === 'seeking' || st === 'loading' || st === 'confirm';
      const playing = st === 'playing';
      ui.play.textContent = playing ? '❚❚' : '▶';
      ui.play.setAttribute('aria-pressed', String(playing));
      ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      ui.play.disabled = busy || st === 'ended';
      ui.step.disabled = busy || st === 'ended' || playing;
      ui.back.disabled = busy || !RP.cps.some(c => c.t < t);
      ui.jump.disabled = busy || st === 'ended';
      const tf = S.set.tf, tfName = tf >= 60 ? tf / 60 + 'h' : tf + 'm';
      ui.step.setAttribute('aria-label', `Step to the next ${tfName} bar`);
      ui.sp.forEach(b => { const on = +b.dataset.sp === RP.speed; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      if (!ui._drag()) ui.scrub.value = t;
      ui.scrub.setAttribute('aria-valuenow', String(t));
      ui.scrub.setAttribute('aria-valuetext', `${hm(t)} UTC, ${dur(t - sp.start)} played of ${dur(sp.end - sp.start)}`);
      ui.scrub.disabled = busy;
      const pct = RP.seek ? Math.round((t - RP.seek.from) / Math.max(1, RP.seek.to - RP.seek.from) * 100) : null;
      ui.clock.textContent = `${longT(t)} · +${dur(t - sp.start)}${pct != null ? ` · jumping ${pct}%` : ''}`;
    }
  }
})();
