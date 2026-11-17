'use strict';
/* tradeBerry — the link to the execution server (WebSocket /api/trade, host/gateway.mjs). On a signed-in page the
   account lives on the server: this browser sends commands and shows what the server reports, from as many sessions
   as are open. Nothing about the account is decided here.
   - TradeLink.live: the page is served signed in (cookie tb_u=1, or a browser that synced before) and is not a replay. A page
     without the server (a static copy, the test and dev servers) keeps the local account as before (sandbox), and a
     replay, the backtester and the Coach keep the local core in every case.
   - Commands { op, cid, … } get a promise each (send); a reply { cid, ok, id?, code?, text? } settles it. While the
     socket is closed a command is refused at once ("Execution server unreachable"): nothing waits to go out later. A
     command still unanswered when the socket drops is sent again with the same cid after the reconnect (the gateway
     answers a repeated cid with the same result, never a second order), only while it is younger than 3 s; an older one
     is answered here: the connection dropped before the answer, check the account (M8).
   - The server may close the socket with a reason the bar shows instead of "unreachable": 4029 (the account open in 10
     tabs or devices already), 4401 (signed out), 4503 (the account is being moved to the server); it tries again every 30 s.
   - Readouts (I7): the history (the newest 500 rows), the fill receipts (500) and the order log (300) come from the
     broker (records), after every snapshot; the peak equity is the broker's (acct.peak), the same on every device.
   - Events: snapshot (at every connection and after every gateway logon: the whole account, nothing incremental), exec
     (fill, new, replaced, restated, cancel, reject), pos, ord, acct, gw, link. Each is applied to S in the shapes S has
     always had (sanitizeState-compatible), then changed() redraws.
   - No optimistic money: a command shows "Sent" (positions/orders tables, the chart line of a dragged level) until the
     server's report changes the account; a refusal shows the toast of today, with the server's text.
   - The link is shown honestly: until the first snapshot the account on screen is the last one seen (IndexedDB), and
     the bar says so; with the socket closed or the broker unreachable the bar says "Execution server unreachable" and
     the order buttons are disabled.
   Task 9 shapes (host/gateway.mjs, host/gateway/oms.mjs headers):
   - snapshot.info / acct.info = { type: 'demo' | 'live', set: { jur, lev, slip, slipSd, latMs, comm } } (null until the
     broker's first BA);
   - snapshot.gw = gw_state { key: value }, then ev 'gw' { key, value }: alerts, chal, bkPos, bkOrders, bkHist, bkAlerts
     (the shapes S had), ordMeta { [clOrdId]: { exits: { sl, tp, slPips, tpPips, trail, tps, be }, … } };
   - a position's meta (gw_meta) carries the journal fields and prot { trail, trailNow, trailSl, trailed, be, beSl };
   - ev 'notice' { kind, text?, … }: what the server did on its own (exits, break-even, baskets, alerts, time stops,
     challenge), shown as a toast.
   - commands beyond Task 8's: order { sl, tp, slPips, tpPips, trail, tps, be, pm, ctx, reason }, close { reason },
     modify { posId, sl?, tp?, tps?, trail?, be? } | { id, price?, limit?, … }, basket { do: open | … },
     alert { do: add | edit | del }. */
const TradeLink = (() => {
  const served = (() => { try { return /(?:^|;\s*)tb_u=1(?:;|$)/.test(document.cookie) || !!localStorage.getItem('tb-sync'); } catch (e) { return false; } })();
  let live = served && typeof WebSocket === 'function' && !(typeof Engine === 'object' && Engine.isReplayDoc);
  /* on a local host the tb_u cookie is shared by every port (cookies ignore the port): an old one from the local live
     server makes a static copy on another port look signed in. A /api/me answered 404 (a server without the API, not a
     401 or a 200) means this page is not on the execution server: it keeps the local account and the stale cookie is
     removed on this host. Only local hosts ask (tb.oneaigency.com is unchanged); boot waits for it (TradeLink.ready). */
  const LOCAL = typeof location === 'object' && /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/i.test(location.hostname);
  const ready = !live || !LOCAL || typeof fetch !== 'function' ? Promise.resolve() : Promise.race([
    fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }).then(r => {
      if (r.status !== 404) return;
      live = false; st.live = false;
      try { document.cookie = 'tb_u=; Path=/; Max-Age=0; SameSite=Lax'; } catch (e) { /* nothing to remove */ }
    }, () => {}),
    new Promise(res => setTimeout(res, 4000)) // no answer: as before (signed in, the bar says if the server is unreachable)
  ]);
  const SEEN = 'tb-tl-seen', DOWN = 'Execution server unreachable', WAIT_MS = 20000, RESEND_MS = 3000;
  const LOST = 'The connection dropped before the execution server answered: check the account (positions, orders) before sending again';
  const st = { live, sock: false, link: 'down', seen: false, type: null, gw: {}, seenAt: 0 };
  try { st.seenAt = +localStorage.getItem(SEEN) || 0; } catch (e) { /* no storage */ }
  let ws = null, backoff = 1000, timer = 0, nCid = 0;
  const cmds = new Map();             // cid → { msg, resolve, timer, label, kind }
  const book = new Map();             // clOrdId → the order as the server reports it (entries and linked SL/TP)
  const meta = new Map();             // position id → journal fields (gw_meta)
  const histSeen = new Set();         // history rows already shown (a new one is a close of this session: its toast)
  let histReady = false, histAsk = null, histAgain = false;
  /* a reduction by hand sent from here: { pos, of, lots } on its cid, the position's lots when it was sent and the lots
     it closes. Its toast ("0.05 of 0.10 closed, 0.05 left") is worked out from these when its history row comes, never
     from the mirror (the row can come before or after the gateway's 'pos'). of: the mirror's lots, or less when an
     earlier reduction of the same position is still on its way (two quick ½). */
  const parts = new Map();
  function partSent(cid, fields) {
    if (fields.posId == null || !(fields.lots > 0)) return;
    const p = S.positions.find(x => x.id === fields.posId); if (!p) return;
    for (const [k, x] of parts) if (Date.now() - x.t > 60000) parts.delete(k); // a row that never came: forgotten after a minute
    let of = p.lots;
    for (const x of parts.values()) if (x.pos === fields.posId) of = Math.min(of, x.of - x.lots);
    parts.set(cid, { pos: fields.posId, of, lots: fields.lots, t: Date.now() });
    if (parts.size > 50) parts.delete(parts.keys().next().value);
  }
  function partOf(h) {
    for (const [cid, x] of parts) if (x.pos === h.id && Math.abs(x.lots - h.lots) < 1e-9) { parts.delete(cid); return x; }
    for (const [cid, x] of parts) if (x.pos === h.id) { parts.delete(cid); return x; } // the server took less (what was left)
    return null;
  }
  const fin = v => typeof v === 'number' && isFinite(v);
  const device = () => { let d = null; try { d = localStorage.getItem('tb-device'); } catch (e) { /* no storage */ } if (!d || !/^[a-z0-9]{12,40}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('') + Date.now().toString(36); try { localStorage.setItem('tb-device', d); } catch (e) { /* one id per page */ } } return d; };

  /* ---------- the socket ---------- */
  function connect() {
    timer = 0;
    let s;
    try { s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/trade?device=' + device()); } catch (e) { return retry(); }
    ws = s;
    s.onopen = () => {
      st.sock = true; backoff = 1000;
      for (const [cid, c] of [...cmds]) { if (Date.now() - c.t > RESEND_MS) c.resolve({ ok: false, code: 'LINK_LOST', text: LOST }); else s.send(JSON.stringify(c.msg)); }
      ui();
    };
    s.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } safe('execution server', () => onMsg(m)); };
    s.onclose = ev => {
      if (ws !== s) return; ws = null; st.sock = false; st.failed = true;
      // a closing the server explains: its words on the bar, and a slow retry
      if (ev && [4029, 4401, 4503].includes(ev.code) && ev.reason) { st.refused = ev.reason; backoff = 30000; }
      ui(); retry();
    };
    s.onerror = () => {};
  }
  function retry() { if (timer) return; timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); }
  // no waiting out the backoff when the browser is online again, the tab comes back or the trader clicks the bar (UX-44)
  function retryNow() { if (st.sock || ws || st.refused) return; clearTimeout(timer); timer = 0; backoff = 1000; connect(); }
  addEventListener('online', retryNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryNow(); });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#tlBar')) retryNow(); });
  // the link is usable: socket open, the gateway linked to the broker, the account as the server holds it on screen
  const up = () => st.sock && st.link === 'up' && st.seen;
  function send(op, fields = {}, label = '', kind = '') {
    if (!live) return Promise.resolve({ ok: false, code: 'LOCAL', text: 'Not on the execution server' });
    if (!up()) return Promise.resolve({ ok: false, code: 'LINK_DOWN', text: DOWN });
    const cid = 'b' + Date.now().toString(36) + '-' + (++nCid) + '-' + Math.random().toString(36).slice(2, 6);
    const msg = { ...fields, op, cid };
    return new Promise(resolve => {
      const c = { msg, label, kind, t: Date.now(), resolve: r => { clearTimeout(c.timer); cmds.delete(cid); if (!r.ok) parts.delete(cid); if (kind) changed(kind); resolve(r); } };
      c.timer = setTimeout(() => c.resolve({ ok: false, code: 'TIMEOUT', text: 'No answer from the execution server: check the account before sending again' }), WAIT_MS);
      cmds.set(cid, c);
      if (op === 'close') partSent(cid, fields);
      if (kind) changed(kind);
      try { ws.send(JSON.stringify(msg)); } catch (e) { /* sent again at the reconnect */ }
    });
  }

  /* ---------- the server's account in S ---------- */
  const legs = id => [...book.values()].filter(o => o.linkPos === id);
  function posView(p, x = S.positions.find(y => y.id === p.id)) {
    const m = M(p.sym), mt = meta.get(p.id) || {}, g = mt.prot || {}, L = legs(p.id), sl = L.find(o => o.leg === 'SL');
    const tps = L.filter(o => /^TP[1-4]$/.test(o.leg)).sort((a, b) => a.leg.localeCompare(b.leg)).map(o => ({ price: o.price, lots: o.lots, leg: o.leg }));
    const v = x || { fills: [], src: null };
    Object.assign(v, { id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, swap: p.swap || 0, comm: p.comm || 0, open: p.open ?? Engine.simTime,
      sl: sl ? sl.price : null, tp: tps.length ? tps[0].price : null, trail: +g.trail || 0 });
    if (fin(p.im)) v.im = p.im;
    if (tps.length > 1) v.tps = tps; else delete v.tps;
    for (const k of ['be', 'trailNow', 'trailSl', 'trailed', 'beSl']) if (g[k] != null) v[k] = g[k]; else delete v[k];
    v.risk = v.sl != null && m ? Math.abs(v.entry - v.sl) * v.lots * m.size * Engine.usd(m.quote) : null;
    for (const [k, x] of Object.entries(mt)) if (k !== 'prot') v[k] = x;
    return v;
  }
  function ordView(o, x = S.orders.find(y => y.id === o.clOrdId)) {
    // its exits: the gateway's view (ordMeta), else the terms the broker reports with the order (I5 / I6)
    const om = (st.gw.ordMeta || {})[o.clOrdId] || {}, e = om.exits || o, v = x || { created: om.t ?? Engine.simTime };
    Object.assign(v, { id: o.clOrdId, sym: o.sym, side: o.side, ot: o.ot === 'stoplimit' ? 'stop' : o.ot, price: o.price, limit: o.ot === 'stoplimit' ? o.limit : null, lots: o.lots,
      tif: o.tif || 'GTC', expires: o.expires ?? null, oca: o.oca || null, net: !!o.net, status: 'pending', slPips: +e.slPips || 0, tpPips: +e.tpPips || 0, trail: +e.trail || 0 });
    if (Array.isArray(e.tps) && e.tps.length) v.tps = e.tps; else delete v.tps;
    if (e.be) v.be = e.be; else delete v.be;
    return v;
  }
  const isEntry = o => o && o.linkPos == null && o.ot !== 'market';
  function setPos(p) {
    const i = S.positions.findIndex(y => y.id === p.id);
    if (!(p.lots > 0)) { if (i >= 0) S.positions.splice(i, 1); return; }
    const v = posView(p, i >= 0 ? S.positions[i] : undefined); if (i < 0) S.positions.push(v);
  }
  // a position's levels follow its linked orders
  const relink = id => { const p = S.positions.find(y => y.id === id); if (p) posView(p, p); };
  function setOrder(o) {
    book.set(o.clOrdId, o);
    if (o.linkPos != null) return relink(o.linkPos);
    if (!isEntry(o)) return;
    const i = S.orders.findIndex(y => y.id === o.clOrdId), v = ordView(o, i >= 0 ? S.orders[i] : undefined); if (i < 0) S.orders.push(v);
  }
  // an order that left the book: its order-log row (the status from the exec that removed it)
  const gone = new Map();
  function dropOrder(cl) {
    const o = book.get(cl); book.delete(cl); if (!o) return;
    if (o.linkPos != null) return relink(o.linkPos);
    const i = S.orders.findIndex(y => y.id === cl); if (i >= 0) { gone.set(cl, S.orders[i]); S.orders.splice(i, 1); }
  }
  function applySet(a) {
    if (!a) return;
    st.type = a.type === 'demo' || a.type === 'live' ? a.type : st.type;
    if (a.set && typeof a.set === 'object') { for (const k of ['jur', 'lev', 'slip', 'slipSd', 'latMs', 'comm']) if (a.set[k] !== undefined) S.set[k] = a.set[k]; if (typeof syncLevSel === 'function') syncLevSel(); }
    syncReset();
  }
  function applyGw(g) {
    if (!g || typeof g !== 'object') return;
    Object.assign(st.gw, g);
    if (Object.hasOwn(g, 'alerts')) S.alerts = Array.isArray(g.alerts) ? g.alerts.map(a => ({ ...a })) : [];
    for (const k of ['bkPos', 'bkOrders', 'bkHist', 'bkAlerts']) if (Object.hasOwn(g, k)) S[k] = Array.isArray(g[k]) ? g[k] : [];
    if (Object.hasOwn(g, 'chal')) S.chal = g.chal;
    for (const p of S.positions) posView(p, p);
    for (const o of S.orders) { const b = book.get(o.id); if (b) ordView(b, o); }
    // the panels that show this state redraw (Observatory › Baskets, Coach › Challenge)
    if (['bkPos', 'bkOrders', 'bkHist', 'bkAlerts'].some(k => Object.hasOwn(g, k)) && typeof obsDraw === 'function') setTimeout(() => safe('baskets', obsDraw), 0);
    if (Object.hasOwn(g, 'chal') && typeof renderChal === 'function' && typeof activeTab === 'string' && activeTab === 'chal') setTimeout(() => safe('challenge', renderChal), 0);
  }
  function snapshot(m) {
    st.link = m.link === 'up' ? 'up' : 'down';
    book.clear(); meta.clear(); gone.clear();
    for (const p of m.positions || []) if (p.meta) meta.set(p.id, p.meta);
    for (const o of m.orders || []) book.set(o.clOrdId, o);
    st.gw = {}; applyGw(m.gw || {});
    S.positions = []; for (const p of m.positions || []) setPos(p);
    S.orders = []; for (const o of m.orders || []) if (isEntry(o)) S.orders.push(ordView(o, null));
    acct(m.acct);
    applySet(m.info);
    st.refused = null;
    const ex = (m.execs || []).filter(e => e && e.kind === 'fill' && e.receipt).map(e => e.receipt).reverse();
    { const had = st.seen && Array.isArray(S.fills) ? new Set(S.fills.map(f => f.fid + ':' + f.pos + ':' + f.t)) : null;
      if (had) for (const r of ex.slice(0, 5)) if ((r.kind === 'open' || r.kind === 'add') && !had.has(r.fid + ':' + r.pos + ':' + r.t)) toast(`${r.side === 'buy' ? 'Bought' : 'Sold'} ${lotsFmt(r.sym, r.lots)}${r.kind === 'add' ? ' more' : ''} ${pretty(r.sym)}`, `@ ${fp(r.sym, r.px)} · confirmed after the link came back`, r.side === 'buy' ? 'up' : 'dn'); }
    S.fills = ex.slice(0, 500);
    st.seen = true; st.seenAt = Date.now(); try { localStorage.setItem(SEEN, String(st.seenAt)); } catch (e) { /* no storage */ }
    changed('pos', 'ord', 'hist', 'al');
    history(); records();
    ui(); waiters();
  }
  // the account amounts; the peak is the broker's when it sends one (the drawdown readout, the same on every device)
  function acct(a) {
    if (!a || !fin(a.balance)) return;
    S.balance = a.balance;
    S.peak = fin(a.peak) ? a.peak : Math.max(S.peak || 0, S.balance);
  }
  // the fill receipts (≤ 500) and the order log (≤ 300) as the broker holds them, migrated ones included
  async function records() {
    const r = await send('records', { fills: 500, log: 300 });
    if (!r.ok || !Array.isArray(r.fills)) return;
    const live = (S.fills || []).filter(f => !r.fills.some(x => x.fid === f.fid && x.t === f.t)); // heard meanwhile
    S.fills = [...live.filter(f => f.t > (r.fills[0] ? r.fills[0].t : 0)), ...r.fills].slice(0, 500);
    if (Array.isArray(r.ordLog)) S.ordLog = r.ordLog.slice(0, 300);
    changed('ord', 'hist');
  }
  /* a position shown (whenPos) or gone (whenGone): resolved by the server's events, not a fixed wait; null after WAIT_MS */
  const want = [];
  function waiters() { for (const w of [...want]) { const has = S.positions.some(p => p.id === w.id); if (has === w.has) { want.splice(want.indexOf(w), 1); clearTimeout(w.t); w.res(w.has ? S.positions.find(p => p.id === w.id) : true); } } }
  const whenPos = (id, has = true, ms = WAIT_MS) => new Promise(res => { const w = { id, has, res, t: setTimeout(() => { want.splice(want.indexOf(w), 1); res(has ? null : false); }, ms) }; want.push(w); waiters(); });
  function onExec(e) {
    const cl = e.ids && e.ids.clOrdId;
    if (e.kind === 'fill' && e.receipt) {
      const r = e.receipt; if (!Array.isArray(S.fills)) S.fills = [];
      if (!S.fills.some(f => f.fid === r.fid && f.pos === r.pos && f.t === r.t)) { S.fills.unshift(r); if (S.fills.length > 500) S.fills.length = 500; }
      const o = gone.get(cl); if (o) { gone.delete(cl); logOrder({ ...o, status: 'filled', end: r.t }); }
      if (r.kind === 'open' || r.kind === 'add') {
        legToast(`${r.side === 'buy' ? 'Bought' : 'Sold'} ${lotsFmt(r.sym, r.lots)}${r.kind === 'add' ? ' more' : ''} ${pretty(r.sym)}`, `@ ${fp(r.sym, r.px)}${Math.abs(r.slip) >= .1 ? ' · slip ' + slipWords(r.slip, r.sym) : ''}`, r.side === 'buy' ? 'up' : 'dn');
        legBeep('fill');
      } else history(); // a close or a reduction: its trade row (and its toast) comes with the history
      changed('pos', 'ord');
    } else if (e.kind === 'cancel' || e.kind === 'reject') {
      const o = gone.get(cl); if (o) { gone.delete(cl); logOrder({ ...o, status: e.kind === 'cancel' ? (/expir/i.test(e.text || '') ? 'expired' : 'cancelled') : 'rejected', end: Engine.simTime, why: e.text || '' }); }
    }
  }
  function onMsg(m) {
    if (m.cid != null && !m.ev) { const c = cmds.get(String(m.cid)); if (c) c.resolve(m); return; }
    switch (m.ev) {
      case 'snapshot': return snapshot(m);
      case 'link': st.link = m.state === 'up' ? 'up' : 'down'; return ui();
      case 'ord': if (m.gone) dropOrder(m.clOrdId); else if (m.order) setOrder(m.order); return changed('pos', 'ord');
      case 'pos': if (m.meta) meta.set(m.pos.id, m.meta); { const was = S.positions.find(y => y.id === m.pos.id); setPos(m.pos); if (was && !(m.pos.lots >= was.lots)) history(); } waiters(); return changed('pos');
      case 'acct': acct(m.acct); applySet(m.info); return changed('pos');
      case 'notice': return notice(m);
      case 'exec': return onExec(m.exec || {});
      case 'gw': if (typeof m.key === 'string') applyGw({ [m.key]: m.value }); return changed('pos', 'ord', 'al');
    }
  }
  // what the server did on its own: a toast ('title · details' texts split there)
  const NOTICE = { exit: 'Exits', be: 'Stop moved to break-even', basket: 'Basket', bkAlert: 'Basket alert', alert: 'Alert', chal: 'Challenge', timeStop: 'Time stop' };
  function notice(m) {
    // challenge events without a text: today's challenge.js wording for them
    if ((typeof m.text !== 'string' || !m.text) && m.kind === 'chal' && typeof chNotice === 'function') return chNotice(m);
    if (typeof m.text !== 'string' || !m.text) return;
    const i = m.text.indexOf(' · '), title = i > 0 && i < 60 ? m.text.slice(0, i) : NOTICE[m.kind] || 'Execution server', body = i > 0 && i < 60 ? m.text.slice(i + 3) : m.text;
    toast(title, body, m.kind === 'chal' ? 'dn' : 'info');
    if (m.kind === 'alert' || m.kind === 'bkAlert') beep('alert');
  }
  // the trade history: page 0 (newest 200) after every snapshot and every close; a row this session has not shown yet
  // is a close that just happened: its toast is today's
  async function history() {
    if (histAsk) { histAgain = true; return histAsk; }
    histAsk = (async () => {
      const r = await send('history', { page: 0, size: 500 }); // the newest 500 rows, as the browser always kept
      if (!r.ok || !Array.isArray(r.rows)) return;
      const rows = r.rows.map(h => { const x = { note: '', ...h, ...(h.meta || {}) }; delete x.meta; return x; });
      const key = h => `${h.id}:${h.close}:${h.lots}`;
      if (histReady) for (const h of rows.filter(h => !histSeen.has(key(h))).reverse()) {
        if (h.nbp) toast('Negative balance protection', `The last close left the balance below zero. ${usdFmt(h.pnl)} covered; balance reset to ${usdFmt(0)}.`, 'info');
        else if (M(h.sym)) {
          // a reduction by hand says what is left (trade.js partToast; UX 09.11.2026, F10): from the command itself (the
          // position's lots when it was sent, the lots the server closed), not from the mirror; a reduction sent from
          // elsewhere, or one that took all that was left, keeps the plain toast
          const x = h.reason === 'Partial close' ? partOf(h) : null, left = x && x.of - h.lots > 1e-9 ? { of: x.of, lots: +(x.of - h.lots).toFixed(8) } : null;
          legToast(left ? partToast(h.sym, h.lots, left.of, left.lots) : `${h.reason}: ${pretty(h.sym)} ${lotsFmt(h.sym, h.lots)}`, `${left ? `${pretty(h.sym)} #${h.id} · ` : ''}${usdFmt(h.pnl, true)} · ${sgn(h.pips)} ${unitWord(h.sym)} · closed @ ${fp(h.sym, h.exit)}${Math.abs(h.slip) >= .1 ? ' · slip ' + slipWords(h.slip, h.sym) : ''}${h.gap ? ' · gap' : ''}`, h.pnl >= 0 ? 'up' : 'dn'); legBeep(h.pnl >= 0 ? 'win' : 'loss');
        }
      }
      for (const h of rows) histSeen.add(key(h));
      histReady = true;
      S.history = rows; changed('hist');
    })().finally(() => { histAsk = null; if (histAgain) { histAgain = false; history(); } });
    return histAsk;
  }

  /* ---------- what the user sees of the link ---------- */
  let bar = null;
  function ui() {
    if (!live) return;
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'tlBar'; bar.className = 'tl-bar'; bar.setAttribute('role', 'status'); bar.hidden = true;
      (document.getElementById('statusbar') || document.body).before(bar);
    }
    const when = st.seenAt ? new Date(st.seenAt).toLocaleString() : '';
    const t = up() ? '' : st.refused && !st.sock ? `${st.refused}${st.seen ? ' The account shown is as last seen.' : ''}` : !st.seen && st.failed ? `${DOWN}: orders cannot be sent.${when ? ` The account shown is as last seen ${when}.` : ''}`
      : !st.seen ? (when ? `Last seen ${when} · connecting to the execution server…` : 'Connecting to the execution server…')
      : `${DOWN}: orders cannot be sent. The account shown is as last seen${st.sock ? ' (the server cannot reach the broker)' : ''}.`;
    bar.textContent = t; bar.hidden = !t; bar.classList.toggle('bad', !!t && (st.seen || st.failed));
    document.documentElement.classList.toggle('tl-down', !up());
    if (typeof tkQuickState === 'function' && typeof S === 'object' && S) { tkQuickWhy = null; safe('ticket', () => tkQuickState(S.set.sym)); }
    dirty.lines = true;
  }
  // Reset account: on a demo account only (its control is absent on a live one, and while the type is not known)
  function syncReset() {
    const b = document.getElementById('resetAcct'); if (b) { b.hidden = st.type !== 'demo'; b.title = 'Closes every position, cancels the orders, clears the history and starts this demo account again at $100,000 on the execution server'; }
    const i = document.getElementById('importBtn'); if (i) { i.textContent = 'Import preferences'; i.title = 'Loads the interface preferences of an export (settings, ticket, watchlist, drawings, lines); the account on the execution server is not changed'; }
  }

  function start() {
    if (!live || ws || timer) return;
    ui(); syncReset(); connect();
  }
  const sent = kind => [...cmds.values()].filter(c => c.kind === kind && c.label);
  return {
    get live() { return live; }, get up() { return up(); }, get seen() { return st.seen; }, get type() { return st.type; }, get link() { return st.link; }, get sock() { return st.sock; }, get gw() { return st.gw; },
    DOWN, start, send, sent, history, records, meta, ui, whenPos, ready
  };
})();
// the order buttons say why nothing can be sent while the execution server is not reachable (as for a closed market)
if (TradeLink.live) {
  const _tkBlocks = tkBlocks;
  tkBlocks = function (k) { const b = _tkBlocks.apply(this, arguments); if (TradeLink.live && !TradeLink.up) b.unshift({ btn: TradeLink.DOWN, why: TradeLink.DOWN + '.' }); return b; };
  const _tkQuick = tkQuickState;
  tkQuickState = function (sym) {
    if (TradeLink.up || !TradeLink.live) return _tkQuick.apply(this, arguments);
    tkQuickWhy = TradeLink.DOWN;
    for (const b of $$('#qBuy,#qSell')) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = TradeLink.DOWN; }
  };
}
