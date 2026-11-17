/* The broker platform (trade.capitalsvision.com): live quotes and 1-minute history, read on the server only.
   - quotes: GET {LEGACY_BASE}/quotes?apiKey= → CSV "instrument, bid, ask, timestamp" (ms), one row per instrument.
     The key is a Pages secret (LEGACY_API_KEY); it never reaches the browser. A wrong key still answers 200, with
     the body "Invalid apiKey: …", so the body is checked, not the status.
   - history: the platform's TradingView datafeed (UDF), keyed by ticker, not by symbol (EURUSD → "EUR A0-FX");
     the map comes from symbol_info?group=Main. Both are fetched at most once a second (quotes) or a day (the map)
     per server instance, and kept a short while at the edge, so many viewers make one upstream request.
   Notes: .mace/research/2026-10-26-api-quotes.md. */
const HOST = 'https://trade.capitalsvision.com/gcp';
const QUOTES_MS = 1000, MAP_MS = 6 * 3600 * 1000;
export const SYM_RE = /^[A-Z0-9][A-Z0-9._-]{1,19}$/;

let qMemo = null, qWait = null, mapMemo = null, mapWait = null;

// "EURUSD, 1.12146, 1.12158, 1792966726148" → [sym, bid, ask, tMs]; rows that do not parse are skipped
export function parseQuotes(text) {
  if (typeof text !== 'string' || !/^instrument\s*,\s*bid\s*,\s*ask\s*,\s*timestamp/i.test(text)) throw new Error(/^Invalid apiKey/i.test(text || '') ? 'The platform refused the API key' : 'Unexpected answer from the platform');
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    const p = line.split(',').map(s => s.trim()); if (p.length < 4) continue;
    const [sym, b, a, t] = p, bid = +b, ask = +a, ts = +t;
    if (!SYM_RE.test(sym) || !(bid > 0) || !(ask >= bid) || !Number.isFinite(ts) || ts < 1e12) continue;
    out.push([sym, bid, ask, ts]);
  }
  if (!out.length) throw new Error('No quotes in the platform answer');
  return out;
}

export async function quotes(env) {
  if (!env.LEGACY_API_KEY) { const e = new Error('Live prices are not configured on this server'); e.status = 503; throw e; }
  if (qMemo && Date.now() - qMemo.at < QUOTES_MS) return qMemo;
  if (qWait) return qWait;
  const base = env.LEGACY_BASE || HOST + '/api';
  qWait = (async () => {
    const r = await fetch(`${base}/quotes?apiKey=${encodeURIComponent(env.LEGACY_API_KEY)}`, { cf: { cacheTtl: 1, cacheEverything: true } });
    if (!r.ok) throw new Error(`Platform answered ${r.status}`);
    qMemo = { at: Date.now(), q: parseQuotes(await r.text()) };
    return qMemo;
  })().finally(() => { qWait = null; });
  return qWait;
}

async function tickerMap() {
  if (mapMemo && Date.now() - mapMemo.at < MAP_MS) return mapMemo.m;
  if (mapWait) return mapWait;
  mapWait = (async () => {
    const r = await fetch(`${HOST}/datafeed/symbol_info?group=Main`, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) throw new Error(`Platform symbol list answered ${r.status}`);
    const j = await r.json(), m = new Map();
    if (!j || !Array.isArray(j.symbol) || !Array.isArray(j.ticker)) throw new Error('Unexpected platform symbol list');
    j.symbol.forEach((s, i) => { if (SYM_RE.test(s) && !m.has(s) && j.ticker[i]) m.set(s, { ticker: String(j.ticker[i]), ps: +(Array.isArray(j.pricescale) ? j.pricescale[i] : j.pricescale) || 0 }); });
    mapMemo = { at: Date.now(), m };
    return m;
  })().finally(() => { mapWait = null; });
  return mapWait;
}

/* 1-minute bars of one instrument for the last `days` days, compact: prices as integers of 1/ps, the close as a
   delta from the previous close, open/high/low as offsets from their own close, times as minute steps.
   { sym, ps, t0 (s), dt: [min], c: [Δ], o: [c−o], h: [h−c], l: [c−l] }; decode in livefeed.js. */
export function packBars(sym, ps, j, from) {
  const out = { sym, ps, t0: 0, dt: [], c: [], o: [], h: [], l: [] };
  if (!j || j.s !== 'ok' || !Array.isArray(j.t)) return out;
  let pt = 0, pc = 0;
  for (let i = 0; i < j.t.length; i++) {
    const t = +j.t[i]; if (!Number.isFinite(t) || t < from || (pt && t <= pt)) continue;
    const c = Math.round(j.c[i] * ps), o = Math.round(j.o[i] * ps), h = Math.round(j.h[i] * ps), l = Math.round(j.l[i] * ps);
    if (!(c > 0 && o > 0 && h > 0 && l > 0)) continue;
    if (!pt) out.t0 = t; else out.dt.push((t - pt) / 60);
    out.c.push(c - pc); out.o.push(c - o); out.h.push(Math.max(h, o, c) - c); out.l.push(c - Math.min(l, o, c));
    pt = t; pc = c;
  }
  return out;
}

/* One limiter for every /datafeed/history request, so a chart paging back through years cannot starve the startup load
   or hammer the platform: at most 2 starts per second, two queues (0 = startup load, 1 = background paging; 1 runs only
   while 0 is empty), and a waiter older than 30 s is refused (before the app's own 40 s timeout gives up on it). `_lim` is the clock, replaceable by tests. */
const LIM_PER_S = 2, LIM_WAIT_MS = 30000;
export const _lim = { now: () => Date.now(), wait: (ms, f) => setTimeout(f, ms) };
const lq = [[], []], starts = []; let lTimer = false;
function pump() {
  lTimer = false; const t = _lim.now();
  for (const q of lq) while (q.length && t - q[0].at > LIM_WAIT_MS) { const x = new Error('Platform busy, try again'); x.status = 503; q.shift().rej(x); }
  while (starts.length && t - starts[0] >= 1000) starts.shift();
  while (starts.length < LIM_PER_S) {
    const w = lq[0].length ? lq[0].shift() : lq[1].shift(); if (!w) return;
    starts.push(t); w.run().then(w.res, w.rej);
  }
  if (lq[0].length || lq[1].length) { lTimer = true; _lim.wait(Math.max(1, starts[0] + 1000 - t), pump); }
}
// the pump runs on a later tick, so requests queued in the same tick are ordered by priority, not by arrival
const limited = (prio, run) => new Promise((res, rej) => { lq[prio ? 1 : 0].push({ run, res, rej, at: _lim.now() }); if (!lTimer) { lTimer = true; _lim.wait(0, pump); } });

/* Answers already in hand skip the limiter: a URL read within its TTL is served from this map (the limiter counts real
   platform calls only), and concurrent identical reads share one promise. The map holds parsed bodies, so it is bounded
   by an estimate of their size (_lim.budget, ~40 bytes per bar), oldest first; the host/edge cache holds the bytes for
   the long TTLs, and a read it serves still goes through the limiter. `good(j)` says whether the body is a real
   datafeed answer (no_data counts); one that is not is re-asked once past the fetch cache (which would keep it for the
   whole TTL), then refused with 502, never kept. */
const seen = new Map(); let seenBytes = 0; _lim.forget = () => { seen.clear(); seenBytes = 0; }; _lim.budget = 4e6; _lim.held = () => [seen.size, seenBytes];
const sane = j => !!j && (j.s === 'no_data' || (j.s === 'ok' && Array.isArray(j.t)));
function drop(u) { const v = seen.get(u); if (v) { seenBytes -= v.size; seen.delete(u); } }
async function feed(prio, url, ttl, good = sane) {
  const t = Date.now(), k = seen.get(url); if (k && k.until > t) return k.p;
  const get = async cf => { const r = await limited(prio, () => fetch(url, cf ? { cf: { cacheTtl: ttl, cacheEverything: true } } : {})); if (!r.ok) throw new Error(`Platform history answered ${r.status}`); return r.json(); };
  const p = (async () => { let j = await get(true); if (!good(j)) { j = await get(false); if (!good(j)) { const x = new Error('Unexpected answer from the platform history'); x.status = 502; throw x; } } return j; })();
  for (const [u, v] of seen) if (v.until <= t) drop(u);
  const e = { until: t + ttl * 1000, p, size: 0 }; seen.set(url, e);
  p.then(j => {
    if (seen.get(url) !== e) return;
    e.size = 200 + 40 * (Array.isArray(j.t) ? j.t.length : 0); seenBytes += e.size;
    for (const [u, v] of seen) { if (seenBytes <= _lim.budget || u === url) break; if (v.size) drop(u); }
    if (seenBytes > _lim.budget) drop(url);
  }, () => { if (seen.get(url) === e) drop(url); });
  return p;
}

// res 1 = 1-minute bars, res 60 = 1-hour bars (the 1H and 4H views need more days than the 1-minute history holds).
// Checked on the platform 02.11.2026: the datafeed ignores `from` (a 7-day window answered bars from 14 days earlier),
// so it answers up to ~30,000 bars ending at `to`. A long span is read in pages, each ending just before the oldest bar
// of the one after it; a page that adds nothing (the platform's start) ends it. historyWindow cuts to [from, to) locally.
const PAGES = 6;
export async function history(sym, days, res = 1) {
  const m = await tickerMap(), e = m.get(sym);
  if (!e) { const x = new Error('Unknown instrument'); x.status = 404; throw x; }
  const now = Math.floor(Date.now() / 1000), from = now - days * 86400, r60 = res === 60 ? 60 : 1;
  const parts = []; let to = now;
  for (let i = 0; i < PAGES && to > from; i++) {
    // the newest page changes every minute; older pages are history and can sit at the edge for a day
    const j = await feed(0, `${HOST}/datafeed/history?symbol=${encodeURIComponent(e.ticker)}&resolution=${r60}&from=${from}&to=${to}`, i ? 86400 : (r60 === 60 ? 300 : 30));
    if (!j || j.s !== 'ok' || !Array.isArray(j.t) || !j.t.length) break;
    parts.unshift(j);
    const first = +j.t[0]; if (!(first < to)) break;
    to = first - 1;
  }
  const all = { s: 'ok', t: [], o: [], h: [], l: [], c: [] };
  for (const j of parts) for (const k of ['t', 'o', 'h', 'l', 'c']) { const src = j[k], dst = all[k]; for (let i = 0; i < src.length; i++) dst.push(src[i]); }
  const ps = e.ps > 0 ? e.ps : 100000;
  return packBars(sym, ps, all, from);
}

/* The window of fixed, aligned width that holds the second `before − 1`: 7 days of 1-minute bars, 365 days of 1-hour
   bars. Fixed alignment makes every viewer ask the platform for the same URL, so the cache answers all of them: a day for
   the closed ones; the window that holds now asks up to the next 30-second mark, so it too is one URL for 30 s. Beyond the platform's reach (1 min: 400 days back,
   1 h: 2022-01-01) it answers empty without asking. { …packBars, from, to (s), more }, more false = nothing in the window. */
const WIN = { 1: 604800, 60: 31536000 }, CAP60 = 1640995200;
export async function historyWindow(sym, res, before, prio = 1) {
  const m = await tickerMap(), e = m.get(sym);
  if (!e) { const x = new Error('Unknown instrument'); x.status = 404; throw x; }
  const r60 = res === 60 ? 60 : 1, w = WIN[r60], now = Math.floor(Date.now() / 1000), ps = e.ps > 0 ? e.ps : 100000;
  const from = Math.floor((before - 1) / w) * w, to = Math.min(from + w, Math.ceil(now / 30) * 30), cap = r60 === 60 ? CAP60 : now - 400 * 86400;
  if (before <= cap || from >= now) return { ...packBars(sym, ps, null, from), from, to, more: false };
  // 'no_data' is the platform's honest "nothing here"; any other status is an error and must not read as the end of history
  const j = await feed(prio, `${HOST}/datafeed/history?symbol=${encodeURIComponent(e.ticker)}&resolution=${r60}&from=${from}&to=${to}`, from + w > now ? 30 : 86400), hi = from + w > now ? now + 1 : to, cut = { s: 'ok', t: [], o: [], h: [], l: [], c: [] };
  if (j && j.s === 'ok' && Array.isArray(j.t)) for (let i = 0; i < j.t.length; i++) { const t = +j.t[i]; if (t >= from && t < hi) for (const k of ['t', 'o', 'h', 'l', 'c']) cut[k].push(j[k][i]); }
  const packed = packBars(sym, ps, cut, from);
  return { ...packed, from, to, more: packed.c.length > 0 };
}
