/* tradeBerry — browser persistence: account and market survive a reload, one writer across tabs, honest modes.
   Runs after app.js and before boot. It replaces the methods of the global store (get/set/clear stay synchronous
   and read an in-memory cache) and adds getMarket/setMarket, flush and ready (a Promise boot waits for).
   Where: IndexedDB 'meridian-fx' (key 'state' = {schemaVersion, rev, savedAt, state}, 'prev' = the last valid copy a
   session started from, 'rejected' = a saved copy that sanitizeState refused, kept until an export or a reset,
   'market' = the engine snapshot), plus a small localStorage shell (theme, layout, rev, market) for the first paint.
   No IndexedDB: the account goes to localStorage, capped at 1 MB. Neither: memory.
   Only the tab holding the Web Lock 'meridian-writer' (no Web Locks: a fresh localStorage heartbeat) runs the market
   and writes. Other tabs are read-only live copies: they reload the account and the market from storage at every
   save of the writer (BroadcastChannel; without it the storage event of a small 'rev' key; without both a snapshot,
   and they say so), and the first of them to get the lock (or a free heartbeat) becomes the writer on its own.
   A writer that comes back in the same tab (reload, Enter in the address bar, a deep link) takes the role back; the
   tab that stood in for it announces the role only once it is stable, and retracts the announcement if it loses it.
   On a signed-in page the account is not this browser's: it lives on the execution server (tradelink.js). What is
   stored here is then only the last account seen, for a fast start, and the page says "Last seen …" until the
   server's snapshot replaces it; every tab trades (the one-writer rule protects only the sandbox account). */
(function () {
  const DB = 'meridian-fx', OS = 'kv', SCHEMA = 2, LOCK = 'meridian-writer';
  const K = { shell: 'meridian-fx-shell', state: 'meridian-fx-state', prev: 'meridian-fx-prev', rejected: 'meridian-fx-rejected', legacy: 'meridian-fx-v1', hb: 'meridian-fx-writer', take: 'meridian-fx-takeover', tab: 'meridian-fx-tab', was: 'meridian-fx-was-writer', rev: 'meridian-fx-rev', exp: 'meridian-fx-exported' };
  const LS_CAP = 1024 * 1024, SHELL_CAP = 50000, DEBOUNCE = 2000, GRACE = 2000, CONFIRM = 3000;
  const LABEL = {
    persistent: 'Saved in this browser',
    'best-effort': 'Best effort — may be cleared by the browser (e.g. Safari after 7 days without visits)',
    session: 'Session only — lasts until reload'
  };
  const SHORT = { persistent: 'Saved in this browser', 'best-effort': 'Best effort', session: 'Session only' };
  const RO_TITLE = 'Read-only: this account is open in another tab — Take over here to change it';
  // controls that replace or wipe the stored account: disabled while this tab is read-only
  // (the Challenge controls are redrawn by challenge.js, which renders them disabled in a read-only tab too)
  const RO_CONTROLS = ['resetAcct', 'importBtn', 'importFile', 'chStartB', 'chNewB', 'chStopB', 'chPreset', 'ceSave'];
  // step-by-step migrations: MIGRATE[n] turns a schema-n envelope into schema n+1
  const MIGRATE = { 1: e => ({ schemaVersion: 2, rev: e.rev | 0, savedAt: e.savedAt || 0, state: e.state }) };

  const tryLS = () => { try { const s = window.localStorage; s.getItem(K.shell); return s; } catch (e) { return null; } };
  const ls = tryLS();
  const lsJSON = k => { try { const v = ls && ls.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const ssGet = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const ssSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const isQuota = e => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
  const tell = (title, body, kind) => { try { toast(title, body, kind); } catch (e) { console.warn('[Meridian]', title, body); } };

  let cache = null, market = null, marketAt = 0;   // cache: the account as a JSON string (in a read-only tab: what storage holds)
  let db = null, backend = 'memory';                // 'indexedDB' | 'localStorage' | 'memory'
  let persisted = false, readOnly = false, refused = false, unsaved = false, quotaTold = false, trimmed = 0, trimTold = 0;
  let rev = 0, sig = '', dirtyState = false, dirtyMarket = false, strictNext = false, timer = 0, queued = false, hiding = false, isReady = false;
  // promoting: a read-only tab is loading what the writer left before it writes; restored: savedAt of the 'prev'
  // copy loaded in place of a damaged one; rejectedNow: this load found a damaged copy
  let promoting = false, booted = false, restored = null, rejectedNow = false;
  let bootRes; const bootDone = new Promise(r => { bootRes = r; });
  const pending = new Set();
  const shell = lsJSON(K.shell) || {};
  // first paint in the saved theme, before boot applies it
  if (shell.theme === 'dark' || shell.theme === 'light') document.documentElement.dataset.theme = shell.theme;

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise((res, rej) => {
      let r; try { r = indexedDB.open(DB, 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => r.result.createObjectStore(OS);
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); if (db === d) db = null; }; res(d); };
      r.onerror = () => rej(r.error);
    });
  }
  function idbRead(keys) {
    return new Promise((res, rej) => {
      const tx = db.transaction(OS, 'readonly'), st = tx.objectStore(OS), out = {};
      keys.forEach(k => { st.get(k).onsuccess = e => { out[k] = e.target.result; }; });
      tx.oncomplete = () => res(out); tx.onerror = tx.onabort = () => rej(tx.error);
    });
  }
  function idbWrite(puts, dels, strict) {
    return new Promise((res, rej) => {
      if (!db) return rej(new Error('IndexedDB closed'));
      let tx;
      try {
        tx = db.transaction(OS, 'readwrite', { durability: strict ? 'strict' : 'default' });
        const st = tx.objectStore(OS);
        for (const [k, v] of puts) st.put(v, k);
        for (const k of dels || []) st.delete(k);
        tx.oncomplete = () => res(); tx.onerror = e => e.preventDefault(); tx.onabort = () => rej(tx.error || new DOMException('Transaction aborted', 'AbortError'));
        if (tx.commit) tx.commit();
      } catch (e) { try { tx && tx.abort(); } catch (x) { /* already finished */ } rej(e); }
    });
  }
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  /* ---------- one writer ---------- */
  let bc = null; try { bc = new BroadcastChannel('meridian-fx'); } catch (e) { bc = null; }
  const post = m => { try { bc && bc.postMessage(m); } catch (e) { /* closed */ } };
  // the tab id survives a reload of the same tab (sessionStorage), so the tab's own heartbeat never blocks it
  const newId = () => Math.random().toString(36).slice(2);
  let tabId = ssGet(K.tab) || newId(); ssSet(K.tab, tabId);
  const hasLocks = () => !!(navigator.locks && navigator.locks.request);
  // a writer that loads the app again in the same tab (reload, Enter in the address bar, a deep link, the PWA start_url)
  // takes its lock back: a read-only tab queued for it may have got it while the page was away. The mark (this tab's id)
  // is left on the way out (pagehide) and counts for any navigation of this same tab within a few seconds.
  const was = (() => { try { return JSON.parse(ssGet(K.was) || 'null'); } catch (e) { return null; } })(); ssSet(K.was, null);
  const reclaim = !!(was && typeof was === 'object' && was.id === tabId && Date.now() - (+was.t || 0) < 15000);
  // the lock: resolves true when this tab holds it, false when it is taken (ifAvailable); held until the page goes away
  // or another tab steals it, which demotes this tab
  const grab = opts => new Promise(res => {
    navigator.locks.request(LOCK, opts, lock => {
      if (!lock) { res(false); return; }
      held = true; res(true); return new Promise(() => {});
    }).catch(e => { if (held) { held = false; demote(); } else res(false); });
  });
  const hbRead = () => lsJSON(K.hb);
  const hbWrite = id => { try { ls.setItem(K.hb, JSON.stringify({ id, t: Date.now() })); } catch (e) { /* best effort */ } };
  const hbDrop = () => { try { const v = hbRead(); if (v && v.id === tabId) ls.removeItem(K.hb); } catch (e) { /* best effort */ } };
  const hbFresh = v => v && Date.now() - v.t < 5000;
  let hbTimer = 0, held = false, waiting = false, pollTimer = 0;
  // asked at once, before IndexedDB opens, so the reloaded writer is back before a queued tab's grace period ends
  const early = reclaim && hasLocks() ? (post({ type: 'claim', why: 'reclaim' }), grab({ steal: true })) : null;
  const hbStart = () => { clearInterval(hbTimer); hbWrite(tabId); hbTimer = setInterval(() => { if (!readOnly) hbWrite(tabId); }, 2000); };
  // a duplicated tab copies sessionStorage, and the tab id with it: ask whether a live writer already uses that id
  const probe = id => new Promise(res => {
    if (!bc) return res(false);
    const t = setTimeout(() => done(false), 300);
    function done(v) { clearTimeout(t); bc.removeEventListener('message', on); res(v); }
    function on(e) { if (e.data && e.data.type === 'me' && e.data.id === id) done(true); }
    bc.addEventListener('message', on); post({ type: 'who', id });
  });
  async function elect() {
    if (backend === 'memory' || refused) return; // nothing shared to protect
    const steal = ssGet(K.take) === '1'; ssSet(K.take, null);
    if (hasLocks()) {
      const got = early ? await early : await grab(steal ? { steal: true } : { ifAvailable: true });
      if (!got) { readOnly = true; follow(); }
      return;
    }
    if (ls) { // no Web Locks: a heartbeat in localStorage, displaced through the storage event
      let cur = hbRead();
      if (cur && cur.id === tabId && hbFresh(cur) && await probe(tabId)) { tabId = newId(); ssSet(K.tab, tabId); cur = hbRead(); }
      if (!steal && cur && cur.id !== 'handover' && cur.id !== tabId && hbFresh(cur)) { readOnly = true; follow(); }
      else hbStart();
      addEventListener('storage', e => { if (e.key === K.hb && !readOnly) { const v = hbRead(); if (v && v.id !== tabId) demote(); } });
    }
  }
  // read-only: queue for the lock (no steal), or watch the heartbeat; whichever frees first makes this tab the writer
  function follow() {
    if (hasLocks()) {
      if (waiting || held) return;
      waiting = true;
      // granted: wait a grace period first. A writer that only reloaded steals the lock back within it, and this tab
      // stays read-only without a word; a writer that closed does not, and this tab takes over.
      let granted = false, settled = false;
      navigator.locks.request(LOCK, () => {
        granted = held = true;
        setTimeout(() => { if (held && readOnly) { settled = true; waiting = false; promote(); } }, GRACE);
        return new Promise(() => {});
      }).catch(e => {
        const was = held; held = false; waiting = false;
        if (settled) { if (was) demote(); return; }
        if (granted && readOnly) follow(); // stolen back during the grace period: queue again behind the writer
      });
      return;
    }
    if (!ls || pollTimer) return;
    let missingSince = 0;
    pollTimer = setInterval(() => {
      if (!readOnly) { clearInterval(pollTimer); pollTimer = 0; return; }
      const cur = hbRead(), now = Date.now();
      // gone for 3 s (a hidden writer drops it and rewrites it within 2 s) or not refreshed for 5 s: the writer has left
      if (cur) missingSince = 0; else if (!missingSince) missingSince = now;
      if (cur ? hbFresh(cur) : now - missingSince < 3000) return;
      hbWrite(tabId);
      setTimeout(() => { const v = hbRead(); if (readOnly && v && v.id === tabId) { clearInterval(pollTimer); pollTimer = 0; hbStart(); promote(); } }, 250);
    }, 500);
  }
  // the take-over is announced only once it has held for CONFIRM: a writer that was only slow to reload takes it back
  // before that, and this tab never claimed anything. Lost after the announcement: it goes, and the reason replaces it.
  const PROMO = 'This tab now saves the account';
  let announceT = 0, announced = false, lastClaim = null;
  const dropToast = title => { try { document.querySelectorAll('#toasts .toast').forEach(x => { const b = x.querySelector('b'); if (b && b.textContent === title) x.remove(); }); } catch (e) { /* no toasts */ } };
  function lostRole() {
    const c = lastClaim && Date.now() - lastClaim.t < 5000 ? lastClaim.why : '', copy = live() ? 'a live copy of that tab' : 'a snapshot, not updated';
    if (c === 'reclaim') tell('The original tab took the account back', `It came back after this tab had started saving. This tab is read-only again: ${copy}.`, 'info');
    else if (c === 'takeover') tell('Another tab took over the account', `“Take over here” was used in another tab. This tab is read-only now: ${copy}.`, 'info');
    else tell('Another tab now saves the account', `This tab is read-only now: ${copy}.`, 'info');
  }
  function demote() {
    if (readOnly) return;
    clearTimeout(announceT); announceT = 0;
    if (announced) { announced = false; dropToast(PROMO); setTimeout(lostRole, 150); } // the claim message may arrive just after the lock
    readOnly = true; clearTimeout(timer); timer = 0; clearInterval(hbTimer); dirtyState = dirtyMarket = false; roTold = false;
    try { Engine.speed = 0; } catch (e) { /* engine missing */ }
    roBase = booted ? acctOf(S) : null;
    const b = banner.querySelector('button'); if (b) b.disabled = false;
    ui(); follow();
  }
  // a read-only tab that gets the lock or the heartbeat: load what the writer left, start the market, drop the banner
  async function promote() {
    if (!readOnly) return;
    readOnly = false;
    if (!isReady) return; // still loading: the load goes on as the writer
    promoting = true; ui();
    try { await bootDone; await pull(); } catch (e) { console.error('[Meridian] take-over load failed:', e); } finally { promoting = false; }
    if (readOnly) return;
    try { Engine.speed = (S && S.set && S.set.speed) || 1; const sp = document.getElementById('speedSel'); if (sp) sp.value = Engine.speed; } catch (e) { /* engine missing */ }
    ui();
    clearTimeout(announceT);
    announceT = setTimeout(() => {
      announceT = 0;
      if (readOnly || promoting) return;
      announced = true; tell(PROMO, 'The tab that saved it is no longer open. The market runs here and changes are saved from this tab.', 'info');
    }, CONFIRM);
  }
  if (bc) bc.onmessage = e => {
    const m = e.data || {};
    // a tab about to take over asks the writer to save everything first
    if (m.type === 'flush' && !readOnly) { try { if (typeof persistNow === 'function') persistNow(); } catch (x) { console.error(x); } flush(true).then(() => post({ type: 'flushed', rev })); }
    else if (m.type === 'rev' && readOnly && booted) pull();
    else if (m.type === 'who' && !readOnly && m.id === tabId) post({ type: 'me', id: tabId });
    else if (m.type === 'claim') lastClaim = { why: m.why, t: Date.now() };
  };
  // no BroadcastChannel: the writer marks every save in localStorage and the storage event tells the other tabs
  const live = () => !!bc || !!ls;
  addEventListener('storage', e => { if (e.key === K.rev && readOnly && booted) pull(); });
  async function takeOver() {
    const b = document.querySelector('#persistBanner button'); if (b) b.disabled = true;
    await new Promise(res => {
      if (!bc) return res();
      const t = setTimeout(done, 1500);
      function done() { clearTimeout(t); bc.removeEventListener('message', on); res(); }
      function on(e) { if (e.data && e.data.type === 'flushed') done(); }
      bc.addEventListener('message', on); post({ type: 'flush' });
    });
    post({ type: 'claim', why: 'takeover' });
    if (hasLocks()) {
      // the reloaded page steals the lock before it reads, so it loads what the old writer saved last
      if (ssSet(K.take, '1')) { location.reload(); return; }
      navigator.locks.request(LOCK, { steal: true }, () => { location.reload(); return new Promise(() => {}); }).catch(() => location.reload());
      return;
    }
    hbWrite('handover'); location.reload();
  }

  /* ---------- reading what is stored ---------- */
  const REFUSED = {}; // marks an envelope from a newer schema than this build
  // an envelope brought to the current schema; null when missing or unreadable
  function normEnv(env) {
    let e = env && typeof env === 'object' && Number.isInteger(env.schemaVersion) ? env : null;
    if (e && e.schemaVersion > SCHEMA) return REFUSED;
    while (e && e.schemaVersion < SCHEMA) e = MIGRATE[e.schemaVersion] ? MIGRATE[e.schemaVersion](e) : null;
    return e;
  }
  // valid: sanitizeState (app.js) accepts it as an account
  const validEnv = e => { if (!e || e === REFUSED || !e.state || typeof e.state !== 'object') return false; try { return typeof sanitizeState !== 'function' || !!sanitizeState(e.state); } catch (x) { return false; } };
  const useEnv = e => { try { cache = JSON.stringify(e.state); sig = sigOf(e.state); } catch (x) { cache = null; sig = ''; } rev = Math.max(rev, e.rev | 0); };
  const newestMarket = (...xs) => xs.filter(x => x && x.snap).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
  // the account without this tab's own view settings and ticket (a read-only tab keeps those)
  const acctOf = s => { try { if (!s || typeof s !== 'object') return ''; const { set, tk, ...a } = s; return JSON.stringify(a); } catch (e) { return ''; } };
  let roBase = null, roTold = false, roToldAt = 0, appliedAt = 0;
  async function readStored() {
    let env = null, mk = null;
    if (backend === 'indexedDB' && db) { const o = await idbRead(['state', 'market']); env = o.state || null; mk = o.market || null; }
    else if (backend === 'localStorage') env = lsJSON(K.state);
    const sh = lsJSON(K.shell) || {};
    return { env: normEnv(env), present: !!env, mk: newestMarket(mk, sh.market) };
  }
  // bring the engine to the writer's market: carry the clock on, then set every currency to its saved level
  let rawSpeed = v => { Engine.speed = v; };
  async function applyMarket(snap) {
    if (!snap || !snap.L || typeof Engine !== 'object' || !Engine.CCY) return false;
    const dt = snap.simTime - Engine.simTime;
    if (dt > 6 * 3600) { await Engine.init(snap); return true; } // far apart: rebuild the history from the snapshot
    if (dt > 0) { const s0 = Engine.speed; rawSpeed(1); try { Engine.tick(dt * 1000); } finally { rawSpeed(s0); } }
    const L = Engine.snapshot().L;
    // every currency of the FX model (15 in v15; Engine.CCY = the G8 only), then the non-FX log prices, which ride in
    // the same L under their symbols: align them too, or a read-only copy drifts on its own path
    for (const c of Engine.CCY_ALL || Engine.CCY) if (Number.isFinite(snap.L[c]) && Number.isFinite(L[c]) && snap.L[c] !== L[c]) Engine.jump(c, snap.L[c] - L[c]);
    if (Engine.CFDS && typeof Engine.jumpX === 'function') for (const c of Engine.CFDS) { const k = c.sym || c; if (Number.isFinite(snap.L[k]) && Number.isFinite(L[k]) && snap.L[k] !== L[k]) Engine.jumpX(k, snap.L[k] - L[k]); }
    return true;
  }
  // reload the account and the market from storage into the running app (a read-only tab, or one taking over)
  let pulling = null, pullAgain = false;
  function pull() {
    if (pulling) { pullAgain = true; return pulling; }
    pulling = (async () => {
      do {
        pullAgain = false;
        const got = await readStored();
        let acct = false, mkt = false;
        if (validEnv(got.env)) { useEnv(got.env); acct = true; } else if (!got.present) { cache = null; sig = ''; acct = true; } // nothing saved: a fresh account
        if (got.mk && (got.mk.savedAt || 0) > appliedAt) { market = got.mk.snap; marketAt = appliedAt = got.mk.savedAt || 0; mkt = await applyMarket(market); }
        if (!booted || (!acct && !mkt)) continue;
        if (acct) {
          // the account comes from storage; this tab keeps its own view settings and ticket (its screen shows them)
          const set = S && S.set, tk = S && S.tk;
          // a signed-in page: storage holds only the last account seen; this tab's own one comes from the server
          const own = TradeLink.live && TradeLink.seen && S ? Object.fromEntries(ACCT_KEYS.filter(k => S[k] !== undefined).map(k => [k, S[k]])) : null;
          loadState();
          if (own) { Object.assign(S, own); if (set) for (const k of SET_EXEC) S.set[k] = set[k]; }
          if (set) S.set = { ...set, jur: S.set.jur, lev: S.set.lev };
          if (tk) S.tk = tk;
          try { if (typeof syncLevSel === 'function') syncLevSel(); } catch (e) { console.error(e); }
        }
        roBase = acctOf(S);
        try { changed('pos', 'ord', 'hist', 'al'); } catch (e) { console.error(e); }
        if (mkt) try { if (typeof fullChart === 'function') fullChart(false); } catch (e) { console.error(e); }
      } while (pullAgain);
    })().catch(e => console.error('[Meridian] reload from storage failed:', e)).finally(() => { pulling = null; });
    return pulling;
  }

  /* ---------- load ---------- */
  const ready = (async () => {
    try { db = await within(openDB(), 4000); backend = 'indexedDB'; } catch (e) { db = null; backend = ls ? 'localStorage' : 'memory'; }
    await elect();
    let env = null, mk = null;
    if (db) { try { const o = await idbRead(['state', 'market']); env = o.state || null; mk = o.market || null; } catch (e) { db = null; backend = ls ? 'localStorage' : 'memory'; } }
    if (!env) env = lsJSON(K.state); // saved while IndexedDB was unavailable
    if (!env) { const raw = lsJSON(K.legacy); if (raw && typeof raw === 'object') env = { schemaVersion: 1, rev: 0, savedAt: 0, state: raw }; }
    let e = env ? normEnv(env) : null;
    if (e === REFUSED) { refused = true; e = null; }
    else if (env && !validEnv(e)) {
      // a damaged copy: load the previous valid one instead, and keep the damaged one apart
      rejectedNow = true; e = null;
      let pv = null;
      if (db) { try { pv = (await idbRead(['prev'])).prev || null; } catch (x) { pv = null; } }
      if (!pv) pv = lsJSON(K.prev);
      pv = pv ? normEnv(pv) : null;
      if (validEnv(pv)) { e = pv; restored = pv.savedAt || 0; }
      // no valid previous copy: a copy whose only fault is the balance is repaired at boot (loadState), not dropped
      else if (typeof sanitizeState === 'function') { try { if (sanitizeState(env.state, { repairBalance: true })) { e = normEnv(env); rejectedNow = false; } } catch (x) { /* stays rejected */ } }
    }
    if (e) useEnv(e);
    rev = Math.max(rev, (env && env.rev) | 0, shell.rev | 0, (mk && mk.rev) | 0);
    // market: the newest of the IndexedDB copy and the shell copy (the shell is written synchronously on the way out)
    const best = newestMarket(mk, shell.market);
    if (best) { market = best.snap; marketAt = appliedAt = best.savedAt || 0; }
    if (refused) { readOnly = false; backend === 'indexedDB' && db && db.close(); }
    // 'prev' only ever holds a valid copy; a refused one goes to 'rejected' and stays there until an export or a reset
    else if (env && !readOnly) {
      const key = rejectedNow ? 'rejected' : 'prev';
      if (backend === 'indexedDB') idbWrite([[key, env]], [], false).catch(x => console.warn('[Meridian] backup failed:', x));
      else if (backend === 'localStorage') { try { ls.setItem(rejectedNow ? K.rejected : K.prev, JSON.stringify(env)); } catch (x) { /* no room for a backup */ } }
    }
    try { if (navigator.storage && navigator.storage.persisted) persisted = !!(await within(navigator.storage.persisted(), 1000)); } catch (x) { persisted = false; }
    isReady = true;
    // the restored copy replaces the damaged one at once
    if (restored != null && canWrite()) { dirtyState = strictNext = true; schedule(0); }
  })().catch(e => { console.error('[Meridian] storage load failed:', e); backend = 'memory'; isReady = true; });

  /* ---------- save ---------- */
  const sigOf = s => { try { return [(s.positions || []).map(p => p.id + ':' + p.lots).join(','), (s.orders || []).length, (s.history || []).length, s.history && s.history[0] ? s.history[0].id + ':' + s.history[0].lots : '', s.balance].join('|'); } catch (e) { return ''; } };
  const canWrite = () => isReady && !readOnly && !promoting && !refused && backend !== 'memory';
  function schedule(ms) {
    if (!canWrite()) return;
    // the page is going away: write now. Hidden but alive: the same debounce as in front (a fill still goes at once)
    if (hiding) { if (!queued) { queued = true; queueMicrotask(() => { queued = false; flush(); }); } return; }
    if (ms === 0) { clearTimeout(timer); timer = 0; flush(); return; }
    if (!timer) timer = setTimeout(() => { timer = 0; flush(); }, ms);
  }
  function writeShell(now) {
    if (!ls) return;
    const set = typeof S === 'object' && S && S.set ? S.set : {};
    const o = { schemaVersion: SCHEMA, rev, savedAt: now, theme: set.theme, layout: { layouts: set.layouts, ws: set.ws, view: set.view, mv: set.mv },
      market: market ? { savedAt: marketAt, snap: market } : undefined, askedPersist: shell.askedPersist, lastExport: shell.lastExport, reminded: shell.reminded };
    let s = JSON.stringify(o); if (s.length > SHELL_CAP) { delete o.layout; s = JSON.stringify(o); }
    try { ls.setItem(K.shell, s); Object.assign(shell, o); } catch (e) { /* the shell is only a convenience */ }
  }
  function writeLS(env) {
    let s = JSON.stringify(env), n = env.state.history ? env.state.history.length : 0, cut = 0;
    while (s.length > LS_CAP && n > 0) { n = Math.floor(n * .8); env = { ...env, state: { ...env.state, history: env.state.history.slice(0, n) } }; s = JSON.stringify(env); cut = n; }
    if (s.length > LS_CAP) throw new DOMException('Account larger than the localStorage cap', 'QuotaExceededError');
    ls.setItem(K.state, s);
    if (trimmed !== cut) { trimmed = cut; ui(); }
    if (cut && !trimTold) { trimTold = cut; tell(`Saved the last ${cut} trades only`, 'This browser offers only a small store here. Export keeps the full journal.', 'info'); }
  }
  function doFlush() {
    clearTimeout(timer); timer = 0;
    if (!canWrite() || (!dirtyState && !dirtyMarket)) return Promise.resolve();
    const strict = strictNext, ds = dirtyState, dm = dirtyMarket, now = Date.now(), r = ++rev;
    strictNext = dirtyState = dirtyMarket = false;
    let st = null; try { st = ds && cache ? JSON.parse(cache) : null; } catch (e) { st = null; }
    writeShell(now);
    const env = st ? { schemaVersion: SCHEMA, rev: r, savedAt: now, state: st } : null;
    let p;
    try {
      if (backend === 'indexedDB') {
        const puts = []; if (env) puts.push(['state', env]); if (dm && market) puts.push(['market', { rev: r, savedAt: marketAt, snap: market }]);
        p = puts.length ? idbWrite(puts, [], strict) : Promise.resolve();
      } else { if (env) writeLS(env); p = Promise.resolve(); }
    } catch (e) { p = Promise.reject(e); }
    p = p.then(() => {
      quotaTold = false; if (unsaved) { unsaved = false; ui(); } post({ type: 'rev', rev: r });
      if (!bc && ls) { try { ls.setItem(K.rev, JSON.stringify({ rev: r, t: Date.now() })); } catch (x) { /* the others stay a snapshot */ } }
    }, e => {
      if (ds && !dirtyState) dirtyState = true; if (dm) dirtyMarket = true; // retried at the next save
      if (!isQuota(e)) console.error('[Meridian] save failed:', e);
      unsaved = true; ui();
      if (isQuota(e) && !quotaTold) { quotaTold = true; tell('Not saved — storage full; use Export', 'The account stays in this tab until you reload. Export (Help) keeps a copy.', 'dn'); }
    }).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }
  // flush(): write what is pending now; resolves when every write in flight has finished
  function flush() { doFlush(); return Promise.allSettled([...pending]).then(() => {}); }
  // a write asked of a read-only tab: nothing changes; one toast says so (a set only when it would change the account)
  function roRefuse(v, force) {
    if (!force && (roBase == null || acctOf(v) === roBase)) return;
    if (roTold && !(force && Date.now() - roToldAt > 10000)) return;
    roTold = true; roToldAt = Date.now();
    if (typeof TradeLink === 'object' && TradeLink && TradeLink.live) tell('Preferences not saved in this tab', 'The account is open in another tab, so layout and settings changed here are not kept. Orders sent here still go to your account. Use “Take over here” to save from this tab.', 'info');
    else tell('Not saved — this tab is read-only', 'The account is open in another tab, so changes made here are not kept. Use “Take over here” to change it in this tab.', 'dn');
  }

  /* ---------- the store ---------- */
  store.ready = ready;
  store.get = () => { if (!cache) return null; try { return JSON.parse(cache); } catch (e) { return null; } };
  store.set = v => {
    if (readOnly || promoting) return roRefuse(v, false);
    let s; try { s = JSON.stringify(v); } catch (e) { console.error('[Meridian] state not serialisable:', e); return; }
    cache = s;
    if (!canWrite()) return;
    dirtyState = true;
    // a fill or a close goes to disk at once, with strict durability; anything else is debounced
    const g = sigOf(v); if (g !== sig) { sig = g; strictNext = true; schedule(0); } else schedule(DEBOUNCE);
  };
  store.clear = () => {
    if (readOnly || promoting) return roRefuse(null, true);
    cache = null; sig = '';
    if (!canWrite()) return;
    dirtyState = false; trimmed = trimTold = 0; rejectedNow = false; restored = null;
    if (ls) for (const k of [K.state, K.prev, K.rejected, K.legacy]) { try { ls.removeItem(k); } catch (e) { /* ignore */ } }
    if (backend === 'indexedDB') { const p = idbWrite([], ['state', 'prev', 'rejected'], true).catch(e => console.error('[Meridian] reset failed:', e)).finally(() => pending.delete(p)); pending.add(p); }
    ui();
  };
  store.getMarket = () => isReady ? market : ready.then(() => market);
  store.setMarket = snap => { if (readOnly || promoting) return; market = snap; marketAt = Date.now(); if (!canWrite()) return; dirtyMarket = true; schedule(DEBOUNCE); };
  store.flush = flush;
  store.mode = () => refused || backend === 'memory' ? 'session' : persisted ? 'persistent' : 'best-effort';
  store.backend = () => backend;
  store.readOnly = () => readOnly;
  store.unsaved = () => unsaved;
  store.takeOver = takeOver;

  addEventListener('pagehide', () => { hiding = true; schedule(0); if (!readOnly) { hbDrop(); if (held) ssSet(K.was, JSON.stringify({ id: tabId, t: Date.now() })); } });
  addEventListener('pageshow', e => {
    hiding = false; if (e.persisted) ssSet(K.was, null); // back from the back/forward cache: the lock was never let go
    if (e.persisted && !readOnly && !hasLocks() && ls && hbTimer) { const v = hbRead(); if (v && v.id !== tabId && hbFresh(v)) demote(); else hbWrite(tabId); }
  });
  // registered after boot, so it runs after app.js's own handler (persistNow) and writes what that handler queued
  function onVisibility() {
    if (document.visibilityState === 'hidden') { schedule(0); if (!readOnly) hbDrop(); return; }
    hiding = false;
    if (!readOnly && !hasLocks() && ls && hbTimer) { const v = hbRead(); if (v && v.id !== tabId && hbFresh(v)) demote(); else hbWrite(tabId); }
  }

  /* ---------- read-only tab: no market, no trading, no triggers ---------- */
  try {
    const d = Object.getOwnPropertyDescriptor(Engine, 'speed');
    if (d && d.set && d.configurable) {
      Object.defineProperty(Engine, 'speed', { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { d.set.call(Engine, readOnly ? 0 : v); } });
      rawSpeed = v => d.set.call(Engine, v); // the clock catch-up of a read-only tab
    }
  } catch (e) { console.warn('[Meridian] speed guard unavailable', e); }
  let roNoteAt = 0;
  const roNote = () => { if (Date.now() - roNoteAt > 3000) { roNoteAt = Date.now(); tell('This tab is read-only', 'The account is open in another tab. Use “Take over here” to trade in this one.', 'dn'); } };
  let queuedNow = false;
  for (const name of ['openPosition', 'placeOrder', 'closePosition']) {
    const f = window[name]; if (typeof f !== 'function') continue;
    window[name] = function () {
      // a signed-in page trades on the server's account from any tab (tradelink.js): only the sandbox has one writer
      if ((readOnly || promoting) && !TradeLink.live) { roNote(); return null; }
      const r = f.apply(this, arguments);
      // write a fill or a close at once (persistNow runs negative balance protection and saves the market with it)
      if (!queuedNow) { queuedNow = true; queueMicrotask(() => { queuedNow = false; try { if (canWrite() && typeof persistNow === 'function') persistNow(); } catch (e) { console.error(e); } }); }
      return r;
    };
  }
  const guardRO = name => { const f = window[name]; if (typeof f !== 'function' || f.roGuard) return; const g = window[name] = function () { if (readOnly || promoting) return; return f.apply(this, arguments); }; g.roGuard = true; };
  guardRO('checkTriggers');
  // demo history replaces or wipes the account: a read-only tab refuses out loud. The demo fixture (tests/fixtures/demo.js) defines these later (and
  // challenge.js may wrap them): whatever is assigned is wrapped, so the refusal always comes first
  const roDemo = f => {
    const g = function () {
      if (readOnly || promoting) { tell('Read-only: this account is open in another tab', 'Demo history is neither loaded nor cleared here. Use “Take over here” to change the account in this tab.', 'dn'); return null; }
      return f.apply(this, arguments);
    };
    g.roGuard = true; return g;
  };
  for (const name of ['loadDemoHistory', 'clearDemoHistory']) {
    let fn = typeof window[name] === 'function' ? roDemo(window[name]) : window[name];
    try { Object.defineProperty(window, name, { configurable: true, enumerable: true, get: () => fn, set: v => { fn = typeof v === 'function' && !v.roGuard ? roDemo(v) : v; } }); } catch (e) { console.warn('[Meridian] demo guard unavailable', e); }
  }
  // swap is charged by the writer; a read-only tab only moves its rollover clock on (no positions, no save)
  if (typeof rolloverTick === 'function') {
    const rt = rolloverTick;
    window.rolloverTick = function () {
      if (!(readOnly || promoting) || typeof S !== 'object' || !S) return rt.apply(this, arguments);
      const keep = S.positions; S.positions = [];
      try { return rt.apply(this, arguments); } finally { S.positions = keep; }
    };
  }

  /* ---------- what the user sees ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const banner = document.createElement('div');
  banner.id = 'persistBanner'; banner.setAttribute('role', 'status'); banner.hidden = true;
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;display:none;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 16px;background:var(--s3);color:var(--tx);border-bottom:1px solid var(--acc);font-size:13px';
  banner.innerHTML = '<span>Open in another tab — this tab is read-only: a live copy, its market view-only</span><button class="ghost sm" type="button">Take over here</button>';
  banner.querySelector('button').addEventListener('click', takeOver);
  document.body.prepend(banner);
  const pill = document.createElement('span');
  pill.id = 'persistPill'; pill.className = 'pill';
  const anchor = document.getElementById('demoPill') || document.getElementById('feedPill');
  if (anchor) anchor.after(pill);
  // a signed-in page (tradelink.js): the account is on the execution server; this browser keeps the preferences and
  // the last account seen (a display copy for a fast start), so nothing here guards the account
  const onServer = () => typeof TradeLink === 'object' && !!TradeLink && !!TradeLink.live;
  const SERVER_PILL = 'Preferences in this browser · account on the server';
  /* the account type, said the same way everywhere and from here only: window.acctKind() gives the words, and every
     change of type is announced once, as the document event 'tb:acct-kind' (detail: the acctKind() object, its key in
     detail.key). The status-bar flag here, the feed pill and Help › #simLabel (livefeed.js), the first row of the
     account menu (ui.js) and the onboarding tour (ui.js) all read these texts; none of them polls the type itself.
     - signed in, TradeLink.type 'demo': a demo account on the execution server (real executions on live prices, no money);
     - signed in, TradeLink.type 'live': a live account there (real money); it is not called demo, so the flag is hidden;
     - signed in, type not known yet (null until the server's first snapshot): neither word, the flag stays hidden;
     - not signed in, the demo history loaded (S.demo, tests/fixtures/demo.js): 'DEMO · example trades';
     - not signed in, the account's own trades: no flag.
     flag: the status-bar text ('' = hidden); line: the account menu's row; title: the explanation (status-bar flag and
     menu row); pill: the end of the feed pill's title; label: the end of Help › #simLabel (both on live prices); tour: the
     sentence of the onboarding tour's Markets step (ui.js). */
  const KIND = {
    demo: { flag: 'DEMO', line: 'Demo account · on the execution server · real executions, no money', title: 'Demo account on the execution server: real executions on live prices, no money.',
      pill: 'Demo account on the execution server: real executions on these prices, no money.',
      label: 'Demo account on the execution server: orders are executed there on these prices, so no real money is at risk.',
      tour: 'It is a demo account on the execution server: real executions on live prices, nothing is real money.' },
    live: { flag: '', line: 'Live account · on the execution server · real executions, real money', title: 'Live account on the execution server: real executions on live prices, with real money.',
      pill: 'Live account on the execution server: real executions on these prices, with real money.',
      label: 'Live account on the execution server: orders are executed there on these prices, with real money.',
      tour: 'It is a live account on the execution server: real executions with real money.' },
    pending: { flag: '', line: 'Account on the execution server · demo or live: waiting for the server', title: 'Account on the execution server: its type (demo or live) shows once the server answers.',
      pill: 'Account on the execution server: real executions on these prices; its type (demo or live) shows once the server answers.',
      label: 'Account on the execution server: orders are executed there on these prices. Whether it is a demo or a live account shows once the server answers.',
      tour: 'The account is on the execution server; whether it is a demo or a live account shows once the server answers.' },
    example: { flag: 'DEMO · example trades', line: 'Account in this browser · example trades, no money', title: 'Account in this browser · example trades, no money: the trade history is example trades on the 16 FX pairs, generated to show the tools (no CFDs).',
      pill: 'Account in this browser · example trades, no money: the trade history is example trades generated to show the tools; orders and fills stay in this browser, no execution server.',
      label: 'Account in this browser · example trades, no money: the trade history is example trades generated to show the tools; orders and fills stay in this browser, no execution server.',
      tour: 'The account is in this browser, with example trades and no execution server: nothing is real money.' },
    local: { flag: '', line: 'Account in this browser · no execution server, no money', title: 'Account in this browser · no execution server, no money: orders and fills stay in this browser.',
      pill: 'Account in this browser · no execution server, no money: orders and fills stay in this browser.',
      label: 'Account in this browser · no execution server, no money: orders and fills stay in this browser.',
      tour: 'The account is in this browser, with no execution server: nothing is real money.' }
  };
  const kindKey = () => onServer() ? (TradeLink.type === 'demo' || TradeLink.type === 'live' ? TradeLink.type : 'pending')
    : typeof S === 'object' && S && S.demo ? 'example' : 'local';
  window.acctKind = () => { const k = kindKey(); return { key: k, ...KIND[k] }; };
  /* the account flag of the status bar (#demoPill). Visibility goes through the hidden attribute (the statusbar's
     [hidden] rule): styles.css gates .demo-flag on html[data-demo] only on the phone, so the server flag drops that class.
     Text, title, class and hidden are written together on every call, hidden or not: the element never keeps the words
     of another type (index.html's 'DEMO · example trades' included). */
  function acctFlag(k) {
    const f = document.getElementById('demoPill'); if (!f) return;
    const text = k.flag, cls = k.key === 'example' ? 'pill demo-flag' : 'pill', hide = !k.flag;
    if (f.textContent !== text) f.textContent = text;
    if (f.title !== k.title) f.title = k.title;
    if (f.className !== cls) f.className = cls;
    if (f.hidden !== hide) f.hidden = hide;
    document.body.classList.toggle('acct-flag', !hide); // the header's Equity label carries the flag (decision 43)
  }
  /* the one watch on the type: TradeLink has no event for it (its type comes with the server's first snapshot, its live
     flag can turn off after /api/me) and S.demo changes without one. Every 100 ms until the type is final (signed in and
     demo or live), so the first answer shows at once even when TradeLink.live turns true late; then every second (a
     sign-out, a later change, the demo history loaded or dropped). A change re-draws the flag and is announced once. */
  let kindShown = null;
  function kindCheck() {
    const k = acctKind();
    acctFlag(k);
    if (k.key === kindShown) return k;
    kindShown = k.key;
    try { document.dispatchEvent(new CustomEvent('tb:acct-kind', { detail: k })); } catch (e) { console.error(e); }
    // Help › the money line says the account's truth (round 3 follow-up: it said 'no real money' for every account)
    const hm = document.getElementById('helpMoney');
    if (hm) hm.textContent = k.key === 'live' ? 'This is a live account: real money is at risk.' : k.key === 'pending' ? 'Whether real money is at risk shows once the server tells this account’s type.' : 'This is a demo environment — no real money is at risk.';
    return k;
  }
  // fast (100 ms) only while the kind can still change soon: the first 10 s of the page, or a signed-in page whose type is
  // not known yet; then once a second (round 3 follow-up: a local page used to poll at 10 Hz for its whole life)
  const kindT0 = Date.now();
  (function kindWatch() {
    let k = null;
    try { k = kindCheck(); } catch (e) { /* page torn down */ }
    const settled = !!k && (onServer() ? (k.key === 'demo' || k.key === 'live') : Date.now() - kindT0 > 10000);
    setTimeout(kindWatch, settled ? 1000 : 100);
  })();
  function note() {
    const m = store.mode();
    if (onServer()) return [
      'Your account (balance, positions, orders, history) is on the execution server: every device signed in shows the same account.',
      backend === 'memory' ? 'This browser does not allow storage here, so your preferences last only in this tab.'
        : 'This browser keeps only your preferences (settings, layout) and a display copy of the last account seen, for a fast start.',
      'Preferences: ' + LABEL[m] + '.',
      unsaved ? 'The latest preference changes are not saved here (storage full or unavailable).' : '',
      refused ? 'The copy saved in this browser is from a newer version of tradeBerry. It was kept untouched and not loaded, so this tab does not save your preferences.' : '',
      readOnly ? 'This tab does not save your preferences: tradeBerry is open in another tab of this browser, which saves them (“Take over here” moves that to this tab). Orders still go to the execution server from here.' : '',
      'Export downloads a copy of the account as this page shows it.'].filter(Boolean).join(' ');
    const where = refused ? 'The account saved in this browser is from a newer version of tradeBerry. It was kept untouched and not loaded, so this tab does not save.'
      : backend === 'indexedDB' ? 'Your account, settings, journal and the market are kept in this browser’s storage (IndexedDB) on this device only.'
      : backend === 'localStorage' ? 'Your account, settings, journal and the market are kept in this browser’s localStorage on this device only (IndexedDB is unavailable).'
      : 'This browser does not allow storage here, so the account lives only in this tab.';
    return [where, LABEL[m] + '.',
      restored != null ? `The saved account was damaged, so the previous valid copy${restored ? ' (saved ' + new Date(restored).toLocaleString() + ')' : ''} was loaded. The damaged copy is kept apart until you export or reset.`
        : rejectedNow ? 'The saved account was damaged and no earlier valid copy exists, so a fresh account was started. The damaged copy is kept apart until you export or reset.' : '',
      trimmed ? `Only the last ${trimmed} trades of the journal are saved here (browser limit).` : '',
      unsaved ? 'The latest changes are not saved (unsaved: storage full or unavailable).' : '',
      readOnly ? (live() ? 'This tab is read-only: the account is open in another tab. It shows a live copy of that tab’s account and market (view-only) and becomes the writer when the other tab closes.'
        : 'This tab is read-only: the account is open in another tab. It shows a snapshot of that tab’s account and market from when it opened (this browser cannot pass updates between tabs) and becomes the writer when the other tab closes.') : '',
      'Export is the only guarantee: it downloads a copy you keep, and Import brings it back in any browser.'].filter(Boolean).join(' ');
  }
  function ui() {
    if (!isReady) return;
    const m = store.mode();
    banner.hidden = !readOnly; banner.style.display = readOnly ? 'flex' : 'none';
    // on the phone the banner sits under the top bar, so the account button (and the account type in its menu) stays
    // reachable while this tab is read-only (round 3 follow-up)
    if (readOnly) { const tb = document.querySelector('header.topbar'), mn = document.body.classList.contains('mnav-on'); banner.style.top = mn && tb ? Math.round(tb.getBoundingClientRect().bottom) + 'px' : '0'; }
    pill.textContent = readOnly ? (live() ? 'Read-only · live copy' : 'Read-only · snapshot') : (onServer() ? SERVER_PILL : SHORT[m]) + (unsaved ? ' · unsaved' : '');
    kindCheck();
    // on the server account a second tab still trades: only its preferences are not saved (UX-10)
    const bt = banner.querySelector('span'); if (bt) bt.textContent = onServer() ? 'Open in another tab — this tab does not save your preferences. Orders sent here still go to your account' : live() ? 'Open in another tab — this tab is read-only: a live copy, its market view-only' : 'Open in another tab — this tab is read-only: a snapshot from when it opened, not updated';
    pill.title = note();
    const n = document.getElementById('persistNote'); if (n) n.innerHTML = esc(note());
    const sp = document.getElementById('speedSel'); if (sp) sp.disabled = readOnly || !!Engine.realTime; // real prices: real time only
    for (const id of RO_CONTROLS) {
      const el = document.getElementById(id); if (!el) continue;
      if (readOnly) { if (!('roTitle' in el.dataset)) el.dataset.roTitle = el.getAttribute('title') || ''; el.disabled = true; el.title = RO_TITLE; }
      else if ('roTitle' in el.dataset) { el.disabled = false; if (el.dataset.roTitle) el.title = el.dataset.roTitle; else el.removeAttribute('title'); delete el.dataset.roTitle; }
    }
  }
  ready.then(() => {
    ui();
    if (readOnly) try { Engine.speed = 0; } catch (e) { /* engine missing */ }
    const ex = document.getElementById('exportBtn');
    if (ex) ex.addEventListener('click', () => {
      // any tab records the export (for the backup reminder) in a key of its own; only the writer writes the shell,
      // so a read-only tab never puts its theme or layout over the writer's
      const at = Date.now(); shell.lastExport = at;
      if (ls) { try { ls.setItem(K.exp, String(at)); } catch (e) { /* the reminder may come early */ } }
      if (!canWrite()) return;
      writeShell(at);
      // the user has a copy of their own now: the damaged one is let go
      if (ls) { try { ls.removeItem(K.rejected); } catch (e) { /* ignore */ } }
      if (backend === 'indexedDB') idbWrite([], ['rejected'], false).catch(e => console.warn('[Meridian] could not drop the damaged copy:', e));
      if (rejectedNow) { rejectedNow = false; restored = null; ui(); }
    });
    // after boot: messages that must stay on screen long enough to read, the one-time persist() request, the backup reminder
    (function after() {
      const b = document.getElementById('boot');
      if (b && !b.classList.contains('done')) return setTimeout(after, 200);
      booted = true; bootRes();
      document.addEventListener('visibilitychange', onVisibility);
      guardRO('checkDrawAlerts'); // draw.js loads after this file
      if (readOnly) roBase = acctOf(S);
      ui();
      if (refused) tell('Saved account not loaded', 'It was saved by a newer version of tradeBerry and is kept untouched. This tab starts a fresh account and does not save it.', 'dn');
      if (!readOnly && restored != null) tell('Saved account was damaged', 'The previous valid copy was loaded instead. The damaged copy is kept apart until you export or reset.', 'dn');
      else if (!readOnly && rejectedNow) tell('Saved account was damaged', 'It could not be loaded and there is no earlier valid copy, so a fresh account was started. The damaged copy is kept apart until you export or reset.', 'dn');
      if (canWrite() && !persisted && !shell.askedPersist && navigator.storage && navigator.storage.persist) {
        shell.askedPersist = true; writeShell(Date.now());
        navigator.storage.persist().then(v => { persisted = !!v; ui(); }).catch(() => {});
      }
      const day = 864e5, now = Date.now(), trades = typeof S === 'object' && S && S.history ? S.history.length : 0;
      const lastExport = Math.max(shell.lastExport || 0, +lsJSON(K.exp) || 0);
      if (canWrite() && !onServer() && trades >= 10 && now - lastExport > 7 * day && now - (shell.reminded || 0) > 3 * day) {
        shell.reminded = now; writeShell(now);
        tell('Keep a copy of your account', 'Browser storage can be cleared. Export (Help) saves a file you control.', 'info');
      }
      // a write that arrived while this tab was still booting
      if (readOnly) pull();
    })();
  });
})();
