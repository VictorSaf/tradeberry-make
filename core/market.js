/* tradeBerry — market core, shared by the browser (engine.js) and the server (core/market.mjs). One file, one set of
   rules: the sheet's instrument model (META), the sessions in server time (EET/EEST) and the New York day, the quote
   store of a live feed and the rules on it (news/night spread, crypto jitter, off quotes, no feed, usd cross-rates).
   No simulation (engine.js keeps it), no DOM, no globals but MarketCore.
   MarketCore.create({ catalog, now: () => ms }) → market:
   - META[sym]; setQuotes([[sym, bid, ask, tMs], …]); quote(sym) → { bid, ask, mid, spread, sp, open, why, t, off };
   - usd(ccy); session(sym, tSec) → { open, opensAt, closesAt }; isOpen(sym, tSec); serverOffset(t), nyOffset(t);
   - feedAlive(): a setQuotes in the last 10 s; setNewsMult(ccy, mult, until);
   - engine hooks (not the server's contract): SX, openAt, last, clearQuotes, stale, compose, newsMult.
   Times are unix seconds except tMs and now(). PIVOT ON BID: mid = bid; ask = the feed's ask, else bid + the sheet. */
const MarketCore = (() => {
  const FX_SESS = Object.freeze([['Sydney', 21, 24], ['Sydney', 0, 6], ['Tokyo', 0, 9], ['London', 7, 16], ['New York', 12, 21]].map(([name, from, to]) => Object.freeze({ name, from, to })));
  const FEED_S = 10, OFFQ_S = 120; // feed alive = an answer in the last 10 s; off quotes = no tick for 2 min (sheet offQ wins)

  // server time: EET/EEST (UTC+2, +3 from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC)
  const dstY = {};
  function serverOffset(t) {
    const y = new Date(t * 1000).getUTCFullYear();
    let r = dstY[y];
    if (!r) { const ls = m => { const d = Date.UTC(y, m + 1, 0) / 1000, w = new Date(d * 1000).getUTCDay(); return d - w * 86400 + 3600; }; r = dstY[y] = [ls(2), ls(9)]; }
    return t >= r[0] && t < r[1] ? 3 : 2;
  }
  /* New York time (the FX day ends at 17:00 New York): nyOffset returns −4 (EDT) or −5 (EST) hours. */
  const dstCache = {};
  function dstRange(y) {
    if (dstCache[y]) return dstCache[y];
    const sun = (m, n) => { const d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + (7 - d) % 7 + 7 * (n - 1)) / 1000; };
    return dstCache[y] = [sun(2, 2) + 7 * 3600, sun(10, 1) + 6 * 3600];
  }
  function nyOffset(t) { const r = dstRange(new Date(t * 1000).getUTCFullYear()); return t >= r[0] && t < r[1] ? -4 : -5; }
  const local2utc = loc => { const o1 = serverOffset(loc - 7200), u = loc - o1 * 3600, o2 = serverOffset(u); return o2 === o1 ? u : loc - o2 * 3600; };
  // Night = 23:00–01:00 server time on a weekday (Monday to Friday, by the server's calendar day)
  function isNight(t) {
    const loc = t + serverOffset(t) * 3600, dow = ((Math.floor(loc / 86400) + 4) % 7 + 7) % 7, mn = Math.floor((((loc % 86400) + 86400) % 86400) / 60);
    return dow >= 1 && dow <= 5 && (mn >= 1380 || mn < 60);
  }
  // the crypto jitter draw on live prices: a uniform in (0,1) from (sym, second), no state, so the server and a browser on
  // real prices (engine.js, realTime) draw the same spread for a quote without an ask; the simulation passes its own
  const fnv1a = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
  const fmix = h => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
  const jitU = (sym, s) => (fmix(fnv1a(sym) ^ Math.imul(s | 0, 0x9e3779b1)) + .5) / 4294967296;

  function create({ catalog, now = () => Date.now() } = {}) {
    const CAT = catalog;
    if (!CAT || !Array.isArray(CAT.instr) || !CAT.ccy) throw new Error('MarketCore.create: needs the catalog (catalog.js)');
    const ALL_SET = new Set(['USD', ...Object.keys(CAT.ccy)]);
    // compatibility fields for the modules that still read the v14 instrument model (label, short, tick, spread in the
    // displayed unit, minLot/lotStep, newsCcy, fin, div, sessions as UTC hours); the sheet fields ride along unchanged
    function utcSessions(r) {
      if (r.kind === 'fx') return FX_SESS;
      if (r.is247) return Object.freeze([Object.freeze({ name: '24h', from: 0, to: 24 })]);
      const off = serverOffset(now() / 1000), out = [], name = r.exch && r.exch !== 'OTC' ? r.exch : 'Session';
      const day = r.sess.filter(w => w[0] === 3).length ? 3 : r.sess.length ? r.sess[0][0] : 3;
      for (const [d, f, t] of r.sess) {
        if (d !== day) continue;
        let a = f / 60 - off, b = t / 60 - off;
        if (a < 0) { a += 24; b += 24; }
        if (b <= 24) out.push({ name, from: a, to: b }); else { out.push({ name, from: a, to: 24 }); if (b - 24 > 0) out.push({ name, from: 0, to: b - 24 }); }
      }
      return Object.freeze(out.filter(x => x.to > x.from).map(Object.freeze));
    }
    function metaOf(r) {
      const fx = r.kind === 'fx', label = fx ? r.base + '/' + r.quote : r.desc;
      const fin = fx ? { ref: 'pair', markup: .5, tripleDow: 3 } : r.group === 'crypto' ? { ref: 'none', markup: 18, tripleDow: 5 } : { ref: 'quote', markup: 2.5, tripleDow: 5 };
      return Object.freeze({
        ...r, label, short: fx ? label : r.sym, tick: r.point, spread: +(r.p.spread[0] * r.point / r.pip).toFixed(6),
        minLot: r.p.vol[0], lotStep: r.p.vol[2], maxLot: r.p.vol[1], newsCcy: Object.freeze(fx ? [r.base, r.quote] : [r.quote]),
        fin: Object.freeze(fin), div: r.group === 'index' ? 'excluded' : null, sessions: utcSessions(r)
      });
    }
    const META = Object.freeze(Object.fromEntries(CAT.instr.filter(r => r.seed).map(r => [r.sym, metaOf(r)])));

    /* ---------- sessions (sheet windows in server time; UTC out) ---------- */
    const SESS = new Map(); // sess key -> { byDow, is247, cache a/b/open }
    function sessOf(m) {
      const key = m.is247 ? '247' : JSON.stringify(m.sess);
      let s = SESS.get(key);
      if (!s) { const byDow = [[], [], [], [], [], [], []]; for (const [d, f, t] of m.sess) byDow[d].push([f, t]); byDow.forEach(a => a.sort((x, y) => x[0] - y[0])); SESS.set(key, s = { byDow, is247: !!m.is247, a: 1, b: 0, open: false }); }
      return s;
    }
    const SX = Object.freeze(Object.fromEntries(Object.values(META).map(m => [m.sym, sessOf(m)])));
    // merged open intervals [start, end) in UTC around t (±8 days)
    function intervals(s, t) {
      const out = [], D0 = Math.floor((t + serverOffset(t) * 3600) / 86400);
      for (let D = D0 - 8; D <= D0 + 8; D++) {
        const dow = ((D + 4) % 7 + 7) % 7;
        for (const [f, e] of s.byDow[dow]) {
          const a = local2utc(D * 86400 + f * 60), b = local2utc(D * 86400 + e * 60);
          if (out.length && out[out.length - 1][1] === a) out[out.length - 1][1] = b; else out.push([a, b]);
        }
      }
      return out;
    }
    function openAt(s, t) {
      if (s.is247) return true;
      if (t >= s.a && t < s.b) return s.open;
      const iv = intervals(s, t);
      let a = -Infinity, b = Infinity, open = false;
      for (const [x, y] of iv) {
        if (t >= x && t < y) { a = x; b = y; open = true; break; }
        if (y <= t) a = y; else if (x > t) { b = x; break; }
      }
      s.a = a; s.b = b; s.open = open;
      return open;
    }
    function session(sym, t = now() / 1000) {
      if (!META[sym]) return null;
      const s = SX[sym];
      if (s.is247) return { open: true, opensAt: null, closesAt: null };
      const iv = intervals(s, t);
      const i = iv.findIndex(([, y]) => y > t);
      if (i < 0) return { open: false, opensAt: null, closesAt: null };
      const [x, y] = iv[i];
      if (t >= x) return { open: true, opensAt: iv[i + 1] ? iv[i + 1][0] : null, closesAt: y };
      return { open: false, opensAt: x, closesAt: y };
    }
    const isOpen = (sym, t = now() / 1000) => (META[sym] ? openAt(SX[sym], t) : false);

    /* ---------- news: the calendar puts an instrument on its News spread while a release on one of its currencies is active */
    const newsMult = {};
    function setNewsMult(ccy, mult, until) { if (ALL_SET.has(ccy) && Number.isFinite(mult) && mult >= 1 && Number.isFinite(until)) newsMult[ccy] = { mult, until }; }
    const newsOn = (c, t) => { const n = newsMult[c]; return !!n && n.mult > 1 && t < n.until; };

    /* ---------- the feed's quotes: sym -> { bid, ask?, t (s) }; a row's ask is kept only when ask ≥ bid ---------- */
    const Q = {};
    let lastSet = -Infinity; // now() of the last setQuotes
    function setQuotes(rows) {
      lastSet = now();
      if (!Array.isArray(rows)) return;
      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        const [sym, bid, ask, tMs] = r;
        if (!META[sym] || !(bid > 0) || !Number.isFinite(tMs)) continue;
        Q[sym] = ask >= bid ? { bid, ask, t: tMs / 1000 } : { bid, t: tMs / 1000 };
      }
    }
    const last = sym => Q[sym] || null;
    const clearQuotes = () => { for (const k in Q) delete Q[k]; };
    const feedAlive = () => now() - lastSet <= FEED_S * 1000;
    const stale = (sym, lim) => { const f = Q[sym]; return !f || now() / 1000 - f.t > lim; };
    // value of 1 unit of a currency in USD from the quoted pairs (EURUSD, USDJPY, USDCZK, …; HUF via EURHUF·EURUSD)
    function usd(c) {
      if (c === 'USD') return 1;
      const q = s => (Q[s] && Q[s].bid > 0 ? Q[s].bid : null);
      let v = q(c + 'USD'); if (v) return v;
      v = q('USD' + c); if (v) return 1 / v;
      const eu = q('EURUSD'), e = q('EUR' + c); if (eu && e) return eu / e;
      return NaN;
    }

    /* compose: the quote of sym at t from its bid, the feed's row f (or null), the session state (open, why) and the
       crypto jitter draw u. spread in the displayed unit (pips for FX, points otherwise); sp = 'default'|'night'|'news'. */
    function compose(sym, bid, f, t, open, why, off, u) {
      const m = META[sym], nc = m.newsCcy;
      let sp = 'default', k = 0;
      for (let i = 0; i < nc.length; i++) if (newsOn(nc[i], t)) { sp = 'news'; k = 2; break; }
      if (!k && isNight(t)) { sp = 'night'; k = 1; }
      let pts = m.p.spread[k];
      if (m.p.jit) { const [lo, hi] = m.p.jit[k]; pts = Math.max(0, pts + lo + (hi - lo) * u); }
      if (f && f.ask >= f.bid) pts = Math.round((f.ask - f.bid) / m.point * 1e6) / 1e6;
      const ask = f && f.ask >= f.bid ? f.ask : bid + pts * m.point;
      return { bid, ask, mid: bid, spread: pts * m.point / m.pip, sp, open, why, t, off };
    }
    // quote(sym) on the feed alone: closed by the sheet's session, no feed (nothing for 10 s), off quotes (the row is
    // older than the sheet's offQ, else 2 min; never quoted = off quotes, bid NaN)
    function quote(sym) {
      const m = META[sym];
      if (!m) return undefined;
      const t = now() / 1000, f = last(sym), off = stale(sym, m.offQ || OFFQ_S);
      let open = openAt(SX[sym], t), why = open ? '' : 'closed';
      if (!feedAlive()) { open = false; why = 'no feed'; }
      else if (open && off) { open = false; why = 'off quotes'; }
      return compose(sym, f ? f.bid : NaN, f, t, open, why, off, jitU(sym, Math.floor(t)));
    }

    return {
      META, setQuotes, quote, usd, session, isOpen, serverOffset, nyOffset, isNight, feedAlive, setNewsMult,
      SX, openAt, last, clearQuotes, stale, compose, newsMult
    };
  }
  return { create, serverOffset, nyOffset, isNight, jitU };
})();
