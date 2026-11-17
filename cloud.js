/* tradeBerry — the signed-in user's interface preferences on the server (host/server.mjs + functions/api/state.js).
   The trading account itself (balance, positions, orders, history) lives on the execution server and reaches the page
   through tradelink.js; it is never saved here. What is saved here are the interface preferences (app.js prefsOf:
   settings except the execution ones, ticket, watchlist, drawings, lines, pre-mortem and tilt, tool settings), per key:
   every save sends only the keys that changed (PUT /api/state {base, prefs}); the server merges them into the stored
   copy key by key and the last writer of a key wins. No device holds the account, so nothing is stopped and nothing
   asks "which copy": any number of browsers can be open at once. At load the server's preferences go over this
   browser's (keys changed here and not sent yet stay and go first).
   Served without the API (a static server, file://, the tests): nothing changes and nothing is shown.
   localStorage 'tb-sync' = {user, rev, dirty: [keys not sent yet]}; 'tb-device' = this browser's random device id
   (a shared login keeps one set of preferences, and one portfolio, per browser). */
(function () {
  if (typeof store !== 'object' || !store) return;
  // served without the account server (a static copy, the tests): stay out of the way, not even a request.
  // tb_u=1 is set by the server with each signed-in page; a browser that synced before may boot offline without it
  const served = (() => { try { return /(?:^|;\s*)tb_u=1(?:;|$)/.test(document.cookie) || !!localStorage.getItem('tb-sync'); } catch (e) { return false; } })();
  if (!served) return;
  // preference changes go within seconds; the market alone (saved every few seconds while it runs) at most every 30 s
  const META = 'tb-sync', DEV = 'tb-device', PUSH_MS = 4000, MARKET_MS = 30000, KEEPALIVE_MAX = 60000;
  const orig = { ready: store.ready, set: store.set, clear: store.clear, setMarket: store.setMarket };
  const tell = (t, b, k) => { try { toast(t, b, k); } catch (e) { console.warn('[tradeBerry]', t, b); } };
  const readMeta = () => { try { const v = JSON.parse(localStorage.getItem(META) || 'null'); return v && typeof v.user === 'string' ? v : null; } catch (e) { return null; } };
  const writeMeta = () => { try { localStorage.setItem(META, JSON.stringify({ user, rev, dirty: [...dirtyK] })); } catch (e) { /* the server copy still syncs; a reload compares again */ } };
  const dropMeta = () => { try { localStorage.removeItem(META); } catch (e) { /* ignore */ } };
  const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const device = (() => { let d = null; try { d = localStorage.getItem(DEV); } catch (e) { /* no storage: one id per page */ } if (!d || !/^[a-z0-9]{12,40}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('') + Date.now().toString(36); try { localStorage.setItem(DEV, d); } catch (e) { /* ignore */ } } return d; })();
  const api = (path, opt = {}) => fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opt, headers: { 'Content-Type': 'application/json', 'X-TB-Device': device, ...(opt.headers || {}) } });
  const hasData = s => !!(s && ((s.history && s.history.length) || (s.positions && s.positions.length) || (s.orders && s.orders.length)));

  // dirtyK: preference keys changed here and not on the server yet; sentJ: each key as the server has it (JSON)
  let on = false, user = null, rev = 0, mDirty = false, timer = 0, inflight = null, again = false, retryMs = 5000;
  let shared = false, admin = false, modules = []; // a login several people use: every browser keeps its own preferences and portfolio
  let status = 'local', savedAt = 0, frozen = false, lastErr = '';
  const dirtyK = new Set(), sentJ = new Map();
  const mayTrack = () => on && !frozen && status !== 'signedout' && !(store.readOnly && store.readOnly());
  const dirty = () => dirtyK.size > 0;
  const keysOf = v => { const p = prefsOf(v || {}), out = new Map(); for (const [k, x] of Object.entries(p)) { try { out.set(k, JSON.stringify(x)); } catch (e) { /* persist.js reports it */ } } return out; };

  /* ---------- load: the server's preferences over this browser's ---------- */
  store.ready = (async () => {
    await orig.ready;
    const meta = readMeta();
    let me = null;
    try {
      const r = await timed(api('/api/me'), 6000);
      if (r.ok && (r.headers.get('Content-Type') || '').includes('json')) me = await r.json();
      else if (r.status === 401) { if (!meta) return; on = true; user = meta.user; rev = meta.rev | 0; status = 'signedout'; return; }
      else return; // no API here: a static copy of the app, browser storage only
    } catch (e) {
      if (!meta) return;
      on = true; user = meta.user; rev = meta.rev | 0; (meta.dirty || []).forEach(k => dirtyK.add(k)); status = 'offline'; lastErr = 'No connection to the server';
      return;
    }
    if (!me || typeof me.username !== 'string') return;
    on = true; user = me.username; shared = !!me.shared; admin = !!me.admin; modules = Array.isArray(me.modules) ? me.modules : [];
    const mine = !!(meta && meta.user === user);
    if (mine && Array.isArray(meta.dirty)) meta.dirty.forEach(k => dirtyK.add(k));
    let srv;
    try { const r = await timed(api('/api/state'), 10000); if (!r.ok) throw new Error('HTTP ' + r.status); srv = await r.json(); }
    catch (e) { rev = mine ? meta.rev | 0 : 0; status = 'offline'; lastErr = 'Could not read your preferences from the server'; return; }
    const local = store.get() || {}, sp = srv.data && srv.data.state && typeof srv.data.state === 'object' ? prefsOf(srv.data.state) : {};
    rev = srv.rev | 0; savedAt = (srv.savedAt | 0) * 1000;
    // a browser that held an account before signing in, or another user's: that account is not this user's (the
    // server's is); it can be downloaded, never mixed in
    if (!meta && hasData(local)) offerCopy(local, 'This browser held an account saved before you signed in. Your account on the server is shown instead; that copy can be downloaded.');
    // another user's copy is never offered (security audit 09.11.2026, F10: on a shared computer the next user could
    // download it): it is replaced below by this user's, and the page only says so
    if (meta && !mine && hasData(local)) afterBoot(() => showBar('This browser held another user\'s data from an earlier session. It was cleared; your own account is shown.', [['OK', hideBar, true]]));
    // another user's copy (or an account from before the sign-in) is not shown even as "last seen": a fresh start
    const next = mine ? { ...local } : JSON.parse(JSON.stringify(DEF));
    if (!mine) dirtyK.clear();
    for (const [k, v] of Object.entries(sp)) if (!dirtyK.has(k)) next[k] = k === 'set' && next.set ? { ...next.set, ...v } : v;
    frozen = true;
    try { orig.set(next); if (srv.data && srv.data.market) orig.setMarket(srv.data.market); await store.flush(); } finally { frozen = false; }
    for (const [k, v] of Object.entries(sp)) sentJ.set(k, JSON.stringify(v));
    status = dirty() ? 'pending' : 'synced';
    writeMeta();
  })().catch(e => { console.error('[tradeBerry] server sync load failed:', e); });

  /* ---------- save: the keys that changed ---------- */
  // a preference change brings a pending market-only push forward
  let timerAt = 0;
  function schedule(ms) {
    if (status === 'signedout' || status === 'toolarge') return;
    if (timer && Date.now() + ms < timerAt) { clearTimeout(timer); timer = 0; }
    if (!timer) { timerAt = Date.now() + ms; timer = setTimeout(() => { timer = 0; push(); }, ms); }
  }
  store.set = v => {
    if (frozen) return;
    orig.set(v);
    if (!mayTrack()) return;
    let n = 0;
    for (const [k, j] of keysOf(v)) if (sentJ.get(k) !== j && !dirtyK.has(k)) { dirtyK.add(k); n++; }
    if (!n) return;
    writeMeta(); if (status === 'synced') status = 'pending'; ui(); schedule(PUSH_MS);
  };
  store.clear = () => { if (frozen) return; orig.clear(); };
  store.setMarket = snap => { if (frozen) return; orig.setMarket(snap); if (mayTrack()) { mDirty = true; schedule(MARKET_MS); } };

  async function push(keepalive) {
    clearTimeout(timer); timer = 0;
    if (!mayTrack() || (!dirty() && !mDirty)) return;
    if (inflight) { again = true; return inflight; }
    const cur = keysOf(store.get()), keys = [...dirtyK].filter(k => cur.has(k)), prefs = {};
    for (const k of keys) prefs[k] = JSON.parse(cur.get(k));
    for (const k of [...dirtyK]) if (!cur.has(k)) dirtyK.delete(k);
    let body = null, mkt = null;
    try {
      if (keys.length) body = JSON.stringify({ base: rev, prefs });
      if (mDirty && !keys.length) { const m = store.getMarket(); if (m && typeof m.then !== 'function') mkt = JSON.stringify({ market: m }); }
    } catch (e) { console.error('[tradeBerry] preferences not serialisable:', e); return; }
    if (body) { status = 'syncing'; ui(); }
    const ka = b => !!keepalive && b.length < KEEPALIVE_MAX;
    inflight = (async () => {
      try {
        if (body) {
          const r = await api('/api/state', { method: 'PUT', body, keepalive: ka(body) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) {
            rev = j.rev | 0; savedAt = (j.savedAt | 0) * 1000; lastErr = '';
            for (const k of keys) { const s = JSON.stringify(prefs[k]); sentJ.set(k, s); if (cur.get(k) === s && (keysOf(store.get()).get(k) === s)) dirtyK.delete(k); }
            status = dirty() ? 'pending' : 'synced'; writeMeta();
          }
          else if (r.status === 401) { status = 'signedout'; signedOut(); return; }
          else if (r.status === 413) { status = 'toolarge'; lastErr = j.error || 'Preferences too large to sync'; tell('Preferences not synced', lastErr + '. They stay saved in this browser; Export keeps a copy.', 'dn'); return; }
          else throw new Error(j.error || 'HTTP ' + r.status);
        }
        if (mkt) {
          const r = await api('/api/market', { method: 'PUT', body: mkt, keepalive: ka(mkt) });
          if (r.ok || r.status === 413) mDirty = false;
          else if (r.status === 401) { status = 'signedout'; signedOut(); return; }
          else throw new Error('HTTP ' + r.status);
        }
        retryMs = 5000;
        if (status === 'offline') status = dirty() ? 'pending' : 'synced';
      } catch (e) {
        status = 'offline'; lastErr = navigator.onLine === false ? 'You are offline' : 'The server did not answer';
        retryMs = Math.min(retryMs * 2, 60000);
        if (!timer) timer = setTimeout(() => { timer = 0; push(); }, retryMs);
      } finally { inflight = null; ui(); }
      if (again) { again = false; if (dirty() || mDirty) push(); }
    })();
    return inflight;
  }
  // the page goes to the background or away: send what is pending now
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && (dirty() || mDirty)) push(true); });
  addEventListener('pagehide', () => { if (dirty() || mDirty) push(true); });
  addEventListener('online', () => { if ((dirty() || mDirty) && status === 'offline') push(); });

  /* ---------- what the user is told ---------- */
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
    afterBoot(() => showBar(text, [['Download that copy', () => { download(state, name); hideBar(); }, true], ['Dismiss', hideBar]]));
  }
  // after boot, so the bar is not covered by the boot screen
  function afterBoot(show) { const wait = () => { const b = document.getElementById('boot'); if (b && !b.classList.contains('done')) return setTimeout(wait, 300); show(); }; wait(); }
  function signedOut() {
    showBar('You were signed out. Preference changes made since are kept in this browser and go to the server after you sign in again.', [['Sign in again', () => { store.flush().finally(() => location.reload()); }, true]]);
  }
  async function signOut() {
    if (!on) return;
    if (dirty() && status !== 'signedout') { await push(); }
    if (dirty() && !confirm('Some preference changes made here are not on the server. If you sign out now they are lost from this browser. Sign out anyway?')) return;
    // the session must end on the server, or the next person at this computer would be signed in as this user
    let okOut = false;
    try { const r = await timed(api('/api/logout', { method: 'POST', body: '{}' }), 8000); okOut = r.ok || r.status === 401; } catch (e) { okOut = false; }
    if (!okOut) { tell('Not signed out', 'The server did not answer, so the session is still open. Check the connection and try Sign out again.', 'dn'); return; }
    frozen = true;
    try { orig.clear(); await store.flush(); } catch (e) { console.error(e); }
    dropMeta();
    try { if (window.caches) for (const k of await caches.keys()) if (k.startsWith('mfx-shell-')) await caches.delete(k); } catch (e) { /* ignore */ }
    location.href = '/';
  }

  /* ---------- status in the status bar and in Help ---------- */
  const TEXT = { synced: 'Synced', pending: 'Saving…', syncing: 'Saving…', offline: 'Not synced', signedout: 'Signed out', toolarge: 'Not synced' };
  const pill = document.createElement('button');
  pill.type = 'button'; pill.id = 'cloudPill'; pill.className = 'pill'; pill.hidden = true;
  pill.addEventListener('click', () => { const h = document.getElementById('help'); if (h) h.hidden = false; });
  const note = document.createElement('p'); note.className = 'muted small'; note.id = 'cloudNote'; note.hidden = true;
  const out = document.createElement('button'); out.type = 'button'; out.className = 'ghost sm'; out.id = 'signOutBtn'; out.textContent = 'Sign out'; out.hidden = true;
  out.addEventListener('click', signOut);
  function explain() {
    const at = savedAt ? ` Preferences last saved on the server ${new Date(savedAt).toLocaleString()}.` : '';
    const acct = 'Your trading account runs on the execution server: any browser where you sign in shows it and can trade it.';
    return ({
      synced: shared ? `Signed in as ${user}, a login shared by several people. This browser has its own portfolio on the execution server and its own preferences: others using the same login do not see them, and another browser starts its own.${at}`
        : `Signed in as ${user}. ${acct} Your interface preferences are saved on the server too.${at}`,
      pending: `Signed in as ${user}. ${acct} The latest preference changes are being sent to the server.${at}`,
      syncing: `Signed in as ${user}. ${acct} Sending the latest preference changes to the server.${at}`,
      offline: `Signed in as ${user}. ${lastErr || 'No connection to the server'}: preference changes are kept in this browser and sent when the connection is back.${at}`,
      signedout: `Your session ended. Preference changes are kept in this browser and go to the server after you sign in again.`,
      toolarge: `Signed in as ${user}. ${lastErr}. Preferences stay saved in this browser; Export keeps a copy.`
    })[status] || '';
  }
  function ui() {
    if (!on) return;
    const bad = status === 'offline' || status === 'signedout' || status === 'toolarge';
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
    if (dirty()) push();
  });
  /* ---------- Administration (users.admin = 1): the accounts of the server, managed from the app (/api/admin) ---------- */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = t => t ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
  const genPw = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
  async function adm(op, username, extra = {}) {
    try {
      const r = await timed(api('/api/admin', { method: 'POST', body: JSON.stringify({ op, username, ...extra }) }), 10000), j = await r.json().catch(() => ({}));
      if (!r.ok) { tell('Not done', j.error || 'HTTP ' + r.status, 'dn'); return false; }
      return true;
    } catch (e) { tell('Not done', 'No answer from the server.', 'dn'); return false; }
  }
  const MODS = [['research', 'Research'], ['lab', 'Strategy Lab'], ['coach', 'Coach']];
  /* Security log (/api/admin audit, security audit 09.11.2026 F08): the newest 100 sign-ins, sign-outs and administrator
     actions, as the server wrote them; every value is escaped (a failed sign-in's username is whatever was typed). */
  const AUDIT_WHAT = { 'login.ok': 'Signed in', 'login.fail': 'Sign-in refused', 'login.locked': 'Sign-in locked', logout: 'Signed out', 'admin.denied': 'Administration refused', 'edition.regen': 'New Opening Note asked' };
  const auditWhat = a => AUDIT_WHAT[a] || (a.startsWith('admin.') ? 'Admin · ' + a.slice(6) : a.startsWith('pricedata.') ? 'Price data · ' + a.slice(10) : a);
  function adminLog(rows) {
    if (!Array.isArray(rows)) return '';
    const tr = rows.map(r => `<tr${r.ok ? '' : ' class="adm-bad"'}><td class="mono">${esc(new Date(r.at * 1000).toISOString().slice(0, 19).replace('T', ' '))}</td><td>${esc(auditWhat(String(r.action)))}</td><td>${esc(r.actor)}</td><td>${esc(r.target || '')}</td><td class="mono">${esc(r.ip)}</td><td>${r.ok ? 'Done' : '<b class="adm-off">Refused</b>'}${r.detail ? ` <small>${esc(r.detail)}</small>` : ''}</td></tr>`).join('');
    return `<section class="adm-log"><h3>Security log <small class="muted">newest ${rows.length}, kept 400 days</small></h3>${tr ? `<table class="adm-tbl"><thead><tr><th scope="col">When (UTC)</th><th scope="col">What</th><th scope="col">By</th><th scope="col">Account</th><th scope="col">Address</th><th scope="col">Result</th></tr></thead><tbody>${tr}</tbody></table>` : '<p class="adm-foot">Nothing logged yet.</p>'}</section>`;
  }
  const admTabs = on => `<div class="adm-tabs" role="tablist">${[['users', 'Accounts'], ['data', 'Price data']].map(([k, n]) => `<button type="button" role="tab" data-a="tab" data-t="${k}" aria-selected="${k === on}"${k === on ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
  /* Price data (/api/pricedata): the tick recorder, its gaps and the platform-history archive on the Mac mini. Every value
     shown is read from the server; while this tab is open it is read again every 5 s. */
  let pdTimer = 0;
  const gb = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
  const ms = t => t ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : '—';
  const dur = m => { m = Math.round(m / 60000); return m < 60 ? m + ' min' : m < 2880 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.round(m / 1440) + ' days'; };
  async function adminData(quiet) {
    clearTimeout(pdTimer);
    const el = document.getElementById('adminDlg'); if (!el || el.hidden) return;
    const box = el.querySelector('.adm-pd');
    let d;
    try { const r = await timed(api('/api/pricedata'), 10000); d = await r.json(); if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status); }
    catch (e) { if (box) box.querySelector('.adm-pd-st').textContent = 'Could not read the price data: ' + e.message; pdTimer = setTimeout(() => adminData(true), 5000); return; }
    if (!el.querySelector('.adm-pd') || el.hidden) return;
    const R = d.recorder, A = d.archive, syms = Object.entries(A.syms || {}), run = A.run && A.pid ? A.run : null;
    const n1 = syms.filter(([, v]) => v[1] && v[1].n).length, n60 = syms.filter(([, v]) => v[60] && v[60].n).length, bars = syms.reduce((n, [, v]) => n + ((v[1] && v[1].n) || 0) + ((v[60] && v[60].n) || 0), 0);
    const bad = syms.flatMap(([k, v]) => [1, 60].filter(r => v[r] && v[r].err).map(r => `${esc(k)} ${r === 60 ? '1h' : '1m'}: ${esc(v[r].err)}`));
    const L = A.last;
    const state = run ? `<b class="adm-live">Importing</b> ${esc(run.op === 'gaps' ? '1-minute bars (fill gaps)' : run.op === 'one' ? run.sym : 'all instruments')} · ${run.done}/${run.total} · now ${esc(run.cur || '')} · since ${ms(run.start)}`
      : A.stopped ? `The import started ${ms(A.stopped.start)} stopped before finishing (${A.stopped.done}/${A.stopped.total}).`
      : L ? (L.error ? `Last import ${ms(L.start)} failed: ${esc(L.error)}` : `Last import ${ms(L.end)} (${esc(L.op === 'gaps' ? 'fill gaps' : L.op === 'one' ? L.sym : 'all')}): ${L.ok} done, ${L.failed} failed, ${L.added.toLocaleString()} bars added`)
      : 'Nothing imported yet.';
    const gaps = d.gaps.map(g => `<tr><td class="mono">${ms(g.start)}</td><td class="mono">${g.ongoing ? '<b class="adm-off">now (recorder not hearing the platform)</b>' : ms(g.end)}</td><td class="mono">${dur(g.end - g.start)}</td><td>${g.ongoing ? '—' : g.of ? `1-minute bars for ${g.covered} of ${g.of} instruments` : 'no 1-minute archive yet'}</td></tr>`).join('');
    el.querySelector('.adm-pd').innerHTML = `
      <section><h3>Tick recorder</h3><table class="adm-tbl adm-kv"><tbody>
        <tr><th scope="row">Status</th><td>${R.last == null ? 'Not started on this server' : R.on ? '<b class="adm-live">Recording</b>' : `<b class="adm-off">Not recording</b> since ${ms(R.last)}`}</td></tr>
        <tr><th scope="row">Last write</th><td class="mono">${ms(R.last)}</td></tr>
        <tr><th scope="row">Ticks today (UTC)</th><td class="mono">${R.today.toLocaleString()}</td></tr>
        <tr><th scope="row">Database</th><td class="mono">${gb(R.bytes)} <small>today's and yesterday's ticks</small> · ${gb(R.daysBytes)} <small>older days, compressed</small></td></tr>
        <tr><th scope="row">All price data</th><td class="mono"><b>${gb(d.total)}</b> <small>ticks ${gb(R.bytes + R.daysBytes)} + bar archive ${gb(A.bytes)}</small></td></tr>
        <tr><th scope="row">Free disk</th><td class="mono">${gb(d.disk.free)} <small>the recorder pauses below 5 GB</small></td></tr></tbody></table></section>
      <section><h3>Platform history archive</h3><p class="adm-pd-st">${state}</p>
        <table class="adm-tbl adm-kv"><tbody>
        <tr><th scope="row">Instruments</th><td class="mono">${n1} with 1-minute bars · ${n60} with 1-hour bars</td></tr>
        <tr><th scope="row">Bars</th><td class="mono">${bars.toLocaleString()} · ${gb(A.bytes)}</td></tr>
        <tr><th scope="row">Failed</th><td>${bad.length ? bad.slice(0, 8).join('<br>') + (bad.length > 8 ? `<br>… ${bad.length - 8} more` : '') : 'none'}</td></tr></tbody></table>
        <div class="adm-new"><button type="button" class="adm-go" data-a="pd-all"${run ? ' disabled' : ''}>Import all now</button>
          <label>Instrument<input name="pdsym" maxlength="20" autocapitalize="characters" spellcheck="false" placeholder="EURUSD"></label><button type="button" data-a="pd-one"${run ? ' disabled' : ''}>Import one</button>
          <button type="button" data-a="pd-gaps"${run ? ' disabled' : ''}>Fill gaps</button>
          <small>Every day at 05:30 the archive takes what is new. Charts and backtests keep reading the platform; this is a copy.</small></div></section>
      <section><h3>Recorder gaps <small>${d.gapsTotal > d.gaps.length ? `last ${d.gaps.length} of ${d.gapsTotal}` : d.gapsTotal}</small></h3>
        ${gaps ? `<table class="adm-tbl"><thead><tr><th scope="col">From (UTC)</th><th scope="col">To</th><th scope="col">Length</th><th scope="col">Covered</th></tr></thead><tbody>${gaps}</tbody></table>` : '<p class="adm-pd-st">No gaps.</p>'}
        <p class="adm-foot">The platform keeps no ticks: a gap can only be covered by its 1-minute bars (Fill gaps, or the daily import). The missing ticks themselves cannot be recovered.</p></section>`;
    if (!quiet) el.querySelector('[data-a=pd-all]')?.focus({ preventScroll: true });
    pdTimer = setTimeout(() => adminData(true), 5000);
  }
  async function pdStart(body) {
    try {
      const r = await timed(api('/api/pricedata', { method: 'POST', body: JSON.stringify(body) }), 10000), j = await r.json().catch(() => ({}));
      if (!r.ok) { tell('Not started', j.error || 'HTTP ' + r.status, 'dn'); return; }
      tell('Import started', j.started === 'all' ? 'All instruments, 1-minute and 1-hour bars. The first run takes about two hours.' : j.started === 'gaps' ? '1-minute bars since the archive\'s last ones, every instrument.' : j.started + ', 1-minute and 1-hour bars.', 'info');
    } catch (e) { tell('Not started', 'No answer from the server.', 'dn'); }
    setTimeout(() => adminData(true), 800);
  }
  function adminDataOpen() {
    const el = document.getElementById('adminDlg');
    el.innerHTML = `<div class="modal cf-modal adm-modal" role="dialog" aria-modal="true" aria-labelledby="admT">
      <div class="ph"><h2 id="admT">Administration</h2>${admTabs('data')}<span class="muted small">Ticks and price history on the server</span><button type="button" class="adm-x" data-a="close">Close</button></div>
      <div class="adm-body adm-pd"><p class="adm-pd-st">Reading the price data…</p></div></div>`;
    adminData();
  }
  /* A client's complete journal (/api/admin?journal=, server/journal.js): sign-ins, every order report from the broker,
     the order log and the closed trades, newest first, 300 at a time ("Older" reads the next page). Every value escaped. */
  const JCAT = { session: 'Session', admin: 'Administrator', order: 'Order', fill: 'Fill', cancel: 'Cancelled', reject: 'Rejected', log: 'Order log', close: 'Trade closed', other: 'Other' };
  const jn = (v, d = 5) => v == null ? '' : (+v).toLocaleString('en-US', { maximumFractionDigits: d });
  const jt = t => esc(new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' '));
  function jRow(r) {
    const pnl = r.pnl != null ? `<b class="${r.pnl >= 0 ? 'adm-live' : 'adm-off'}">${r.pnl >= 0 ? '+' : ''}${jn(r.pnl, 2)}</b>` : '';
    const px = r.cat === 'close' ? `${jn(r.entry)} → ${jn(r.px)}` : r.px != null ? jn(r.px) + (r.limit != null ? ` / ${jn(r.limit)}` : '') : '';
    const det = [r.ot, r.reason, r.status, r.code, r.text, r.actor && r.cat !== 'session' ? 'by ' + r.actor : '', r.ip, r.pips != null ? jn(r.pips, 1) + ' pips' : '', r.pos != null ? 'pos #' + r.pos : '', r.cl ? r.cl : ''].filter(Boolean).map(esc).join(' · ');
    return `<tr class="adm-j-${esc(r.cat)}${r.ok === false ? ' adm-bad' : ''}"><td class="mono">${jt(r.t)}</td><td>${esc(JCAT[r.cat] || r.cat)}</td><td>${esc(r.what || '')}</td><td class="mono">${esc(r.acc || '')}</td><td><b>${esc(r.sym || '')}</b></td><td>${esc(r.side || '')}</td><td class="mono">${r.lots != null ? jn(r.lots, 2) : ''}</td><td class="mono">${px}</td><td class="mono">${pnl}</td><td class="adm-j-det">${det}</td></tr>`;
  }
  async function adminJournal(u, before) {
    clearTimeout(pdTimer);
    const el = document.getElementById('adminDlg');
    if (!before) el.innerHTML = `<div class="modal cf-modal adm-modal" role="dialog" aria-modal="true" aria-labelledby="admT">
      <div class="ph"><h2 id="admT">Administration</h2>${admTabs('users')}<span class="muted small">Journal of <b>${esc(u)}</b> · reading…</span><button type="button" data-a="back">← Accounts</button><button type="button" class="adm-x" data-a="close">Close</button></div>
      <div class="adm-j-accts"></div>
      <div class="adm-j-filter"><span>Show</span>${['all', 'trading', 'session', 'admin'].map((k, i) => `<button type="button" data-a="jf" data-f="${k}"${i ? '' : ' class="on" aria-pressed="true"'}>${{ all: 'Everything', trading: 'Orders, fills and trades', session: 'Sign-ins', admin: 'Administrator actions' }[k]}</button>`).join('')}</div>
      <div class="adm-body"><table class="adm-tbl adm-jtbl" data-u="${esc(u)}"><thead><tr><th scope="col">When (UTC)</th><th scope="col">Type</th><th scope="col">Event</th><th scope="col">Account</th><th scope="col">Instrument</th><th scope="col">Side</th><th scope="col">Lots</th><th scope="col">Price</th><th scope="col">P&amp;L (USD)</th><th scope="col">Detail</th></tr></thead><tbody></tbody></table>
      <p class="adm-j-more"></p></div></div>`;
    let d;
    try { const r = await timed(api('/api/admin?journal=' + encodeURIComponent(u) + (before ? '&before=' + before : '') + '&limit=300'), 15000); d = await r.json(); if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status); }
    catch (e) { const s = el.querySelector('.ph .small'); if (s) s.innerHTML = `Journal of <b>${esc(u)}</b> · could not be read: ${esc(e.message)}`; return; }
    if (!el.querySelector('.adm-jtbl')) return;
    el.querySelector('.adm-jtbl tbody').insertAdjacentHTML('beforeend', d.rows.map(jRow).join(''));
    const n = el.querySelectorAll('.adm-jtbl tbody tr').length;
    el.querySelector('.ph .small').innerHTML = `Journal of <b>${esc(u)}</b> · account since ${day(d.created)} · ${n.toLocaleString()} event${n === 1 ? '' : 's'} shown${d.next ? ', older ones below' : ', all of them'}`;
    if (!before) el.querySelector('.adm-j-accts').innerHTML = d.accounts.length
      ? d.accounts.map(a => `<span><b class="mono">${esc(a.id)}</b>${a.device ? ` <small>browser ${esc(a.device.slice(0, 6))}</small>` : ''} · ${esc(a.type || '—')} · balance <b class="mono">${a.balance == null ? '—' : jn(a.balance, 2)}</b> · ${a.positions} open position${a.positions === 1 ? '' : 's'} · ${a.orders} working order${a.orders === 1 ? '' : 's'}${a.closed ? ' · <b class="adm-off">archived</b>' : ''}</span>`).join('')
      : `<span class="muted">No trading account yet${d.broker === 'missing' ? ' (the broker\'s data is not on this server)' : ''}.</span>`;
    const more = el.querySelector('.adm-j-more');
    more.innerHTML = d.next ? `<button type="button" data-a="jmore" data-b="${d.next}">Older events</button>` : n ? '<small>Start of the journal.</small>' : '<small>Nothing recorded yet.</small>';
    jFilter(el);
  }
  function jFilter(el) {
    const f = (el.querySelector('[data-a=jf].on') || {}).dataset?.f || 'all';
    const show = { all: () => true, trading: c => ['order', 'fill', 'cancel', 'reject', 'log', 'close', 'other'].includes(c), session: c => c === 'session', admin: c => c === 'admin' }[f];
    for (const tr of el.querySelectorAll('.adm-jtbl tbody tr')) tr.hidden = !show(tr.className.replace(/^adm-j-(\w+).*/, '$1'));
  }
  async function adminOpen() {
    clearTimeout(pdTimer);
    let el = document.getElementById('adminDlg');
    if (!el) {
      el = document.createElement('div'); el.className = 'overlay'; el.id = 'adminDlg'; document.body.appendChild(el);
      el.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('confirmDlg')?.matches(':not([hidden])')) { e.stopPropagation(); el.hidden = true; } });
      el.addEventListener('click', adminClick);
    }
    el.hidden = false;
    el.innerHTML = '<div class="modal cf-modal adm-modal" role="dialog" aria-modal="true" aria-labelledby="admT"><div class="ph"><h2 id="admT">Administration</h2><span class="muted small">Loading the accounts…</span></div></div>';
    let d;
    try { const r = await timed(api('/api/admin'), 10000); d = await r.json(); if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status); }
    catch (e) { el.querySelector('.small').textContent = 'Could not load the accounts: ' + e.message; return; }
    const rows = d.users.map(u => {
      const me = u.username === d.me;
      return `<tr data-u="${esc(u.username)}"><th scope="row">${esc(u.username)}${me ? ' <small>you</small>' : ''}</th>
        <td>${u.shared ? `Shared <small>${u.devices} browser${u.devices === 1 ? '' : 's'}</small>` : 'Personal'} · ${u.admin ? '<b class="adm-role">Admin</b>' : 'User'} · <span class="adm-st ${u.disabled ? 'off' : 'on'}">${u.disabled ? 'Disabled' : 'Active'}</span></td>
        <td class="mono">${day(u.created)}</td><td class="mono">${day(u.saved)}${u.saves ? ` <small>· ${u.saves} saves</small>` : ''}</td>
        <td class="mono">${u.sessions}${u.active ? ' <small class="adm-live">on a device now</small>' : ''}</td>
        <td class="adm-mods">${MODS.map(([k, n]) => `<label class="adm-ck"><input type="checkbox" data-a="mod" value="${k}"${u.modules.includes(k) ? ' checked' : ''}> ${n}</label>`).join('')}</td>
        <td class="adm-acts"><button type="button" data-a="journal" class="adm-jbtn" title="Everything ${esc(u.username)} did: sign-ins, orders, fills, rejections, closed trades">Journal</button><button type="button" data-a="pw">Password</button><button type="button" data-a="logout"${u.sessions ? '' : ' disabled'}>Sign out</button>`
        + `<button type="button" data-a="${u.disabled ? 'enable' : 'disable'}"${me ? ' disabled title="Not on your own account"' : ''}>${u.disabled ? 'Enable' : 'Disable'}</button>`
        + `<button type="button" data-a="${u.admin ? 'unadmin' : 'admin'}"${me ? ' disabled title="Not on your own account"' : ''}>${u.admin ? 'Remove admin' : 'Make admin'}</button>`
        + `<button type="button" data-a="reset" title="Erase the interface preferences saved on the server (the trading account is not changed)">Reset preferences</button><button type="button" data-a="delete" class="adm-del"${me ? ' disabled title="Not on your own account"' : ''}>Delete</button></td></tr>`;
    }).join('');
    el.innerHTML = `<div class="modal cf-modal adm-modal" role="dialog" aria-modal="true" aria-labelledby="admT">
      <div class="ph"><h2 id="admT">Administration</h2>${admTabs('users')}<span class="muted small">${d.users.length} account${d.users.length === 1 ? '' : 's'} on the server · signed in as ${esc(d.me)}</span><button type="button" class="adm-x" data-a="close">Close</button></div>
      <form class="adm-new" id="admNew" autocomplete="off"><b>New account</b>
        <label>Username<input name="username" maxlength="32" autocapitalize="none" spellcheck="false" required></label>
        <label>Password<input name="password" maxlength="256" autocomplete="new-password" required></label>
        <button type="button" data-a="gen">Generate</button>
        <label class="adm-ck"><input type="checkbox" name="shared"> Shared login <small>each browser its own portfolio</small></label>
        <button type="submit" class="adm-go">Create</button></form>
      <div class="adm-body"><table class="adm-tbl"><thead><tr><th scope="col">User</th><th scope="col">Type · Role · Status</th><th scope="col">Created (UTC)</th><th scope="col">Last saved</th><th scope="col">Sessions</th><th scope="col">Modules</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table>${adminLog(d.audit)}</div>
      <p class="adm-foot">Passwords are hashed on the server (PBKDF2-SHA256) and never shown again: give a new password to its user yourself. A new password or Sign out ends that user's sessions; Disable also blocks sign-in. Sessions last until the browser closes, at most 12 hours. Trade and Monitor are open to everyone; a module ticked or unticked here applies at the user's next page load.</p></div>`;
    el.querySelector('#admNew').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target, u = f.username.value.trim().toLowerCase(), p = f.password.value;
      if (await adm('create', u, { password: p, shared: f.shared.checked })) { tell('Account created', `${u}${f.shared.checked ? ' (shared)' : ''} can sign in now.`, 'info'); adminOpen(); }
    });
    el.querySelector('[data-a=close]').focus({ preventScroll: true });
  }
  async function adminClick(e) {
    const el = document.getElementById('adminDlg');
    if (e.target === el) { el.hidden = true; clearTimeout(pdTimer); return; }
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a, row = b.closest('tr[data-u]'), u = row && row.dataset.u;
    if (a === 'close') { el.hidden = true; clearTimeout(pdTimer); return; }
    if (a === 'mod') {
      // saved at once; on a refusal the box goes back to what the server has
      const list = [...row.querySelectorAll('input[data-a=mod]:checked')].map(i => i.value), n = MODS.find(m => m[0] === b.value)[1];
      if (await adm('modules', u, { modules: list })) {
        if (u === user) { modules = list; if (typeof wsGate === 'function') wsGate(list); }
        tell('Saved', `${u}: ${n} ${b.checked ? 'open' : 'closed'}${u === user ? ' here now' : ' from their next page load'}.`, 'info');
      }
      else b.checked = !b.checked;
      return;
    }
    if (a === 'tab') { if (b.dataset.t === 'data') adminDataOpen(); else adminOpen(); return; }
    if (a === 'journal') return adminJournal(u);
    if (a === 'back') return adminOpen();
    if (a === 'jmore') { b.disabled = true; return adminJournal(el.querySelector('.adm-jtbl').dataset.u, +b.dataset.b); }
    if (a === 'jf') { el.querySelectorAll('[data-a=jf]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); jFilter(el); return; }
    if (a === 'pd-all') return pdStart({ op: 'import' });
    if (a === 'pd-gaps') return pdStart({ op: 'gaps' });
    if (a === 'pd-one') { const v = el.querySelector('[name=pdsym]').value.trim().toUpperCase(); if (!v) { el.querySelector('[name=pdsym]').focus(); return; } return pdStart({ op: 'import', sym: v }); }
    if (a === 'gen') { const i = el.querySelector('#admNew [name=password]'); i.value = genPw(); i.select(); return; }
    if (a === 'pw') {
      const nx = row.nextElementSibling; if (nx && nx.classList.contains('adm-pw')) { nx.remove(); return; }
      row.insertAdjacentHTML('afterend', `<tr class="adm-pw"><td colspan="7"><span>New password for <b>${esc(u)}</b></span><input maxlength="256" autocomplete="new-password" aria-label="New password for ${esc(u)}"><button type="button" data-a="pwgen">Generate</button><button type="button" data-a="pwset" class="adm-go">Set password</button><small>ends ${esc(u)}'s sessions</small></td></tr>`);
      row.nextElementSibling.querySelector('input').focus(); return;
    }
    if (a === 'pwgen') { const i = b.closest('tr').querySelector('input'); i.value = genPw(); i.select(); return; }
    if (a === 'pwset') {
      const tr = b.closest('tr'), who = tr.previousElementSibling.dataset.u, p = tr.querySelector('input').value;
      if (await adm('passwd', who, { password: p })) { tell('Password changed', `${who}: the new password works now; their sessions were ended.`, 'info'); if (who === user) location.reload(); else adminOpen(); }
      return;
    }
    const run = async (msg) => { if (await adm(a, u)) { tell('Done', msg, 'info'); adminOpen(); } };
    if (a === 'logout') return run(`${u} was signed out everywhere.`);
    if (a === 'enable') return run(`${u} can sign in again.`);
    if (a === 'admin') return run(`${u} is an administrator.`);
    if (a === 'unadmin') return run(`${u} is no longer an administrator.`);
    const ask = (title, body, ok, msg) => askConfirm({ title, body, ok, kind: 'sell', onOk: () => run(msg) });
    if (a === 'disable') return ask(`Disable ${u}?`, `${u} is signed out and cannot sign in until enabled again. The account and its saved data are kept.`, 'Disable', `${u} is disabled.`);
    if (a === 'reset') return ask(`Erase ${u}'s saved preferences?`, `The interface preferences saved on the server for ${u} (settings, watchlist, drawings, lines) are erased. The trading account on the execution server is not changed.`, 'Erase preferences', `${u}'s saved preferences were erased.`);
    if (a === 'delete') return ask(`Delete ${u}?`, `The user and everything saved for them on the server are deleted. This cannot be undone.`, 'Delete user', `${u} was deleted.`);
  }
  store.ready.then(() => {
    if (!on || !admin) return;
    // the Account menu shows Administration when this control exists (ui.js userMenu)
    const ab = document.createElement('button'); ab.type = 'button'; ab.id = 'adminBtn'; ab.hidden = true; ab.addEventListener('click', adminOpen);
    document.body.appendChild(ab);
  });
  store.cloud = () => ({ on, user, rev, dirty: dirty(), status, device, admin, modules });
})();
