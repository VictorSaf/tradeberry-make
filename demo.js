/* tradeBerry — demo trading history.
   Builds a realistic, fully virtual account on top of the simulated price history so every
   analytics module has data: ~260 closed trades over the last 6 days, replayed bar by bar on the
   real 1-minute path (SL / TP / trailing / time stops hit where the price actually went), plus
   human habits the coach can find — early profit-taking, a few widened stops, revenge trades,
   bursts of over-trading, pre-mortems with confidence and mood, journal tags and notes —
   and a handful of open positions, pending orders and alerts.
   Honest by construction: every decision (direction, size, setup tag, confidence) uses only bars
   up to the entry, and the week's result is whatever the path gives — no retries, no rescaling.
   The market is a zero-drift random walk, so the expected result is about zero minus costs. */
(function demo() {
  if (typeof S === 'undefined' || !S || !S.set || typeof Engine === 'undefined' || !Engine.candles || !Engine.candles.EURUSD || typeof bhState !== 'function' || typeof renderJournal !== 'function') return setTimeout(demo, 200);

  // deterministic per session so a reload of the same session tells the same story
  let seed = 20261018;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const wpick = (items) => { const t = items.reduce((s, x) => s + x[1], 0); let r = rnd() * t; for (const [v, w] of items) { if ((r -= w) <= 0) return v; } return items[0][0]; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  const SYMS = [['EURUSD', 18], ['GBPUSD', 14], ['USDJPY', 12], ['AUDUSD', 7], ['USDCAD', 6], ['USDCHF', 5], ['EURJPY', 7], ['GBPJPY', 8], ['EURGBP', 5], ['NZDUSD', 4], ['AUDJPY', 4], ['EURAUD', 3], ['GBPCHF', 2], ['CADJPY', 2], ['EURCHF', 2], ['AUDNZD', 1]]
    .filter(([s]) => Engine.META[s]);
  const SETUPS = { Pullback: .9, Trend: .7, Breakout: .45, Range: .4, Reversal: .3, News: .2, Impulse: .2 };
  const NOTES_W = ['Waited for the retest, clean entry.', 'Followed the plan, let it run to target.', 'Good patience — entry at the level.', 'London open momentum, trailed nicely.', 'Took it at the 1H EMA20 bounce.', 'Scaled in too late but still worked.', 'Banked early — could have held for TP.'];
  const NOTES_L = ['Entered before confirmation.', 'Stop was inside the noise, got wicked out.', 'Chased the candle, no edge.', 'Ignored the 4H trend.', 'Moved my stop — should not have.', 'News spike took me out.', 'Revenge trade after the previous loss.', 'Size too big, closed in panic.'];
  const KILL = ['Out if 1H closes back through the level', 'Exit if no follow-through in 2 hours', 'Close before the US data', 'Exit on a 15m close against the EMA20', ''];
  const MOOD_W = [['calm', 34], ['confident', 26], ['bored', 10], ['anxious', 12], ['FOMO', 10], ['frustrated', 8]];

  const idxAt = (arr, t) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m].time <= t) lo = m; else hi = m - 1; } return lo; };
  function hourRange(arr, i) { // average 1-hour range over the previous 6 hours
    let s = 0, k = 0;
    for (let h = 1; h <= 6; h++) { const a = i - h * 60, z = a + 60; if (a < 0) break; let H = -Infinity, L = Infinity; for (let j = a; j < z; j++) { if (arr[j].high > H) H = arr[j].high; if (arr[j].low < L) L = arr[j].low; } s += H - L; k++; }
    return k ? s / k : arr[i].close * .001;
  }

  function build(opts = {}) {
    const N = opts.trades || 260, days = opts.days || 6;
    const now = Engine.simTime, t0 = now - days * 86400, tEnd = now - 3 * 3600;
    const trades = [];
    let t = t0 + 1800, bal = 100000, lastLossClose = -1e12, id = 1;
    const meanGap = (tEnd - t0) / N;
    while (trades.length < N && t < tEnd) {
      const sym = wpick(SYMS), m = Engine.META[sym], arr = Engine.candles[sym], pip = m.pip;
      const i = idxAt(arr, t); if (i < 400 || i > arr.length - 30) { t += meanGap; continue; }
      const px = arr[i].close, hr = hourRange(arr, i) / pip, trend = Math.sign(px - arr[i - 240].close);
      const flags = [];
      // persona: mostly trend-following, sometimes fades the move
      const withTrend = rnd() < .68; let d = (withTrend ? trend : -trend) || (rnd() < .5 ? 1 : -1);
      if (!withTrend) flags.push('trend');
      const noSL = rnd() < .04;
      let slP = Math.max(6, Math.round(hr * (.55 + rnd() * 1.1)));
      if (rnd() < .1) { slP = Math.max(4, Math.round(hr * .3)); flags.push('tight'); }
      const rrT = wpick([[1, 10], [1.5, 22], [2, 34], [2.5, 12], [3, 10], [.8, 6], [0, 6]]);
      const tpP = rrT ? Math.round(slP * rrT) : null; if (rrT && rrT < 1) flags.push('rr');
      let riskPct = Math.max(.25, Math.min(3.5, .55 + gauss() * .25)); if (rnd() < .07) riskPct = 2.1 + rnd() * 1.2;
      if (riskPct > 2) flags.push('size');
      const pv = LOT * pip * Engine.usd(m.quote);
      let lots = Math.max(.01, Math.round((100000 + (bal - 100000) * .3) * riskPct / 100 / (slP * pv) * 100) / 100); lots = Math.min(lots, 12);
      const spr = m.spread * pip, entry = d > 0 ? px + spr : px; // candles are bids (v15): a buy fills at the ask
      if (slP < 8 && m.spread > 1) flags.push('cost');
      if (trades.some(x => x.pnl < 0 && x.close <= t && t - x.close < REVENGE_MIN * 60)) flags.push('revenge');
      const lastHour = trades.filter(x => x.open > t - 3600).length; if (lastHour >= 5) flags.push('overtrade');
      if (rnd() < .07) flags.push('chase'); if (rnd() < .05) flags.push('news'); if (rnd() < .05) flags.push('corr');
      const sl0 = noSL ? null : entry - d * slP * pip, tp0 = tpP ? entry + d * tpP * pip : null;
      if (noSL) flags.push('nosl');
      // walk the real path
      const trail = !noSL && rnd() < .1 ? Math.round(slP * .8) : 0;
      const dispo = rnd() < .3, widen = !noSL && rnd() < .1, panic = rnd() < .06, timeStop = rnd() < .12 ? 4 * 3600 : 0;
      let sl = sl0, widened = false, best = entry, exit = null, reason = null, close = null;
      const maxJ = Math.min(arr.length - 2, i + 60 * 30);
      for (let j = i + 1; j <= maxJ; j++) {
        const k = arr[j], bid = x => x, ask = x => x + spr;
        const hiQ = d > 0 ? bid(k.high) : ask(k.high), loQ = d > 0 ? bid(k.low) : ask(k.low), cl = d > 0 ? bid(k.close) : ask(k.close);
        if (sl != null && (d > 0 ? loQ <= sl : hiQ >= sl)) { exit = sl; reason = trail && sl !== sl0 ? 'Trailing stop' : 'Stop loss'; close = k.time; break; }
        if (tp0 != null && (d > 0 ? hiQ >= tp0 : loQ <= tp0)) { exit = tp0; reason = 'Take profit'; close = k.time; break; }
        const up = (cl - entry) * d / pip;
        if (trail) { best = d > 0 ? Math.max(best, cl) : Math.min(best, cl); const ns = best - d * trail * pip; if (d > 0 ? ns > sl : ns < sl) sl = ns; }
        if (widen && !widened && sl != null && Math.abs(cl - sl) / pip < slP * .2) { sl = sl - d * slP * .6 * pip; widened = true; }
        if (dispo && up > slP * .55 && rnd() < .08) { exit = cl; reason = 'Manual'; close = k.time; break; }
        if (panic && up < -slP * .3 && rnd() < .1) { exit = cl; reason = 'Manual'; close = k.time; break; }
        if (timeStop && k.time - t >= timeStop && up <= 0) { exit = cl; reason = 'Time stop'; close = k.time; break; }
        if (j - i > 60 * 20 && rnd() < .02) { exit = cl; reason = 'Manual'; close = k.time; break; }
      }
      if (exit == null) { t += meanGap * (.5 + rnd()); continue; }
      const pips = (exit - entry) * d / pip, pnl = (exit - entry) * d * lots * LOT * Engine.usd(m.quote);
      const risk = sl0 != null ? Math.abs(entry - sl0) * lots * LOT * Engine.usd(m.quote) : null;
      const vol = reason === 'Manual';
      const h = { id: id++, sym, side: d > 0 ? 'buy' : 'sell', lots, entry, exit, open: t, close, pnl, pips, r: risk ? pnl / risk : null, reason, note: '', setup: '',
        sl0, tp0, slLast: sl, tpLast: tp0, vol, ctx: [...new Set(flags)], news: [], timeStop: timeStop || 0 };
      // journal: the setup tag is declared at entry, from the persona (with-trend vs fade), never from the outcome
      if (rnd() < .62) h.setup = wpick(Object.entries(SETUPS).map(([k, w]) => [k, withTrend ? w : 1.1 - w]));
      // notes are written after the fact, so they may reflect the result
      if (rnd() < .35) h.note = pnl > 0 ? pick(NOTES_W) : pick(widened ? ['Moved my stop — should not have.'] : NOTES_L);
      // pre-mortem on riskier trades, with a confidence that runs a little hot
      if (riskPct >= .7 || rnd() < .3) {
        const names = h.ctx.map(c => FLAG_NAMES[c]).filter(Boolean);
        const conf = Math.max(10, Math.min(90, Math.round((58 + gauss() * 12) / 10) * 10));
        h.pm = { flags: names, codes: h.ctx.slice(), mine: rnd() < .7 ? [pick(PM_REASONS)].concat(rnd() < .3 ? [pick(PM_REASONS)] : []).filter((x, k, a) => a.indexOf(x) === k) : [], own: '', kill: pick(KILL), timeStop: timeStop || 0, conf, mood: wpick(MOOD_W), broke: [], t, override: false };
        if (pnl <= 0 && rnd() < .55) h.pmHit = rnd() < .45;
      }
      trades.push(h); bal += pnl;
      if (pnl < 0) lastLossClose = close;
      // next entry time: bursts after losses (revenge / over-trading), calmer after wins
      const g = pnl < 0 && close < t + 4 * 3600 && rnd() < .16 ? (close - t) + 120 + rnd() * 420 : rnd() < .12 ? 300 + rnd() * 900 : meanGap * (.35 + rnd() * 1.3);
      t += Math.max(60, g);
    }
    return trades;
  }

  // the same rules as dispoSale (behav.js): only sales from a portfolio of two or more positions, zero P&L neither gain nor loss
  function dispoEvents(trades) {
    const st = { rg: 0, rl: 0, pg: 0, pl: 0, ev: [] };
    const pnlAt = (x, tt) => { const arr = Engine.candles[x.sym], k = arr[idxAt(arr, tt)], d = x.side === 'buy' ? 1 : -1; return (k.close - x.entry) * d; };
    for (const h of trades.filter(x => x.vol).sort((a, b) => a.close - b.close)) {
      const held = trades.filter(o => o !== h && o.open < h.close && o.close > h.close), net = netPnl(h);
      if (!held.length || Math.round(net * 100) === 0) continue;
      const e = { t: h.close, sym: h.sym, rg: net > 0 ? 1 : 0, rl: net < 0 ? 1 : 0, pg: 0, pl: 0 };
      for (const o of held) { const v = pnlAt(o, h.close); if (v > 0) e.pg++; else if (v < 0) e.pl++; }
      st.rg += e.rg; st.rl += e.rl; st.pg += e.pg; st.pl += e.pl; st.ev.unshift(e);
    }
    st.ev = st.ev.slice(0, 300); return st;
  }

  function load(opts = {}) {
    const _toast = toast, _beep = typeof beep === 'function' ? beep : null; toast = () => {}; if (_beep) beep = () => {};
    try { return loadInner(opts); } finally { toast = _toast; if (_beep) beep = _beep; }
  }
  function loadInner(opts) {
    // one pass, no selection: the week's result is whatever the simulated path gives, losses included
    const trades = build(opts);
    const hist = trades.slice().sort((a, b) => b.close - a.close);
    S.history = hist.slice(0, 500);
    let bal = 100000, peak = 100000; for (const h of hist.slice().reverse()) { bal += h.pnl; peak = Math.max(peak, bal); }
    S.balance = bal; S.peak = peak; S.positions = []; S.orders = []; S.alerts = [];
    S.nextId = (trades.length ? trades[trades.length - 1].id : 0) + 1;
    for (const h of S.history) h.id = h.id; // ids already unique
    bhState(); S.dispo = dispoEvents(trades);
    S.tiltSt = { until: 0, trips: 2, overrides: 1, lastTrip: hist.find(h => h.ctx.includes('revenge'))?.close || null };
    // two skipped trades the coach can grade
    S.pmSkip = [];
    for (const back of [26, 9]) {
      const sym = pick(['EURUSD', 'GBPUSD', 'USDJPY']), m = Engine.META[sym], arr = Engine.candles[sym], tt = Engine.simTime - back * 3600, i = idxAt(arr, tt), px = arr[i].close, side = rnd() < .5 ? 'buy' : 'sell', d = side === 'buy' ? 1 : -1;
      const slP = Math.round(hourRange(arr, i) / m.pip), lots = .8, usdPip = LOT * m.pip * Engine.usd(m.quote) * lots;
      S.pmSkip.push({ type: 'trade', t: tt, sym, side, lots, entry: px, sl: px - d * slP * m.pip, tp: px + d * 2 * slP * m.pip, risk: slP * usdPip, reward: 2 * slP * usdPip, flags: [FLAG_NAMES.revenge] });
    }
    // live book: open positions, pending orders and alerts at current prices (via the normal code paths)
    const pm0 = pmCfg().on, tl0 = tiltCfg().on; pmCfg().on = false; tiltCfg().on = false;
    const book = [['EURUSD', 'buy', 1.2, 22, 44], ['USDJPY', 'sell', .8, 28, 50], ['GBPJPY', 'buy', .5, 40, 0], ['AUDUSD', 'sell', 1.5, 18, 30]];
    for (const [sym, side, lots, slP, tpP] of book) {
      const m = Engine.META[sym], q = Engine.quote(sym), d = side === 'buy' ? 1 : -1, e = d > 0 ? q.ask : q.bid;
      const p = openPosition({ sym, side, lots, sl: e - d * slP * m.pip, tp: tpP ? e + d * tpP * m.pip : null, pmDone: true, ctx: [] });
      if (p) { const arr = Engine.candles[sym]; const back = 20 + Math.floor(rnd() * 160); p.open = Engine.simTime - back * 60; const k = arr[Math.max(0, arr.length - 1 - back)]; p.entry = d > 0 ? k.close + m.spread * m.pip : k.close; p.sl = p.entry - d * slP * m.pip; if (d > 0 ? p.sl >= q.bid : p.sl <= q.ask) p.sl = (d > 0 ? q.bid : q.ask) - d * slP * m.pip; p.sl0 = p.sl; p.risk = Math.abs(p.entry - p.sl) * p.lots * LOT * Engine.usd(m.quote); if (tpP) { p.tp = p.entry + d * tpP * m.pip; if (d > 0 ? p.tp <= q.bid : p.tp >= q.ask) p.tp = (d > 0 ? q.bid : q.ask) + d * tpP * m.pip; p.tp0 = p.tp; } }
    }
    for (const [sym, side, ot, dist] of [['EURGBP', 'buy', 'limit', -15], ['USDCAD', 'sell', 'stop', -20], ['EURJPY', 'sell', 'limit', 25]]) {
      const m = Engine.META[sym], q = Engine.quote(sym); placeOrder({ sym, side, ot, price: +(q.mid + dist * m.pip).toFixed(m.digits), lots: .6, slPips: 20, tpPips: 40, trail: 0 });
    }
    for (const [sym, k] of [['EURUSD', 30], ['GBPUSD', -35], ['USDJPY', 45]]) { const m = Engine.META[sym], q = Engine.quote(sym); S.alerts.push({ id: S.nextId++, sym, price: +(q.mid + k * m.pip).toFixed(m.digits), cond: k > 0 ? 'above' : 'below', done: false }); }
    { const m = Engine.META.AUDJPY, q = Engine.quote('AUDJPY'); S.alerts.push({ id: S.nextId++, sym: 'AUDJPY', price: +(q.mid - 12 * m.pip).toFixed(m.digits), cond: 'below', done: true, at: Engine.simTime - 5400 }); }
    pmCfg().on = pm0; tiltCfg().on = tl0;
    S.demo = { at: Engine.simTime, n: S.history.length };
    document.documentElement.dataset.demo = '1';
    changed('pos', 'ord', 'hist', 'al'); dirty.journal = true;
    if (typeof renderJournal === 'function' && activeTab === 'journal') renderJournal();
    if (typeof renderBehav === 'function' && activeTab === 'behav') renderBehav();
    return S.history.length;
  }

  function clear() {
    S.history = []; S.positions = []; S.orders = []; S.alerts = []; S.balance = 100000; S.peak = 100000;
    S.dispo = { rg: 0, rl: 0, pg: 0, pl: 0, ev: [] }; S.pmSkip = []; S.tiltSt = { until: 0, trips: 0, overrides: 0, lastTrip: null }; S.demo = null;
    delete document.documentElement.dataset.demo;
    changed('pos', 'ord', 'hist', 'al'); dirty.journal = true;
  }

  window.loadDemoHistory = (o) => { const n = load(o); toast('Demo history loaded', `${n} synthetic trades on a simulated market · illustrative, not achievable · ${S.positions.length} open · ${S.orders.length} pending`, 'info'); return n; };
  window.clearDemoHistory = () => { clear(); toast('Account cleared', 'Balance reset to $100,000 · no trades', 'info'); };

  // Help › account actions
  const acts = document.querySelector('.acct-actions');
  if (acts && !document.getElementById('demoBtn')) {
    const b1 = document.createElement('button'); b1.className = 'ghost sm'; b1.id = 'demoBtn'; b1.textContent = 'Load demo history';
    const b2 = document.createElement('button'); b2.className = 'ghost sm'; b2.id = 'demoClear'; b2.textContent = 'Start clean';
    // both replace the account: ask first with what would be lost (confirmWipe, app.js); the window functions stay direct
    const ask = (title, ok, what, f) => typeof confirmWipe === 'function' ? confirmWipe(title, ok, what, f) : f();
    b1.onclick = () => ask('Load the demo history?', 'Load demo', 'The demo replaces this account with about 260 synthetic trades on the simulated market.', () => window.loadDemoHistory());
    b2.onclick = () => ask('Start clean?', 'Start clean', 'The account goes back to $100,000 with no trades.', () => window.clearDemoHistory());
    acts.prepend(b1, b2);
  }

  // opt-in only: the account starts empty unless the URL asks for ?demo=1 (or Help › Load demo history)
  const want = /[?&]demo=1(&|$)/.test(location.search);
  if (want && !S.history.length && !S.positions.length && !S.demo) setTimeout(() => {
    // a read-only tab shows the other tab's account: loading a demo here would only pretend to succeed
    if (window.store && typeof store.readOnly === 'function' && store.readOnly()) { toast('Demo not loaded', 'Read-only: this account is open in another tab.', 'info'); return; }
    const n = load();
    toast('Demo account loaded', `${n} synthetic trades on a simulated market — illustrative, not achievable. Help › Start clean resets it.`, 'info');
  }, 600);
  // the label is derived from S.demo, never set once: any path that replaces or wipes S
  // (Help › Reset account, import, loadState) and then calls changed() re-syncs it
  const syncLabel = () => { const de = document.documentElement; if (S && S.demo) de.dataset.demo = '1'; else delete de.dataset.demo; };
  if (typeof window.changed === 'function') { const ch0 = window.changed; window.changed = function (...k) { const r = ch0.apply(this, k); syncLabel(); return r; }; }
  if (typeof window.loadState === 'function') { const ls0 = window.loadState; window.loadState = function (...a) { const r = ls0.apply(this, a); syncLabel(); return r; }; }
  syncLabel(); // restored session that still holds the demo
})();
