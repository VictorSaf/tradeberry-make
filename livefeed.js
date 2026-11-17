/* livefeed.js — real prices from the broker platform, through the tradeBerry server (functions/api/quotes.js and
   history.js; the platform's key stays on the server). The account, the orders and the fills stay simulated in
   tradeBerry until the platform's trading API exists (decision 39 + Victor, 2026-10-26).
   - start(): one GET /api/quotes. No answer, 404 (the static test and dev servers) or 503 (not configured): the
     simulated market stays and start() resolves false. Otherwise the engine gets a realTime adapter: the wall clock,
     bid and ask of every instrument the platform quotes.
   - the ticks come from the stream (WebSocket /api/stream, relay/worker.js): each price as it changes, about ten
     batches a second. While the stream is not open the page reads /api/quotes every second (every 5 s while the tab
     is hidden) and tries the stream again, sooner at first, then every 30 s.
   - prime(syms): the 1-minute history of the instruments the first screen needs, before it draws; any other
     instrument loads its history the first time its candles are read (want), a few at a time.
   - alive(): an answer in the last 10 s. After that every fed instrument is closed ("no feed") and the status pill
     says so; nothing trades on a frozen price. */
const LiveFeed = (() => {
  const POLL_MS = 1000, HIDDEN_MS = 5000, ALIVE_MS = 10000, FIRST_MS = 5000, DAYS = 7, PARALLEL = 4;
  let on = false, okAt = 0, cb = null, timer = null, have = new Set(), err = '';
  const last = {}, hist = new Map(), queue = [];
  let running = 0, ws = null, streaming = false, wsWait = 2000, wsTimer = null;

  const get = async (url, ms) => {
    const c = typeof AbortController === 'function' ? new AbortController() : null, to = c ? setTimeout(() => c.abort(), ms) : null;
    try { return await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: c ? c.signal : undefined }); }
    finally { if (to) clearTimeout(to); }
  };
  async function quotes(ms) {
    const r = await get('/api/quotes', ms);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !Array.isArray(j.q)) { const e = new Error((j && j.error) || 'Live prices unavailable (' + r.status + ')'); e.status = r.status; throw e; }
    return j;
  }
  // only the rows that changed reach the engine
  function push(j) {
    if (j.err) { err = j.err; return; } // the relay's beat while the platform does not answer
    okAt = Date.now(); err = '';
    if (!cb || !Array.isArray(j.q)) return;
    for (const row of j.q) {
      const [s, bid, ask, t] = row;
      if (!have.has(s)) continue;
      const k = last[s];
      if (k && k[0] === bid && k[1] === ask && k[2] === t) continue;
      last[s] = [bid, ask, t];
      cb(s, bid, t, ask);
    }
  }
  let wasAlive = true;
  function watch() { const a = alive(); if (a !== wasAlive) { wasAlive = a; pill(); } }
  async function poll() {
    timer = null;
    if (streaming) return;
    try { push(await quotes(8000)); } catch (e) { err = e.message || 'Live prices unavailable'; }
    watch();
    if (!streaming) timer = setTimeout(poll, document.hidden ? HIDDEN_MS : POLL_MS);
  }
  function stream() {
    wsTimer = null;
    if (typeof WebSocket !== 'function' || ws) return;
    let s;
    try { s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/stream'); } catch (e) { return retry(); }
    ws = s;
    s.onopen = () => { streaming = true; wsWait = 2000; if (timer) { clearTimeout(timer); timer = null; } pill(); };
    s.onmessage = e => { let j = null; try { j = JSON.parse(e.data); } catch (x) { return; } if (j) push(j); };
    s.onclose = () => {
      const was = streaming; ws = null; streaming = false;
      if (!timer) timer = setTimeout(poll, was ? 0 : POLL_MS);
      pill(); retry();
    };
    s.onerror = () => { try { s.close(); } catch (e) { /* closing */ } };
  }
  function retry() { if (!wsTimer) { wsTimer = setTimeout(stream, wsWait); wsWait = Math.min(30000, wsWait * 2); } }
  const alive = () => Date.now() - okAt < ALIVE_MS;

  // the packed bars of server/legacy.js → [{time, open, high, low, close}]
  function unpack(p) {
    const out = [], ps = p.ps;
    if (!(ps > 0) || !Array.isArray(p.c)) return out;
    let c = 0, t = p.t0;
    for (let i = 0; i < p.c.length; i++) {
      c += p.c[i]; if (i) t += p.dt[i - 1] * 60;
      out.push({ time: t, open: (c - p.o[i]) / ps, high: (c + p.h[i]) / ps, low: (c - p.l[i]) / ps, close: c / ps });
    }
    return out;
  }
  function load(sym) {
    if (hist.has(sym)) return hist.get(sym);
    let res; const pr = new Promise(r => { res = r; });
    hist.set(sym, pr); queue.push([sym, res]); pump();
    return pr;
  }
  function pump() {
    while (running < PARALLEL && queue.length) {
      const [sym, res] = queue.shift(), pr0 = hist.get(sym);
      running++;
      get('/api/history?sym=' + encodeURIComponent(sym) + '&days=' + DAYS, 20000)
        .then(r => { if (!r.ok) throw new Error('history ' + r.status); return r.json(); })
        .then(p => { const b = unpack(p), ok = b.length ? Engine.feedHistory(sym, b) : false; if (ok) redraw(sym); res(ok); })
        // a failed load is tried again 5 s later (and on any read after that)
        .catch(() => { res(false); setTimeout(() => { if (hist.get(sym) === pr0) { hist.delete(sym); load(sym); } }, 5000); })
        .finally(() => { running--; pump(); });
    }
  }
  // a chart already drawn with the one bar the first quote made gets the whole history
  function redraw(sym) {
    try {
      if (typeof S === 'object' && S.set && S.set.sym === sym && typeof fullChart === 'function' && typeof candle !== 'undefined' && candle) fullChart(true);
      if (typeof MC === 'object' && typeof mcFull === 'function') for (const p of MC.panes) if (p.cfg && p.cfg.sym === sym) mcFull(p, true);
    } catch (e) { console.error('livefeed redraw', e); }
  }
  async function prime(syms, ms = 12000) {
    if (!on) return;
    const all = Promise.all([...new Set(syms)].filter(s => have.has(s)).map(load));
    await Promise.race([all, new Promise(r => setTimeout(r, ms))]);
  }

  async function start() {
    if (on || typeof Engine !== 'object' || Engine.isReplayDoc || typeof fetch !== 'function') return on;
    let j;
    try { j = await quotes(FIRST_MS); } catch (e) { err = e.message || ''; return false; }
    have = new Set(j.q.map(r => r[0]).filter(s => Engine.META[s]));
    if (!have.size) return false;
    Engine.setFeed({
      realTime: true,
      has: s => have.has(s),
      onTicks: f => { cb = f; },
      alive,
      want: s => { if (!hist.has(s) && have.has(s)) load(s); }
    });
    on = true;
    push(j);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) { clearTimeout(timer); poll(); } });
    timer = setTimeout(poll, POLL_MS);
    setInterval(watch, 1000);
    stream();
    return true;
  }

  // the status pill and the labels that described the simulated market
  function pill() {
    const f = document.getElementById('feedPill');
    if (!f || !on) return;
    const a = alive();
    f.textContent = a ? 'LIVE · platform prices' : 'NO FEED · trading paused';
    f.classList.toggle('feed-down', !a);
    f.title = a
      ? 'Bid and ask from the broker platform (Capitals Vision), ' + (streaming ? 'streamed as they change' : 'refreshed every second') + ' through the tradeBerry server. Your account, orders and fills are simulated in tradeBerry: no real money.'
      : 'The broker platform has not answered for over 10 seconds' + (err ? ' (' + err + ')' : '') + '. Prices are frozen and every instrument is closed until it answers again.';
  }
  function decorate() {
    if (!on) return;
    pill();
    const c = document.getElementById('simClock'); if (c) c.title = 'Market time (UTC): real time';
    const l = document.getElementById('simLabel');
    if (l) l.innerHTML = '<b>LIVE</b> Prices are the broker platform’s real bid and ask. The account, orders and fills are simulated in tradeBerry until the platform’s trading API is connected: no real money is at risk.';
    const sp = document.getElementById('speedSel');
    if (sp) { sp.value = '1'; sp.disabled = true; const lb = sp.closest('label'); if (lb) lb.title = 'Real prices run in real time: no time compression'; }
  }

  return { start, prime, decorate, alive, get on() { return on; }, get error() { return err; }, get streaming() { return streaming; } };
})();
