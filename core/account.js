/* tradeBerry — account core, shared by the browser (trade.js) and the server (core/account.mjs). One file, one set of
   rules for the money of an account: P/L, margin, leverage (sheet and jurisdiction cap), volumes, the execution model,
   commission, swap and rollover, the order model (stops, targets, break-even, trailing, pending entries, OCO, expiry),
   netting, the stop-out under 50% and the negative balance protection. No DOM, no toast, no globals but AccountCore.
   AccountCore.create({ market, rng, now, live, speed, vol, replayOff, opens }) → core:
   - market: MarketCore (core/market.js) or the same shape over Engine: META, quote(sym), usd(ccy), nyOffset(t),
     serverOffset(t); mid(sym) optional (else quote(sym).mid);
   - rng() → [0, 1) for the fill noise (AccountCore.seeded(n) for a reproducible one); now() → unix seconds;
   - live() → the fill noise is on (the browser: a running live market, not a replay); speed() → the latency scale;
     vol(sym) → the instrument's volatility in pips per √second (0: none known); replayOff(sym) → not in this replay;
     opens(sym) → 'opens …' for the "Market closed" text ('' by default).
   Every operation takes the account acct = { balance, peak, positions, orders, set, nextId, nextFill } and changes it in
   place; what happened comes back in the result: { ok: true, …, events[] } or { ok: false, code, title, why, text }
   (REJECT[code]: why = the reason as the UI shows it, text = the order-log wording). Events: { type: 'fill' (fill:
   the receipt, trade: the history row of a close), 'filled' | 'reject' | 'cancel' | 'expire' (order: the order-log
   row), 'trigger', 'oco', 'stopout', 'nbp' (trade: the row), 'swap' }. Hooks h (all optional) let the browser keep its
   wrapper chain: h.gate(req) → true holds the order (duplicate confirmation; a reversal's remainder comes with dupOk); h.close(acct, id, frac, reason, ctx) and
   h.open(acct, req) replace the inner close / open (their events are then theirs to apply); h.protect(p, q, byTp)
   runs the trailing and break-even of a position (onTick never applies them: trailNext and beLevel are pure);
   h.emit(event) sees each event of onTick when it happens. Times are unix seconds. */
const AccountCore = (() => {
  const TP_MAX = 4, MAX_WORKING = 200, MAX_NOTIONAL_X = 25, MONEY_MAX = 1e12;
  const EXEC_DEF = Object.freeze({ slip: 'sym', slipSd: .2, latMs: 120, comm: 0 }); // comm: USD per lot round turn (set.comm)

  /* ---------- leverage: min(sheet [or the user's choice, up to the sheet maximum], jurisdiction cap) ----------
     set.lev: null = the sheet default (p.lev[0]); a number = the user's choice, capped at the sheet maximum (p.lev[1]).
     set.jur: an optional retail cap per margin class. ESMA Annex I (EU, and the UK and AU rules modelled on it) 30:1
     pairs of USD, EUR, JPY, GBP, CAD, CHF, 20:1 other pairs, gold and major indices (Annex I list), 10:1 other
     commodities and minor indices, 5:1 equities (the bond futures BUND/SCHATZ are margined as equity here, declared),
     2:1 crypto; UK retail offers no crypto derivatives (FCA PS20/10); US NFA 50:1 when both currencies are on its
     major list, 20:1 otherwise, and no CFDs for retail. A class with cap null is not offered under that jurisdiction:
     such an instrument cannot be opened, and a position already open on it is close-only, margined at the ESMA cap. */
  const NFA_MAJORS = new Set(['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK']);
  const ESMA_CAP = { 'fx-major': 30, 'fx-minor': 20, gold: 20, 'index-major': 20, 'index-minor': 10, commodity: 10, equity: 5, crypto: 2 };
  const NO_CFD = { gold: null, 'index-major': null, 'index-minor': null, commodity: null, equity: null, crypto: null };
  const JUR = {
    none: { name: 'No jurisdiction cap', opt: 'None', cap: {}, choice: true, none: true },
    eu: { name: 'EU retail', opt: 'EU · ESMA', cap: { ...ESMA_CAP } },
    uk: { name: 'UK retail', opt: 'UK · FCA', cap: { ...ESMA_CAP, crypto: null }, why: { crypto: 'FCA ban on crypto derivatives for retail' } },
    au: { name: 'AU retail', opt: 'AU · ASIC', cap: { ...ESMA_CAP }, note: 'AU retail uses the ESMA index list.' },
    us: { name: 'US retail', opt: 'US · NFA', cap: { 'fx-major': 50, 'fx-minor': 20, ...NO_CFD }, majors: NFA_MAJORS, majorsName: 'NFA major currencies', why: { cfd: 'US retail: no CFDs' } }
  };
  // states saved before v15 may still say 'pro' or 'sim': both read as no cap with the leverage kept as the choice
  // (hidden from Object.keys, so no list offers them)
  for (const k of ['pro', 'sim']) Object.defineProperty(JUR, k, { value: JUR.none, enumerable: false });
  const jurOf = set => JUR[set && set.jur] || JUR.none;

  /* ---------- refusals: one code per text of trade.js (and of the level editor, ui.js, for modify) ----------
     tpl: the reason with {placeholders}; title: the toast title. text (the order-log wording) = 'title (why)' in lower
     case, except the market refusals (the reason itself) and the requote. */
  const R = (title, tpl, extra) => Object.freeze({ title, tpl, ...extra });
  const REJECT = Object.freeze({
    UNKNOWN_SYM: R('Order rejected', 'Unknown instrument'),
    CLOSED: R('Market closed', 'Market closed{opens}', { market: true }),
    OFF_QUOTES: R('Off quotes', 'Off quotes — no fresh price from the feed', { market: true }),
    NO_FEED: R('No live prices', 'No live prices — the broker platform is not answering', { market: true }),
    VOL_MIN: R('Order rejected', 'Minimum size is {min}'),
    VOL_MAX: R('Order blocked', 'Maximum size is {max} per order'),
    NOTIONAL: R('Order blocked', 'Notional {notional} is above the per-order cap of {x}× equity ({cap})'),
    REPLAY_OFF: R('Order rejected', '{short} is not offered in a replay (replays cover the 16 G8 FX pairs)'),
    CLOSE_ONLY: R('Order rejected', '{short} is close only — new positions and orders are not accepted'),
    NOT_OFFERED: R('Order rejected', '{short} is not offered under {jur}'),
    MARGIN: R('Insufficient margin', 'Needs {req} · free {free}'),
    NOT_FILLED: R('Order rejected', 'not filled'),
    REQUOTE: R('Requote', '{short}: the price moved {n} pts from the quote (maximum deviation {maxDev} pts) — not filled. Send again at the new price.'),
    SL_SPREAD: R('Order rejected', 'Stop inside the spread ({spread} {unit}) — widen it'),
    SL_SIDE: R('Order rejected', 'Stop loss is on the wrong side of price'),
    TRAIL_SPREAD: R('Order rejected', 'Trailing stop must be wider than the spread ({spread} {unit})'),
    TP_SIDE: R('Order rejected', 'Take profit is on the wrong side of price'),
    TPS_MAX: R('Order rejected', 'At most {max} targets'),
    TPS_ROWS: R('Order rejected', 'Each target needs pips above 0 and a share between 0 and 100%'),
    TPS_SUM: R('Order rejected', 'Targets add up to {pct}% — max 100%'),
    TPS_MIN: R('Order rejected', 'TP{i} is below the {min}-{unit} minimum'),
    TPS_SAME: R('Order rejected', 'Two targets at the same price'),
    TPS_OVER: R('Order rejected', 'Targets cover more than the position'),
    BE_SPREAD: R('Order rejected', 'Break-even trigger must exceed the spread ({spread} {unit})'),
    PRICE_INVALID: R('Order rejected', 'Enter a valid price'),
    PRICE_SIDE: R('Order rejected', '{side} {ot} must be {dir} market'),
    MIN_DIST: R('Order rejected', 'Too close to the market: at least {pts} points ({dist}) from the {ref}'),
    MAX_WORKING: R('Order rejected', 'Too many working orders ({max})'),
    LIMIT_STOP_ONLY: R('Order rejected', 'Only a stop order can carry a limit price'),
    LIMIT_INVALID: R('Order rejected', 'Enter a valid limit price'),
    LIMIT_SIDE: R('Order rejected', '{Side} stop-limit: the limit must be at or {dir} the stop price'),
    EXPIRY: R('Order rejected', 'Expiry must be at least one minute ahead'),
    OCO_NOT_FOUND: R('Order rejected', 'OCO group not found'),
    DUPLICATE: R('Duplicate order', 'duplicate order awaiting confirmation'),
    // the level editor (ui.js validateLevel), for modify
    MOD_SL_SIDE: R('Not applied', 'Stop loss must be {dir} the {ref}'),
    MOD_TP_SIDE: R('Not applied', 'Take profit must be {dir} the {ref}'),
    MOD_PRICE_SIDE: R('Not applied', '{Side} {ot} must be {dir} market'),
    NO_POS: R('Not found', 'Position not found'),
    NO_ORDER: R('Not found', 'Order not found')
  });
  const render = (tpl, a = {}) => tpl.replace(/\{(\w+)\}/g, (_, k) => (a[k] == null ? '' : String(a[k])));

  // the fill noise of a test or a replay: a seeded generator (the sequence of trade.js execSeed)
  function seeded(n) {
    let s = n >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // one trailing rule for live stops and the Exit lab: the stop follows px (the best price so far) at dist, never loosened
  const trailNext = (d, stop, px, dist) => stop == null ? px - d * dist : d > 0 ? Math.max(stop, px - dist) : Math.min(stop, px + dist);
  /* break-even: the stop level once the rule is armed (after `at` pips in profit, or after a target filled: be.tpHit),
     null otherwise. d = ±1 (buy / sell), px = the price the position closes at (bid for a buy). The caller moves the
     stop only when it tightens and sits beyond the quote, then marks be.done. */
  const beLevel = (be, d, entry, px, pip) => !be || be.done || (!be.tpHit && !(be.at != null && d * (px - entry) / pip >= be.at)) ? null : entry + d * (+be.off || 0) * pip;

  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const usdFmt = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + '$' + nf2.format(Math.abs(v));
  const dts = t => { const d = new Date(t * 1000).toISOString(); return d.slice(5, 10) + ' ' + d.slice(11, 16); };
  const finite = v => typeof v === 'number' && isFinite(v);
  const r2 = v => Math.round(v * 100) / 100;

  // gapStops (the broker): a pending order filled through a gap whose stop loss is already past keeps it, and the stop
  // closes the new position at once in the same tick ('Stop loss', gap marked), instead of the fill being refused
  function create({ market, rng = Math.random, now = () => Date.now() / 1000, live = () => true, speed = () => 1, vol = () => 0, replayOff = () => false, opens = () => '', gapStops = false } = {}) {
    if (!market || typeof market.quote !== 'function') throw new Error('AccountCore.create: needs the market (core/market.js)');
    const M = s => market.META[s];
    const Q = s => market.quote(s);
    const usd = c => market.usd(c);
    const mid = s => market.mid ? market.mid(s) : Q(s).mid;
    const fp = (sym, v) => v == null || !isFinite(v) ? '—' : v.toFixed(M(sym) ? M(sym).digits : 5);
    const unitWord = (sym, one = false) => M(sym) && M(sym).unit === 'pt' ? 'pt' : one ? 'pip' : 'pips';
    const rej = (code, a, extra) => {
      const r = REJECT[code], why = render(r.tpl, a);
      const text = r.market ? why[0].toLowerCase() + why.slice(1) : code === 'REQUOTE' ? `requote — price moved ${a.n} pts` : code === 'DUPLICATE' ? why : `${r.title.toLowerCase()} (${why})`;
      return { ok: false, code, title: r.market ? why.split(' — ')[0] : r.title, why, text, ...extra };
    };
    const held = () => ({ ...rej('DUPLICATE'), held: true });

    /* ---------- account math ----------
       Money on any instrument goes through its contract size and is paid in its quote currency. pip is the displayed
       unit: a pip on FX, the platform's point otherwise. */
    const pipValue = (sym, lots = 1) => lots * M(sym).size * M(sym).pip * usd(M(sym).quote);
    function posPnl(p) {
      const q = Q(p.sym), m = M(p.sym), d = p.side === 'buy' ? 1 : -1;
      const exit = d > 0 ? q.bid : q.ask;
      return { exit, pips: (exit - p.entry) * d / m.pip, pnl: (exit - p.entry) * d * p.lots * m.size * usd(m.quote) + (p.swap || 0) };
    }
    // USD notional: FX = lots × size units of the base currency in USD; otherwise lots × size × bid in the quote currency
    const notionalUsd = (sym, lots) => { const m = M(sym); return m.kind === 'cfd' ? lots * m.size * mid(sym) * usd(m.quote) : lots * m.size * usd(m.base); };

    /* ---------- volumes (sheet vol: [min, max, step]) ---------- */
    const volOf = sym => M(sym).p.vol;
    const lotDec = sym => { const s = volOf(sym)[2]; return s >= 1 ? 0 : Math.min(8, Math.max(0, Math.ceil(-Math.log10(s) - 1e-9))); };
    // a size rounded to the sheet's step (0.01 lots on FX, 1 share, 100 XRP lots); nothing is clamped here
    function normLots(sym, v) {
      const m = M(sym); if (!m || !finite(+v)) return NaN;
      const st = m.p.vol[2]; return +(Math.round(+v / st + 1e-9) * st).toFixed(lotDec(sym));
    }
    const lotsFmt = (sym, lots) => (+lots).toFixed(lotDec(sym));
    const lotsWord = (sym, lots) => { const n = Number.isInteger(+lots) ? nf0.format(lots) : lotsFmt(sym, lots), u = M(sym).lotName === 'shares' ? 'share' : 'lot'; return `${n} ${u}${+lots === 1 ? '' : 's'}`; };
    // sizes on the instrument's step: round (rS), round down (fS)
    const rS = (sym, v) => normLots(sym, v), fS = (sym, v) => { const st = volOf(sym)[2]; return +(Math.floor(v / st + 1e-6) * st).toFixed(lotDec(sym)); };
    // null or why a size is outside the sheet's min/max
    function volCheck(sym, lots) {
      const [mn, mx] = volOf(sym);
      if (!(lots >= mn - 1e-9)) return ['VOL_MIN', { min: lotsWord(sym, mn) }];
      if (lots > mx + 1e-9) return ['VOL_MAX', { max: lotsWord(sym, mx) }];
      return null;
    }
    const why = c => c ? render(REJECT[c[0]].tpl, c[1]) : '';
    const volWhy = (sym, lots) => why(volCheck(sym, lots));

    /* ---------- leverage ---------- */
    // margin class under a jurisdiction: for a pair, the regime's own major list if it has one, else the sheet class
    const levCls = (sym, j) => { const m = M(sym); return m.kind !== 'cfd' && j.majors ? (j.majors.has(m.base) && j.majors.has(m.quote) ? 'fx-major' : 'fx-minor') : m.cls; };
    // the sheet's leverage for the user's choice: the default, or the choice up to the maximum
    const sheetLev = (sym, set) => { const [def, max] = M(sym).p.lev, c = set && set.lev; return c > 0 ? Math.min(c, max) : def; };
    // the jurisdiction's cap on the instrument (Infinity: none); a class not offered keeps the ESMA cap as its margin
    const jurCap = (sym, set) => { const j = jurOf(set); if (j.none) return Infinity; const c = levCls(sym, j); return j.cap[c] ?? ESMA_CAP[c] ?? Infinity; };
    const effLev = (sym, set) => Math.min(sheetLev(sym, set), jurCap(sym, set));

    /* ---------- trade status and sessions ----------
       tradeStatus(sym, set) → 'off' (not offered: unknown, the jurisdiction does not offer its class, or a replay that
       does not cover it), 'close' (CLOSE ONLY on the sheet: reductions and closes only) or 'full'. */
    function tradeStatus(sym, set) {
      const m = M(sym); if (!m) return 'off';
      const j = jurOf(set);
      if (replayOff(sym) || (!j.none && j.cap[levCls(sym, j)] === null)) return 'off';
      return m.p.status === 'close' ? 'close' : 'full';
    }
    function unavailable(sym, set) {
      const m = M(sym); if (!m) return ['UNKNOWN_SYM', {}];
      if (replayOff(sym)) return ['REPLAY_OFF', { short: m.short }];
      const st = tradeStatus(sym, set);
      if (st === 'close') return ['CLOSE_ONLY', { short: m.short }];
      if (st === 'off') return ['NOT_OFFERED', { short: m.short, jur: jurOf(set).name }];
      return null;
    }
    const unavailableWhy = (sym, set) => why(unavailable(sym, set));
    const isAvailable = (sym, set) => tradeStatus(sym, set) === 'full';
    // close only: CLOSE ONLY on the sheet, or not offered with a position still open on it (reduce and close, add nothing)
    const closeOnly = (acct, sym) => !!M(sym) && (tradeStatus(sym, acct.set) === 'close' || (!isAvailable(sym, acct.set) && acct.positions.some(p => p.sym === sym)));
    // null while the instrument quotes; else why it cannot be traded now
    function marketCheck(sym) {
      const q = Q(sym); if (!q || q.open) return null;
      if (q.why === 'off quotes') return ['OFF_QUOTES', {}];
      if (q.why === 'no feed') return ['NO_FEED', {}];
      const o = opens(sym); return ['CLOSED', { opens: o ? ' — ' + o : '' }];
    }
    const marketWhy = sym => why(marketCheck(sym));
    const marketOpen = sym => { const q = Q(sym); return !!q && q.open; };

    /* Initial margin (decision 35, ESMA Q&A 5.8): fixed per position when it opens (p.im = notional at the fill / the
       effective leverage), scaled on a partial close, rescaled by a leverage profile change; used margin, margin level
       and the stop-out read Σ im. A position saved without im is margined at its entry price (once, then kept). An
       order or a bare {sym, lots} (no entry) is margined at the current price. posMargin(p, cur, set): p's margin under
       the account's set cur, or what it would be under set. */
    const okIm = v => typeof v === 'number' && isFinite(v) && v > 0 && v <= MONEY_MAX;
    const imAtEntry = (p, set) => { const m = M(p.sym); return p.lots * m.size * p.entry * usd(m.quote) / effLev(p.sym, set); };
    function posMargin(p, cur, set = cur) {
      if (okIm(p.im)) return set !== cur ? p.im * effLev(p.sym, cur) / effLev(p.sym, set) : p.im;
      if (isFinite(p.entry) && p.entry > 0) return imAtEntry(p, set);
      return notionalUsd(p.sym, p.lots) / effLev(p.sym, set);
    }
    // the account at the current quotes (a position without im gets it now, at its entry price)
    function summary(acct) {
      let fl = 0, mg = 0;
      for (const p of acct.positions) { fl += posPnl(p).pnl; if (!okIm(p.im)) p.im = posMargin(p, acct.set); mg += p.im; }
      const eq = acct.balance + fl;
      return { balance: acct.balance, equity: eq, eq, margin: mg, mg, free: eq - mg, level: mg ? eq / mg * 100 : Infinity, fl };
    }
    // the per-order limits: the sheet's [min, max] and a notional of at most 25× equity
    function orderCaps(acct, sym, lots) {
      { const c = volCheck(sym, lots); if (c) return c; }
      const notional = notionalUsd(sym, lots), cap = Math.max(0, summary(acct).eq) * MAX_NOTIONAL_X;
      if (notional > cap) return ['NOTIONAL', { notional: usdFmt(notional), x: MAX_NOTIONAL_X, cap: usdFmt(cap) }];
      return null;
    }

    /* ============ execution model ============
       A live fill lands at the quote plus symmetric noise of σ = √(slipSd² + σ_lat²) pips, where σ_lat is the
       instrument's own volatility over the latency (latMs × speed). The noise has mean zero by construction. Off the
       live market (paused, replay) it fills exactly at the quote. All-or-nothing. A limit never fills worse than its
       price (out.ok false, why 'not reached'). A stop fills at the quote that crossed it (gap flagged beyond 2 pips).
       Maximum deviation (sheet maxDev, points): a market fill further than that from the quote is 'requote'; stops,
       limits, gaps and the stop-out (dev: false) are never requoted. */
    const execCfg = set => { const s = set || {}; return { on: s.slip !== 'off', sd: s.slipSd ?? EXEC_DEF.slipSd, lat: s.latMs ?? EXEC_DEF.latMs, comm: s.comm ?? EXEC_DEF.comm }; };
    const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    function execFill(acct, { sym, side, kind = 'market', ref = null, limit = null, dev = true }) {
      const q = Q(sym), m = M(sym), d = side === 'buy' ? 1 : -1, base = d > 0 ? q.ask : q.bid, c = execCfg(acct.set);
      const on = c.on && live(), sp = speed();
      const lat = on ? c.lat * (.5 + rng()) : 0;
      const sdLat = on ? vol(sym) * Math.sqrt(lat / 1000 * sp) : 0;
      const eps = on ? gauss() * Math.sqrt(sdLat ** 2 + c.sd ** 2) : 0; // pips, positive = against the trader
      // the fill is a price of the instrument: on its grid (digits), so what the screen shows reproduces the P&L (UX-42)
      const px = +(base + d * eps * m.pip).toFixed(m.digits), want = ref ?? base;
      const out = { ok: true, px, base, ref: want, kind, bid: q.bid, ask: q.ask, spread: q.spread, lat: Math.round(lat), slip: (px - want) * d / m.pip,
        gap: kind !== 'market' && Math.abs(base - want) > 2 * m.pip, model: { on: c.on, sd: c.sd, lat: c.lat, live: on } };
      if (kind === 'limit' && d * (px - limit) > 1e-12) { out.ok = false; out.why = 'not reached'; }
      if (kind === 'market' && dev) { const pts = Math.abs(px - base) / m.point; if (pts > m.p.maxDev + 1e-9) { out.ok = false; out.why = 'requote'; out.devPts = pts; } }
      return out;
    }
    const exRej = (sym, ex) => ex.why === 'requote' ? rej('REQUOTE', { short: M(sym).short, n: Math.round(ex.devPts), maxDev: M(sym).p.maxDev }, { devPts: ex.devPts }) : rej('NOT_FILLED');
    // commission per lot round turn: the sheet's (0 on every instrument of the Default profile) + the account's extra
    const commOf = (set, lots, sym) => ((sym && M(sym) ? M(sym).p.comm : 0) + execCfg(set).comm) * lots;

    /* fill receipts: ids from acct.nextFill (their own counter, not nextId) */
    function newFill(acct, ex, x) {
      if (!(Number.isInteger(acct.nextFill) && acct.nextFill > 0)) acct.nextFill = 1 + (Array.isArray(acct.fills) ? acct.fills.reduce((mx, f) => Math.max(mx, f.fid | 0), 0) : 0);
      return { fid: acct.nextFill++, t: x.t ?? now(), sym: x.sym, side: x.side, lots: x.lots, pos: x.pos, order: x.order ?? null, kind: x.kind, reason: x.reason,
        bid: ex.bid, ask: ex.ask, ref: ex.ref, refKind: x.refKind, px: ex.px, slip: ex.slip, slipUsd: ex.slip * pipValue(x.sym, x.lots), spread: ex.spread,
        spreadUsd: ex.spread * pipValue(x.sym, x.lots), lat: ex.lat, comm: x.comm || 0, gap: ex.gap, model: ex.model };
    }

    /* ============ swap (sheet p.swap: [long, short, unit]) ============
       'pts' (FX): points per lot a night; 'pctYr' (everything else): a yearly fraction of the notional / 360 a night.
       Rollover at 17:00 New York: Monday to Friday, three nights on the triple day (FX Wednesday, the rest Friday);
       crypto every night, no triple. */
    const isCrypto = sym => M(sym).group === 'crypto';
    function swapPerNight(sym, side, lots) {
      const m = M(sym), [l, s, u] = m.p.swap, v = side === 'buy' ? l : s;
      if (!v) return 0;
      return u === 'pts' ? v * m.point * m.size * lots * usd(m.quote) : notionalUsd(sym, lots) * v / 360;
    }
    const nyDow = t => new Date((t + market.nyOffset(t) * 3600) * 1000).getUTCDay();
    // the triple day by New York weekday: 3 FX (Wednesday), 5 the rest (Friday), null crypto (every night, no triple)
    const tripleDow = sym => !sym || !M(sym) ? 3 : isCrypto(sym) ? null : M(sym).kind === 'fx' ? 3 : 5;
    // nights a position on sym is financed by the rollover at t (no symbol: FX)
    function rolloverNights(t, sym) {
      const dow = nyDow(t);
      if (sym && M(sym) && isCrypto(sym)) return 1;
      if (dow < 1 || dow > 5) return 0;
      return dow === tripleDow(sym) ? 3 : 1;
    }
    // the first rollover strictly after t: any day (no symbol), or one that finances sym
    function nextRollover(t, sym) {
      let day = Math.floor((t + market.nyOffset(t) * 3600) / 86400);
      for (let i = 0; i < 10; i++, day++) {
        const local = day * 86400 + 17 * 3600, utc = local - market.nyOffset(local + 5 * 3600) * 3600;
        if (utc > t && (!sym || rolloverNights(utc, sym) > 0)) return utc;
      }
      return Infinity;
    }
    function nextTriple(t, sym) {
      if (tripleDow(sym) == null) return Infinity;
      let r = nextRollover(t, sym); for (let i = 0; i < 8 && rolloverNights(r, sym) !== 3; i++) r = nextRollover(r, sym); return r;
    }
    /* rollover(acct, t): books the swap of every rollover in (acct.rollLast, t], so the nights missed while nothing ran
       are booked too (at most 40 in one call; the rest on the next). The first call only sets acct.rollLast. */
    function rollover(acct, t) {
      if (acct.rollLast == null || !finite(acct.rollLast)) { acct.rollLast = t; return []; }
      const ev = [];
      let r = nextRollover(acct.rollLast), last = acct.rollLast, guard = 0;
      for (; r <= t && guard < 40; guard++) {
        const rows = [];
        for (const p of acct.positions) {
          if (!M(p.sym) || (p.open != null && p.open > r)) continue; // opened after that rollover: not financed by it
          const k = rolloverNights(r, p.sym);
          if (k) { const v = swapPerNight(p.sym, p.side, p.lots) * k; p.swap = (p.swap || 0) + v; rows.push({ pos: p.id, nights: k, swap: v }); }
        }
        if (rows.length) ev.push({ type: 'swap', t: r, rows });
        last = r; r = nextRollover(r);
      }
      acct.rollLast = r > t ? t : last;
      return ev;
    }
    /* costModel(set, sym) → the sheet's costs as pure functions, for the backtester's 'account' cost mode (see trade.js) */
    const srvNight = t => { const loc = t + market.serverOffset(t) * 3600, dow = ((Math.floor(loc / 86400) + 4) % 7 + 7) % 7, mn = Math.floor((((loc % 86400) + 86400) % 86400) / 60); return dow >= 1 && dow <= 5 && (mn >= 1380 || mn < 60); };
    function costModel(set, sym) {
      const m = M(sym); if (!m) return null;
      const p = m.p, usdQ = () => usd(m.quote);
      const sp = k => (p.spread[k] + (p.jit ? (p.jit[k][0] + p.jit[k][1]) / 2 : 0)) * m.point;
      return {
        commRT: lots => commOf(set, lots, sym),
        swapNight(side, lots, px, tUtc) {
          const k = rolloverNights(tUtc, sym), [l, s, u] = p.swap, v = side === 'buy' ? l : s;
          if (!k || !v) return 0;
          return k * (u === 'pts' ? v * m.point * m.size * lots * usdQ() : lots * m.size * px * usdQ() * v / 360);
        },
        spreadAt: tUtc => sp(srvNight(tUtc) ? 1 : 0),
        newsInSpread: false
      };
    }

    /* ============ order model (hybrid) ============
       Protections live on the position: one stop loss (sl, optionally trailing or moved to break-even once) and up to 4
       take profits (tp alone, or tps legs that each close part of the position; p.tp always shows the nearest). Entry
       orders can be limit, stop or stop-limit, GTC, DAY or GTD, and two or more can form an OCO group. Their exits are
       offsets from the fill (slPips, tpPips or tps rows, trail, be). */
    /* targets from {pips, pct} rows (or absolute {price, lots}). Lots per leg round down to the sheet's step and the
       last leg takes the remainder, so the legs never cover more than the position. → { tps } or { err, code, a } */
    function buildTps(sym, side, entry, lots, rows) {
      const m = M(sym), d = side === 'buy' ? 1 : -1;
      const e = (code, a) => ({ err: render(REJECT[code].tpl, a), code, a });
      if (!Array.isArray(rows) || !rows.length) return { tps: null };
      if (rows.length > TP_MAX) return e('TPS_MAX', { max: TP_MAX });
      let legs;
      if (rows.every(x => x && x.price > 0 && x.lots > 0)) legs = rows.map(x => ({ price: +x.price, lots: rS(sym, x.lots) }));
      else {
        if (!rows.every(x => x && x.pips > 0 && x.pct > 0 && x.pct <= 100)) return e('TPS_ROWS');
        const tot = rows.reduce((s, x) => s + +x.pct, 0); if (tot > 100 + 1e-9) return e('TPS_SUM', { pct: Math.round(tot) });
        legs = [...rows].sort((a, b) => a.pips - b.pips).map(x => ({ price: entry + d * x.pips * m.pip, lots: fS(sym, lots * x.pct / 100) }));
        legs[legs.length - 1].lots = rS(sym, fS(sym, lots * tot / 100) - legs.slice(0, -1).reduce((s, x) => s + x.lots, 0));
      }
      legs.sort((a, b) => d * (a.price - b.price));
      const mn = volOf(sym)[0];
      for (let i = 0; i < legs.length; i++) {
        if (!(legs[i].lots >= mn - 1e-9)) return e('TPS_MIN', { i: i + 1, min: lotsFmt(sym, mn), unit: m.lotName === 'shares' ? 'share' : 'lot' });
        if (i && Math.abs(legs[i].price - legs[i - 1].price) < m.pip / 100) return e('TPS_SAME');
      }
      if (legs.reduce((s, x) => s + x.lots, 0) > lots + 1e-9) return e('TPS_OVER');
      legs.forEach((x, i) => { x.leg = 'TP' + (i + 1); });
      return { tps: legs };
    }
    // break-even: after `at` pips in profit and/or after the first target fills, the stop moves to entry + off pips (once)
    function beSpec(b, spread, sym) {
      if (!b || typeof b !== 'object') return { be: null };
      const at = b.at == null || b.at === '' ? null : +b.at, off = +b.off || 0;
      if (at != null && !(at > spread)) { const a = { spread: spread.toFixed(1), unit: unitWord(sym) }; return { err: render(REJECT.BE_SPREAD.tpl, a), code: 'BE_SPREAD', a }; }
      if (at == null && !b.onTp) return { be: null };
      return { be: { at, off, onTp: !!b.onTp, done: false } };
    }
    // after a partial close the targets are cut back to the remaining size, nearest first
    function trimTps(p) {
      if (!p.tps) return;
      const rs = v => M(p.sym) ? rS(p.sym, v) : r2(v), mn = M(p.sym) ? volOf(p.sym)[0] : .01;
      let over = rs(p.tps.reduce((s, x) => s + x.lots, 0) - p.lots);
      for (const x of p.tps) { if (over <= 0) break; const cut = Math.min(x.lots, over); x.lots = rs(x.lots - cut); over = rs(over - cut); }
      p.tps = p.tps.filter(x => x.lots >= mn - 1e-9);
      if (!p.tps.length) { delete p.tps; p.tp = null; } else p.tp = p.tps[0].price;
    }
    // p.tp edited in place (dock, chart, modify): the nearest leg follows it (cleared: that leg is removed)
    function syncTps(p) {
      if (!p.tps || !p.tps.length || p.tp === p.tps[0].price) return;
      const d = p.side === 'buy' ? 1 : -1;
      if (p.tp == null) p.tps.shift(); else { p.tps[0].price = p.tp; p.tps.sort((a, b) => d * (a.price - b.price)); }
      if (!p.tps.length) { delete p.tps; p.tp = null; } else p.tp = p.tps[0].price;
    }
    // a target set on the losing side of the entry is a limit, not a profit
    const tpWhy = (p, ex, name) => (p.side === 'buy' ? ex.px < p.entry : ex.px > p.entry) ? `${name} · limit at a loss` : name;
    const slWhy = p => p.slReason ? p.slReason : p.trail && p.trailed ? 'Trailing stop' : p.beSl != null && p.sl === p.beSl ? 'Stop loss (break-even)' : 'Stop loss';

    /* ============ netting ============
       One position per instrument in the net book (positions with no basket / bgid, and none the broker opened as a
       hedged position: hedge, a D without a position id or the net flag, e.g. a basket leg). merge: a state from before
       netting may hold several on one side; they become the oldest (size-weighted entry, fills, swap, commission,
       margin; it keeps its own SL/TP). */
    const netBook = (acct, sym) => acct.positions.filter(x => x.sym === sym && !x.basket && !x.bgid && !x.hedge);
    function netAgg(acct, sym, side) {
      const ps = netBook(acct, sym).filter(x => x.side === side); if (!ps.length) return null;
      const lots = ps.reduce((s, x) => s + x.lots, 0), p = ps[0];
      return { p, n: ps.length, lots, entry: ps.reduce((s, x) => s + x.entry * x.lots, 0) / lots, sl: p.sl, tp: p.tp, tps: p.tps || null, im: ps.reduce((s, x) => s + (okIm(x.im) ? x.im : posMargin(x, acct.set)), 0) };
    }
    function netMerge(acct, sym) {
      let n = 0;
      for (const side of ['buy', 'sell']) {
        const ps = netBook(acct, sym).filter(x => x.side === side); if (ps.length < 2) continue;
        const p = ps[0], m = M(sym), a = netAgg(acct, sym, side);
        p.lots = rS(sym, a.lots); p.entry = a.entry; p.im = a.im;
        for (const x of ps.slice(1)) { p.swap = (p.swap || 0) + (x.swap || 0); p.comm = (p.comm || 0) + (x.comm || 0); p.fills = [...(p.fills || []), ...(x.fills || [])]; acct.positions.splice(acct.positions.indexOf(x), 1); }
        p.risk = p.sl != null ? Math.abs(p.entry - p.sl) * p.lots * m.size * usd(m.quote) : null;
        n++;
      }
      return n > 0;
    }

    /* ============ market orders ============
       openMarket(acct, req, h) → { ok, pos, fills[], events[], net, op, ex } | refusal. req: { sym, side, lots, sl?, tp?
       (prices), slPips?, tpPips? (pips from the fill), tps? (rows), be?, trail?, exec? (a fill already made: a pending
       order's), src?, reason?, refKind?, posId? }. With posId the order nets on that position: the same side adds at
       the size-weighted entry (the position keeps its own SL/TP), the other side reduces it at the fill (P/L
       realised) and the remainder of a reversal opens a new position with the order's own SL/TP (req.closeReason: the
       reason of that close, else 'Offset by … order'; req.hedge: the new position stays out of the net book). req.net: net on the
       instrument's book instead (the browser: legacy positions merge first; a reversal's remainder adds to the book's
       position on its side, if any). net: null (opened), 'add', 'reduce', 'close', 'flip'; op: 'open' | 'add' | 'reduce'
       (what the last fill did). */
    function openMarket(acct, req, h = {}) {
      const sym = req.sym, m = M(sym);
      if (!m) return rej('UNKNOWN_SYM');
      { const c = marketCheck(sym); if (c) return rej(c[0], c[1]); }
      const q = Q(sym), d = req.side === 'buy' ? 1 : -1;
      const lots = normLots(sym, req.lots), mn = volOf(sym)[0];
      if (!(lots >= mn - 1e-9)) { const c = volCheck(sym, lots || 0); return rej(c[0], c[1]); }
      let opp = null, same = null, merged = false;
      const tgt = req.posId != null ? acct.positions.find(x => x.id === req.posId && x.sym === sym) : null;
      if (tgt) { if (tgt.side === req.side) same = tgt; else opp = tgt; }
      else if (req.net && !req.basket) { // the net book (also a pending order whose position closed meanwhile)
        merged = netMerge(acct, sym);
        const book = netBook(acct, sym);
        opp = book.find(x => x.side !== req.side) || null; same = book.find(x => x.side === req.side) || null;
      } else if (req.posId != null) return rej('NO_POS');
      const mr = r => (merged ? { ...r, merged } : r); // a refusal after the merge still says the book changed
      const events = [], fills = [];
      const own = r => { if (r && Array.isArray(r.events)) for (const e of r.events) { events.push(e); if (e.type === 'fill') fills.push(e.fill); } };
      // other side open: reduce it at this fill (allowed on a close-only instrument too); the remainder reverses
      if (opp) {
        if (h.gate && h.gate(req)) return mr(held());
        const ex = req.exec || execFill(acct, { sym, side: req.side, kind: 'market' });
        if (!ex.ok) return mr(exRej(sym, ex));
        const before = opp.lots, ctx = { exec: ex, refKind: req.refKind || 'quote at the click', t: req.t }, reason = req.closeReason || `Offset by ${req.side} order`;
        const r = h.close ? h.close(acct, opp.id, Math.min(1, lots / before), reason, ctx) : close(acct, opp.id, Math.min(1, lots / before), reason, ctx);
        if (!h.close) own(r);
        const still = acct.positions.find(y => y.id === opp.id), done = before - (still ? still.lots : 0);
        if (!(done > 0)) return { ...(r && r.ok === false ? r : rej('NOT_FILLED')), quiet: true, merged, events }; // refused (the close says why)
        const left = rS(sym, Math.max(0, lots - done)), last = still || opp, net0 = still ? 'reduce' : 'close';
        if (left < mn - 1e-9) return { ok: true, pos: last, net: net0, op: 'reduce', ex, fills, events, merged };
        // targets given as prices for the whole order are cut back to the remainder, nearest first (trimTps)
        let rtps = req.tps;
        if (Array.isArray(rtps) && rtps.length && rtps.every(x => x && x.price > 0 && x.lots > 0) && rtps.reduce((s, x) => s + +x.lots, 0) > left + 1e-9) {
          const pp = { sym, lots: left, tps: rtps.map(x => ({ price: +x.price, lots: +x.lots })).sort((a, b) => d * (a.price - b.price)) }; trimTps(pp); rtps = pp.tps || null;
        }
        const rest = openMarket(acct, { ...req, tps: rtps, lots: left, exec: ex, posId: null, dupOk: true }, h); // dupOk: the gate lets it through
        if (!rest.ok) return { ok: true, pos: last, net: net0, op: 'reduce', ex, fills, events: [...events, ...(rest.events || [])], merged, restRej: rest };
        return { ...rest, net: rest.net || 'flip', fills: [...fills, ...rest.fills], events: [...events, ...rest.events], merged: merged || rest.merged };
      }
      // not offered under the profile, or close only: no new exposure
      { const c = unavailable(sym, acct.set); if (c) return mr(rej(c[0], c[1])); }
      { const c = orderCaps(acct, sym, lots); if (c) return mr(rej(c[0], c[1])); }
      const req0 = notionalUsd(sym, lots) / effLev(sym, acct.set), a = summary(acct);
      if (req0 > a.free) return mr(rej('MARGIN', { req: usdFmt(req0), free: usdFmt(a.free) }));
      if (same) { const r = netAdd(acct, same, req, lots, req0, h); return r.ok ? { ...r, merged } : mr(r); }
      const ex = req.exec || execFill(acct, { sym, side: req.side, kind: 'market' }), entry = ex.px;
      if (!ex.ok) return mr(exRej(sym, ex));
      let sl = req.sl ?? (req.slPips > 0 ? entry - d * req.slPips * m.pip : null), tp = req.tp ?? (req.tpPips > 0 ? entry + d * req.tpPips * m.pip : null);
      const trail = Math.max(0, +req.trail || 0), sa = { spread: q.spread.toFixed(1), unit: unitWord(sym) };
      // a stop between the entry and the other side of the quote is not the wrong side: it sits inside the spread
      if (sl != null && (d > 0 ? sl >= q.bid : sl <= q.ask) && !(gapStops && req.auto && req.exec)) return mr((d > 0 ? sl < entry : sl > entry) ? rej('SL_SPREAD', sa) : rej('SL_SIDE'));
      // a trailing stop without a stop loss protects at once: the stop starts at entry ∓ trail and follows the price
      let trailNow = false;
      if (trail > 0 && sl == null) {
        sl = trailNext(d, null, entry, trail * m.pip); trailNow = true;
        if (d > 0 ? sl >= q.bid : sl <= q.ask) return mr(rej('TRAIL_SPREAD', sa));
      }
      let tps = null;
      if (req.tps) { const b = buildTps(sym, req.side, entry, lots, req.tps); if (b.err) return mr(rej(b.code, b.a)); tps = b.tps; }
      if (tps && tps.length === 1 && tps[0].lots >= lots) { tp = tps[0].price; tps = null; }
      if (tps) tp = tps[0].price;
      if (tp != null && (d > 0 ? tp <= q.bid : tp >= q.ask)) return mr(rej('TP_SIDE'));
      const bs = beSpec(req.be, q.spread, sym); if (bs.err) return mr(rej(bs.code, bs.a));
      if (h.gate && h.gate(req)) return mr(held());
      const comm = commOf(acct.set, lots, sym);
      const p = { id: acct.nextId++, sym, side: req.side, lots, entry, sl, tp, trail, swap: 0, comm, im: req0, open: req.t ?? now(), risk: sl != null ? Math.abs(entry - sl) * lots * m.size * usd(m.quote) : null, src: req.src ?? null };
      if (trailNow) { p.trailNow = true; p.trailSl = sl; }
      if (req.hedge) p.hedge = true;
      if (tps) p.tps = tps;
      if (bs.be) p.be = bs.be;
      acct.balance -= comm;
      acct.positions.push(p);
      const f = newFill(acct, ex, { t: req.t, sym, side: req.side, lots, pos: p.id, order: req.src, kind: 'open', reason: req.reason || 'Market order', refKind: req.refKind || 'quote at the click', comm });
      p.fills = [f.fid];
      return { ok: true, pos: p, net: null, op: 'open', ex, trailNow, fills: [f], events: [{ type: 'fill', fill: f }], merged };
    }
    // same side open: add the size at the size-weighted average entry; the position's own protections cover the whole size
    function netAdd(acct, p, req, lots, req0, h) {
      const sym = p.sym, m = M(sym);
      const ex = req.exec || execFill(acct, { sym, side: req.side, kind: 'market' });
      if (!ex.ok) return exRej(sym, ex);
      if (h.gate && h.gate(req)) return held();
      const comm = commOf(acct.set, lots, sym), l0 = p.lots, nl = rS(sym, l0 + lots);
      p.entry = (p.entry * l0 + ex.px * lots) / (l0 + lots); p.lots = nl;
      p.comm = (p.comm || 0) + comm; p.im = (okIm(p.im) ? p.im : posMargin(p, acct.set)) + req0;
      p.risk = p.sl != null ? Math.abs(p.entry - p.sl) * nl * m.size * usd(m.quote) : null;
      acct.balance -= comm;
      if (!Array.isArray(p.fills)) p.fills = [];
      const f = newFill(acct, ex, { t: req.t, sym, side: req.side, lots, pos: p.id, order: req.src, kind: 'add', reason: req.reason || 'Market order', refKind: req.refKind || 'quote at the click', comm });
      p.fills.push(f.fid);
      return { ok: true, pos: p, net: 'add', op: 'add', ex, lots, fills: [f], events: [{ type: 'fill', fill: f }] };
    }

    /* close(acct, id, frac, reason, ctx) → { ok, pos, full, trade (the history row), fills[], events[] } | refusal.
       A close or a reduction, also on a close-only instrument. Refused while the market is closed (or off quotes) and
       on a requote; ctx: { exec (a fill already made: a stop, a target, the stop-out), refKind, leg, t (the time to stamp,
       else now()) } or the fill itself. Partial sizes go on the sheet's step; what would be left under the minimum size is closed with the rest. */
    const lastTrade = new WeakMap();
    function close(acct, id, frac = 1, reason = 'Manual', x) {
      const ctx = x && typeof x.px === 'number' ? { exec: x } : x || {};
      const i = acct.positions.findIndex(p => p.id === id); if (i < 0) return { ...rej('NO_POS'), quiet: true };
      const p = acct.positions[i], m = M(p.sym), d = p.side === 'buy' ? 1 : -1;
      { const c = marketCheck(p.sym); if (c) return rej(c[0], c[1]); }
      const mn = volOf(p.sym)[0];
      let lots = frac >= 1 ? p.lots : Math.max(mn, normLots(p.sym, p.lots * frac));
      if (lots >= p.lots - 1e-9 || p.lots - lots < mn - 1e-9) lots = p.lots;
      const ex = ctx.exec || execFill(acct, { sym: p.sym, side: d > 0 ? 'sell' : 'buy', kind: 'market' });
      if (!ex.ok) return ex.why === 'requote' ? exRej(p.sym, ex) : { ...rej('NOT_FILLED'), quiet: true };
      const exit = ex.px, pips = (exit - p.entry) * d / m.pip;
      const swap = (p.swap || 0) * lots / p.lots, pnl = (exit - p.entry) * d * lots * m.size * usd(m.quote) + swap, comm = (p.comm || 0) * lots / p.lots;
      acct.balance += pnl;
      const riskPart = p.risk ? p.risk * lots / p.lots : null, full = lots === p.lots;
      if (full && frac < 1 && reason === 'Partial close') reason = 'Close'; // ½ of the minimum lot is the whole position
      const f = newFill(acct, ex, { t: ctx.t, sym: p.sym, side: d > 0 ? 'sell' : 'buy', lots, pos: p.id, order: null, kind: full ? 'close' : 'reduce', reason, refKind: ctx.refKind || 'quote at the click', comm: 0 });
      const t = ctx.t ?? now();
      const row = { id: p.id, sym: p.sym, side: p.side, lots, entry: p.entry, exit, open: p.open, close: t, pnl, pips, r: riskPart ? pnl / riskPart : null, reason, note: '', swap,
        leg: ctx.leg ?? null, comm, slip: ex.slip, gap: ex.gap, fills: [...(p.fills || []).slice(0, 1), f.fid] };
      if (full) acct.positions.splice(i, 1);
      else { const l0 = p.lots; p.lots = normLots(p.sym, p.lots - lots); if (p.risk) p.risk -= riskPart; if (p.swap) p.swap -= swap; if (p.comm) p.comm -= comm; if (okIm(p.im)) p.im *= p.lots / l0; trimTps(p); }
      lastTrade.set(acct, row);
      return { ok: true, pos: p, full, lots, pnl, pips, ex, trade: row, fills: [f], events: [{ type: 'fill', fill: f, trade: row }] };
    }

    /* ============ pending orders ============
       place(acct, req, h) → { ok, order, peer, events[] } | refusal. req: { sym, side, ot: 'limit'|'stop', price,
       limit? (stop-limit), lots, slPips, tpPips, tps?, be?, trail, tif?: 'GTC'|'DAY'|'GTD', expires? (GTD), oca? (an
       order id or 'o<id>' group to join), posId?, net? (true: it nets on the instrument's book when it fills, as a
       market order of the net book; kept on the order) }, plus caller extras kept on the order (pm, auto, src, ctx, basket…).
       Margin is not checked here: it is checked at the fill. */
    const dayEnd = t => (Math.floor(t / 86400) + 1) * 86400;
    function place(acct, o, h = {}) {
      const nb = (c, a) => rej(c, a, { beep: false });
      if (!M(o.sym)) return rej('UNKNOWN_SYM');
      { const c = unavailable(o.sym, acct.set); if (c) return rej(c[0], c[1]); }
      { const c = marketCheck(o.sym); if (c) return rej(c[0], c[1]); }
      const m = M(o.sym), q = Q(o.sym), d = o.side === 'buy' ? 1 : -1, ref = d > 0 ? q.ask : q.bid, t = now();
      if (!(o.price > 0)) return nb('PRICE_INVALID');
      const okSide = o.ot === 'limit' ? (d > 0 ? o.price < ref : o.price > ref) : (d > 0 ? o.price > ref : o.price < ref);
      if (!okSide) return rej('PRICE_SIDE', { side: o.side, ot: o.ot, dir: (o.ot === 'limit') === (d > 0) ? 'below' : 'above' });
      // minimum pending distance (sheet minPend, points) from the side the order fills on
      if (Math.abs(o.price - ref) < m.p.minPend * m.point - 1e-12) return rej('MIN_DIST', { pts: m.p.minPend, dist: fp(o.sym, m.p.minPend * m.point), ref: d > 0 ? 'ask' : 'bid' });
      const lots = normLots(o.sym, o.lots);
      if (!(lots >= m.p.vol[0] - 1e-9)) { const c = volCheck(o.sym, lots || 0); return nb(c[0], c[1]); }
      { const c = orderCaps(acct, o.sym, lots); if (c) return rej(c[0], c[1]); }
      if (acct.orders.length >= MAX_WORKING) return rej('MAX_WORKING', { max: MAX_WORKING });
      let limit = null;
      if (o.limit != null) {
        if (o.ot !== 'stop') return rej('LIMIT_STOP_ONLY');
        if (!(o.limit > 0)) return rej('LIMIT_INVALID');
        if (d > 0 ? o.limit < o.price : o.limit > o.price) return rej('LIMIT_SIDE', { Side: d > 0 ? 'Buy' : 'Sell', dir: d > 0 ? 'above' : 'below' });
        limit = +o.limit;
      }
      const tif = ['DAY', 'GTD'].includes(o.tif) ? o.tif : 'GTC';
      const expires = tif === 'DAY' ? dayEnd(t) : tif === 'GTD' ? (finite(o.expires) ? o.expires : null) : null;
      if (tif === 'GTD' && !(expires >= t + 60)) return rej('EXPIRY');
      // a stop measured from the fill price must clear the spread, or the fill would be refused later
      const sa = { spread: q.spread.toFixed(1), unit: unitWord(o.sym) };
      if (o.slPips > 0 && o.slPips <= q.spread) return rej('SL_SPREAD', sa);
      if (!(o.slPips > 0) && o.trail > 0 && o.trail <= q.spread) return rej('TRAIL_SPREAD', sa);
      const rows = Array.isArray(o.tps) && o.tps.length ? o.tps.map(x => ({ pips: +x.pips, pct: +x.pct })) : null;
      if (rows) { const b = buildTps(o.sym, o.side, o.price, lots, rows); if (b.err) return rej(b.code, b.a); }
      const bs = beSpec(o.be, q.spread, o.sym); if (bs.err) return rej(bs.code, bs.a);
      let oca = null, peer = null;
      if (o.oca != null && o.oca !== '' && o.oca !== 0) {
        const g = typeof o.oca === 'string' ? /^o(\d+)$/.exec(o.oca) : null;
        peer = (g && acct.orders.find(x => x.oca === o.oca)) || acct.orders.find(x => x.id === (g ? +g[1] : +o.oca));
        if (!peer || peer.sym !== o.sym) return rej('OCO_NOT_FOUND');
        oca = peer.oca || 'o' + peer.id;
      }
      if (h.gate && h.gate(o)) return held();
      const { dupOk, oca: _g, tps: _t, be: _b, exec: _e, ...rec } = o;
      const ord = { id: acct.nextId++, ...rec, lots, limit, tif, expires, oca, net: o.net === true, status: 'pending', created: t };
      if (rows) { ord.tps = rows; ord.tpPips = Math.min(...rows.map(x => x.pips)); }
      if (bs.be) { const { done, ...b } = bs.be; ord.be = b; }
      if (peer && !peer.oca) peer.oca = oca;
      acct.orders.push(ord);
      return { ok: true, order: ord, peer, events: [] };
    }
    // an order leaves the book → its order-log row
    function endOrder(acct, o, status, why, t = now()) {
      const i = acct.orders.indexOf(o); if (i >= 0) acct.orders.splice(i, 1);
      return { ...o, status, end: t, why };
    }
    function cancel(acct, id, why = 'Cancelled') {
      const o = acct.orders.find(x => x.id === id); if (!o) return { ...rej('NO_ORDER'), quiet: true };
      return { ok: true, order: o, events: [{ type: 'cancel', order: endOrder(acct, o, 'cancelled', why) }] };
    }
    // OCO: the first entry of a group to fill (or a stop-limit to trigger) cancels the other entries of the group
    function oco(acct, o, what, emit, t) {
      if (!o.oca) return;
      const sib = acct.orders.filter(x => x !== o && x.oca === o.oca);
      const recs = sib.map(x => { const r = endOrder(acct, x, 'cancelled', `OCO: #${o.id} ${what}`, t); emit({ type: 'cancel', order: r, by: o.id }); return r; });
      if (recs.length) emit({ type: 'oco', order: o, what, cancelled: recs });
    }

    /* modify(acct, { posId | orderId, sl?, tp?, tps?, price?, limit?, trail?, be? }) → { ok, pos | order, events[] } |
       refusal. The rules of the level editor (ui.js validateLevel / setLevel): a stop below the bid (buy) / above the
       ask (sell), a target on the other side, a pending price on its side of the market; prices on the instrument's
       digits. A new stop clears the trail (as a drag does); null removes a stop or a target. All fields are checked
       before any is applied. */
    function modify(acct, x = {}) {
      const p = x.posId != null ? acct.positions.find(y => y.id === x.posId) : null;
      const o = !p && x.orderId != null ? acct.orders.find(y => y.id === x.orderId) : null;
      if (!p && !o) return rej(x.posId != null ? 'NO_POS' : 'NO_ORDER');
      const r = p || o, sym = r.sym, m = M(sym), q = Q(sym), buy = r.side === 'buy', d = buy ? 1 : -1;
      const has = k => Object.prototype.hasOwnProperty.call(x, k) && x[k] !== undefined;
      const px = v => typeof v === 'number' && isFinite(v) && v > 0 ? +v.toFixed(m.digits) : NaN;
      const set = {};
      if (p) {
        if (has('sl') && x.sl !== null) {
          const v = px(x.sl); if (!(v > 0)) return rej('PRICE_INVALID');
          if (!(buy ? v < q.bid : v > q.ask)) return rej('MOD_SL_SIDE', { dir: buy ? 'below' : 'above', ref: buy ? 'bid' : 'ask' });
          set.sl = v;
        } else if (has('sl')) set.sl = null;
        if (has('tp') && x.tp !== null) {
          const v = px(x.tp); if (!(v > 0)) return rej('PRICE_INVALID');
          if (!(buy ? v > q.bid : v < q.ask)) return rej('MOD_TP_SIDE', { dir: buy ? 'above' : 'below', ref: buy ? 'bid' : 'ask' });
          set.tp = v;
        } else if (has('tp')) set.tp = null;
        if (has('tps')) {
          if (x.tps === null || (Array.isArray(x.tps) && !x.tps.length)) set.tps = null;
          else {
            const b = buildTps(sym, r.side, r.entry, r.lots, x.tps); if (b.err) return rej(b.code, b.a);
            // every leg on the profit side of the market, as a single target must be
            if (b.tps.some(l => !(buy ? l.price > q.bid : l.price < q.ask))) return rej('TP_SIDE');
            set.tps = b.tps;
          }
        }
      } else {
        if (has('price')) {
          const v = px(x.price); if (!(v > 0)) return rej('PRICE_INVALID');
          const ref = buy ? q.ask : q.bid, lim = o.ot === 'limit', ok = lim ? (buy ? v < ref : v > ref) : (buy ? v > ref : v < ref);
          if (!ok) return rej('MOD_PRICE_SIDE', { Side: buy ? 'Buy' : 'Sell', ot: o.ot, dir: lim === buy ? 'below' : 'above' });
          // the sheet's minimum pending distance, as placing the order checks it
          if (Math.abs(v - ref) < m.p.minPend * m.point - 1e-12) return rej('MIN_DIST', { pts: m.p.minPend, dist: fp(sym, m.p.minPend * m.point), ref: buy ? 'ask' : 'bid' });
          // a stop-limit keeps its limit at or beyond the new stop price
          if (o.limit != null && !has('limit') && (d > 0 ? o.limit < v : o.limit > v)) return rej('LIMIT_SIDE', { Side: d > 0 ? 'Buy' : 'Sell', dir: d > 0 ? 'above' : 'below' });
          set.price = v;
        }
        if (has('limit')) {
          if (x.limit === null) set.limit = null;
          else {
            if (o.ot !== 'stop') return rej('LIMIT_STOP_ONLY');
            const v = px(x.limit); if (!(v > 0)) return rej('LIMIT_INVALID');
            const sp = set.price ?? o.price;
            if (d > 0 ? v < sp : v > sp) return rej('LIMIT_SIDE', { Side: d > 0 ? 'Buy' : 'Sell', dir: d > 0 ? 'above' : 'below' });
            set.limit = v;
          }
        }
        if (has('tps')) {
          const rows = Array.isArray(x.tps) && x.tps.length ? x.tps.map(y => ({ pips: +y.pips, pct: +y.pct })) : null;
          if (rows) { const b = buildTps(sym, o.side, set.price ?? o.price, o.lots, rows); if (b.err) return rej(b.code, b.a); }
          set.tps = rows;
        }
        // the stop and the target of a pending order are distances from its fill (slPips, tpPips); null or 0 removes one (UX-92)
        for (const k of ['slPips', 'tpPips']) if (has(k)) {
          const v = x[k] === null ? 0 : +x[k];
          if (!isFinite(v) || v < 0) return rej('PRICE_INVALID');
          if (k === 'slPips' && v > 0 && v <= q.spread) return rej('SL_SPREAD', { spread: q.spread.toFixed(1), unit: unitWord(sym) });
          set[k] = v;
        }
      }
      if (has('trail')) {
        const v = Math.max(0, +x.trail || 0);
        if (v > 0 && v <= q.spread) return rej('TRAIL_SPREAD', { spread: q.spread.toFixed(1), unit: unitWord(sym) });
        set.trail = v;
      }
      if (has('be')) { const bs = beSpec(x.be, q.spread, sym); if (bs.err) return rej(bs.code, bs.a); set.be = bs.be; }
      // apply
      if (p) {
        if ('sl' in set) { p.sl = set.sl; p.trail = 0; p.trailed = false; }
        if ('tp' in set) { p.tp = set.tp; syncTps(p); }
        if ('tps' in set) { if (set.tps) { p.tps = set.tps; p.tp = set.tps[0].price; } else { delete p.tps; } }
        if ('trail' in set) p.trail = set.trail;
        if ('be' in set) { if (set.be) p.be = set.be; else delete p.be; }
        p.risk = p.sl != null ? Math.abs(p.entry - p.sl) * p.lots * m.size * usd(m.quote) : null;
      } else {
        if ('price' in set) o.price = set.price;
        if ('limit' in set) { o.limit = set.limit; if (set.limit == null) o.status = 'pending'; }
        if ('tps' in set) { if (set.tps) { o.tps = set.tps; o.tpPips = Math.min(...set.tps.map(y => y.pips)); } else delete o.tps; }
        if ('slPips' in set) o.slPips = set.slPips;
        if ('tpPips' in set) { o.tpPips = set.tpPips; delete o.tps; } // a single target replaces the legs the order had
        if ('trail' in set) o.trail = set.trail;
        if ('be' in set) { if (set.be) { const { done, ...b } = set.be; o.be = b; } else delete o.be; }
      }
      return { ok: true, pos: p || undefined, order: o || undefined, events: [{ type: 'modify', pos: p ? p.id : null, order: o ? o.id : null, set }] };
    }

    /* Negative balance protection: flat with a negative balance ⇒ balance 0, the cover is a history row 'nbp'. */
    function nbp(acct, t = now()) {
      if (acct.positions.length || !(acct.balance < 0)) return null;
      const a = Array.isArray(acct.history) ? acct.history[0] : null, b = lastTrade.get(acct), cover = -acct.balance;
      const h0 = !a ? b : !b ? a : (b.close > a.close ? b : a); // the newer of the last row stored and the core's last close
      const sym = h0 ? h0.sym : acct.set && acct.set.sym, px = h0 ? h0.exit : sym && M(sym) ? mid(sym) : NaN;
      acct.balance = 0;
      const row = { id: acct.nextId++, sym, side: 'nbp', lots: 0, entry: px, exit: px, open: t, close: t, pnl: cover, pips: 0, r: null, reason: 'Negative balance protection', note: '', swap: 0, nbp: true };
      return { type: 'nbp', trade: row, cover, after: h0 ? h0.reason : null };
    }

    /* onTick(acct, t, h) → events[]: what the book does at the quotes of time t, in order: (1) DAY/GTD expiry; (2)
       pending entries (stop-limit trigger, fills, OCO); (3) per position: h.protect (trailing, break-even), stop loss,
       targets (reduce-only, nearest first, a limit never filled worse); (4) the stop-out under a 50% margin level,
       worst P/L first among the open markets; (5) the negative balance protection. */
    function onTick(acct, t = now(), h = {}) {
      const out = [], emit = e => { out.push(e); if (h.emit) h.emit(e); };
      const doClose = (id, frac, reason, c) => { const ctx = { ...c, t }; if (h.close) return h.close(acct, id, frac, reason, ctx); const r = close(acct, id, frac, reason, ctx); if (r.events) r.events.forEach(emit); return r; };
      // 1. DAY / GTD expiry
      const gone = acct.orders.filter(o => o.expires != null && t >= o.expires);
      gone.forEach((o, i) => emit({ type: 'expire', order: endOrder(acct, o, 'expired', `${o.tif} expiry ${dts(o.expires)} UTC`, t), last: i === gone.length - 1 }));
      // 2. entries
      for (const o of [...acct.orders]) {
        if (!acct.orders.includes(o)) continue; // cancelled by an OCO sibling earlier in this tick
        if (!isAvailable(o.sym, acct.set)) continue; // not offered under the profile: never fills
        const q = Q(o.sym), d = o.side === 'buy' ? 1 : -1;
        if (!q.open) continue; // closed: works again at the first quote of the next session
        const stopHit = d > 0 ? q.ask >= o.price : q.bid <= o.price;
        if (o.limit != null && o.status !== 'triggered') {
          if (!stopHit) continue;
          o.status = 'triggered'; o.trig = t;
          emit({ type: 'trigger', order: o });
          oco(acct, o, 'triggered', emit, t);
        }
        const lim = o.ot === 'limit' ? o.price : o.status === 'triggered' ? o.limit : null;
        if (!(lim != null ? (d > 0 ? q.ask <= lim : q.bid >= lim) : stopHit)) continue;
        const ex = execFill(acct, { sym: o.sym, side: o.side, kind: lim != null ? 'limit' : 'stop', ref: lim ?? o.price, limit: lim });
        if (!ex.ok) continue; // the fill noise is beyond the limit: still working
        // slPx / tpPx / tpsPx: exits given as prices (the broker's orders: the gateway's D carries them)
        const rq = { sym: o.sym, side: o.side, lots: o.lots, slPips: o.slPips, tpPips: o.tps || o.tpsPx ? 0 : o.tpPips, tps: o.tpsPx || o.tps, be: o.be, trail: o.trail, pm: o.pm, auto: true,
          ...(o.slPx > 0 ? { sl: o.slPx } : {}), ...(o.tpPx > 0 && !o.tpsPx && !o.tps ? { tp: o.tpPx } : {}),
          src: o.id, exec: ex, reason: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.limit != null ? 'stop-limit' : o.ot} #${o.id}`, refKind: lim != null ? 'limit price' : 'stop price' };
        if (o.posId != null) rq.posId = o.posId;
        if (o.net) rq.net = true;
        if (o.hedge) rq.hedge = true;
        rq.t = t;
        let r = null, err;
        try { r = h.open ? h.open(acct, rq) : openMarket(acct, rq); } catch (e) { r = null; err = String(e); }
        if (!h.open && r && r.events) r.events.forEach(emit);
        const okp = !!(r && r.ok && r.pos);
        // the order leaves the book either way; a refused fill (margin, stop inside the spread) says why
        const text = okp ? `filled: position #${r.pos.id}` : (r && r.text) || 'could not be filled';
        emit({ type: okp ? 'filled' : 'reject', order: endOrder(acct, o, okp ? 'filled' : 'rejected', text, t), text: r && r.text, pos: okp ? r.pos.id : null, ...(err && { err }) });
        if (okp) oco(acct, o, 'filled', emit, t);
      }
      // 3. position protections: trailing and break-even (h.protect), stop, targets
      for (const p of [...acct.positions]) {
        if (!acct.positions.includes(p)) continue;
        const q = Q(p.sym), d = p.side === 'buy' ? 1 : -1, out = d > 0 ? 'sell' : 'buy';
        // closed: stops and targets wait; at the first quote of the session a stop fills there (gap marked), a target
        // at its price or better
        if (!q.open) continue;
        if (h.protect) h.protect(p, q, false);
        if (p.sl != null && (d > 0 ? q.bid <= p.sl : q.ask >= p.sl)) {
          doClose(p.id, 1, slWhy(p), { exec: execFill(acct, { sym: p.sym, side: out, kind: 'stop', ref: p.sl }), refKind: 'stop price', leg: 'SL' });
          continue;
        }
        if (p.tps) {
          let hit = false;
          while (acct.positions.includes(p) && p.tps && p.tps.length) {
            const leg = p.tps[0];
            if (!(d > 0 ? q.bid >= leg.price : q.ask <= leg.price)) break;
            const ex = execFill(acct, { sym: p.sym, side: out, kind: 'limit', ref: leg.price, limit: leg.price });
            if (!ex.ok) break;
            const frac = leg.lots >= p.lots ? 1 : leg.lots / p.lots;
            p.tps.shift(); if (!p.tps.length) delete p.tps; p.tp = p.tps ? p.tps[0].price : null;
            doClose(p.id, frac, tpWhy(p, ex, `Take profit ${leg.leg.slice(2)}`), { exec: ex, refKind: 'take-profit limit', leg: leg.leg });
            hit = true;
          }
          if (hit && acct.positions.includes(p) && h.protect) h.protect(p, q, true);
        } else if (p.tp != null && (d > 0 ? q.bid >= p.tp : q.ask <= p.tp)) {
          const ex = execFill(acct, { sym: p.sym, side: out, kind: 'limit', ref: p.tp, limit: p.tp });
          if (ex.ok) doClose(p.id, 1, tpWhy(p, ex, 'Take profit'), { exec: ex, refKind: 'take-profit limit', leg: 'TP1' });
        }
      }
      // 4. stop-out under 50%: worst first, among the positions whose market is open (a closed one waits for its open)
      let a = summary(acct), guard = 0;
      while (acct.positions.length && a.level < 50 && guard++ < 50) {
        const open = acct.positions.filter(p => M(p.sym) && marketOpen(p.sym)); if (!open.length) break;
        const worst = open.reduce((w, p) => posPnl(p).pnl < posPnl(w).pnl ? p : w);
        emit({ type: 'stopout', pos: worst.id, level: a.level });
        doClose(worst.id, 1, 'Stop-out', { exec: execFill(acct, { sym: worst.sym, side: worst.side === 'buy' ? 'sell' : 'buy', kind: 'market', dev: false }), refKind: 'quote at the stop-out' });
        if (acct.positions.includes(worst)) break;
        a = summary(acct);
      }
      // 5. negative balance protection
      { const e = nbp(acct, t); if (e) emit(e); }
      return out;
    }

    return {
      REJECT, JUR, ESMA_CAP, NFA_MAJORS, TP_MAX, MAX_WORKING, MAX_NOTIONAL_X, EXEC_DEF,
      // math
      pipValue, posPnl, notionalUsd, volOf, lotDec, normLots, lotsFmt, lotsWord, rS, fS, volCheck, volWhy, unitWord, fp, usdFmt,
      jurOf, levCls, sheetLev, jurCap, effLev, tradeStatus, unavailable, unavailableWhy, isAvailable, closeOnly, marketCheck, marketWhy, marketOpen,
      okIm, imAtEntry, posMargin, summary, orderCaps, execCfg, execFill, commOf, newFill,
      swapPerNight, nyDow, tripleDow, rolloverNights, nextRollover, nextTriple, rollover, srvNight, costModel,
      buildTps, beSpec, trimTps, syncTps, trailNext, beLevel, tpWhy, slWhy, netBook, netAgg, netMerge, why,
      // operations
      openMarket, close, place, cancel, endOrder, modify, onTick, nbp, dayEnd, render, rej
    };
  }
  return { create, seeded, trailNext, beLevel, REJECT, JUR, EXEC_DEF, render };
})();
