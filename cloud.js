/* tradeBerry — the account on the server, per signed-in user (Cloudflare Pages Functions + D1, see functions/).
   Runs after persist.js and before boot: it wraps the store. At load it compares this browser's copy with the user's
   copy on the server (GET /api/state) and boot starts from the right one; after that every save of the writer tab
   also goes to the server (PUT /api/state, debounced), with the revision it started from, so two devices never
   overwrite each other in silence: a 409 asks the user which copy to keep. The local copy stays (offline, reload).
   Served without the API (a static server, file://, the tests): nothing changes and nothing is shown.
   One device runs an account at a time (a lease on the server, renewed every 40 s): each device runs its own
   simulated market, so two at once would trade the same account apart. Another device opened meanwhile shows the
   account up to date but stopped, with "Use it here"; taking it over stops the first one, which can no longer save.
   localStorage 'tb-sync' = {user, rev, dirty}: whose copy this browser holds, the server revision it matches, and
   whether it has changes the server does not have yet; 'tb-device' = this browser's random device id. */
(function () {
  if (typeof store !== 'object' || !store) return;
  // served without the account server (a static copy, the tests): stay out of the way, not even a request.
  // tb_u=1 is set by the server with each signed-in page; a browser that synced before may boot offline without it
  const served = (() => { try { return /(?:^|;\s*)tb_u=1(?:;|$)/.test(document.cookie) || !!localStorage.getItem('tb-sync'); } catch (e) { return false; } })();
  if (!served) return;
  // account changes go within seconds; the market alone (saved every few seconds while it runs) at most every 30 s,
  // which keeps a tester well inside D1's free writes
  const META = 'tb-sync', DEV = 'tb-device', PUSH_MS = 4000, MARKET_MS = 30000, RENEW_MS = 40000, KEEPALIVE_MAX = 60000;
  const orig = { ready: store.ready, set: store.set, clear: store.clear, setMarket: store.setMarket };
  const tell = (t, b, k) => { try { toast(t, b, k); } catch (e) { console.warn('[tradeBerry]', t, b); } };
  const readMeta = () => { try { const v = JSON.parse(localStorage.getItem(META) || 'null'); return v && typeof v.user === 'string' ? v : null; } catch (e) { return null; } };
  const writeMeta = () => { try { localStorage.setItem(META, JSON.stringify({ user, rev, dirty })); } catch (e) { /* the server copy still syncs; a reload compares again */ } };
  const dropMeta = () => { try { localStorage.removeItem(META); } catch (e) { /* ignore */ } };
  const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const device = (() => { let d = null; try { d = localStorage.getItem(DEV); } catch (e) { /* no storage: one id per page */ } if (!d || !/^[a-z0-9]{12,40}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('') + Date.now().toString(36); try { localStorage.setItem(DEV, d); } catch (e) { /* ignore */ } } return d; })();
  const api = (path, opt = {}) => fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-TB-Device': device, ...(opt.headers || {}) } });
  // the same account written by two devices may differ only in key order: compare with sorted keys
  const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);
  // copies that never reached the server, kept until the user downloads them: 'tb-keep-<user>'
  const keepCopy = (u, state) => { if (!u || !hasData(state)) return; try { localStorage.setItem('tb-keep-' + u, JSON.stringify({ at: Date.now(), state })); } catch (e) { console.warn('[tradeBerry] could not keep the unsent copy', e); } };
  const keptCopy = u => { try { const v = JSON.parse(localStorage.getItem('tb-keep-' + u) || 'null'); return v && v.state ? v : null; } catch (e) { return null; } };
  const dropKept = u => { try { localStorage.removeItem('tb-keep-' + u); } catch (e) { /* ignore */ } };
  const hasData = s => !!(s && ((s.history && s.history.length) || (s.positions && s.positions.length) || (s.orders && s.orders.length)));

  // dirty: the account (positions, trades, settings) has changes the server lacks; mDirty: only the market snapshot
  let on = false, user = null, rev = 0, dirty = false, gen = 0, mDirty = false, gm = 0, timer = 0, timerMs = 0, inflight = null, again = false, retryMs = 5000;
  // held: this device runs the account (the lease); elsewhereSince: when another device took it
  let shared = false; // a login several people use: every browser keeps its own portfolio on the server
  let status = 'local', savedAt = 0, frozen = false, lastErr = '', held = false, elsewhereSince = 0;
  // track: this tab's changes count (it is the writer tab and the account runs here or will); write: and it holds the lease
  const mayTrack = () => on && !frozen && status !== 'elsewhere' && !(store.readOnly && store.readOnly());
  const mayWrite = () => mayTrack() && held;

  /* ---------- load: which copy boot starts from ---------- */
  async function applyServer(d) {
    frozen = true;
    try {
      if (d && d.state) orig.set(d.state); else orig.clear();
      if (d && d.market) orig.setMarket(d.market);
      await store.flush();
    } finally { frozen = false; }
  }
  store.ready = (async () => {
    await orig.ready;
    const meta = readMeta();
    let me = null;
    try {
      const r = await timed(api('/api/me'), 6000);
      if (r.ok && (r.headers.get('Content-Type') || '').includes('json')) me = await r.json();
      else if (r.status === 401) { if (!meta) return; on = true; user = meta.user; rev = meta.rev | 0; dirty = !!meta.dirty; status = 'signedout'; return; }
      else return; // no API here: a static copy of the app, browser storage only
    } catch (e) {
      if (!meta) return;                       // never synced in this browser: stay local
      on = true; user = meta.user; rev = meta.rev | 0; dirty = !!meta.dirty; status = 'offline'; lastErr = 'No connection to the server';
      return; // renew() / the online event take the lease and send the changes when the server answers
    }
    if (!me || typeof me.username !== 'string') return;
    on = true; user = me.username; shared = !!me.shared;
    if (store.readOnly && store.readOnly()) { rev = meta && meta.user === user ? meta.rev | 0 : 0; status = 'synced'; return; } // the writer tab syncs; if this tab becomes the writer, renew() takes the lease
    try {
      const r = await timed(api('/api/lease', { method: 'POST', body: '{}' }), 6000);
      if (r.ok) held = true; else if (r.status === 423) elsewhereSince = ((await r.json().catch(() => ({}))).since | 0) * 1000; else throw new Error('HTTP ' + r.status);
    } catch (e) { const mine = !!(meta && meta.user === user); status = 'offline'; lastErr = 'No connection to the server'; rev = mine ? meta.rev | 0 : 0; dirty = mine && !!meta.dirty; return; }
    let srv;
    try { const r = await timed(api('/api/state'), 10000); if (!r.ok) throw new Error('HTTP ' + r.status); srv = await r.json(); }
    catch (e) { rev = meta && meta.user === user ? meta.rev | 0 : 0; dirty = !!(meta && meta.user === user && meta.dirty); status = 'offline'; lastErr = 'Could not read your account from the server'; return; }
    const local = store.get(), sRev = srv.rev | 0;
    savedAt = (srv.savedAt | 0) * 1000;
    if (!held) {
      // open on another device: show the account as it is there, stopped; changes this browser never sent can be downloaded
      if (meta && meta.user === user && meta.dirty) keepCopy(user, local);
      if (meta && meta.user !== user && meta.dirty) keepCopy(meta.user, local);
      if (sRev > 0) await applyServer(srv.data); else if (meta && meta.user !== user) await applyServer(null);
      rev = sRev; dirty = false; status = 'elsewhere';
    } else if (!meta || meta.user !== user) {
      if (meta && meta.user !== user && meta.dirty) keepCopy(meta.user, local); // that user's unsent changes wait for them
      if (sRev > 0) {
        // the server copy wins; a local account that belonged to nobody (saved before sign-in) can be downloaded
        if (!meta && hasData(local)) offerCopy(local, 'This browser held an account saved before you signed in. Your server account was loaded instead.');
        await applyServer(srv.data); rev = sRev; dirty = false;
      } else if (meta && meta.user !== user) { await applyServer(null); rev = 0; dirty = false; }   // another user's copy
      else { rev = 0; dirty = true; }                                                                // first sign-in: upload this browser's account
    } else if (meta.dirty && sRev === (meta.rev | 0)) { rev = sRev; dirty = true; }               // changes made here while offline
    else if (meta.dirty) {
      offerCopy(local, `Your account was also saved from another device${savedAt ? ' (' + new Date(savedAt).toLocaleString() + ')' : ''}. That copy was loaded; the changes made only in this browser can be downloaded.`);
      await applyServer(srv.data); rev = sRev; dirty = false;
    } else if (sRev !== (meta.rev | 0)) { await applyServer(srv.data); rev = sRev; dirty = false; } // newer on the server
    else { rev = sRev; dirty = false; }
    if (held) status = dirty ? 'pending' : 'synced';
    try { lastJ = JSON.stringify(store.get()); } catch (e) { lastJ = null; }
    writeMeta();
  })().catch(e => { console.error('[tradeBerry] server sync load failed:', e); });

  /* ---------- save: the writer tab sends each change ---------- */
  function mark(ms = PUSH_MS, market = false) {
    if (!mayTrack()) return;
    if (market) { gm++; mDirty = true; }
    else {
      gen++;
      if (!dirty) { dirty = true; writeMeta(); }
      if (status === 'synced') status = 'pending';
      ui();
    }
    if (status === 'conflict' || status === 'signedout' || status === 'toolarge' || !held) return; // no lease yet: renew() gets it
    // an account change brings a pending market-only push forward
    if (timer && ms < (timerMs || 0)) { clearTimeout(timer); timer = 0; }
    if (!timer) { timerMs = ms; timer = setTimeout(() => { timer = 0; push(); }, ms); }
  }
  // the app saves every few seconds, mostly with nothing new: only a real change of the account counts
  let lastJ = null;
  store.set = v => {
    if (frozen) return;
    orig.set(v);
    let j = null; try { j = JSON.stringify(v); } catch (e) { /* persist.js reports it */ }
    if (j !== null && j === lastJ) return;
    lastJ = j; mark();
  };
  store.clear = () => { if (frozen) return; orig.clear(); lastJ = null; mark(); };
  store.setMarket = snap => { if (frozen) return; orig.setMarket(snap); mark(MARKET_MS, true); };

  async function push(keepalive) {
    clearTimeout(timer); timer = 0;
    if (!mayWrite() || (!dirty && !mDirty) || status === 'conflict' || status === 'signedout') return;
    if (inflight) { again = true; return inflight; }
    // a tab that became the writer: the revision the old writer reached is in the shared meta
    const m0 = readMeta(); if (m0 && m0.user === user && (m0.rev | 0) > rev) rev = m0.rev | 0;
    const g = gen, h = gm, base = rev, sendAcct = dirty, sendMkt = mDirty;
    let acct = null, mkt = null;
    try {
      const mm = store.getMarket(), mNow = mm && typeof mm.then !== 'function' ? mm : null;
      if (sendAcct) acct = JSON.stringify({ base, state: store.get(), market: mNow });
      if (sendMkt && !sendAcct) { const m = store.getMarket(); if (m && typeof m.then !== 'function') mkt = JSON.stringify({ market: m }); }
    } catch (e) { console.error('[tradeBerry] account not serialisable:', e); return; }
    if (sendAcct) { status = 'syncing'; ui(); }
    const ka = body => !!keepalive && body.length < KEEPALIVE_MAX;
    inflight = (async () => {
      try {
        if (acct) {
          const r = await api('/api/state', { method: 'PUT', body: acct, keepalive: ka(acct) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) { rev = j.rev | 0; savedAt = (j.savedAt | 0) * 1000; if (gen === g) dirty = false; if (gm === h) mDirty = false; status = dirty ? 'pending' : 'synced'; lastErr = ''; writeMeta(); }
          else if (r.status === 409) {
            // the other device saved the very same account (e.g. both added the same defaults): nothing to choose
            if (await sameAsServer()) { if (gen === g) dirty = false; status = dirty ? 'pending' : 'synced'; writeMeta(); }
            else { status = 'conflict'; conflict(j); return; }
          }
          else if (r.status === 401) { status = 'signedout'; signedOut(); return; }
          else if (r.status === 423) { lost(j); return; }
          else if (r.status === 413) { status = 'toolarge'; lastErr = j.error || 'Account too large to sync'; tell('Not synced to the server', lastErr + '. It stays saved in this browser; Export keeps a copy.', 'dn'); return; }
          else throw new Error(j.error || 'HTTP ' + r.status);
        }
        if (mkt) {
          const r = await api('/api/market', { method: 'PUT', body: mkt, keepalive: ka(mkt) });
          if (r.ok) { if (gm === h) mDirty = false; }
          else if (r.status === 401) { status = 'signedout'; signedOut(); return; }
          else if (r.status === 423) { lost(await r.json().catch(() => ({}))); return; }
          else if (r.status !== 413) throw new Error('HTTP ' + r.status);
          else mDirty = false; // a market that large is not worth retrying; the account is what matters
        }
        retryMs = 5000;
        if (status === 'offline') status = dirty ? 'pending' : 'synced';
      } catch (e) {
        status = 'offline'; lastErr = navigator.onLine === false ? 'You are offline' : 'The server did not answer';
        retryMs = Math.min(retryMs * 2, 60000);
        if (!timer) timer = setTimeout(() => { timer = 0; push(); }, retryMs);
      } finally { inflight = null; ui(); }
      if (again) { again = false; if ((dirty || mDirty) && (status === 'pending' || status === 'synced')) push(); }
    })();
    return inflight;
  }
  // the page goes to the background or away: send what is pending now
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && (dirty || mDirty)) push(true); });
  addEventListener('pagehide', () => { if (dirty || mDirty) push(true); });
  addEventListener('online', () => { if ((dirty || mDirty) && status === 'offline') push(); });
  // a device left open: once a minute (while in front) look for an account saved from another device
  async function check() {
    if (!on || !mayWrite() || !held || document.visibilityState !== 'visible' || status !== 'synced' || dirty || !bar.hidden) return;
    try {
      const r = await api('/api/state?meta=1'); if (!r.ok) { if (r.status === 401) { status = 'signedout'; signedOut(); ui(); } return; }
      const j = await r.json();
      if ((j.rev | 0) > rev && !dirty && !(await sameAsServer())) newer(j);
    } catch (e) { /* offline: the next save says so */ }
  }
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });

  /* ---------- one device at a time ---------- */
  async function renew() {
    if (!on || (store.readOnly && store.readOnly()) || status === 'elsewhere' || status === 'signedout') return;
    if (!held) return reacquire();
    try {
      const r = await api('/api/lease', { method: 'POST', body: '{}' });
      if (r.status === 423) lost(await r.json().catch(() => ({})));
      else if (r.status === 401 && status !== 'signedout') { status = 'signedout'; signedOut(); ui(); }
    } catch (e) { /* offline: the lease runs out after 2 minutes and another device may take it */ }
  }
  setInterval(renew, RENEW_MS);
  addEventListener('online', () => { if (on && !held) reacquire(); });
  // a tab that started read-only, offline or before the server answered: get the lease now and line up with the server
  let reacq = null;
  function reacquire() {
    if (reacq) return reacq;
    reacq = (async () => {
      try {
        const r = await api('/api/lease', { method: 'POST', body: '{}' });
        if (r.status === 423) { held = true; lost(await r.json().catch(() => ({}))); return; }
        if (r.status === 401) { status = 'signedout'; signedOut(); return; }
        if (!r.ok) return;
        held = true;
        const m0 = readMeta(); if (m0 && m0.user === user && (m0.rev | 0) > rev) rev = m0.rev | 0;
        const j = await (await api('/api/state?meta=1')).json();
        if ((j.rev | 0) > rev) {
          if (await sameAsServer()) { dirty = false; status = 'synced'; writeMeta(); }
          else if (dirty) { status = 'conflict'; conflict(j); }
          else { status = 'synced'; newer(j); }
        } else { status = dirty ? 'pending' : 'synced'; if (dirty) push(); }
      } catch (e) { status = 'offline'; lastErr = 'No connection to the server'; }
      finally { reacq = null; ui(); }
    })();
    return reacq;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renew(); });
  function lost(j) {
    if (!held) return;
    held = false; elsewhereSince = ((j && j.since) | 0) * 1000 || Date.now(); status = 'elsewhere';
    clearTimeout(timer); timer = 0;
    if (dirty) keepCopy(user, store.get());
    dirty = false; mDirty = false; writeMeta();
    away(); ui();
  }
  // stopped: no market, no trading; the account stays on screen as it was
  const over = document.createElement('div');
  over.id = 'cloudAway'; over.hidden = true; over.setAttribute('role', 'dialog'); over.setAttribute('aria-modal', 'true'); over.setAttribute('aria-labelledby', 'cloudAwayT');
  over.style.cssText = 'position:fixed;inset:0;z-index:3000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(5,7,10,.72)';
  document.body.appendChild(over);
  function away() {
    try { Engine.speed = 0; } catch (e) { /* engine missing */ }
    const when = elsewhereSince ? new Date(elsewhereSince).toLocaleString() : 'recently';
    over.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:440px;width:100%;background:var(--s1);color:var(--tx);border:1px solid var(--line2);border-radius:12px;padding:22px';
    const h = document.createElement('h2'); h.id = 'cloudAwayT'; h.style.cssText = 'margin:0 0 8px;font-size:17px'; h.textContent = 'Your account is open on another device';
    const p = document.createElement('p'); p.style.cssText = 'margin:0 0 16px;color:var(--tx2);font-size:13.5px;line-height:1.5';
    p.textContent = `It was opened there ${when}. One device runs an account at a time, because each one runs its own simulated market. This one is stopped and shows the account as it was saved. Use it here to continue on this device: the other one stops.`;
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'sm'; go.textContent = 'Use it here';
    go.addEventListener('click', takeHere);
    row.appendChild(go);
    const kept = keptCopy(user);
    if (kept) {
      const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'ghost sm'; dl.textContent = 'Download the changes made here';
      dl.title = 'Changes made in this browser that never reached the server (kept here until you download them)';
      dl.addEventListener('click', () => { download(kept.state, `tradeberry-this-device-${new Date().toISOString().slice(0, 10)}.json`); dropKept(user); dl.remove(); });
      row.appendChild(dl);
    }
    const so = document.createElement('button'); so.type = 'button'; so.className = 'ghost sm'; so.textContent = 'Sign out'; so.addEventListener('click', signOut);
    row.appendChild(so);
    card.append(h, p, row); over.appendChild(card);
    over.hidden = false; over.style.display = 'flex';
    go.focus();
  }
  async function takeHere() {
    const b = over.querySelector('button'); if (b) { b.disabled = true; b.textContent = 'Opening…'; }
    try {
      const r = await api('/api/lease', { method: 'POST', body: '{"take":true}' }); if (!r.ok) throw new Error('HTTP ' + r.status);
      held = true; await loadServerCopy();
    } catch (e) { held = false; if (b) { b.disabled = false; b.textContent = 'Use it here'; } tell('Could not open the account here', 'Check the connection and try again.', 'dn'); }
  }
  // a trade asked of a stopped device: refused out loud (keyboard shortcuts reach past the overlay)
  for (const name of ['openPosition', 'placeOrder', 'closePosition']) {
    const f = window[name]; if (typeof f !== 'function') continue;
    window[name] = function () { if (status === 'elsewhere') { tell('Account open on another device', 'Use it here to trade on this device.', 'dn'); return null; } return f.apply(this, arguments); };
  }

  /* ---------- what the user decides ---------- */
  const bar = document.createElement('div');
  bar.id = 'cloudBar'; bar.setAttribute('role', 'alert'); bar.hidden = true;
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2000;display:none;gap:10px 14px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 16px;background:var(--s3);color:var(--tx);border-top:1px solid var(--acc);font-size:13px';
  document.body.appendChild(bar);
  function showBar(text, buttons) {
    bar.textContent = '';
    const s = document.createElement('span'); s.textContent = text; bar.appendChild(s);
    for (const [label, fn, primary] of buttons) { const b = document.createElement('button'); b.type = 'button'; b.className = primary ? 'sm' : 'ghost sm'; b.textContent = label; b.addEventListener('click', fn); bar.appendChild(b); }
    bar.hidden = false; bar.style.display = 'flex';
  }
  const hideBar = () => { bar.hidden = true; bar.style.display = 'none'; };
  function download(state, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'meridian-fx', version: 1, exported: new Date().toISOString(), state }, null, 1)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function offerCopy(state, text) {
    if (!hasData(state)) return;
    const name = `tradeberry-this-browser-${new Date().toISOString().slice(0, 10)}.json`;
    const show = () => showBar(text, [['Download that copy', () => { download(state, name); hideBar(); }, true], ['Dismiss', hideBar]]);
    // after boot, so the bar is not covered by the boot screen
    const wait = () => { const b = document.getElementById('boot'); if (b && !b.classList.contains('done')) return setTimeout(wait, 300); show(); };
    wait();
  }
  function showBarAfterBoot(text, state) {
    const name = `tradeberry-unsent-${new Date().toISOString().slice(0, 10)}.json`;
    const wait = () => { const b = document.getElementById('boot'); if (b && !b.classList.contains('done')) return setTimeout(wait, 300); showBar(text, [['Download them', () => { download(state, name); dropKept(user); hideBar(); }, true], ['Discard', () => { if (confirm('Discard these changes for good?')) { dropKept(user); hideBar(); } }]]); };
    wait();
  }
  function conflict(j) {
    const when = j && j.savedAt ? new Date(j.savedAt * 1000).toLocaleString() : 'just now';
    showBar(`Your account was saved from another device (${when}) while this one had changes. Which copy do you keep?`, [
      ['Load the other device’s copy (this one is downloaded)', async () => {
        hideBar();
        try { offerCopyNow(); await loadServerCopy(); }
        catch (e) { status = 'conflict'; conflict(j); tell('Could not load the other copy', 'Check the connection and try again.', 'dn'); }
      }, true],
      ['Keep this one', () => { hideBar(); rev = j.rev | 0; status = 'pending'; dirty = true; writeMeta(); push(); }]
    ]);
    function offerCopyNow() { const s = store.get(); if (hasData(s)) download(s, `tradeberry-this-device-${new Date().toISOString().slice(0, 10)}.json`); }
  }
  // the server copy equals this browser's account: take its revision and say nothing
  async function sameAsServer() {
    try {
      const r = await api('/api/state'); if (!r.ok) return false;
      const srv = await r.json();
      if (canon(srv.data && srv.data.state) !== canon(store.get())) return false;
      rev = srv.rev | 0; savedAt = (srv.savedAt | 0) * 1000; return true;
    } catch (e) { return false; }
  }
  async function loadServerCopy() {
    const r = await api('/api/state'); if (!r.ok) throw new Error('HTTP ' + r.status);
    const srv = await r.json(); await applyServer(srv.data); rev = srv.rev | 0; dirty = false; writeMeta(); frozen = true; location.reload();
  }
  function newer(j) {
    const when = j.savedAt ? new Date(j.savedAt * 1000).toLocaleString() : 'recently';
    showBar(`Your account was saved from another device (${when}). Load that copy here?`, [
      ['Load it', async () => { hideBar(); try { await loadServerCopy(); } catch (e) { tell('Could not load the other copy', 'Check the connection and try again.', 'dn'); } }, true],
      ['Not now', hideBar]
    ]);
  }
  function signedOut() {
    showBar('You were signed out. Changes made since are kept in this browser and go to the server after you sign in again.', [['Sign in again', () => { store.flush().finally(() => location.reload()); }, true]]);
  }
  async function signOut() {
    if (!on) return;
    if (dirty && status !== 'signedout') { await push(); }
    const kept = keptCopy(user);
    if ((dirty || kept) && !confirm('Some changes made here are not on the server' + (kept ? ' (a copy kept from when the account was open on another device)' : '') + '. If you sign out now they are lost from this browser. Sign out anyway?')) return;
    // the session must end on the server, or the next person at this computer would be signed in as this user
    let okOut = false;
    try { const r = await timed(api('/api/logout', { method: 'POST', body: '{}' }), 8000); okOut = r.ok || r.status === 401; } catch (e) { okOut = false; }
    if (!okOut) { tell('Not signed out', 'The server did not answer, so the session is still open. Check the connection and try Sign out again.', 'dn'); return; }
    dropKept(user);
    frozen = true;
    try { orig.clear(); await store.flush(); } catch (e) { console.error(e); }
    dropMeta();
    try { if (window.caches) for (const k of await caches.keys()) if (k.startsWith('mfx-shell-')) await caches.delete(k); } catch (e) { /* ignore */ }
    location.href = '/';
  }

  /* ---------- status in the status bar and in Help ---------- */
  const TEXT = { elsewhere: 'Open on another device', synced: 'Synced', pending: 'Saving…', syncing: 'Saving…', offline: 'Not synced', conflict: 'Conflict', signedout: 'Signed out', toolarge: 'Not synced' };
  const pill = document.createElement('button');
  pill.type = 'button'; pill.id = 'cloudPill'; pill.className = 'pill'; pill.hidden = true;
  pill.addEventListener('click', () => { const h = document.getElementById('help'); if (h) h.hidden = false; });
  const note = document.createElement('p'); note.className = 'muted small'; note.id = 'cloudNote'; note.hidden = true;
  const out = document.createElement('button'); out.type = 'button'; out.className = 'ghost sm'; out.id = 'signOutBtn'; out.textContent = 'Sign out'; out.hidden = true;
  out.addEventListener('click', signOut);
  function explain() {
    const at = savedAt ? ` Last saved on the server ${new Date(savedAt).toLocaleString()}.` : '';
    return ({
      synced: shared ? `Signed in as ${user}, a login shared by several people. This browser has its own portfolio, saved on the server for this browser only: others using the same login do not see it, and another browser starts its own.${at}`
        : `Signed in as ${user}. Your account is saved on the server under your user and loads in any browser where you sign in; this browser keeps a copy too.${at}`,
      pending: `Signed in as ${user}. The latest changes are saved in this browser and are being sent to the server.${at}`,
      syncing: `Signed in as ${user}. Sending the latest changes to the server.${at}`,
      offline: `Signed in as ${user}. ${lastErr || 'No connection to the server'}: changes are kept in this browser and sent when the connection is back.${at}`,
      conflict: `Signed in as ${user}. The account was saved from another device while this one had changes: choose which copy to keep (bar at the bottom).`,
      signedout: `Your session ended. Changes are kept in this browser and go to the server after you sign in again.`,
      toolarge: `Signed in as ${user}. ${lastErr}. The account stays saved in this browser; Export keeps a copy.`,
      elsewhere: `Signed in as ${user}. The account is open on another device, so this one is stopped and does not save. Use it here to continue on this device.`
    })[status] || '';
  }
  function ui() {
    if (!on) return;
    const bad = status === 'elsewhere' || status === 'offline' || status === 'conflict' || status === 'signedout' || status === 'toolarge';
    pill.hidden = false; pill.textContent = `${user || 'Account'} · ${TEXT[status] || ''}`; pill.title = explain();
    pill.classList.toggle('st-bad', bad);
    note.hidden = false; note.textContent = explain();
    out.hidden = false;
  }
  store.ready.then(() => {
    if (!on) return;
    const pp = document.getElementById('persistPill'); if (pp) pp.after(pill); else { const sb = document.getElementById('statusbar'); if (sb) sb.prepend(pill); }
    const pn = document.getElementById('persistNote'); if (pn && pn.parentNode) pn.parentNode.after(note);
    const acts = document.querySelector('#help .acct-actions'); if (acts) acts.appendChild(out);
    ui();
    if (status === 'signedout') signedOut();
    { const k = status !== 'elsewhere' && keptCopy(user); if (k) showBarAfterBoot(`Changes made in this browser on ${new Date(k.at).toLocaleString()} never reached the server (the account was open elsewhere, or another user signed in here). Download them to keep them.`, k.state); }
    if (status === 'elsewhere') { const wait = () => { const b = document.getElementById('boot'); if (b && !b.classList.contains('done')) return setTimeout(wait, 200); away(); }; wait(); }
    if (dirty) push();
  });
  store.cloud = () => ({ on, user, rev, dirty, status, held, device });
})();
