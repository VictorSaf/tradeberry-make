/* livefeed.js — real prices from the broker platform, through the tradeBerry server (functions/api/quotes.js and
   history.js; the platform's key stays on the server). Signed in (v16), the account, the orders and the fills are on
   the execution server (tradelink.js); a page without it keeps them in this browser. On live prices the Speed control
   is hidden (real time only); replay and the local market keep it.
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
  const POLL_MS = 1000, HIDDEN_MS = 5000, ALIVE_MS = 10000, FIRST_MS = 5000, DAYS = 7, H_DAYS = 90, PARALLEL = 4;
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
        .then(p => { const b = unpack(p), ok = b.length ? Engine.feedHistory(sym, b) : false; if (ok) redraw(sym); res(ok); return ok && hourly(sym); })
        // a failed load is tried again 5 s later (and on any read after that)
        .catch(() => { res(false); setTimeout(() => { if (hist.get(sym) === pr0) { hist.delete(sym); load(sym); } }, 5000); })
        .finally(() => { running--; pump(); });
    }
  }
  // the 1-hour bars (H_DAYS) behind the 1H/4H views; a failure leaves them on the 1-minute history alone
  function hourly(sym) {
    return get('/api/history?sym=' + encodeURIComponent(sym) + '&res=60&days=' + H_DAYS, 30000)
      .then(r => (r.ok ? r.json() : null))
      .then(p => { const b = p ? unpack(p) : []; if (b.length && typeof Engine.feedHourly === 'function' && Engine.feedHourly(sym, b)) redraw(sym); })
      .catch(() => {});
  }
  /* On-demand history (spec istoric-la-cerere). The server answers /api/history with one aligned window (7 days of 1-minute
     bars, 365 days of 1-hour bars) and `more` (false = the platform had nothing there). liveRange walks windows back from
     `to`; up to WIN_PAR are in flight (the server limiter paces their start), but they are judged in window order, newest
     to oldest, so "two empty windows in a row = the platform's start" does not depend on which answer came first. */
  // WIN_BARS: the windows kept, in candles (~150,000 ≈ 15 weeks of 1-minute bars); the least recently used closed ones go
  const WIN = { 1: 604800, 60: 31536000 }, WIN_PAR = 3, WIN_BARS = 150000, wins = new Map();
  let winBars = 0;
  function winDrop(k) { const pr = wins.get(k); if (pr && pr.n) winBars -= pr.n; wins.delete(k); }
  window.liveHas = s => on && have.has(s);
  // one promise per sym|res|aligned window start (the server answers the whole window whatever `before` falls in it), so
  // two charts asking with a slightly different `to` share it; a failed one leaves the map. The window that holds "now"
  // is kept 30 s only (the server caches it as long), the closed ones up to WIN_BARS candles in all.
  function hwin(sym, res, before) {
    const k = sym + '|' + res + '|' + Math.floor((before - 1) / WIN[res]) * WIN[res];
    if (wins.has(k)) { const pr = wins.get(k); wins.delete(k); wins.set(k, pr); return pr; }
    const pr = get('/api/history?sym=' + encodeURIComponent(sym) + '&res=' + res + '&before=' + before + '&p=bg', 40000).then(async r => {
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) { const e = new Error((j && j.error) || 'History unavailable (' + r.status + ')'); e.status = r.status; throw e; }
      if (j.to * 1000 > Date.now() - 60000) setTimeout(() => { if (wins.get(k) === pr) winDrop(k); }, 30000);
      const v = { bars: unpack(j), more: j.more !== false };
      if (wins.get(k) === pr) {
        pr.n = v.bars.length; winBars += pr.n;
        for (const [key, q] of wins) { if (winBars <= WIN_BARS) break; if (key !== k && q.n) winDrop(key); }
      }
      return v;
    });
    wins.set(k, pr);
    pr.catch(() => { if (wins.get(k) === pr) winDrop(k); });
    return pr;
  }
  window.liveRange = (sym, res, from, to, o = {}) => new Promise((resolve, reject) => {
    res = res === 60 ? 60 : 1;
    const w = WIN[res], befores = [], sg = o.signal, rs = [];
    if (!(to > from)) return resolve({ bars: [], start: false, from, to });
    for (let b = to; ;) { befores.push(b); b = Math.floor((b - 1) / w) * w; if (b <= from) break; }
    let total = befores.length, issued = 0, flying = 0, seen = 0, empties = 0, start = false, over = false;
    const bars = [];
    const end = (f, v) => { if (over) return; over = true; if (sg) sg.removeEventListener('abort', stop); f(v); };
    const stop = () => end(reject, Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    if (sg) { if (sg.aborted) return stop(); sg.addEventListener('abort', stop); }
    function fill() {
      while (!over && !start && flying < WIN_PAR && issued < total) {
        const i = issued++; flying++;
        hwin(sym, res, befores[i]).then(r => { flying--; rs[i] = r; judge(); }, e => { flying--; end(reject, e); });
      }
    }
    function judge() {
      while (!over && !start && seen < total && rs[seen]) {
        const r = rs[seen++];
        for (const b of r.bars) bars.push(b);
        empties = r.more ? 0 : empties + 1;
        if (empties >= 2) { start = true; total = seen; } // windows still in flight are ignored (they stay cached)
        try { if (o.onProgress) o.onProgress(seen, total); } catch (e) { console.error('liveRange onProgress', e); }
      }
      if (over) return;
      if (start || seen >= total) {
        bars.sort((a, b) => a.time - b.time);
        end(resolve, { bars: bars.filter((b, i) => b.time >= from && b.time < to && (!i || b.time !== bars[i - 1].time)), start, from, to });
      } else fill();
    }
    fill();
  });
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

  /* the account type and its words come from persist.js only (window.acctKind; TradeLink.type is null until the server's
     first snapshot): the pill's title and Help › #simLabel say demo (no money) or live (real money) only once the server
     has said which, in the same words as the status-bar flag and the account menu. They are re-said on persist.js's
     'tb:acct-kind' event, the one signal of a change of type (no poll here). */
  const kind = () => typeof acctKind === 'function' ? acctKind() : null;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function sayKind() {
    if (!on) return;
    pill();
    const l = document.getElementById('simLabel'), k = kind();
    if (l) l.innerHTML = '<b>LIVE</b> Prices are the broker platform’s real bid and ask.' + (k ? ' ' + esc(k.label) : '');
  }
  document.addEventListener('tb:acct-kind', () => sayKind());
  // the status pill and the labels that described the simulated market
  function pill() {
    const f = document.getElementById('feedPill');
    if (!f || !on) return;
    const a = alive();
    f.textContent = a ? 'LIVE · platform prices' : 'NO FEED · trading paused';
    f.classList.toggle('feed-down', !a); f.classList.toggle('feed-live', a);
    f.title = a
      ? 'Bid and ask from the broker platform (Capitals Vision), ' + (streaming ? 'streamed as they change' : 'refreshed every second') + ' through the tradeBerry server.' + (kind() ? ' ' + kind().pill : '')
      : 'The broker platform has not answered for over 10 seconds' + (err ? ' (' + err + ')' : '') + '. Prices are frozen and every instrument is closed until it answers again.';
  }
  function decorate() {
    if (!on) return;
    sayKind();
    const c = document.getElementById('simClock'); if (c) c.title = 'Market time (UTC): real time';
    const sp = document.getElementById('speedSel');
    // real prices run in real time: the speed control has nothing to do here, so it is hidden, not only disabled
    // (replay and the local market keep it; .sel sets display, hence the inline style next to hidden)
    if (sp) { sp.value = '1'; sp.disabled = true; const lb = sp.closest('label') || sp; lb.hidden = true; lb.style.display = 'none'; lb.title = 'Real prices run in real time: no time compression'; }
  }

  return { start, prime, decorate, alive, get on() { return on; }, get error() { return err; }, get streaming() { return streaming; } };
})();
