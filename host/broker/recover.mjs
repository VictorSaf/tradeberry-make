/* The temporary broker's recovery after downtime (spec §7): the executions it missed while it was down are found on the
   platform's 1-minute bars (then on the live ticks it heard while it was recovering) and booked as if it had run.
   recover({ market, core, fetchBars, to, accounts: [{ A, from }], each, done, ticks, deadline, log }) → { events, pending }
   - market: the broker's MarketCore (the sheet, the sessions, compose: the night / news spread); core: AccountCore;
   - fetchBars(sym, from, to, { deadline }) → [{ t, o, h, l, c }] (bid prices, t the minute's start in s) or null;
   - accounts: each account with the time it last ran (s); to: the end of the bars asked (now, s);
   - ticks(): the live ticks heard since the recovery began, [{ t, rows: [[sym, bid, ask], …] }], played after the bars;
   - each(A, run): run() books the recovery on A.acct → { events, end } (end: the last moment played); the broker wraps
     it in its own path (store.tx, the reports, acceptor.send). It throws → that account is pending;
   - done(id, end): called as soon as an account is finished (the broker releases it there, synchronously after each);
   - deadline (ms): the time budget of the fetches; a fetch not answered by then is "not available";
   - noted: a Set kept across the rounds of one recovery (each account's "no bar" line is logged once).
   Rules (Claude's calls where the spec is silent, 02-03.11.2026):
   - only the complete bars of (from, to]; a missing minute is a missing minute (nothing is interpolated); a bar outside
     the instrument's session (market.isOpen) is ignored. The bar holding from is played as its close only: its open
     and extremes may come from before from, when the book was another (a stop moved by a G in that minute);
   - ask = bid + the sheet's spread at the bar's time (compose: the night and news rule; the crypto jitter draw of that
     second), the same rule the app uses when a live ask is missing;
   - per bar, the exits are played per position, adverse first (they are independent, the stop-out waits for the
     close): the longs' stops and targets on open → low → high → close, the shorts' on open → high → low → close; then
     the entries on the book as it stands, on open → the extreme nearer the open → the other → close (an order whose
     DAY / GTD expiry falls inside that minute sees only the open); between two of these prices the price passes every
     level in between: a stop or a target there fills at its level, a stop beyond the open at the open, a limit at its
     price or better;
   - the stop-out is evaluated once a minute, on the closes of the instruments that had a bar in it (and on every
     live tick played after the bars); an instrument with no bar in the whole gap has no price: the stop-out of that
     account is then not evaluated (logged);
   - DAY / GTD expiries at their own time; rollovers in order (core.rollover: each once, from acct.rollLast);
   - every fill carries gap: true and reason 'filled after server downtime' (the closed trade keeps what closed it, with
     gap: true); fills and trades are stamped with the bar's minute (never before from), or the tick's time;
   - an account with nothing open needs nothing; one whose gap holds no complete minute needs no bars (its ticks are
     played at once); a pause over 14 days, or the bars of one of its instruments (or of the currency conversion it
     needs) not available → nothing is executed: the account is pending.
   barSource({ data, platform }): the local archive (data/bars/1/SYM/YYYY-MM.csv.gz, host/bars-import.mjs) up to its
   last bar, the platform's /datafeed/history (resolution 1) for the rest; one request a second, 3 tries, within the
   deadline; when symbol_info fails, every instrument fails at once for a minute. */
import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MarketCore } from '../../core/market.mjs';
import { AccountCore } from '../../core/account.mjs';

export const MAX_GAP_S = 14 * 86400;
export const REASON = 'filled after server downtime';
const EPS = 1e-12;

// the instruments whose bid gives c in USD (as MarketCore.usd reads them)
function convSyms(META, c) {
  if (c === 'USD') return [];
  if (META[c + 'USD']) return [c + 'USD'];
  if (META['USD' + c]) return ['USD' + c];
  return META['EUR' + c] ? ['EURUSD', 'EUR' + c] : [];
}
const syms = acct => [...new Set([...acct.positions.map(p => p.sym), ...acct.orders.map(o => o.sym)])];
const okBar = b => b && [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) && b.l > 0 && b.l <= Math.min(b.o, b.c) && b.h >= Math.max(b.o, b.c);
const tickFrom = (from, to) => Math.max(from, Math.floor(to / 60) * 60);
// a bar inside the instrument's session (a bar outside it is not a market price)
const inSession = (market, sym, b) => market.isOpen(sym, b.t + 30) || market.isOpen(sym, b.t);

/* one account through the bars, then the ticks: A.acct is changed in place → { events, end } */
export function replay({ market, core = AccountCore, acct, bars, ticks = [], from, to }) {
  const META = market.META, Q = {}, rel = new Set(syms(acct).filter(s => META[s]));
  let cur = from, allowSO = false, end = from;
  const rm = {
    META, nyOffset: t => market.nyOffset(t), serverOffset: t => market.serverOffset(t),
    quote: s => Q[s] || { bid: NaN, ask: NaN, mid: NaN, spread: NaN, sp: 'default', open: false, why: 'closed', t: cur, off: true },
    usd(c) {
      if (c === 'USD') return 1;
      const b = s => (Q[s] && Q[s].bid > 0 ? Q[s].bid : null);
      let v = b(c + 'USD'); if (v) return v;
      v = b('USD' + c); if (v) return 1 / v;
      const eu = b('EURUSD'), e = b('EUR' + c); if (eu && e) return eu / e;
      return market.usd(c);
    },
  };
  const C = core.create({ market: rm, rng: () => .5, now: () => cur, live: () => false, gapStops: true });
  const out = [];
  // onTick's own events (h.emit) and those of the closes it asks for (h.close), in the order they happen; the stop-out
  // only where it is evaluated
  const h = {
    emit: e => out.push(e),
    close(a, id, frac, reason, ctx) {
      if (reason === 'Stop-out' && !allowSO) return { ok: false };
      const r = C.close(a, id, frac, reason, ctx); if (r.events) out.push(...r.events); return r;
    },
  };
  const run = (t, so) => { cur = t; end = Math.max(end, t); out.push(...C.rollover(acct, t)); allowSO = so; C.onTick(acct, t, h); };
  const sp = {}; // sym -> [spread (price), sp kind] at the bar being played
  const spreadAt = (sym, t) => { const q = market.compose(sym, 1, null, t, true, '', false, MarketCore.jitU(sym, Math.floor(t))); return [q.spread * META[sym].pip, q.sp]; };
  const mk = (sym, bid, ask, t, open) => ({ bid, ask, mid: bid, spread: (ask - bid) / META[sym].pip, sp: sp[sym] ? sp[sym][1] : 'default', open, why: open ? '' : 'closed', t, off: false });
  const closeAll = () => { for (const k in Q) if (Q[k].open) Q[k] = { ...Q[k], open: false, why: 'closed' }; };

  // the levels the book waits for on sym, as [price, the side it is read on]
  function levels(sym) {
    const L = [];
    for (const p of acct.positions) if (p.sym === sym) {
      const s = p.side === 'buy' ? 'bid' : 'ask';
      if (p.sl != null) L.push([p.sl, s]);
      if (p.tps) for (const l of p.tps) L.push([l.price, s]); else if (p.tp != null) L.push([p.tp, s]);
    }
    for (const o of acct.orders) if (o.sym === sym) {
      const s = o.side === 'buy' ? 'ask' : 'bid';
      if (o.limit == null || o.status !== 'triggered') L.push([o.price, s]);
      if (o.limit != null) L.push([o.limit, s]);
    }
    return L;
  }
  // the bid moves from a to b: every level on the way, nearest first, then b
  function walk(sym, a, b, t) {
    const d = Math.sign(b - a), s = sp[sym][0], seen = new Set();
    for (let x = a, guard = 0; d && guard < 1000; guard++) {
      let best = null;
      for (const [v, side] of levels(sym)) {
        const lv = side === 'bid' ? v : v - s, key = v + side;
        if (seen.has(key) || !(d > 0 ? lv >= x - EPS && lv < b - EPS : lv <= x + EPS && lv > b + EPS)) continue;
        if (!best || Math.abs(lv - x) < Math.abs(best[2] - x)) best = [v, side, lv, key];
      }
      if (!best) break;
      seen.add(best[3]); x = best[2];
      Q[sym] = best[1] === 'bid' ? mk(sym, best[0], best[0] + s, t, true) : mk(sym, best[0] - s, best[0], t, true);
      run(t, false);
    }
    Q[sym] = mk(sym, b, b + s, t, true); run(t, false);
  }
  // the path's first price (a gap is a gap), then its segments; after: hook between the first price and the rest
  function play(sym, path, t, after) {
    closeAll(); Q[sym] = mk(sym, path[0], path[0] + sp[sym][0], t, true); run(t, false);
    if (after) after();
    for (let i = 1; i < path.length; i++) walk(sym, path[i - 1], path[i], t);
  }
  // only the exits of one side's positions on sym act: the others' stops and targets and every order are set aside
  function exits(sym, side, path, t) {
    if (!acct.positions.some(p => p.sym === sym && p.side === side && (p.sl != null || p.tp != null || p.tps))) return;
    const aside = acct.positions.filter(p => p.sym !== sym || p.side !== side).map(p => [p, p.sl, p.tp, p.tps]), ords = acct.orders;
    for (const [p] of aside) { p.sl = null; p.tp = null; delete p.tps; }
    acct.orders = [];
    try { play(sym, path, t); } finally {
      for (const [p, sl, tp, tps] of aside) { p.sl = sl; p.tp = tp; if (tps) p.tps = tps; }
      acct.orders = [...ords, ...acct.orders];
    }
  }

  // the timeline: every minute with a bar, the expiries in (from, to], then the ticks
  const byMin = new Map();
  for (const [sym, list] of Object.entries(bars)) for (const b of list) {
    if (!inSession(market, sym, b)) continue;
    if (!byMin.has(b.t)) byMin.set(b.t, []); byMin.get(b.t).push([sym, b]);
  }
  for (const [sym, list] of Object.entries(bars)) if (list.length) { sp[sym] = spreadAt(sym, list[0].t); const p0 = list[0].t < from ? list[0].c : list[0].o; Q[sym] = mk(sym, p0, p0 + sp[sym][0], list[0].t, false); }
  const pts = [...byMin.keys()].map(t => [t, 1]);
  for (const o of acct.orders) if (o.expires != null && o.expires > from && o.expires <= to) pts.push([o.expires, 0]);
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  for (const [m, isBar] of pts) {
    if (!isBar) { closeAll(); run(m, false); continue; }
    const t = Math.max(m, from), here = byMin.get(m).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    for (const [sym, b] of here) if (!rel.has(sym)) { sp[sym] = spreadAt(sym, m); Q[sym] = mk(sym, b.c, b.c + sp[sym][0], t, false); }
    for (const [sym, b] of here) {
      if (!rel.has(sym)) continue;
      sp[sym] = spreadAt(sym, m);
      const first = m < from; // the bar holding from: its close only
      exits(sym, 'buy', first ? [b.c] : [b.o, b.l, b.h, b.c], t);
      exits(sym, 'sell', first ? [b.c] : [b.o, b.h, b.l, b.c], t);
      if (acct.orders.some(o => o.sym === sym)) {
        const lowFirst = b.o - b.l <= b.h - b.o;
        const late = o => o.sym === sym && o.expires != null && o.expires > m && o.expires < m + 60;
        let aside = [];
        play(sym, first ? [b.c] : [b.o, ...(lowFirst ? [b.l, b.h] : [b.h, b.l]), b.c], t,
          acct.orders.some(late) ? () => { aside = acct.orders.filter(late); acct.orders = acct.orders.filter(o => !late(o)); } : null);
        acct.orders.push(...aside); // they expire at their own time, next
      }
    }
    closeAll();
    for (const [sym, b] of here) if (rel.has(sym)) Q[sym] = mk(sym, b.c, b.c + sp[sym][0], t, true);
    run(t, true); // the minute's closes: the stop-out
    closeAll();
  }
  // the live ticks heard meanwhile, after the bars, each as the live broker would have seen it (stop-out included)
  const t0 = tickFrom(from, to);
  for (const k of ticks) {
    if (!(k.t > t0)) continue;
    closeAll();
    for (const [sym, bid, ask, tMs] of k.rows) {
      if (!META[sym] || !(bid > 0)) continue;
      if (!sp[sym]) sp[sym] = spreadAt(sym, k.t);
      const off = Number.isFinite(tMs) && k.t - tMs / 1000 > (META[sym].offQ || 120); // off quotes, as market.quote says
      Q[sym] = mk(sym, bid, ask >= bid ? ask : bid + spreadAt(sym, k.t)[0], k.t, market.isOpen(sym, k.t) && !off);
    }
    run(k.t, true);
  }
  closeAll();
  for (const e of out) if (e.type === 'fill') { e.fill.gap = true; e.fill.reason = REASON; if (e.trade) e.trade.gap = true; }
  return { events: out.filter(e => e.type !== 'stopout'), end: Math.max(end, to) };
}

export async function recover({ market, core = AccountCore, fetchBars, to, accounts, each = (A, run) => run(), done = () => {}, ticks = () => [], deadline = Infinity, log = () => {}, noted = new Set(),
  pause = () => new Promise(r => setImmediate(r)) }) {
  const META = market.META, events = [], pending = [], need = new Map(), plan = [];
  const play = (A, from, bars) => {
    try {
      const r = each(A, () => replay({ market, core, acct: A.acct, bars, ticks: ticks(), from, to }));
      for (const e of r.events) events.push({ account: A.id, ...e });
      done(A.id, r.end);
    } catch (e) { pending.push({ id: A.id, from, why: `recovery failed (${e.name})` }); }
  };
  for (const { A, from } of accounts) {
    const acct = A.acct;
    if (!acct.positions.length && !acct.orders.length) { done(A.id, to); continue; }
    if (to - from > MAX_GAP_S) { pending.push({ id: A.id, from, why: `the broker was down ${((to - from) / 86400).toFixed(1)} days (over 14)` }); continue; }
    // no complete minute ends in (from, to]: no bars, the ticks only, at once
    if (Math.floor(to / 60) * 60 <= from) { play(A, from, {}); continue; }
    const s = new Set();
    for (const sym of syms(acct)) if (META[sym]) { s.add(sym); for (const x of convSyms(META, META[sym].quote)) s.add(x); }
    for (const sym of s) need.set(sym, Math.min(need.get(sym) ?? Infinity, from));
    plan.push({ A, from, s });
  }
  const got = new Map();
  for (const [sym, from] of need) {
    let v = null; const left = deadline - Date.now();
    if (left <= 0) log(`recovery: bars of ${sym} not asked, the time budget is spent`);
    else {
      let timer;
      try {
        v = await Promise.race([fetchBars(sym, Math.floor(from / 60) * 60, to, { deadline }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('time budget spent')), left); timer.unref?.(); })]);
      } catch (e) { log(`recovery: bars of ${sym} not available (${e.message})`); } finally { clearTimeout(timer); }
    }
    got.set(sym, Array.isArray(v) ? [...new Map(v.filter(okBar).map(b => [+b.t, { t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c }])).values()].sort((a, b) => a.t - b.t) : null);
  }
  for (const { A, from, s } of plan) {
    const miss = [...s].filter(sym => !got.get(sym));
    if (miss.length) { pending.push({ id: A.id, from, why: `bars not available (${miss.join(', ')})` }); continue; }
    const bars = {};
    for (const sym of s) bars[sym] = got.get(sym).filter(b => b.t + 60 > from && b.t + 60 <= to);
    for (const sym of syms(A.acct)) if (bars[sym] && !bars[sym].some(b => inSession(market, sym, b)) && !noted.has(A.id + ' ' + sym) && noted.add(A.id + ' ' + sym)) log(`recovery: account ${A.id}: no bar of ${sym} in the gap (closed or missing): nothing moved there, and its stop-out was not evaluated`);
    await pause(); // the live ticks keep coming between two accounts (buffered for the ones still waiting)
    play(A, from, bars);
  }
  return { events, pending };
}

/* the bars of the downtime: the local archive up to its last bar, the platform for the rest */
export function barSource({ data = process.env.TB_DATA || new URL('../../.data', import.meta.url).pathname, platform = process.env.TB_PLATFORM || 'https://trade.capitalsvision.com/gcp',
  fetch: get = globalThis.fetch, gapMs = 1000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let tickers = null, infoErr = null, lastAt = 0;
  async function json(url, deadline = Infinity) {
    for (let i = 1; ; i++) {
      const w = lastAt + gapMs - Date.now(); if (w > 0) await sleep(w);
      const left = deadline - Date.now(); if (left <= 0) throw new Error('time budget spent');
      lastAt = Date.now();
      try {
        const r = await get(url, { signal: AbortSignal.timeout(Math.min(60000, left)) });
        if (!r.ok) { await r.arrayBuffer?.().catch(() => {}); throw new Error(`platform answered ${r.status}`); }
        return await r.json();
      } catch (e) { if (i >= 3 || Date.now() + 2000 * 2 ** i >= deadline) throw e; await sleep(2000 * 2 ** i); }
    }
  }
  // → { bars, upTo } (upTo: the archive's last bar, s) or null
  function archive(sym, from, to) {
    try {
      const st = JSON.parse(readFileSync(join(data, 'bars', 'status.json'), 'utf8')), s = st.syms && st.syms[sym] && st.syms[sym][1];
      if (!s || !(s.last >= from)) return null;
      const upTo = Math.min(s.last, to), out = [], endP = new Date(upTo * 1000).toISOString().slice(0, 7);
      for (let d = new Date(Math.floor(from / 86400) * 86400000); ; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
        const p = d.toISOString().slice(0, 7), f = join(data, 'bars', '1', sym, p + '.csv.gz');
        if (p > endP) break;
        if (!existsSync(f)) return null;
        for (const l of gunzipSync(readFileSync(f)).toString().split('\n').slice(1)) {
          if (!l) continue; const [t, o, h, lo, c] = l.split(',').map(Number);
          if (t >= from && t <= upTo) out.push({ t, o, h, l: lo, c });
        }
      }
      return { bars: out, upTo };
    } catch { return null; }
  }
  return async (sym, from, to, { deadline = Infinity } = {}) => {
    const a = archive(sym, from, to), got = new Map((a ? a.bars : []).map(b => [b.t, b]));
    const lo0 = a ? a.upTo + 60 : from;
    if (lo0 <= to) {
      if (infoErr && Date.now() - infoErr.at < 60000) throw infoErr.e; // symbol_info failed a moment ago: fail fast
      if (!tickers) {
        try {
          const j = await json(`${platform}/datafeed/symbol_info?group=Main`, deadline), m = new Map();
          j.symbol.forEach((s, i) => { if (j.ticker[i] && !m.has(s)) m.set(s, String(j.ticker[i])); });
          tickers = m; infoErr = null;
        } catch (e) { infoErr = { at: Date.now(), e: new Error(`platform symbol list not available (${e.message})`) }; throw infoErr.e; }
      }
      const tk = tickers.get(sym); if (!tk) throw new Error(`${sym} is not on the platform`);
      // walk back from to (an answer often holds more than asked, or only its latest part)
      for (let hi = to + 60; hi > lo0;) {
        const lo = Math.max(lo0, hi - 7 * 86400);
        const j = await json(`${platform}/datafeed/history?symbol=${encodeURIComponent(tk)}&resolution=1&from=${Math.floor(lo)}&to=${Math.ceil(hi)}`, deadline);
        if (!j || j.s === 'no_data' || !Array.isArray(j.t) || !j.t.length) { hi = lo; continue; }
        if (j.s !== 'ok') throw new Error('unexpected answer from the platform');
        let first = hi;
        for (let i = 0; i < j.t.length; i++) { const t = +j.t[i]; if (t < first) first = t; if (t >= lo0 && t <= to) got.set(t, { t, o: +j.o[i], h: +j.h[i], l: +j.l[i], c: +j.c[i] }); }
        hi = first < hi && first > lo ? first : lo;
      }
    }
    return [...got.values()].sort((x, y) => x.t - y.t);
  };
}
