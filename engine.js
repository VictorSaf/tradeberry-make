/* tradeBerry — market simulation engine (v15, on the instrument catalog: .mace/design/catalog.md §2–3, contract C2).
   The market is SIMULATED, with zero drift, from a starting level per instrument: the bid in Victor's broker platform
   at CATALOG.snapAt (catalog.js). Nothing here fetches rates.
   - FX: 15 currencies modelled as correlated log USD values (K = 4 factors + own noise, fitted on the pairs' 1H
     correlations; hourly profile per currency). All 38 pairs are derived from them, so prices stay triangularly
     consistent. While FX is closed (the weekend in server time) quotes and bars stop and the currencies carry on at
     the `wk` multiplier, so the reopening shows the weekend gap.
   - Everything else (indices, commodities, crypto, stocks): a canonical path per instrument, a pure function of the
     seed, the catalog, the anchor minute and the FX band (the standardised EURUSD/USDJPY increments of each minute).
     It costs nothing while nobody looks at it (cold) and is caught up on access; only the hot set (watchlist rows,
     charts, anything quoted every sub-step) is sampled into candles on every sub-step.
   - PIVOT ON BID: the simulated price is the bid; ask = bid + the sheet's spread (points × point). */
const Engine = (() => {
  const CAT = CATALOG;
  /* ---------- instruments ---------- */
  const CCY = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD']; // the G8 (stream 1, as before)
  const ALL = ['USD', ...CCY];
  const CCY_ALL = [...CCY, ...Object.keys(CAT.ccy).filter(c => !CCY.includes(c))]; // 15; the new ones draw from stream 3
  const ALL_SET = new Set(['USD', ...CCY_ALL]);
  const G8 = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF', 'EURAUD', 'GBPCHF', 'CADJPY', 'AUDNZD'];
  const FX_SESS = Object.freeze([['Sydney', 21, 24], ['Sydney', 0, 6], ['Tokyo', 0, 9], ['London', 7, 16], ['New York', 12, 21]].map(([name, from, to]) => Object.freeze({ name, from, to })));
  // server time: EET/EEST (UTC+2, +3 from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC)
  const dstY = {};
  function serverOffset(t) {
    const y = new Date(t * 1000).getUTCFullYear();
    let r = dstY[y];
    if (!r) { const ls = m => { const d = Date.UTC(y, m + 1, 0) / 1000, w = new Date(d * 1000).getUTCDay(); return d - w * 86400 + 3600; }; r = dstY[y] = [ls(2), ls(9)]; }
    return t >= r[0] && t < r[1] ? 3 : 2;
  }
  // compatibility fields for the modules that still read the v14 instrument model (label, short, tick, spread in the
  // displayed unit, minLot/lotStep, newsCcy, fin, div, sessions as UTC hours); the sheet fields ride along unchanged
  function utcSessions(r) {
    if (r.kind === 'fx') return FX_SESS;
    if (r.is247) return Object.freeze([Object.freeze({ name: '24h', from: 0, to: 24 })]);
    const off = serverOffset(Date.now() / 1000), out = [], name = r.exch && r.exch !== 'OTC' ? r.exch : 'Session';
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
  const RAW = CAT.instr.filter(r => r.seed);
  const byRaw = Object.fromEntries(RAW.map(r => [r.sym, r]));
  const ORDER = [...G8, ...RAW.filter(r => r.kind === 'fx' && !G8.includes(r.sym)).map(r => r.sym), ...RAW.filter(r => r.kind !== 'fx').map(r => r.sym)];
  const INSTR = Object.freeze(ORDER.map(s => metaOf(byRaw[s])));
  const META = Object.freeze(Object.fromEntries(INSTR.map(m => [m.sym, m])));
  const PAIRS = Object.freeze(G8.map(s => META[s]));
  const FX = Object.freeze(INSTR.filter(m => m.kind === 'fx'));
  const NX = Object.freeze(INSTR.filter(m => m.kind !== 'fx')); // non-FX (Engine.CFDS keeps its old name)
  const PAIR_SET = new Set(G8);
  const SNAP_LABEL = 'Starting level: bid 2026-10-20 13:19 UTC from the broker platform (live / last 1H close); simulated since, zero drift; volatility calibrated on 30 days of 1H bars';
  // the six simulated CFDs of v14, retired in v15 (rule 5): kept for the trade history only
  const LEGACY_META = Object.freeze(Object.fromEntries([
    ['XAUUSD', 'Gold', 'gold', 'metal', 'USD', 100, .01, 2], ['US500', 'US 500', 'index-major', 'index', 'USD', 1, 1, 1],
    ['GER40', 'Germany 40', 'index-major', 'index', 'EUR', 1, 1, 1], ['UK100', 'UK 100', 'index-major', 'index', 'GBP', 1, 1, 1],
    ['WTI', 'US Crude (WTI)', 'commodity', 'energy', 'USD', 100, .01, 2], ['BTCUSD', 'Bitcoin', 'crypto', 'crypto', 'USD', 1, 1, 1]
  ].map(([sym, label, cls, group, quote, size, pip, digits]) => [sym, Object.freeze({ sym, kind: 'cfd', label, short: sym, group, cls, base: null, quote, size, pip, point: pip, tick: +(10 ** -digits).toFixed(digits), digits, unit: 'pt', lotName: 'lots', retired: true })])));

  const HIST_MIN = 10080; // one week of 1-minute bars
  /* Replay (see .mace/design/replay.md). VERSION is the version of the market maths: any change to the steps, the
     history build, RP_Q or the RNG streams must bump it, because a seed then builds another market.
     2 = v15: catalog, 15 currencies, sessions, canonical non-FX path, bid pivot. */
  const VERSION = 2;
  const RP_Q = 1, RP_CHUNK = 15, RP_CP = 900, RP_MAX_SPAN = 259200, RP_SPEEDS = [1, 10, 60, 300, 1800];

  /* ---------- sessions (sheet windows in server time; UTC out) ---------- */
  const SESS = new Map(); // sess key -> { byDow, is247, cache }
  function sessOf(m) {
    const key = m.is247 ? '247' : JSON.stringify(m.sess);
    let s = SESS.get(key);
    if (!s) { const byDow = [[], [], [], [], [], [], []]; for (const [d, f, t] of m.sess) byDow[d].push([f, t]); byDow.forEach(a => a.sort((x, y) => x[0] - y[0])); SESS.set(key, s = { byDow, is247: !!m.is247, a: 1, b: 0, open: false }); }
    return s;
  }
  const SX = Object.fromEntries(INSTR.map(m => [m.sym, sessOf(m)]));
  const FXS = SX.EURUSD; // all 38 pairs share the FX week
  const local2utc = loc => { const o1 = serverOffset(loc - 7200), u = loc - o1 * 3600, o2 = serverOffset(u); return o2 === o1 ? u : loc - o2 * 3600; };
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
  function session(sym, t = simTime) {
    const m = META[sym]; if (!m) return null;
    const s = SX[sym];
    if (s.is247) return { open: true, opensAt: null, closesAt: null };
    const iv = intervals(s, t);
    const i = iv.findIndex(([, y]) => y > t);
    if (i < 0) return { open: false, opensAt: null, closesAt: null };
    const [x, y] = iv[i];
    if (t >= x) return { open: true, opensAt: iv[i + 1] ? iv[i + 1][0] : null, closesAt: y };
    return { open: false, opensAt: x, closesAt: y };
  }

  /* ---------- state ---------- */
  let L = {};            // latent log USD value of each currency (CCY_ALL)
  let Lfz = {};          // the levels at the last FX close: what FX quotes while closed
  let fxWas = true;      // FX open at the last FX step
  let simTime = 0;       // seconds
  let speed = 1;
  let regime = 0;        // FX log vol regime (OU)
  let source = 'snapshot';
  let rateDate = CAT.snapAt.slice(0, 10);
  const bars = {};       // sym -> [{time,open,high,low,close}] 1m (non-FX: built on first access)
  const listeners = { bar: [], chunk: [], q: [], end: [] };
  const emit = e => { for (const f of listeners[e]) f(); };
  /* MarketData: where the prices come from. 'live' = the running simulation, advanced by wall-clock dt; 'sim' = the
     same FX simulation rebuilt from a seed and a start moment and advanced in fixed RP_Q steps; 'bars' = recorded
     1-minute bars played back with a fixed path inside each minute. The two replay feeds exist only in a replay
     document (an iframe opened by replay.js) and cover the 16 G8 pairs; everything else stays still there. */
  let mode = 'live', rp = null, acc = 0, rpSpeed = 0, hold = false, endSent = false;
  let bset = null, cur = null;
  const streams = {};

  /* Optional seed (?seed=N or Engine.setSeed(n) before init): the engine then draws from its own PRNGs instead of
     Math.random. The same seed, the same catalog and the same UTC minute at init give the same history, and the same
     sequence of tick lengths gives the same prices after it. The app's loop ticks on setInterval timing, and the
     calendar, demo and other modules keep Math.random, so a running session is not reproducible.
     setSeed after init restarts the FX PRNGs only; the canonical non-FX path keeps the seed it was built with. */
  let seed = null, ready = false;
  const mb = st => () => { st.s = (st.s + 0x6D2B79F5) | 0; let x = Math.imul(st.s ^ (st.s >>> 15), 1 | st.s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const s1 = { s: 0 }, s3 = { s: 0 };
  let rand = Math.random, rand3 = Math.random;
  let PS = (Math.random() * 4294967296) >>> 0; // seed of the canonical non-FX path (fixed at init)
  function setSeed(n) {
    if (n == null || n === '') { seed = null; rand = Math.random; rand3 = Math.random; }
    else { n = Number(n); if (!Number.isFinite(n)) return; seed = Math.trunc(n) >>> 0; s1.s = seed | 0; rand = mb(s1); s3.s = (seed ^ 0x7F4A7C15) | 0; rand3 = mb(s3); }
    gSpare = null; gSpare3 = null;
    for (const k in streams) delete streams[k];
    if (!ready) regime = 0;
  }
  const fnv1a = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
  function rng(name) {
    if (seed == null) return Math.random;
    return () => {
      if (!(name in streams)) streams[name] = (seed ^ fnv1a(name)) | 0;
      const t = streams[name] = (streams[name] + 0x6D2B79F5) | 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  let gSpare = null;
  function gauss() {
    if (gSpare !== null) { const g = gSpare; gSpare = null; return g; }
    let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand();
    const r = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * v; gSpare = r * Math.sin(a); return r * Math.cos(a);
  }
  let gSpare3 = null;
  function gauss3() {
    if (gSpare3 !== null) { const g = gSpare3; gSpare3 = null; return g; }
    let u = 0, v = 0; while (!u) u = rand3(); while (!v) v = rand3();
    const r = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * v; gSpare3 = r * Math.sin(a); return r * Math.cos(a);
  }
  // counter RNG of the canonical path: a uniform in (0,1) from (PS, id, minute, slot), no state
  const mix = (h, k) => { k = Math.imul(k, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593); h ^= k; h = (h << 13) | (h >>> 19); return (Math.imul(h, 5) + 0xe6546b64) | 0; };
  const fmix = h => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
  const u01 = (id, m, slot) => (fmix(mix(mix(mix(PS, id), m), slot)) + .5) / 4294967296;
  const nrm = (id, m, slot) => Math.sqrt(-2 * Math.log(u01(id, m, 2 * slot))) * Math.cos(2 * Math.PI * u01(id, m, 2 * slot + 1));

  /* vol regime: an OU in log vol, clamped to [-.6, .8]; exp(r − RG_V) keeps the mean variance at the calibrated one */
  const RG_SD = Math.sqrt(.03 * .03 / (1 - .998 * .998));
  const RG_V = (() => { let s = 0, w = 0; for (let k = -600; k <= 600; k++) { const x = k / 100, p = Math.exp(-x * x / 2), r = Math.max(-.6, Math.min(.8, x * RG_SD)); s += p * Math.exp(2 * r); w += p; } return Math.log(s / w) / 2; })();
  const clampR = r => Math.max(-.6, Math.min(.8, r));

  /* hourly profile: w_h = digit/5 (≥ .2 in session), RMS 1 over the open UTC hours of a winter week (catalog §2) */
  function profileOf(digits, m) {
    const open = new Array(24).fill(false);
    if (!m || m.is247 || m.kind === 'fx') open.fill(true);
    else for (const [, f, t] of m.sess) for (let x = f; x < t; x += 15) open[(((Math.floor(x / 60) - 2) % 24) + 24) % 24] = true;
    const w = Array.from({ length: 24 }, (_, h) => Math.max(.2, (+digits[h] || 0) / 5));
    let s = 0, n = 0; for (let h = 0; h < 24; h++) if (open[h]) { s += w[h] * w[h]; n++; }
    const k = n ? Math.sqrt(s / n) : 1;
    return Float64Array.from(w, v => v / k);
  }

  /* ---------- FX: 15 currencies ---------- */
  const CV = CCY_ALL.map(c => CAT.ccy[c]);
  const CW = CV.map(v => profileOf(v.prof));
  // the starting log USD value of each currency, from the seed bid of its pair (exact on the USD pairs; HUF via EURHUF)
  const REF_L = (() => {
    const o = { USD: 0 }, todo = [...CCY_ALL];
    for (let k = 0; k < 4 && todo.length; k++) for (const c of todo.splice(0)) {
      const pr = byRaw[CAT.ccy[c].pair], b = pr && pr.base, q = pr && pr.quote;
      if (pr && b === c && q in o) o[c] = o[q] + Math.log(pr.seed.bid);
      else if (pr && q === c && b in o) o[c] = o[b] - Math.log(pr.seed.bid);
      else if (!pr) o[c] = -Math.log(CAT.ccy[c].ref); else todo.push(c);
    }
    for (const c of todo) o[c] = -Math.log(CAT.ccy[c].ref);
    delete o.USD;
    return o;
  })();
  const NG8 = CCY.length, NC = CCY_ALL.length, I_EUR = CCY_ALL.indexOf('EUR'), I_JPY = CCY_ALL.indexOf('JPY');
  const K = CV[0].load.length;
  // the FX band of the canonical path: per finished minute, the standardised increments of EURUSD and USDJPY and the
  // latent EUR level at its end (for the EUR crypto); the minute in progress accumulates in zAccE/zAccJ
  let zBase = 0, zLen = 0, zCap = 0, ZE = null, ZJ = null, ZL = null, zMin = 0, zAccE = 0, zAccJ = 0, zL0 = 0; // zL0: latent EUR at the band's start
  function zAlloc(base, cap) { zBase = base; zLen = 0; zCap = cap; zL0 = L.EUR || 0; ZE = new Float64Array(cap); ZJ = new Float64Array(cap); ZL = new Float64Array(cap); }
  function zPush(e, j, l) {
    if (zLen === zCap) {
      if (zCap >= 60 * 1440) {
        // the band keeps 60 days: before dropping the oldest 14, bring every cold path past them (so a path caught up
        // later never needs a minute the band no longer has)
        const d = 14 * 1440, cut = (zBase + d) * 60;
        if (mode === 'live') for (const s of NXS) { const p = P[s]; if (p.st && p.st.M * 60 < cut) catchUp(p, cut); }
        zL0 = ZL[d - 1]; ZE.copyWithin(0, d); ZJ.copyWithin(0, d); ZL.copyWithin(0, d); zBase += d; zLen -= d;
      }
      else { const n = zCap * 2, a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n); a.set(ZE); b.set(ZJ); c.set(ZL); ZE = a; ZJ = b; ZL = c; zCap = n; }
    }
    ZE[zLen] = e; ZJ[zLen] = j; ZL[zLen] = l; zLen++;
  }
  const zRho = -CV[I_EUR].load.reduce((s, v, k) => s + v * CV[I_JPY].load[k], 0); // corr(z EURUSD, z USDJPY)
  function zOf(m, out) {
    const i = m - zBase;
    if (i >= 0 && i < zLen) { out[0] = ZE[i]; out[1] = ZJ[i]; return out; }
    if (m === zMin) { out[0] = zAccE; out[1] = zAccJ; return out; }
    out[0] = nrm(3, m, 0); out[1] = zRho * out[0] + Math.sqrt(1 - zRho * zRho) * nrm(3, m, 1); return out; // outside the band: drawn
  }
  const lEurAt = m => { const i = m - zBase; return i >= 0 && i < zLen ? ZL[i] : i === -1 ? zL0 : L.EUR; }; // latent EUR at the end of minute m
  const fxOpen = t => openAt(FXS, t);
  const fp = new Float64Array(K);
  /* One FX step over [tS, tS + dt) (inside one minute). Stream 1: regime, K factors, fat-tail draw, then the G8 noise
     in CCY order; stream 3: the noise of the 8 new currencies. dL = vol × w(h) × exp(r − RG_V) × fat × √(dt/3600) × z,
     z = load·f + idio·e (unit variance); closed: w(h) → wk. The log values carry no drift (crosses stay exact). */
  function fxStep(Lx, dt, tS, band) {
    regime += -.002 * regime * dt / 60 + .03 * Math.sqrt(dt / 60) * gauss();
    regime = clampR(regime);
    const open = fxOpen(tS);
    if (!open && fxWas) Lfz = { ...Lx };
    fxWas = open;
    for (let k = 0; k < K; k++) fp[k] = gauss();
    const fat = rand() < .0015 * Math.max(1, dt / 5) ? 3 : 1;
    const h = Math.floor(((tS % 86400) + 86400) % 86400 / 3600), vm = Math.exp(regime - RG_V) * fat * Math.sqrt(dt / 3600);
    let zE = 0, zJ = 0;
    for (let i = 0; i < NC; i++) {
      const v = CV[i], l = v.load;
      let z = v.idio * (i < NG8 ? gauss() : gauss3());
      for (let k = 0; k < K; k++) z += l[k] * fp[k];
      Lx[CCY_ALL[i]] += v.vol * (open ? CW[i][h] : v.wk) * vm * z;
      if (i === I_EUR) zE = z; else if (i === I_JPY) zJ = z;
    }
    if (band) { const q = Math.sqrt(dt / 60); zAccE += zE * q; zAccJ -= zJ * q; }
  }
  // close the FX band's minute when the clock reaches the next one
  function zRoll(t) {
    const m = Math.floor(t / 60);
    while (zMin < m) { zPush(zAccE, zAccJ, L.EUR); zAccE = 0; zAccJ = 0; zMin++; }
  }
  const lv = (Lx, c) => c === 'USD' ? 0 : Lx[c];
  function fxPx(m, Lx) {
    if (cur && Lx === L && cur[m.sym] != null) return cur[m.sym];
    return Math.exp(lv(Lx, m.base) - lv(Lx, m.quote));
  }
  const fxLevels = () => (fxOpen(simTime) ? L : Lfz);

  /* ---------- non-FX: the canonical path ---------- */
  const FN = CAT.factors, NF = FN.names.length; // 6 non-FX factors, conditioned on the 2 FX ones
  /* Fat tails (catalog §2: Poisson jumps carrying φ ≈ .3 of the in-session variance) sit on the innovations, not on the
     instruments: each of the 6 orthogonal non-FX innovations jumps on the clock of its factor instrument (US.500 …
     BTCUSD), the own noise on the instrument's clock. An instrument's minute return, in σ units, is
       a·z + Σ c_j (√(1−φ_j)·N_j + I_j·K_j·Z_j) + idio (√(1−φ)·N + I·K·Z),   P(I) = 1 − e^{−λ/60}, K = √(φ / P(I)),
     unit variance with the fitted correlations kept: jumps on a shared innovation hit every instrument loaded on it. */
  const jumpOf = sd => { const lam = sd && sd.lamJ || 0, J = sd && sd.J || 0, phi = sd && sd.sIn > 0 && lam > 0 ? Math.min(.9, lam * J * J / (sd.sIn * sd.sIn)) : 0, pj = phi ? 1 - Math.exp(-lam / 60) : 0; return { phi, pj, K: pj ? Math.sqrt(phi / pj) : 0 }; };
  const FJ = FN.names.map(n => jumpOf(byRaw[n] && byRaw[n].seed));
  const ID = {}, P = {}; // per non-FX instrument: constants and state
  for (const m of NX) {
    const sd = m.seed, id = fnv1a(m.sym);
    ID[m.sym] = id;
    if (sd.derived) { const [b] = sd.derived.split('/'); P[m.sym] = { m, id, derived: b, lnRef: Math.log(sd.bid) }; continue; }
    const beta = sd.beta || [0, 0, 0, 0, 0, 0, 0, 0], a = [beta[6], beta[7]], c = new Array(NF).fill(0);
    for (let k = 0; k < NF; k++) { a[0] += beta[k] * FN.cond[k][0]; a[1] += beta[k] * FN.cond[k][1]; for (let j = 0; j < NF; j++) c[j] += beta[k] * FN.chol[k][j]; }
    const idio = sd.idio == null ? 1 : sd.idio;
    const Vz = a[0] * a[0] + a[1] * a[1] + 2 * zRho * a[0] * a[1], Vo = c.reduce((s, v) => s + v * v, 0) + idio * idio, V = Vz + Vo || 1, q = 1 / Math.sqrt(V);
    const own = jumpOf(sd), cn = c.map(v => v * q), idn = idio * q;
    const cs = Float64Array.from(cn, (v, j) => v * Math.sqrt(1 - FJ[j].phi)), ids = idn * Math.sqrt(1 - own.phi);
    const vo2 = cs.reduce((s, v) => s + v * v, 0) + ids * ids;
    const fjs = []; cn.forEach((v, j) => { if (v && FJ[j].pj) fjs.push([j, v * FJ[j].K, FJ[j].pj]); }); // jumps it takes from the innovations
    const digits = sd.prof || (byRaw['US.500'].seed.prof);
    P[m.sym] = {
      m, id, s: SX[m.sym], a0: a[0] * q, a1: a[1] * q, c: Float64Array.from(cn), idn, cs, ids, vo: Math.sqrt(vo2), vc: Vz * q * q + vo2,
      sd: sd.sIn, w: profileOf(digits, m), fjs, pj: own.pj, ki: idn * own.K,
      gap: sd.sGap || 0, lnRef: Math.log(sd.bid),
      st: null
    };
  }
  const NXS = NX.filter(m => !P[m.sym].derived).map(m => m.sym);
  const openMin = (p, m) => openAt(p.s, m * 60);
  const eps = new Float64Array(NF); let epsM = NaN, EPS = null, EPB = 0, EPN = 0;
  function epsOf(m) {
    const i = m - EPB;
    if (EPS && i >= 0 && i < EPN) { const o = i * (NF + 1); if (!EPS[o + NF]) { for (let j = 0; j < NF; j++) EPS[o + j] = nrm(1, m, j); EPS[o + NF] = 1; } return EPS.subarray(o, o + NF); }
    if (m !== epsM) { for (let j = 0; j < NF; j++) eps[j] = nrm(1, m, j); epsM = m; }
    return eps;
  }
  // the jumps of the shared innovations in minute m: [j, second, size in K units] (usually none)
  let fjM = NaN, fjL = [];
  function fjOf(m) {
    if (m === fjM) return fjL;
    fjM = m; fjL = [];
    for (let j = 0; j < NF; j++) if (FJ[j].pj && u01(2, m, 1100 + j) < FJ[j].pj) fjL.push([j, Math.floor(u01(2, m, 1110 + j) * 60), nrm(2, m, 560 + j)]);
    return fjL;
  }
  /* The vol regime of a non-FX instrument: .8 × a market regime (one OU per minute, shared by all, stepped every
     minute open or closed) + .6 × its own OU (stepped on its open minutes). Fully own regimes would cut every fitted
     correlation by ≈ 20 % (E[e^{r_i} e^{r_j}] / √(E e^{2r_i} E e^{2r_j}) = e^{−σ_r²}); RG_V2 keeps the mean variance. */
  const RG_V2 = (() => { const E = k => { let s = 0, w = 0; for (let i = -600; i <= 600; i++) { const x = i / 100, p = Math.exp(-x * x / 2); s += p * Math.exp(k * clampR(x * RG_SD)); w += p; } return s / w; }; return Math.log(E(1.6) * E(1.2)) / 2; })();
  let RMB = 0, RMN = 0, RM = new Float64Array(0);
  function rmReset(m0) { RMB = m0; RMN = 1; RM = new Float64Array(4 * 1440); RM[0] = clampR(RG_SD * nrm(2, m0, 4)); }
  function rmAt(m) { // the market regime of minute m
    if (!RMN) rmReset(m);
    let i = m - RMB;
    if (i < 0) i = 0;
    if (i >= RM.length) { const a = new Float64Array(Math.max(RM.length * 2, i + 1440)); a.set(RM); RM = a; }
    while (RMN <= i) { RM[RMN] = clampR(RM[RMN - 1] * .998 + .03 * nrm(2, RMB + RMN, 1)); RMN++; }
    return RM[i];
  }
  /* the draws of one open minute for one instrument, given its own regime before it (state r) */
  function minuteData(p, r0, m) {
    const id = p.id, r = clampR(r0 * .998 + .03 * nrm(id, m, 1));
    const sig = p.sd * p.w[Math.floor((((m % 1440) + 1440) % 1440) / 60)] * Math.exp(.8 * rmAt(m) + .6 * r - RG_V2) / Math.sqrt(60);
    const e = epsOf(m);
    let G = p.ids * nrm(id, m, 0);
    for (let j = 0; j < NF; j++) G += p.cs[j] * e[j];
    // jumps: [second, log size]; comp = the compensator that keeps E[exp(ΔX)] = 1
    let jl = null, comp = 0;
    const s2 = sig * sig / 2;
    if (p.fjs.length) { const fl = fjOf(m); for (const [j, w, pj] of p.fjs) { comp += Math.log1p(pj * Math.expm1(s2 * w * w)); for (const x of fl) if (x[0] === j) (jl || (jl = [])).push([x[1], sig * w * x[2]]); } }
    if (p.pj) { comp += Math.log1p(p.pj * Math.expm1(s2 * p.ki * p.ki)); if (u01(id, m, 1000) < p.pj) (jl || (jl = [])).push([Math.floor(u01(id, m, 1001) * 60), sig * p.ki * nrm(id, m, 2)]); }
    return { m, r, sig, G, jl, comp, bb: null, bc: null };
  }
  // unit Brownian bridge on the 1 s grid of minute m (fine: 60 points; coarse: every 6 s, for older history)
  function bridge(p, md, coarse) {
    if (coarse ? md.bc : md.bb) return coarse ? md.bc : md.bb;
    const n = coarse ? 10 : 60, W = new Float64Array(n + 1), k = 1 / Math.sqrt(n), o = coarse ? 80 : 10;
    for (let j = 0; j < n; j += 2) {
      const r = Math.sqrt(-2 * Math.log(u01(p.id, md.m, 2 * (o + j)))) * k, a = 2 * Math.PI * u01(p.id, md.m, 2 * (o + j) + 1);
      W[j + 1] = W[j] + r * Math.cos(a); W[j + 2] = W[j + 1] + r * Math.sin(a);
    }
    const out = new Float64Array(n + 1); for (let j = 0; j <= n; j++) out[j] = W[j] - j / n * W[n];
    return coarse ? (md.bc = out) : (md.bb = out);
  }
  /* X(s) − X0 inside an open minute, s = whole seconds 0..60 (60 = the minute's close):
       σ·(a·z_s + (s/60)·G + vo·BB(s)) − (s/60)·(½σ²·vc + comp) + each jump once past its second.
     vc = the variance of the continuous bracket (all exposures normalised to 1 with the jumps), comp = Σ log(1 +
     P(I)(e^{½σ²w²K²} − 1)) over its jumps, so E[exp(ΔX)] = 1: a martingale. */
  function partial(p, md, s, z0, z1, coarse) {
    const f = s / 60, b = s === 60 || s === 0 ? 0 : coarse ? bridge(p, md, true)[Math.round(s / 6)] : bridge(p, md, false)[s];
    let x = md.sig * (p.a0 * z0 + p.a1 * z1 + f * md.G + p.vo * b) - f * (.5 * md.sig * md.sig * p.vc + md.comp);
    if (md.jl) for (const j of md.jl) if (s > j[0]) x += j[1];
    return x;
  }
  const zb = [0, 0];
  // the reopening gap: sGap × (the same exposures on the day's shared gap factors + own noise) − ½ sGap²
  function gapOf(p, m) {
    const D = Math.floor((m * 60 + serverOffset(m * 60) * 3600) / 86400);
    let g = p.a0 * nrm(2, D, 6) + p.a1 * nrm(2, D, 7) + p.idn * nrm(p.id, m, 3);
    for (let j = 0; j < NF; j++) g += p.c[j] * nrm(2, D, j);
    return p.gap * g - .5 * p.gap * p.gap;
  }
  /* advance a path state by its minute st.M (st.X = the level at its start): the move of an open minute, then the gap
     if the next minute reopens after a closed one. Hot, cold and rebuilt paths all go through here. */
  function stepMinute(p, st) {
    const m = st.M, op = openMin(p, m);
    if (op) {
      const md = st.md && st.md.m === m ? st.md : minuteData(p, st.r, m);
      zOf(m, zb);
      st.X += partial(p, md, 60, zb[0], zb[1], false);
      st.r = md.r;
    }
    if (p.gap && !op && openMin(p, m + 1)) st.X += gapOf(p, m + 1);
    st.M = m + 1; st.md = null;
    if (st.sh && st.sh.length) for (const [mm, x] of st.sh) if (mm === st.M) st.X += x;
  }
  const mdOf = (p, st) => (st.md && st.md.m === st.M ? st.md : (st.md = minuteData(p, st.r, st.M)));
  // the log price of a state at t (inside its minute st.M); z: the FX band so far (live) or interpolated (rebuilt)
  function xAt(p, st, t) {
    if (!openMin(p, st.M)) return st.X;
    const s = Math.min(59, Math.max(0, Math.floor(t - st.M * 60)));
    if (!s) return st.X;
    const md = mdOf(p, st);
    if (st.M === zMin) return st.X + partial(p, md, s, zAccE, zAccJ, false);
    zOf(st.M, zb); return st.X + partial(p, md, s, zb[0] * s / 60, zb[1] * s / 60, false);
  }
  /* a rebuilt bar of the open minute st.M (log values): the 1 s grid (coarse for old history); z linear in the minute.
     As on a live bar, the close is the last price inside the minute (s = 59) and the level at the minute boundary
     opens the next bar: every bar opens on the canonical level, whether it was hot, cold or rebuilt. */
  function reconBar(p, st, coarse, upTo = 59, zp = null) {
    const md = mdOf(p, st), X0 = st.X;
    let z0, z1;
    if (zp) { z0 = zp[0]; z1 = zp[1]; } else { zOf(st.M, zb); z0 = zb[0]; z1 = zb[1]; }
    let hi = X0, lo = X0, cl = X0;
    const stp = coarse ? 6 : 1, endS = Math.max(0, upTo);
    const pt = s => { const f = zp ? s / endS : s / 60, v = X0 + partial(p, md, s, z0 * f, z1 * f, coarse); if (v > hi) hi = v; if (v < lo) lo = v; cl = v; };
    for (let s = stp; s < endS; s += stp) pt(s);
    if (endS) pt(endS);
    return [X0, hi, lo, cl];
  }
  const expBar = (t, b, k = 0) => ({ time: t, open: Math.exp(b[0] + k), high: Math.exp(b[1] + k), low: Math.exp(b[2] + k), close: Math.exp(b[3] + k) });
  const trim = arr => { if (mode === 'live' && arr.length > HIST_MIN + 4000) arr.splice(0, 1000); };

  // bring a cold state up to the minute of t (rebuilding the bars it missed, when it has bars)
  function catchUp(p, t) {
    const st = p.st, cm = Math.floor(t / 60);
    while (st.M < cm) {
      if (st.bars && openMin(p, st.M)) {
        const a = st.bars, last = a[a.length - 1];
        if (!last || last.time < st.M * 60) { a.push(expBar(st.M * 60, reconBar(p, st, false))); trim(a); }
      }
      stepMinute(p, st);
    }
  }
  function partialBar(p, st, t) {
    const s = Math.min(59, Math.max(0, Math.floor(t - st.M * 60)));
    return expBar(st.M * 60, reconBar(p, st, false, s, st.M === zMin ? [zAccE, zAccJ] : null));
  }
  // the full candle history of a non-FX instrument: a week before the anchor (own path, anchored on its level), then
  // the live path from the anchor replayed minute by minute (with the shocks it received), then the minute in progress
  function buildBars(p) {
    const st = p.st, out = [], a0 = st.aM;
    const hs = { M: a0 - (HIST_MIN - 1), X: 0, r: clampR(RG_SD * nrm(p.id, a0 - HIST_MIN, 5)), md: null }, hb = [];
    while (hs.M < a0) {
      if (openMin(p, hs.M)) hb.push([hs.M * 60, reconBar(p, hs, hs.M < a0 - 120)]);
      stepMinute(p, hs);
    }
    const k = st.aX - hs.X;
    for (const [t, b] of hb) out.push(expBar(t, b, k));
    const ls = { M: a0, X: st.aX, r: st.aR, md: null, sh: st.sh };
    if (st.sh) for (const [mm, x] of st.sh) if (mm === a0) ls.X += x;
    while (ls.M < st.M) {
      if (openMin(p, ls.M)) out.push(expBar(ls.M * 60, reconBar(p, ls, false)));
      stepMinute(p, ls);
    }
    if (openMin(p, st.M) && mode === 'live') out.push(partialBar(p, st, simTime));
    if (!out.length) { const v = Math.exp(xAt(p, st, simTime)); out.push({ time: Math.floor(simTime / 60) * 60, open: v, high: v, low: v, close: v }); }
    st.sh = null;
    return out;
  }
  function stateAt(sym) { // a caught-up state (live market)
    const p = P[sym];
    if (p.st && mode === 'live' && p.st.M < Math.floor(simTime / 60)) catchUp(p, simTime);
    return p;
  }
  function nxLog(sym) {
    const p = P[sym];
    if (p.derived) return mode === 'live' ? nxLog(p.derived) - lv(L, 'EUR') : p.lnRef;
    if (mode !== 'live' || !p.st) return p.st ? p.st.X : p.lnRef;
    stateAt(sym);
    return xAt(p, p.st, simTime);
  }
  // non-FX candles: built on first access, kept up to date while hot
  function ensureBars(sym) {
    const p = P[sym];
    if (mode !== 'live' || !p.st && !p.derived) return bars[sym];
    if (fed(sym) && bars[sym]) return bars[sym]; // the feed's own bars (or the simulated history before it): never caught up
    if (p.derived) {
      const b = ensureBars(p.derived);
      let a = bars[sym];
      if (!a) a = bars[sym] = [];
      const last = a[a.length - 1];
      let i0 = b.length; while (i0 > 0 && (!last || b[i0 - 1].time >= last.time)) i0--;
      for (let i = i0; i < b.length; i++) {
        const c = b[i];
        const m = c.time / 60, e0 = Math.exp(lEurAt(m - 1)), e1 = m === zMin ? Math.exp(L.EUR) : Math.exp(lEurAt(m));
        const d = { time: c.time, open: c.open / e0, high: Math.max(c.open / e0, c.high / e1), low: Math.min(c.open / e0, c.low / e1), close: c.close / e1 };
        if (last && c.time === last.time) { if (d.high > last.high) last.high = d.high; if (d.low < last.low) last.low = d.low; last.close = d.close; } else a.push(d);
      }
      if (!a.length) { const v = Math.exp(nxLog(sym)); a.push({ time: Math.floor(simTime / 60) * 60, open: v, high: v, low: v, close: v }); }
      trim(a);
      return a;
    }
    const st = p.st;
    if (!st.bars) { if (st.M < Math.floor(simTime / 60)) catchUp(p, simTime); st.bars = bars[sym] = buildBars(p); return st.bars; }
    if (st.M < Math.floor(simTime / 60)) catchUp(p, simTime);
    const a = st.bars, last = a[a.length - 1];
    if (openMin(p, st.M) && (!last || last.time < st.M * 60)) { a.push(partialBar(p, st, simTime)); trim(a); }
    return a;
  }

  /* ---------- hot set ---------- */
  let hotReq = new Set(), tickNo = 0, hotList = [], hotS = new Set();
  const touched = new Map(); // sym -> tick number of the last access to its candles
  const HOT_TICKS = 40;
  function hot(syms) {
    hotReq = new Set((Array.isArray(syms) ? syms : []).filter(s => P[s]));
    refreshHot();
    return hotList.slice();
  }
  function refreshHot() {
    const out = [];
    for (const s of NX) {
      const k = s.sym;
      if (hotReq.has(k) || (touched.has(k) && tickNo - touched.get(k) <= HOT_TICKS)) out.push(k); else touched.delete(k);
    }
    hotList = out; hotS = new Set(out);
  }
  const touch = sym => { if (P[sym]) touched.set(sym, tickNo); };

  /* ---------- feed seam ---------- */
  /* An adapter: has(sym), onTicks(cb) where cb(sym, bid, tMs[, ask]), optionally history(sym, from, to) and:
     - realTime: true — real prices (livefeed.js): the clock is the wall clock, the simulated history of every fed
       instrument is dropped (it would join a made-up past to real prices); the bars are the feed's own, from its
       history (feedHistory) and its ticks, each in the minute of its own timestamp;
     - alive(): false while the feed has gone quiet (no answer for a while): every fed instrument is then closed
       ("no feed") instead of trading on a frozen price;
     - want(sym): the candles of sym were read (load its history on demand).
     A tick's ask, when given, is the quote's ask (the platform's own spread); without it ask = bid + the sheet. */
  let feed = null, realTime = false;
  const fq = {}; // sym -> { bid, ask?, t (s) }
  let qQueued = false, barQueued = false;
  function setFeed(ad) {
    if (ad && (typeof ad.has !== 'function' || typeof ad.onTicks !== 'function')) throw new Error('Engine.setFeed: an adapter needs has(sym) and onTicks(cb)');
    feed = ad || null; realTime = !!(feed && feed.realTime && mode === 'live');
    for (const k in fq) delete fq[k];
    if (!feed) return;
    if (speed > 1) speed = 1;
    if (realTime) {
      simTime = Date.now() / 1000;
      for (const m of INSTR) if (feed.has(m.sym)) { bars[m.sym] = []; const p = P[m.sym]; if (p && p.st) p.st.bars = null; }
    }
    feed.onTicks((sym, bid, tMs, ask) => {
      if (feed !== ad || !META[sym] || !feed.has(sym) || !(bid > 0) || !Number.isFinite(tMs)) return;
      fq[sym] = ask >= bid ? { bid, ask, t: tMs / 1000 } : { bid, t: tMs / 1000 };
      const a = bars[sym] || (META[sym].kind !== 'fx' ? ensureBars(sym) : null);
      if (a) {
        const mn = Math.floor((realTime ? tMs / 1000 : simTime) / 60) * 60, last = a[a.length - 1];
        if (!last || last.time < mn) { a.push({ time: mn, open: bid, high: bid, low: bid, close: bid }); trim(a); barSoon(); }
        else if (last.time === mn || !realTime) { if (bid > last.high) last.high = bid; if (bid < last.low) last.low = bid; last.close = bid; }
      }
      if (!qQueued) { qQueued = true; queueMicrotask(() => { qQueued = false; emit('q'); }); }
    });
    if (typeof feed.history === 'function') for (const m of INSTR) if (feed.has(m.sym)) {
      try {
        const take = h => { if (Array.isArray(h) && h.length && h.every(c => c && Number.isFinite(c.time) && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)) { const a = bars[m.sym] || (bars[m.sym] = []); a.splice(0, a.length, ...h.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))); } };
        const h = feed.history(m.sym, simTime - HIST_MIN * 60, simTime);
        if (h && typeof h.then === 'function') h.then(take, () => {}); else take(h);
      } catch (e) { /* history is optional */ }
    }
  }
  const barSoon = () => { if (!barQueued) { barQueued = true; queueMicrotask(() => { barQueued = false; listeners.bar.forEach(f => f()); }); } };
  const feedDown = () => !!(feed && typeof feed.alive === 'function' && !feed.alive());
  const fed = sym => !!(feed && feed.has(sym));
  // a feed's own 1-minute history for one instrument (the relay asks per symbol, not for all 265 at once)
  function feedHistory(sym, h) {
    if (!fed(sym) || !Array.isArray(h) || !h.length) return false;
    if (!h.every(c => c && Number.isFinite(c.time) && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)) return false;
    const a = bars[sym] || (bars[sym] = []), last = a.length ? a[a.length - 1] : null, h0 = h.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    // keep the bar the live ticks are building if it is newer than the history's last bar
    if (last && last.time > h0[h0.length - 1].time) h0.push(last);
    a.splice(0, a.length, ...h0); trim(a);
    barSoon();
    return true;
  }
  // value of 1 unit of a currency in USD from the fed pairs (EURUSD, USDJPY, USDCZK, …; HUF via EURHUF·EURUSD)
  function fedUsd(c) {
    const q = s => (fed(s) && fq[s] && fq[s].bid > 0 ? fq[s].bid : null);
    let v = q(c + 'USD'); if (v) return v;
    v = q('USD' + c); if (v) return 1 / v;
    const eu = q('EURUSD'), e = q('EUR' + c); if (eu && e) return eu / e;
    return null;
  }

  /* ---------- prices ---------- */
  // the simulated price of an instrument: its bid (PIVOT ON BID)
  function bidOf(sym) {
    const m = META[sym];
    if (fed(sym) && fq[sym]) return fq[sym].bid;
    if (m.kind === 'fx') return fxPx(m, mode === 'live' || !cur ? fxLevels() : L);
    return Math.exp(nxLog(sym));
  }
  function mid(sym) { if (!META[sym]) return NaN; touch(sym); return bidOf(sym); }

  /* ---------- build, init, snapshot ---------- */
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  /* A snapshot keeps what a reload needs to carry the market on: the currency levels (those FX quotes: frozen while
     FX is closed) and the non-FX log prices, both in L (keys = currency codes or instrument symbols; readers keep
     them apart by key list), the clock, the FX vol regime, the seed. The fields are those of v14; a v15 snapshot is
     told apart by its 15 currencies (a v14 one has the G8 only, and its non-FX levels are the retired illustrative
     ones: ignored). The candle history is rebuilt. */
  function snapshot() {
    const out = {}, F = fxLevels();
    for (const c of CCY_ALL) out[c] = F[c];
    if (mode === 'live') for (const s of NXS) { const p = P[s]; if (p.st) out[s] = nxLog(s); }
    return { L: out, simTime, regime, source, rateDate, seed };
  }
  function validSnap(r) {
    if (!r || typeof r !== 'object' || !r.L || typeof r.L !== 'object') return false;
    if (!CCY.every(c => isNum(r.L[c]) && Math.abs(r.L[c]) < 20)) return false;
    return isNum(r.simTime) && r.simTime > 1e9 && r.simTime < 1e11 && isNum(r.regime);
  }
  async function init(resume) {
    if (child) return initReplay(await cfgP);
    if (realTime) return; // real prices: a saved market has nothing to rebuild (the clock and the bars are the feed's)
    try { resume = await resume; } catch (e) { resume = null; }
    const res = validSnap(resume) ? resume : null;
    const lvl = {}, xv = {};
    for (const c of CCY_ALL) { const v = res && res.L[c]; lvl[c] = isNum(v) && Math.abs(v - REF_L[c]) <= 5 ? v : REF_L[c]; }
    const v2 = !!res && CCY_ALL.every(c => isNum(res.L[c]));
    for (const s of NXS) { const v = v2 ? res.L[s] : NaN; xv[s] = isNum(v) && Math.abs(v - P[s].lnRef) <= 5 ? v : P[s].lnRef; }
    let now;
    if (res) {
      now = res.simTime;
      if (seed == null && Number.isInteger(res.seed)) setSeed(res.seed);
    } else now = Math.floor(Date.now() / 1000);
    source = 'snapshot'; rateDate = CAT.snapAt.slice(0, 10);
    PS = seed == null ? (Math.random() * 4294967296) >>> 0 : (seed ^ 0x5bd1e995) >>> 0;
    build(lvl, now);
    if (res) regime = clampR(res.regime);
    anchorNx(xv);
    ready = true;
  }
  /* one week of FX history ending at the minute before `now`, anchored so the price at `now` is seedL (the frozen
     levels when FX is closed at `now`); the minute of `now` opens there. Records the FX band for the whole week. */
  function build(seedL, now) {
    const curMin = Math.floor(now / 60) * 60, t0 = curMin - (HIST_MIN - 1) * 60;
    const Lx = { ...seedL };
    for (const m of FX) bars[m.sym] = [];
    zAlloc(t0 / 60, HIST_MIN * 2); zMin = t0 / 60; zAccE = 0; zAccJ = 0;
    fxWas = fxOpen(t0); Lfz = { ...Lx };
    const NP = FX.length, PB = FX.map(m => m.base), PQ = FX.map(m => m.quote), ARR = FX.map(m => bars[m.sym]);
    const lo = new Float64Array(NP), hi = new Float64Array(NP), op = new Float64Array(NP), cl = new Float64Array(NP);
    L = Lx; Lx.USD = 0; zL0 = Lx.EUR;
    for (let i = 0; i < HIST_MIN - 1; i++) {
      const t = t0 + i * 60, open = fxOpen(t);
      for (let j = 0; j < NP; j++) { const v = Lx[PB[j]] - Lx[PQ[j]]; op[j] = hi[j] = lo[j] = cl[j] = v; }
      const sub = i >= HIST_MIN - 1441 ? 6 : 2;
      for (let s = 0; s < sub; s++) {
        fxStep(Lx, 60 / sub, t + s * 60 / sub, true);
        if (open) for (let j = 0; j < NP; j++) { const v = Lx[PB[j]] - Lx[PQ[j]]; if (v > hi[j]) hi[j] = v; if (v < lo[j]) lo[j] = v; cl[j] = v; }
      }
      if (open) for (let j = 0; j < NP; j++) ARR[j].push({ time: t, open: Math.exp(op[j]), high: Math.exp(hi[j]), low: Math.exp(lo[j]), close: Math.exp(cl[j]) });
      zPush(zAccE, zAccJ, Lx.EUR); zAccE = 0; zAccJ = 0; zMin++;
    }
    delete Lx.USD;
    // anchor: shift every currency so the level FX quotes at `now` is the starting level
    const nowOpen = fxOpen(curMin), ref = nowOpen ? Lx : Lfz, dL = {};
    for (const c of CCY_ALL) dL[c] = seedL[c] - ref[c];
    for (let j = 0; j < NP; j++) { const k = Math.exp(lv(dL, PB[j]) - lv(dL, PQ[j])); for (const c of ARR[j]) { c.open *= k; c.high *= k; c.low *= k; c.close *= k; } }
    for (let i = 0; i < zLen; i++) ZL[i] += dL.EUR;
    zL0 += dL.EUR;
    for (const c of CCY_ALL) { Lx[c] += dL[c]; Lfz[c] += dL[c]; }
    L = Lx;
    if (fxOpen(now)) for (let j = 0; j < NP; j++) { const v = Math.exp(lv(Lx, PB[j]) - lv(Lx, PQ[j])); ARR[j].push({ time: curMin, open: v, high: v, low: v, close: v }); }
    fxWas = fxOpen(now);
    simTime = now;
  }
  // the non-FX states at the anchor (the minute of now): the level given is the price at now
  function anchorNx(xv) {
    const aM = Math.floor(simTime / 60), s0 = Math.floor(simTime - aM * 60);
    hotReq = new Set(); touched.clear(); hotList = []; hotS = new Set();
    EPB = aM - HIST_MIN; EPN = HIST_MIN + 2 * 1440; EPS = new Float64Array(EPN * (NF + 1)); epsM = NaN; fjM = NaN;
    rmReset(EPB);
    for (const s of NX) delete bars[s.sym];
    for (const s of NXS) {
      const p = P[s], r = clampR(RG_SD * nrm(p.id, aM, 4));
      const st = { M: aM, X: xv[s], r, md: null, bars: null, sh: [] };
      if (s0 && openMin(p, aM)) st.X -= partial(p, mdOf(p, st), s0, 0, 0, false);
      st.aM = aM; st.aX = st.X; st.aR = r;
      p.st = st;
    }
  }
  // replay documents: everything but the 16 G8 pairs sits still at its starting level, one bar each
  function flatRest(t) {
    const mn = Math.floor(t / 60) * 60;
    for (const m of INSTR) {
      if (PAIR_SET.has(m.sym)) continue;
      const v = m.kind === 'fx' ? fxPx(m, L) : Math.exp(P[m.sym].lnRef);
      bars[m.sym] = [{ time: mn, open: v, high: v, low: v, close: v }];
    }
    for (const s of NXS) P[s].st = { M: Math.floor(t / 60), X: P[s].lnRef, r: 0, md: null, bars: null, sh: null };
  }

  /* ---------- replay feeds ---------- */
  let child = false;
  try {
    const q = typeof location === 'object' ? new URLSearchParams(location.search) : null, id = q && q.get('rid');
    child = !!(q && q.get('replay') && /^[0-9a-f]{32}$/.test(id || '') && window.parent !== window && window.parent.location.origin === location.origin && window.parent.__mfxRpRid === id);
  } catch (e) { child = false; }
  let cfgDone = null;
  const cfgP = child ? new Promise(r => cfgDone = r) : null;
  { const m = !child && typeof location === 'object' && !/[?&]replay=/.test(location.search) && /[?&]seed=(\d{1,10})(&|$)/.exec(location.search); if (m) setSeed(+m[1]); }
  // the anchor rates of this market (units per USD, CCY order): the snapshot's, for a replay started "from now"
  const refRates = CCY.map(c => Math.exp(-REF_L[c]));
  const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
  const T_MIN = 946684800, T_MAX = 4102444800;
  function checkBarSet(bs) {
    if (!bs || typeof bs !== 'object' || bs.format !== 'mfx-bars' || bs.v !== 1 || bs.step !== 60) return 'Bar data: not an mfx-bars v1 set of 1-minute bars';
    if (!isInt(bs.t0, T_MIN, T_MAX) || bs.t0 % 60) return 'Bar data: the first bar is not on a whole minute';
    if (!isInt(bs.n, 1, 30240)) return 'Bar data: between 1 minute and 21 days of bars';
    if (!bs.pairs || typeof bs.pairs !== 'object' || !PAIRS.every(p => bs.pairs[p.sym])) return 'Bar data must contain all 16 pairs';
    const at = i => new Date((bs.t0 + 60 * i) * 1000).toISOString().slice(0, 16).replace('T', ' ');
    for (const p of PAIRS) {
      const c = bs.pairs[p.sym];
      if (!['o', 'h', 'l', 'c'].every(k => c[k] instanceof Float64Array && c[k].length === bs.n)) return `Bar data: ${p.sym} columns must be ${bs.n} numbers each`;
      for (let i = 0; i < bs.n; i++) {
        const o = c.o[i], h = c.h[i], l = c.l[i], cl = c.c[i], gap = [o, h, l, cl].map(Number.isNaN);
        if (gap.every(Boolean)) continue;
        if (gap.some(Boolean) || ![o, h, l, cl].every(v => Number.isFinite(v) && v > 0)) return `Bar data: ${p.sym} has an invalid price at ${at(i)}`;
        if (h < Math.max(o, cl)) return `Bar data: ${p.sym} high below open or close at ${at(i)}`;
        if (l > Math.min(o, cl)) return `Bar data: ${p.sym} low above open or close at ${at(i)}`;
      }
    }
    return '';
  }
  const barIdx = t => (Math.floor(t / 60) * 60 - bset.t0) / 60;
  function barGap(sym, minute) { const i = barIdx(minute); return i < 0 || i >= bset.n || Number.isNaN(bset.pairs[sym].o[i]); }
  function barsAt(t) {
    const m = Math.floor(t / 60) * 60, s = t - m, i = barIdx(m);
    if (i < 0 || i >= bset.n) return;
    for (const p of PAIRS) {
      const c = bset.pairs[p.sym], o = c.o[i];
      if (Number.isNaN(o)) continue;
      const h = c.h[i], l = c.l[i], cl = c.c[i], up = cl >= o, a = up ? l : h, b = up ? h : l;
      const pts = [[0, o], [15, a], [40, b], [59, cl]];
      let v = cl;
      for (let k = 0; k < 3; k++) {
        const [s0, v0] = pts[k], [s1, v1] = pts[k + 1];
        if (s === s0) { v = v0; break; }
        if (s < s1) { const x = v0 + (v1 - v0) * (s - s0) / (s1 - s0); v = Math.min(Math.max(x, Math.min(v0, v1)), Math.max(v0, v1)); break; }
      }
      cur[p.sym] = v;
    }
  }
  function checkSpec(c) {
    if (!c || typeof c !== 'object') return 'Replay: no settings';
    if (!isInt(c.start, T_MIN, T_MAX) || c.start % 60) return 'Replay: start must be a whole minute';
    if (c.mode === 'sim') {
      if (!isInt(c.seed, 0, 4294967295)) return 'Replay: seed must be a whole number from 0 to 4294967295';
      if (!Array.isArray(c.rates) || c.rates.length !== CCY.length || !c.rates.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 1e-4 && v <= 1e5)) return 'Replay: seven rates are needed';
      if (!isInt(c.end, c.start + 1, c.start + RP_MAX_SPAN)) return 'Replay: end must fall within 3 days of the start';
    } else if (c.mode === 'bars') {
      const e = checkBarSet(c.barset); if (e) return e;
      const last = c.barset.t0 + 60 * c.barset.n - 1;
      if (c.start < c.barset.t0 || c.start > last - 60) return 'Replay: start outside the recorded bars';
      if (!isInt(c.end, c.start + 1, last)) return 'Replay: end outside the recorded bars';
    } else return 'Replay: unknown source';
    return '';
  }
  let cfgSet = false;
  function configure(c) {
    if (!child) throw new Error('Engine.configure works only in a replay document');
    if (cfgSet) throw new Error('Engine.configure was already called');
    if (c && c.mode === 'resume') {
      const pk = c.pack, e = pk && pk.eng;
      const err = !pk || !e || e.v !== 1 || e.ev !== VERSION || !pk.spec ? 'Replay: the checkpoint is not from this engine'
        : checkSpec({ ...pk.spec, mode: e.mode, barset: c.barset }) || (!isInt(e.simTime, pk.spec.start, pk.spec.end) ? 'Replay: checkpoint outside the replay' : '')
        || (!pk.candles || !PAIRS.every(p => Array.isArray(pk.candles[p.sym]) && pk.candles[p.sym].length === e.lens[p.sym]) ? 'Replay: checkpoint bars missing' : '');
      if (err) throw new Error(err);
    } else { const err = checkSpec(c); if (err) throw new Error(err); }
    cfgSet = true; cfgDone(c);
  }
  function setReplay(c) {
    rp = { kind: c.mode, start: c.start, end: c.end, seed: c.mode === 'sim' ? c.seed : null, rates: c.mode === 'sim' ? c.rates.slice() : null, rateDate: c.rateDate || '' };
  }
  const ratesL = rates => { const o = { ...REF_L }; CCY.forEach((k, i) => o[k] = Math.log(1 / rates[i])); return o; };
  function initReplay(c) {
    PS = 0x2545F491;
    if (c.mode === 'resume') {
      const pk = c.pack, e = pk.eng;
      setReplay({ ...pk.spec, mode: e.mode });
      if (e.mode === 'bars') { bset = c.barset; cur = {}; } else setSeed(e.seed);
      L = { ...REF_L, ...e.L }; Lfz = { ...L };
      zAlloc(Math.floor(pk.spec.start / 60), 1024); zMin = Math.floor(e.simTime / 60);
      PAIRS.forEach(p => { bars[p.sym] = pk.candles[p.sym]; });
      simTime = pk.spec.start;
      flatRest(pk.spec.start);
      rpRestore(e);
    } else if (c.mode === 'sim') {
      setReplay(c);
      setSeed(c.seed);
      build(ratesL(c.rates), c.start);
      flatRest(c.start);
    } else {
      setReplay(c);
      bset = c.barset; cur = {};
      const i0 = barIdx(c.start);
      for (const p of PAIRS) {
        const col = bset.pairs[p.sym], arr = bars[p.sym] = [];
        for (let i = 0; i < i0; i++) if (!Number.isNaN(col.o[i])) arr.push({ time: bset.t0 + 60 * i, open: col.o[i], high: col.h[i], low: col.l[i], close: col.c[i] });
        cur[p.sym] = !Number.isNaN(col.o[i0]) ? col.o[i0] : arr.length ? arr[arr.length - 1].close : col.o.find(v => !Number.isNaN(v));
        if (!Number.isNaN(col.o[i0])) arr.push({ time: c.start, open: cur[p.sym], high: cur[p.sym], low: cur[p.sym], close: cur[p.sym] });
      }
      regime = 0; simTime = c.start;
      L = { ...REF_L }; CCY.forEach(k => { L[k] = Math.log(usd(k)); }); Lfz = { ...L };
      zAlloc(Math.floor(c.start / 60), 1024); zMin = Math.floor(c.start / 60);
      flatRest(c.start);
    }
    mode = rp.kind;
    source = mode === 'sim' ? 'replay' : 'replay-bars';
    rateDate = rp.rateDate || rateDate;
    ready = true;
  }
  function rpSnap() {
    const lens = {}, last = {};
    for (const p of PAIRS) { const a = bars[p.sym]; lens[p.sym] = a.length; last[p.sym] = a.length ? { ...a[a.length - 1] } : null; }
    return { v: 1, ev: VERSION, mode, simTime, L: { ...L }, regime, gSpare, gSpare3, s1: s1.s, s3: s3.s, fxWas, seed, streams: { ...streams }, cur: cur ? { ...cur } : null, news: JSON.parse(JSON.stringify(newsMult)), lens, last };
  }
  function rpRestore(e) {
    simTime = e.simTime; L = { ...REF_L, ...e.L }; regime = e.regime; gSpare = e.gSpare; gSpare3 = e.gSpare3 ?? null; s1.s = e.s1 | 0; s3.s = e.s3 | 0; fxWas = e.fxWas !== false;
    if (!fxWas) Lfz = { ...L };
    for (const k in streams) delete streams[k];
    Object.assign(streams, e.streams);
    if (cur && e.cur) Object.assign(cur, e.cur);
    for (const k in newsMult) delete newsMult[k];
    Object.assign(newsMult, e.news || {});
    for (const p of PAIRS) {
      const a = bars[p.sym]; a.length = Math.min(a.length, e.lens[p.sym]);
      if (a.length && e.last[p.sym]) Object.assign(a[a.length - 1], e.last[p.sym]);
    }
    acc = 0; endSent = simTime >= rp.end;
  }

  /* ---------- the clock ---------- */
  /* live market: sub-steps of at most 5 s that never cross a minute boundary (each minute opens on a sample at its
     first second); each one emits 'q' (as a replay step does), so orders, stops and alerts see every price the
     candles record, whatever the speed. The listeners only read: the price path is unchanged. */
  function advance(dtSec) {
    if (!(dtSec > 0)) { updateCandles(); return; }
    const end = simTime + dtSec;
    while (simTime < end - 1e-9) {
      const nb = (Math.floor(simTime / 60) + 1) * 60, hitB = nb <= end + 1e-9, segEnd = hitB ? nb : end;
      const n = Math.max(1, Math.ceil((segEnd - simTime) / 5 - 1e-9)), t0 = simTime, h = (segEnd - t0) / n;
      for (let i = 1; i <= n; i++) {
        fxStep(L, h, simTime, true);
        simTime = i === n ? segEnd : t0 + i * h;
        zRoll(simTime);
        updateCandles();
        emit('q');
      }
    }
  }
  function updateCandles() {
    const minute = Math.floor(simTime / 60) * 60;
    let newBar = false;
    const live = mode === 'live';
    if (cur || fxOpen(simTime)) for (const m of live ? FX : PAIRS) {
      if (fed(m.sym)) continue;
      const arr = bars[m.sym], last = arr[arr.length - 1], v = fxPx(m, L);
      if (!last) { if (!cur || !barGap(m.sym, minute)) { arr.push({ time: minute, open: v, high: v, low: v, close: v }); newBar = true; } continue; }
      if (minute > last.time) {
        if (cur) { if (barGap(m.sym, minute)) continue; arr.push({ time: minute, open: v, high: v, low: v, close: v }); newBar = true; continue; }
        const o = simTime === minute || minute - last.time > 60 ? v : last.close;
        arr.push({ time: minute, open: o, high: Math.max(v, o), low: Math.min(v, o), close: v });
        trim(arr);
        newBar = true;
      } else { if (v > last.high) last.high = v; if (v < last.low) last.low = v; last.close = v; }
    }
    if (live) for (const s of hotList) {
      if (fed(s)) continue;
      const p = P[s];
      if (p.derived) { const b = P[p.derived]; if (!b.st.bars) continue; }
      else { if (!p.st.bars) continue; if (p.st.M < minute / 60) catchUp(p, simTime); }
      const ps = p.derived ? P[p.derived] : p;
      if (!openMin(ps, minute / 60)) continue;
      const arr = bars[s]; if (!arr) continue;
      const last = arr[arr.length - 1], v = Math.exp(nxLog(s));
      if (!last || last.time < minute) {
        const o = p.derived || simTime !== minute ? v : Math.exp(p.st.X);
        arr.push({ time: minute, open: o, high: Math.max(o, v), low: Math.min(o, v), close: v }); trim(arr); newBar = true;
      } else if (last.time === minute) { if (v > last.high) last.high = v; if (v < last.low) last.low = v; last.close = v; }
    }
    if (newBar) listeners.bar.forEach(f => f());
  }
  function tick(realMs) {
    if (hold) return;
    tickNo++;
    if (tickNo % 8 === 0 || touched.size !== hotS.size) refreshHot(); else for (const k of touched.keys()) if (!hotS.has(k)) { refreshHot(); break; }
    if (realTime) { // real prices: the clock is the wall clock (no compression, no catching up minute by minute)
      simTime = Math.max(simTime, Date.now() / 1000);
      updateCandles(); emit('q');
      return;
    }
    if (mode === 'live') {
      for (const s of hotList) if (!P[s].derived && P[s].st && !P[s].st.bars) ensureBars(s); else if (P[s].derived && !bars[s]) ensureBars(s);
      return advance(realMs / 1000 * speed);
    }
    if (!(rpSpeed > 0)) return;
    acc += realMs / 1000 * rpSpeed;
    const n = Math.floor(acc / RP_Q); acc -= n * RP_Q;
    if (n) stepFixed(n);
  }
  function stepFixed(n) {
    if (mode === 'live' || !rp) return 0;
    let i = 0;
    for (; i < n; i++) {
      if (simTime >= rp.end) break;
      if (mode === 'sim') fxStep(L, RP_Q, simTime, false); else barsAt(simTime + RP_Q);
      simTime += RP_Q;
      updateCandles();
      if ((simTime - rp.start) % RP_CHUNK === 0) emit('chunk');
      emit('q');
    }
    if (simTime >= rp.end && !endSent) { endSent = true; acc = 0; emit('end'); }
    return i;
  }

  // a shock to one currency (the calendar, tests): its log USD value moves by logSize ('USD': all the others)
  function jump(ccy, logSize) {
    if (cur || !Number.isFinite(logSize)) return;
    if (ccy === 'USD') CCY_ALL.forEach(c => { L[c] -= logSize; Lfz[c] -= logSize; });
    else if (ccy in L) { L[ccy] += logSize; Lfz[ccy] += logSize; }
    updateCandles();
  }
  // a shock to one non-FX instrument (tests, the tab sync): its log price moves by logSize
  function jumpX(sym, logSize) {
    const p = P[sym];
    if (mode !== 'live' || !p || p.derived || !p.st || !Number.isFinite(logSize)) return;
    stateAt(sym);
    const st = p.st;
    st.X += logSize;
    if (st.sh) st.sh.push([st.M, logSize]);
    if (st.bars) { const a = st.bars, last = a[a.length - 1], v = Math.exp(xAt(p, st, simTime)); if (last && last.time === st.M * 60) { if (v > last.high) last.high = v; if (v < last.low) last.low = v; last.close = v; } }
    updateCandles();
  }

  /* New York time (the FX day ends at 17:00 New York): nyOffset returns −4 (EDT) or −5 (EST) hours. */
  const dstCache = {};
  function dstRange(y) {
    if (dstCache[y]) return dstCache[y];
    const sun = (m, n) => { const d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + (7 - d) % 7 + 7 * (n - 1)) / 1000; };
    return dstCache[y] = [sun(2, 2) + 7 * 3600, sun(10, 1) + 6 * 3600];
  }
  function nyOffset(t) { const r = dstRange(new Date(t * 1000).getUTCFullYear()); return t >= r[0] && t < r[1] ? -4 : -5; }
  // news: the calendar puts an instrument on its News spread while a release on one of its currencies is active
  const newsMult = {};
  function setNewsMult(ccy, mult, until) { if (ALL_SET.has(ccy) && Number.isFinite(mult) && mult >= 1 && Number.isFinite(until)) newsMult[ccy] = { mult, until }; }
  const newsOn = c => { const n = newsMult[c]; return !!n && n.mult > 1 && simTime < n.until; };
  // Night = 23:00–01:00 server time on a weekday (Monday to Friday, by the server's calendar day)
  function isNight(t) {
    const loc = t + serverOffset(t) * 3600, dow = ((Math.floor(loc / 86400) + 4) % 7 + 7) % 7, mn = Math.floor((((loc % 86400) + 86400) % 86400) / 60);
    return dow >= 1 && dow <= 5 && (mn >= 1380 || mn < 60);
  }
  /* quote(sym) → { bid, ask, mid, spread (displayed unit: pips for FX, points otherwise), sp: 'default'|'night'|'news',
     open, why, t }. The spread comes from the sheet in points; crypto adds a variation U(lo, hi) points drawn per second.
     PIVOT ON BID: mid keeps its v14 meaning, the simulated price the candles record, which is now the bid (alias);
     the midpoint of the quote is (bid + ask) / 2. */
  function quote(sym) {
    const m = META[sym];
    if (!m) return undefined;
    touch(sym);
    const bid = bidOf(sym), nc = m.newsCcy;
    let sp = 'default', k = 0;
    for (let i = 0; i < nc.length; i++) if (newsOn(nc[i])) { sp = 'news'; k = 2; break; }
    if (!k && isNight(simTime)) { sp = 'night'; k = 1; }
    let pts = m.p.spread[k];
    if (m.p.jit) { const [lo, hi] = m.p.jit[k]; pts = Math.max(0, pts + lo + (hi - lo) * u01(ID[sym], Math.floor(simTime), 1002)); }
    let open = mode === 'live' ? openAt(SX[sym], simTime) : PAIR_SET.has(sym) && (cur ? !barGap(sym, Math.floor(simTime / 60) * 60) : fxOpen(simTime));
    let why = open ? '' : 'closed';
    let f = null;
    if (fed(sym)) {
      f = fq[sym];
      if (feedDown()) { open = false; why = 'no feed'; }
      // the sheet's off-quotes time where it sets one (the platform's own rule); otherwise 2 minutes on real prices
      // (no trading on a price the platform stopped updating), 10 s on a test feed
      else if (open) { const lim = m.offQ || (realTime ? 120 : 10); if (!f || Date.now() / 1000 - f.t > lim) { open = false; why = 'off quotes'; } }
    }
    if (f && f.ask >= f.bid) pts = Math.round((f.ask - f.bid) / m.point * 1e6) / 1e6;
    const ask = f && f.ask >= f.bid ? f.ask : bid + pts * m.point;
    return { bid, ask, mid: bid, spread: pts * m.point / m.pip, sp, open, why, t: simTime };
  }
  const isOpen = (sym, t = simTime) => (META[sym] ? openAt(SX[sym], t) : false);

  // value of 1 unit of currency in USD (FX closed: at the levels FX last quoted)
  const USD_LEG = { EUR: ['EURUSD', 1], GBP: ['GBPUSD', 1], AUD: ['AUDUSD', 1], NZD: ['NZDUSD', 1], JPY: ['USDJPY', -1], CHF: ['USDCHF', -1], CAD: ['USDCAD', -1] };
  function usd(c) {
    if (c === 'USD') return 1;
    if (feed) { const v = fedUsd(c); if (v) return v; }
    if (cur && USD_LEG[c]) { const [s, k] = USD_LEG[c]; return k > 0 ? cur[s] : 1 / cur[s]; }
    const F = mode === 'live' ? fxLevels() : L;
    return c in F ? Math.exp(F[c]) : NaN;
  }

  function aggregate(sym, tf, maxBars = 1500) {
    const src = candles[sym], step = tf * 60, out = [];
    if (!src) return out;
    let startIdx = Math.max(0, src.length - maxBars * tf - tf);
    for (let i = startIdx; i < src.length; i++) {
      const c = src[i], b = Math.floor(c.time / step) * step, last = out[out.length - 1];
      if (!last || last.time !== b) out.push({ time: b, open: c.open, high: c.high, low: c.low, close: c.close });
      else { if (c.high > last.high) last.high = c.high; if (c.low < last.low) last.low = c.low; last.close = c.close; }
    }
    if (out.length > maxBars) out.splice(0, out.length - maxBars);
    return out;
  }
  function ccyChange(c, mins) {
    if (c === 'USD') return 0;
    const sym = PAIRS.find(p => (p.base === c && p.quote === 'USD') || (p.base === 'USD' && p.quote === c)).sym;
    const arr = bars[sym], n = arr.length, a = arr[Math.max(0, n - 1 - mins)].close, b = arr[n - 1].close;
    const d = Math.log(b / a);
    return META[sym].base === 'USD' ? -d : d;
  }
  function strength(mins) {
    const ch = Object.fromEntries(ALL.map(c => [c, ccyChange(c, mins)]));
    const mean = ALL.reduce((s, c) => s + ch[c], 0) / ALL.length;
    return ALL.map(c => ({ c, s: (ch[c] - mean) * 10000 })).sort((a, b) => b.s - a.s);
  }
  function returns(sym, mins) {
    const arr = candles[sym], n = arr.length, out = [];
    for (let i = Math.max(1, n - mins); i < n; i++) out.push(Math.log(arr[i].close / arr[i - 1].close));
    return out;
  }
  function corr(a, b) {
    const n = Math.min(a.length, b.length); let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let s = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; va += x * x; vb += y * y; }
    return va && vb ? s / Math.sqrt(va * vb) : 0;
  }

  /* probeX(sym, n, steps, dt): n antithetic pairs of short paths of the canonical minute step over steps × dt seconds
     (whole minutes, at least one, in session) from the instrument's state and clock, drawing from rng('probeX') and
     leaving the market alone. Returns the mean of P_T / P_0 − 1, its standard error, and ito = the ½σ²T the Itô term
     removes. FX (log values with no drift): the mean is of the log change, with log: true. */
  function probeX(sym, n = 2000, steps = 60, dt = 5) {
    const m = META[sym]; if (!m) return null;
    const ur = rng('probeX');
    let sp = null;
    const gn = () => { if (sp !== null) { const v = sp; sp = null; return v; } let a = 0, b = 0; while (!a) a = ur(); while (!b) b = ur(); const r = Math.sqrt(-2 * Math.log(a)), w = 2 * Math.PI * b; sp = r * Math.sin(w); return r * Math.cos(w); };
    const mins = Math.max(1, Math.round(steps * dt / 60)), ys = new Float64Array(n);
    let ito = 0;
    if (m.kind === 'fx') {
      const ib = CCY_ALL.indexOf(m.base), iq = CCY_ALL.indexOf(m.quote);
      for (let q = 0; q < n; q++) {
        let x = 0;
        for (let k = 0; k < mins; k++) {
          const h = Math.floor((((simTime + 60 * k) % 86400) + 86400) % 86400 / 3600), f = Array.from({ length: K }, gn);
          const zc = i => { if (i < 0) return 0; let z = CV[i].idio * gn(); for (let j = 0; j < K; j++) z += CV[i].load[j] * f[j]; return CV[i].vol * CW[i][h] * Math.exp(regime - RG_V) * Math.sqrt(1 / 60) * z; };
          x += zc(ib) - zc(iq);
        }
        ys[q] = x;
      }
      let mu = 0; for (const y of ys) mu += y; mu /= n; let v = 0; for (const y of ys) v += (y - mu) * (y - mu); v /= n - 1;
      return { n, mean: mu, se: Math.sqrt(v / n), ito: 0, log: true };
    }
    const p = P[m.seed.derived ? m.seed.derived.split('/')[0] : sym];
    const st0 = p.st || { r: 0 }, rm0 = rmAt(Math.floor(simTime / 60));
    const comp = sg => { const s2 = sg * sg / 2; let c = 0; for (const [, w, pj] of p.fjs) c += Math.log1p(pj * Math.expm1(s2 * w * w)); if (p.pj) c += Math.log1p(p.pj * Math.expm1(s2 * p.ki * p.ki)); return c; };
    for (let q = 0; q < n; q++) {
      let x0 = 0, x1 = 0, r0 = st0.r, r1 = st0.r, m0 = rm0, m1 = rm0;
      for (let k = 0; k < mins; k++) {
        const h = Math.floor((((simTime / 60 + k) % 1440) + 1440) % 1440 / 60);
        const nr = gn(), nm = gn(); r0 = clampR(r0 * .998 + .03 * nr); r1 = clampR(r1 * .998 - .03 * nr); m0 = clampR(m0 * .998 + .03 * nm); m1 = clampR(m1 * .998 - .03 * nm);
        const ze = gn(), zj = zRho * ze + Math.sqrt(1 - zRho * zRho) * gn();
        let G = p.ids * gn(); for (let j = 0; j < NF; j++) G += p.cs[j] * gn();
        const s0 = p.sd * p.w[h] * Math.exp(.8 * m0 + .6 * r0 - RG_V2) / Math.sqrt(60), s1 = p.sd * p.w[h] * Math.exp(.8 * m1 + .6 * r1 - RG_V2) / Math.sqrt(60);
        let j0 = 0, j1 = 0;
        for (const [, w, pj] of p.fjs) if (ur() < pj) { const z = gn(); j0 += s0 * w * z; j1 -= s1 * w * z; }
        if (p.pj && ur() < p.pj) { const z = gn(); j0 += s0 * p.ki * z; j1 -= s1 * p.ki * z; }
        const zz = p.a0 * ze + p.a1 * zj + G;
        x0 += s0 * zz - .5 * s0 * s0 * p.vc - comp(s0) + j0;
        x1 += -s1 * zz - .5 * s1 * s1 * p.vc - comp(s1) + j1;
        ito += (.5 * s0 * s0 + .5 * s1 * s1) / 2;
      }
      ys[q] = (Math.exp(x0) + Math.exp(x1)) / 2 - 1;
    }
    let mu = 0; for (const y of ys) mu += y; mu /= n;
    let v = 0; for (const y of ys) v += (y - mu) * (y - mu); v /= n - 1;
    return { n, mean: mu, se: Math.sqrt(v / n), ito: ito / n };
  }

  /* Engine.candles: a Proxy, so consumers keep reading Engine.candles[sym]; a non-FX instrument's history is built on
     first access and it joins the hot set while it keeps being read. */
  const candles = new Proxy(bars, {
    get(o, k) { if (typeof k !== 'string') return o[k]; if (feed && feed.want && META[k]) feed.want(k); if (P[k]) { touch(k); return ensureBars(k); } return o[k]; },
    has(o, k) { return k in META || k in o; },
    ownKeys(o) { return [...new Set([...INSTR.map(m => m.sym), ...Reflect.ownKeys(o)])]; },
    getOwnPropertyDescriptor(o, k) { if (k in META || k in o) return { value: this.get(o, k), writable: true, enumerable: true, configurable: true }; return undefined; },
    set(o, k, v) { o[k] = v; return true; }
  });
  // before init: FX empty, non-FX one flat bar at the starting level (nothing reads them before init resolves)
  for (const m of INSTR) bars[m.sym] = [];

  return {
    CCY, ALL, CCY_ALL, PAIRS, FX, CFDS: NX, INSTR, META, LEGACY_META, SNAP_LABEL, CFD_REF_LABEL: SNAP_LABEL,
    init, jumpX, probeX, tick, quote, usd, mid, bid: mid, aggregate, strength, returns, corr, jump, setSeed,
    snapshot, setNewsMult, nyOffset, serverOffset, isOpen, session, hot, setFeed, feedHistory, get feedOn() { return !!feed; }, get realTime() { return realTime; }, get feedDown() { return feedDown(); },
    candles, on: (e, f) => listeners[e].push(f),
    get simTime() { return simTime; }, get speed() { return speed; }, set speed(v) { speed = feed ? (v > 0 ? 1 : 0) : v; },
    get source() { return source; }, get rateDate() { return rateDate; }, get regime() { return regime; }, get seed() { return seed; },
    get hotSet() { return hotList.slice(); }, get feed() { return !!feed; },
    // replay
    VERSION, RP_Q, RP_CHUNK, RP_CP, RP_MAX_SPAN, RP_SPEEDS, configure, stepFixed, rpSnap, rng, checkBarSet,
    get mode() { return mode; }, get isReplayDoc() { return child; }, get refRates() { return refRates.slice(); },
    get replay() { return rp ? { ...rp, rates: rp.rates && rp.rates.slice() } : null; }, get atEnd() { return !!rp && simTime >= rp.end; },
    get replaySpeed() { return rpSpeed; }, set replaySpeed(v) { rpSpeed = Number.isFinite(v) && v >= 0 ? v : 0; if (!rpSpeed) acc = 0; },
    get hold() { return hold; }, set hold(v) { hold = !!v; }
  };
})();
