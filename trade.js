'use strict';
/* tradeBerry — account math and trading. Classic script sharing globals with app.js; loaded right after it.
   v15 (.mace/design/catalog.md §4, contract C3): every number of the account comes from the instrument sheet
   (Engine.META[sym].p, profile Default): leverage, volumes, sessions, trade status, minimum pending distance, maximum
   deviation, swap and commission. A jurisdiction (S.set.jur) is an optional cap on top of it, none by default. */
/* ============ account math ============ */
/* Money on any instrument goes through its contract size (M(sym).size: 100,000 units of the base currency per FX
   lot, 50 per point on US.500, 1 share on a stock, …) and is paid in its quote currency. pip is the displayed unit:
   a pip on FX, the platform's point otherwise. */
const pipValue = (sym, lots = 1) => lots * M(sym).size * M(sym).pip * Engine.usd(M(sym).quote);
function posPnl(p) {
  const q = Engine.quote(p.sym), m = M(p.sym), d = p.side === 'buy' ? 1 : -1;
  const exit = d > 0 ? q.bid : q.ask;
  return { exit, pips: (exit - p.entry) * d / m.pip, pnl: (exit - p.entry) * d * p.lots * m.size * Engine.usd(m.quote) + (p.swap || 0) };
}
// the displayed unit in words: 'pips' on FX, 'pt' (points) otherwise; one: 'pip' / 'pt'
const unitWord = (sym, one = false) => M(sym) && M(sym).unit === 'pt' ? 'pt' : one ? 'pip' : 'pips';
// one lot in words: '1 lot = 100,000 EUR', '1 lot = 100 Ounces', '1 lot = $50 per point', '1 share'. Where the platform's
// point (pt, the unit of stops and targets) is a fraction of the price (0.01 on BCH/EUR, 0.1 on DE.30), "per point"
// would read as per pt: the text then says what a whole move and one pt are worth, '1 lot = €1 per 1.00 move · 1 pt
// (0.01) = €0.01'
const CCY_SIGN = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const CLS_LABEL = { 'fx-major': 'major pair', 'fx-minor': 'minor pair', gold: 'gold', 'index-major': 'major index', 'index-minor': 'minor index', commodity: 'commodity', crypto: 'crypto', equity: 'equity' };
function contractText(sym) {
  const m = M(sym);
  if (m.kind !== 'cfd') return `1 lot = ${nf0.format(m.size)} ${m.base}`;
  if (m.lotName === 'shares') return m.size === 1 ? '1 share' : `1 lot = ${nf0.format(m.size)} shares`;
  if (m.sizeUnit === 'point') return m.pip === 1 ? `1 lot = ${CCY_SIGN[m.quote] || m.quote + ' '}${nf0.format(m.size)} per point`
    : `1 lot = ${CCY_SIGN[m.quote] || m.quote + ' '}${nf0.format(m.size)} per ${(1).toFixed(m.digits)} move · ${ptWorth(sym)}`;
  return `1 lot = ${nf0.format(m.size)} ${m.sizeUnit || 'units'}`;
}
// what one pt (the unit of stops and targets) moves, and what it is worth for a size, in the quote currency: '1 pt (0.01) = €0.01'
function ptWorth(sym, lots = 1) {
  const m = M(sym), v = lots * m.size * m.pip, s = CCY_SIGN[m.quote] || m.quote + ' ';
  return `1 pt (${m.pip.toFixed(m.digits)}) = ${s}${smallMoney(v)}`;
}
// an amount that may be a fraction of a cent: two decimals from one cent up, else its first significant figures
const smallMoney = v => (Math.abs(v) >= .01 || v === 0 ? nf2.format(v) : String(+v.toPrecision(2)));
// USD notional: FX = lots × size units of the base currency in USD; otherwise lots × size × bid in the quote currency
const notionalUsd = (sym, lots) => { const m = M(sym); return m.kind === 'cfd' ? lots * m.size * Engine.mid(sym) * Engine.usd(m.quote) : lots * m.size * Engine.usd(m.base); };

/* ---------- volumes (sheet vol: [min, max, step]) ---------- */
const volOf = sym => M(sym).p.vol;
const lotDec = sym => { const s = volOf(sym)[2]; return s >= 1 ? 0 : Math.min(8, Math.max(0, Math.ceil(-Math.log10(s) - 1e-9))); };
// a size rounded to the sheet's step (0.01 lots on FX, 1 share, 100 XRP lots); nothing is clamped here
function normLots(sym, v) {
  const m = M(sym); if (!m || !finite(+v)) return NaN;
  const st = m.p.vol[2]; return +(Math.round(+v / st + 1e-9) * st).toFixed(lotDec(sym));
}
const lotsFmt = (sym, lots) => (+lots).toFixed(lotDec(sym));
// '1 share' / '2 shares' / '0.01 lots' / '400 lots'
const lotsWord = (sym, lots) => { const n = Number.isInteger(+lots) ? nf0.format(lots) : lotsFmt(sym, lots), u = M(sym).lotName === 'shares' ? 'share' : 'lot'; return `${n} ${u}${+lots === 1 ? '' : 's'}`; };
// '' or why a size is outside the sheet's min/max
function volWhy(sym, lots) {
  const [mn, mx] = volOf(sym);
  if (!(lots >= mn - 1e-9)) return `Minimum size is ${lotsWord(sym, mn)}`;
  if (lots > mx + 1e-9) return `Maximum size is ${lotsWord(sym, mx)} per order`;
  return '';
}

/* ---------- leverage: min(sheet [or the user's choice, up to the sheet maximum], jurisdiction cap) ----------
   S.set.lev: null = the sheet default (p.lev[0]); a number = the user's choice, capped at the sheet maximum (p.lev[1]).
   S.set.jur: an optional retail cap per margin class. ESMA Annex I (EU, and the UK and AU rules modelled on it) 30:1
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
  au: { name: 'AU retail', opt: 'AU · ASIC', cap: { ...ESMA_CAP }, note: 'AU retail uses the ESMA index list in this simulation.' },
  us: { name: 'US retail', opt: 'US · NFA', cap: { 'fx-major': 50, 'fx-minor': 20, ...NO_CFD }, majors: NFA_MAJORS, majorsName: 'NFA major currencies', why: { cfd: 'US retail: no CFDs' } }
};
// states saved before v15 may still say 'pro' or 'sim': both read as no cap with the leverage kept as the choice
// (hidden from Object.keys, so no list offers them)
for (const k of ['pro', 'sim']) Object.defineProperty(JUR, k, { value: JUR.none, enumerable: false });
const JUR_KEYS = Object.keys(JUR);
const LEV_CHOICES = SET_ENUM.lev, LEV_MAX = Math.max(...Engine.INSTR.map(m => m.p.lev[1]));
// kept for modules that still read the v14 names: no class ceiling any more (the sheet maximum is the ceiling)
const CHOICE_CEIL = {}, CHOICE_CEIL_LABEL = 'the instrument sheet maximum';
const jurOf = set => JUR[set && set.jur] || JUR.none;
// margin class under a jurisdiction: for a pair, the regime's own major list if it has one, else the sheet class
const levCls = (sym, j = jurOf(S.set)) => { const m = M(sym); return m.kind !== 'cfd' && j.majors ? (j.majors.has(m.base) && j.majors.has(m.quote) ? 'fx-major' : 'fx-minor') : m.cls; };
// the sheet's leverage for the user's choice: the default, or the choice up to the maximum
const sheetLev = (sym, set = S.set) => { const [def, max] = M(sym).p.lev, c = set && set.lev; return c > 0 ? Math.min(c, max) : def; };
// the jurisdiction's cap on the instrument (Infinity: none); a class not offered keeps the ESMA cap as its margin
const jurCap = (sym, set = S.set) => { const j = jurOf(set); if (j.none) return Infinity; const c = levCls(sym, j); return j.cap[c] ?? ESMA_CAP[c] ?? Infinity; };
const effLev = (sym, set = S.set) => Math.min(sheetLev(sym, set), jurCap(sym, set));
// the jurisdiction cuts the sheet's leverage on this instrument (watchlist badge)
const capBinds = (sym, set = S.set) => jurCap(sym, set) < sheetLev(sym, set);

/* ---------- trade status and sessions ----------
   tradeStatus(sym) → 'off' (not offered: unknown, the jurisdiction does not offer its class, or a replay that does
   not cover it), 'close' (CLOSE ONLY on the sheet: reductions and closes only) or 'full'. Sessions are separate: a
   'full' instrument still trades only while its market is open. profile: a set ({jur, lev}), a key ('uk', 'none:200')
   or nothing (S.set). */
const setOf = profile => profile == null ? S.set : typeof profile === 'string' ? { ...S.set, ...(parseLevKey(profile) || {}) } : profile;
const replayOff = sym => Engine.isReplayDoc && !Engine.PAIRS.some(p => p.sym === sym);
function tradeStatus(sym, profile) {
  const m = M(sym); if (!m) return 'off';
  const j = jurOf(setOf(profile));
  if (replayOff(sym) || (!j.none && j.cap[levCls(sym, j)] === null)) return 'off';
  return m.p.status === 'close' ? 'close' : 'full';
}
function unavailableWhy(sym, profile) {
  const m = M(sym); if (!m) return 'Unknown instrument';
  if (replayOff(sym)) return `${m.short} is not offered in a replay (replays cover the 16 G8 FX pairs)`;
  const st = tradeStatus(sym, profile);
  if (st === 'close') return `${m.short} is close only — new positions and orders are not accepted`;
  if (st === 'off') return `${m.short} is not offered under ${jurOf(setOf(profile)).name}`;
  return '';
}
// the same text with the rule behind it, for tooltips and the order log
function unavailableNote(sym, profile) {
  const w = unavailableWhy(sym, profile), j = jurOf(setOf(profile)), m = M(sym);
  const r = w && m && tradeStatus(sym, profile) === 'off' && j.why ? j.why[m.cls] || (m.kind === 'cfd' ? j.why.cfd : '') : '';
  return r ? `${w} (${r})` : w;
}
const isAvailable = (sym, profile) => tradeStatus(sym, profile) === 'full';
const instrAvail = (sym, set = S.set) => isAvailable(sym, set);
const instrumentsFor = profile => Engine.INSTR.filter(m => isAvailable(m.sym, profile));
// close only: CLOSE ONLY on the sheet, or not offered with a position still open on it (reduce and close, add nothing)
const closeOnly = sym => !!M(sym) && (tradeStatus(sym) === 'close' || (!isAvailable(sym) && S.positions.some(p => p.sym === sym)));
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hm2 = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
// 'opens Mon 15:35 (local) / 13:35 UTC' (local = the browser's time zone), '' when open or no opening is known
function opensText(sym, t = Engine.simTime) {
  const s = Engine.session(sym, t); if (!s || s.open || !s.opensAt) return '';
  const d = new Date(s.opensAt * 1000), sameDay = d.getDay() === d.getUTCDay();
  return `opens ${DOW3[d.getDay()]} ${hm2(d.getHours(), d.getMinutes())} (local) / ${sameDay ? '' : DOW3[d.getUTCDay()] + ' '}${hm2(d.getUTCHours(), d.getUTCMinutes())} UTC`;
}
// '' while the instrument quotes; else why it cannot be traded now ('Market closed — opens …', 'Off quotes — …')
function marketWhy(sym) {
  const q = Engine.quote(sym); if (!q || q.open) return '';
  if (q.why === 'off quotes') return 'Off quotes — no fresh price from the feed';
  if (q.why === 'no feed') return 'No live prices — the broker platform is not answering';
  const o = opensText(sym); return 'Market closed' + (o ? ' — ' + o : '');
}
const marketOpen = sym => { const q = Engine.quote(sym); return !!q && q.open; };

// what a jurisdiction does to the instruments in this set, in words
function capText(j) {
  if (j.none) return 'no cap: each instrument at its sheet leverage';
  const minor = Engine.FX.some(p => levCls(p.sym, j) === 'fx-minor');
  const fx = minor ? `1:${j.cap['fx-major']} on pairs of ${j.majorsName || 'major currencies'}, 1:${j.cap['fx-minor']} on other pairs` : `1:${j.cap['fx-major']} on every pair`;
  if (j.cap.gold == null) return `${fx}; CFDs not offered to retail`;
  return `${fx}; CFDs: 1:${j.cap.gold} gold and major indices, 1:${j.cap.commodity} other commodities and minor indices, 1:${j.cap.equity} stocks, ` + (j.cap.crypto == null ? 'crypto not offered to retail' : `1:${j.cap.crypto} crypto`);
}
/* Initial margin (decision 35, ESMA Q&A 5.8): fixed per position when it opens (p.im = notional at the fill / the
   effective leverage, the figure the margin check used), scaled on a partial close, rescaled by a leverage profile
   change; used margin, margin level and the stop-out read Σ im. A position saved without im is margined at its entry
   price (once, then kept). An order or a bare {sym, lots} (no entry) is margined at the current price (decision 13). */
const MARGIN_TEXT = 'Used margin is the initial margin of each position, fixed when it opens (notional at the fill ÷ leverage) and scaled when part of it is closed; it does not follow the price. A position saved before v15 uses its entry price. Margin level and the 50% stop-out are measured on it. A leverage or jurisdiction change rescales it.';
const okIm = v => typeof v === 'number' && isFinite(v) && v > 0 && v <= MONEY_MAX;
const imAtEntry = (p, set) => { const m = M(p.sym); return p.lots * m.size * p.entry * Engine.usd(m.quote) / effLev(p.sym, set); };
function posMargin(p, set) {
  if (okIm(p.im)) return set ? p.im * effLev(p.sym) / effLev(p.sym, set) : p.im;
  if (isFinite(p.entry) && p.entry > 0) return imAtEntry(p, set);
  return notionalUsd(p.sym, p.lots) / effLev(p.sym, set);
}
const levText = (set = S.set) => set.lev > 0 ? '1:' + set.lev : 'Sheet default';
const levKey = (set = S.set) => `${JUR[set.jur] ? set.jur : 'none'}:${set.lev > 0 ? set.lev : 'default'}`;
/* A profile key: a jurisdiction ('none', 'eu', …), a leverage ('default', '200'), or both ('eu:default', 'none:200';
   the v14 'pro:200' / 'sim:200' read as 'none:200'). → the fields it sets, or null. */
function parseLevKey(v) {
  const s = String(v), [a, b] = s.includes(':') ? s.split(':') : [s, undefined], out = {};
  const lev = x => x === 'default' || x === 'null' ? null : LEV_CHOICES.includes(+x) ? +x : undefined;
  if (b === undefined) {
    if (Object.prototype.hasOwnProperty.call(JUR, a)) out.jur = JUR[a] === JUR.none ? 'none' : a;
    else { const l = lev(a); if (l === undefined) return null; out.lev = l; }
    return out;
  }
  if (!Object.prototype.hasOwnProperty.call(JUR, a)) return null;
  const l = lev(b); if (l === undefined) return null;
  return { jur: JUR[a] === JUR.none ? 'none' : a, lev: l };
}
// #levSel (status bar) = the leverage choice; #jurSel (Settings, built here) = the optional cap
function buildLevSel() {
  const sel = $('#levSel');
  if (sel) sel.innerHTML = `<option value="default">Sheet default</option>` + LEV_CHOICES.map(l => `<option value="${l}">1:${l}</option>`).join('');
  buildJurSel(); syncLevSel();
  // the margin convention, on the figures that show it (status bar Used margin, header Margin level)
  for (const id of ['mMargin', 'mLevel']) { const el = $('#' + id), box = el && el.closest('.m'); if (box) box.title = MARGIN_TEXT; }
}
function buildJurSel() {
  if ($('#jurSel')) return;
  const box = $('#help .help-set'); if (!box) return;
  const lb = document.createElement('label'); lb.className = 'set-row';
  lb.innerHTML = `<span><b>Jurisdiction cap</b><small class="muted">Optional regulatory leverage cap on top of the instrument sheet: ESMA Annex I for EU, UK (no crypto) and AU; NFA for the US (no CFDs). None: every instrument at its sheet leverage.</small></span>`
    + `<select id="jurSel">${JUR_KEYS.map(k => `<option value="${k}">${escHtml(JUR[k].opt)}</option>`).join('')}</select>`;
  box.appendChild(lb);
  const mn = document.createElement('p'); mn.className = 'muted'; mn.id = 'marginNote'; mn.textContent = MARGIN_TEXT;
  box.appendChild(mn);
  $('#jurSel').addEventListener('change', e => requestProfile(e.target.value));
}
function syncLevSel() {
  const sel = $('#levSel'), js = $('#jurSel'), j = jurOf(S.set);
  if (sel) {
    const v = S.set.lev > 0 && LEV_CHOICES.includes(S.set.lev) ? String(S.set.lev) : 'default'; if (sel.value !== v) sel.value = v;
    const t = `Leverage: ${S.set.lev > 0 ? `1:${S.set.lev} where the instrument sheet allows it (never above its maximum)` : 'the instrument sheet default'}; ${j.none ? 'no jurisdiction cap' : `capped by ${j.name} (${capText(j)})`}${j.note ? '. ' + j.note : ''}`;
    if (sel.title !== t) { sel.title = t; const lb = sel.closest('label'); if (lb) lb.title = t; }
  }
  if (js) { const k = JUR[S.set.jur] === JUR.none || !JUR[S.set.jur] ? 'none' : S.set.jur; if (js.value !== k) js.value = k; }
}
// applying a profile cancels at once the pending orders on instruments it does not offer
// Under a retail jurisdiction S.set.lev is set to its major cap, as loadState (app.js) keeps it; that never changes
// effLev, since every class cap of a regime is at or below its major cap.
function applyProfile(key) {
  const v = parseLevKey(key); if (!v) return false;
  const was = S.positions.filter(p => M(p.sym)).map(p => [p, posMargin(p), effLev(p.sym)]);
  Object.assign(S.set, v);
  { const j = jurOf(S.set); if (!j.choice) S.set.lev = j.cap['fx-major']; }
  // the initial margin of open positions follows the new leverage (the preview in requestProfile shows the same)
  for (const [p, im, l0] of was) p.im = im * l0 / effLev(p.sym);
  syncLevSel(); dirty.lines = true; save();
  dropUnavailableOrders();
  return true;
}
/* With open positions, or with pending orders on instruments the new profile does not offer, a change first shows
   what it does: used margin and margin level, the instruments no longer offered, the positions that become close-only
   and the orders that will be cancelled. */
function requestProfile(key) {
  const v = parseLevKey(key); if (!v) { syncLevSel(); return; }
  const set = { ...S.set, ...v }, j = jurOf(set), n = S.positions.length;
  const lost = Engine.INSTR.filter(m => isAvailable(m.sym, S.set) && !isAvailable(m.sym, set)).map(m => m.sym);
  const lp = S.positions.filter(p => lost.includes(p.sym)).length, lo = S.orders.filter(o => lost.includes(o.sym)).length;
  if (!n && !lo) { applyProfile(key); return; }
  const a = account(), mg = S.positions.reduce((s, p) => s + posMargin(p, set), 0), lv = mg ? a.eq / mg * 100 : Infinity;
  const f = x => isFinite(x) ? nf0.format(x) + '%' : '—';
  const names = lost.slice(0, 8).map(s => M(s).short).join(', ') + (lost.length > 8 ? ` and ${lost.length - 8} more` : '');
  const lossTxt = !lp && !lo ? '' : ` Not offered under ${j.name}: ${names}.` +
    (lp ? ` ${lp} open position${lp > 1 ? 's become' : ' becomes'} close-only${lo ? ';' : '.'}` : '') + (lo ? ` ${lo} pending order${lo > 1 ? 's' : ''} will be cancelled.` : '');
  syncLevSel(); // the selects keep showing the active profile until the change is confirmed
  askConfirm({
    title: 'Change leverage?', ok: 'Apply', kind: lv < 50 ? 'sell' : '',
    body: `Leverage ${levText(set)}, ${j.none ? 'no jurisdiction cap' : `${j.name}: ${capText(j)}`}.` +
      (n ? ` With your ${n} open position${n > 1 ? 's' : ''}: used margin ${usdFmt(a.mg)} → ${usdFmt(mg)}, margin level ${f(a.level)} → ${f(lv)}.` +
        (lv < 50 ? ' That is below the 50% stop-out level: positions would be closed at once, worst first.' : lv < 100 ? ' Below 100%: no free margin for new trades.' : '') : '') + lossTxt,
    onOk: () => applyProfile(key)
  });
}
/* Pending orders on an instrument that is not offered (jurisdiction, replay) or close only leave the book (a row in
   the order log, one toast). Runs when a profile is applied and once after every boot or import (loadState). */
function dropUnavailableOrders() {
  const gone = S.orders.filter(o => !isAvailable(o.sym));
  if (!gone.length) return 0;
  const names = [...new Set(gone.map(o => M(o.sym) ? M(o.sym).short : o.sym))].join(', ');
  for (const o of gone) endOrder(o, 'cancelled', unavailableNote(o.sym));
  toast(`Orders cancelled: ${names}`, `${gone.length} pending order${gone.length > 1 ? 's' : ''} on ${names} cancelled: ${unavailableWhy(gone[0].sym)}.`, 'info');
  return gone.length;
}

/* ============ swap (sheet p.swap: [long, short, unit]) ============
   'pts' (FX): points per lot a night, swap × point × size × lots in the quote currency; 'pctYr' (everything else):
   a yearly fraction of the notional, notional × swap / 360 a night (−0.05 = −5% a year, as the broker platform
   shows it). The sign comes from the sheet (negative = the position pays). Rollover at 17:00 New York (00:00 server
   time): FX and everything else Monday to Friday, three nights on the triple day (FX Wednesday, the rest Friday);
   crypto every night, no triple (a simulation convention, labelled). */
const SWAP_LABEL = 'swap from the instrument sheet (Default profile)';
// kept for modules that still read the v14 names: the swap has no policy-rate table and no markup any more
const POLICY_RATES_LABEL = SWAP_LABEL, SWAP_MARKUP = 0, FIN_LABEL = SWAP_LABEL;
const swapUnit = sym => M(sym).p.swap[2];
const isCrypto = sym => M(sym).group === 'crypto';
function swapPerNight(sym, side, lots) {
  const m = M(sym), [l, s, u] = m.p.swap, v = side === 'buy' ? l : s;
  if (!v) return 0;
  return u === 'pts' ? v * m.point * m.size * lots * Engine.usd(m.quote) : notionalUsd(sym, lots) * v / 360;
}
// the same as % a year of the notional (for display)
const swapRate = (sym, side) => { const m = M(sym), [l, s, u] = m.p.swap, v = side === 'buy' ? l : s; if (u !== 'pts') return v * 100; const n = notionalUsd(sym, 1); return n ? swapPerNight(sym, side, 1) * 360 / n * 100 : 0; };
// in words: '−9.217 pts long / −8.771 pts short', '−5.00% / −5.00% a year'
function swapText(sym) {
  const [l, s, u] = M(sym).p.swap;
  return u === 'pts' ? `${nfx(l, 3)} pts long / ${nfx(s, 3)} pts short a night` : `${nfx(l * 100, 2)}% long / ${nfx(s * 100, 2)}% short a year (÷ 360 a night)`;
}
const nyDow = t => new Date((t + Engine.nyOffset(t) * 3600) * 1000).getUTCDay();
// the triple day by New York weekday: 3 FX (Wednesday), 5 the rest (Friday), null crypto (every night, no triple)
const tripleDow = sym => !sym || !M(sym) ? 3 : isCrypto(sym) ? null : M(sym).kind === 'fx' ? 3 : 5;
const TRIPLE_TEXT = sym => tripleDow(sym) == null ? 'every night, no triple (crypto convention)' : `triple on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][tripleDow(sym)]}`;
// nights a position on sym is financed by the rollover at t (no symbol: FX)
function rolloverNights(t, sym) {
  const dow = nyDow(t);
  if (sym && M(sym) && isCrypto(sym)) return 1;
  if (dow < 1 || dow > 5) return 0;
  return dow === tripleDow(sym) ? 3 : 1;
}
// the first rollover strictly after t: any day (no symbol), or one that finances sym (DST switches at 02:00 local, far
// from 17:00, so one offset lookup is exact)
function nextRollover(t, sym) {
  let day = Math.floor((t + Engine.nyOffset(t) * 3600) / 86400);
  for (let i = 0; i < 10; i++, day++) {
    const local = day * 86400 + 17 * 3600, utc = local - Engine.nyOffset(local + 5 * 3600) * 3600;
    if (utc > t && (!sym || rolloverNights(utc, sym) > 0)) return utc;
  }
  return Infinity;
}
function nextTriple(t, sym) {
  if (tripleDow(sym) == null) return Infinity;
  let r = nextRollover(t, sym); for (let i = 0; i < 8 && rolloverNights(r, sym) !== 3; i++) r = nextRollover(r, sym); return r;
}
let rollNext = null;
function rolloverTick() {
  const now = Engine.simTime;
  if (rollNext == null) { rollNext = nextRollover(now); return; }
  for (let guard = 0; now >= rollNext && guard < 40; guard++) {
    let n = 0;
    for (const p of S.positions) { if (!M(p.sym)) continue; const k = rolloverNights(rollNext, p.sym); if (k) { p.swap = (p.swap || 0) + swapPerNight(p.sym, p.side, p.lots) * k; n++; } }
    if (n) save();
    rollNext = nextRollover(rollNext);
  }
}
/* costModel(sym) → the sheet's costs as pure functions (contract C2), for the backtester's 'account' cost mode:
   commRT(lots): commission round turn in USD (the sheet's + the account's extra, as commOf);
   swapNight(side, lots, px, tUtc): the swap in USD booked by the rollover at tUtc (×3 on the triple day, 0 when that
     rollover does not finance the instrument), at price px for a % a year swap;
   spreadAt(tUtc): ask − bid in price units, the Default spread or the Night spread (23:00–01:00 server time, Monday to
     Friday); a crypto jitter counts at its midpoint;
   newsInSpread: false — the News spread is live only (a calendar release), not part of spreadAt.
   Currency conversion uses the rate at the call; nothing else reads the live market. */
const srvNight = t => { const loc = t + Engine.serverOffset(t) * 3600, dow = ((Math.floor(loc / 86400) + 4) % 7 + 7) % 7, mn = Math.floor((((loc % 86400) + 86400) % 86400) / 60); return dow >= 1 && dow <= 5 && (mn >= 1380 || mn < 60); };
function costModel(sym) {
  const m = M(sym); if (!m) return null;
  const p = m.p, usdQ = () => Engine.usd(m.quote);
  const sp = k => (p.spread[k] + (p.jit ? (p.jit[k][0] + p.jit[k][1]) / 2 : 0)) * m.point;
  return {
    commRT: lots => commOf(lots, sym),
    swapNight(side, lots, px, tUtc) {
      const k = rolloverNights(tUtc, sym), [l, s, u] = p.swap, v = side === 'buy' ? l : s;
      if (!k || !v) return 0;
      return k * (u === 'pts' ? v * m.point * m.size * lots * usdQ() : lots * m.size * px * usdQ() * v / 360);
    },
    spreadAt: tUtc => sp(srvNight(tUtc) ? 1 : 0),
    newsInSpread: false
  };
}
function account() {
  let fl = 0, mg = 0;
  for (const p of S.positions) { fl += posPnl(p).pnl; if (!okIm(p.im)) p.im = posMargin(p); mg += p.im; }
  const eq = S.balance + fl;
  return { fl, mg, eq, free: eq - mg, level: mg ? eq / mg * 100 : Infinity };
}

/* ============ trading ============ */
// the last reason openPosition refused a fill, so a pending order that could not be filled can say why
let lastReject = '';
// true while a basket leg opens or closes: the basket tool says it once for all its legs (one summary toast, no beep per leg)
let legQuiet = false;
const legToast = (...a) => { if (!legQuiet) toast(...a); }, legBeep = k => { if (!legQuiet) beep(k); };
// one wording for a stop loss that would sit inside the spread (ticket button, openPosition, placeOrder)
const stopInSpreadWhy = (sym, spread) => `Stop inside the spread (${spread.toFixed(1)} ${unitWord(sym)}) — widen it`;
// last: the order-log wording when it is not 'title (why)'
const reject = (title, why, last) => { lastReject = last ?? `${title.toLowerCase()} (${why})`; legToast(title, why, 'dn'); legBeep('err'); return null; };
// a refusal because the instrument does not quote now (closed, off quotes): the toast names the opening time
const closedReject = (sym, w, b = true) => { const [title] = w.split(' — '); lastReject = w[0].toLowerCase() + w.slice(1); legToast(title, `${M(sym).short}: ${w}.`, 'dn'); if (b) legBeep('err'); return null; };
/* Order-entry limits, checked inside openPosition/placeOrder so every path (ticket, quick trade, DOM ladder,
   chart gestures, command bar, multi-chart) is covered. RISK_CAP blocks the ticket and the command bar. The size per
   order is the sheet's [min, max] (volWhy); MAX_LOTS is only the largest of them (a sanity bound for stored states). */
const MAX_LOTS = Math.max(...Engine.INSTR.map(m => m.p.vol[1])), MAX_NOTIONAL_X = 25, RISK_CAP = 10, RISK_HIGH = 5, DUP_MS = 2000;
function orderCaps(sym, lots) {
  { const w = volWhy(sym, lots); if (w) return w; }
  const notional = notionalUsd(sym, lots), cap = Math.max(0, account().eq) * MAX_NOTIONAL_X;
  if (notional > cap) return `Notional ${usdFmt(notional)} is above the per-order cap of ${MAX_NOTIONAL_X}× equity (${usdFmt(cap)})`;
  return '';
}
// the same symbol, side and size sent twice within DUP_MS (real time) asks before the second one goes through
let lastSent = null;
function isDuplicate(kind, o, lots) {
  if (o.auto || o.basket || o.dupOk) return false;
  const l = lastSent;
  return !!l && l.kind === kind && l.sym === o.sym && l.side === o.side && l.lots === lots && (kind === 'pos' || l.ot === o.ot) && performance.now() - l.t < DUP_MS;
}
const markSent = (kind, o, lots) => { if (!o.auto && !o.basket) lastSent = { kind, sym: o.sym, side: o.side, ot: o.ot, lots, t: performance.now() }; };
// in-page confirmation (Cancel has focus, so a stray Enter does not confirm)
function askConfirm({ title, body, ok, kind = '', onOk }) {
  let el = $('#confirmDlg');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'confirmDlg'; document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-cf]'); if (e.target === el || b) { const go = b && b.dataset.cf === 'ok', f = el._ok; el.hidden = true; el._ok = null; if (go && f) f(); } });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; el._ok = null; } });
  }
  el.innerHTML = `<div class="modal cf-modal" role="alertdialog" aria-modal="true" aria-labelledby="cfT" aria-describedby="cfB">
    <div class="ph"><h2 id="cfT">${escHtml(title)}</h2></div><p class="cf-body" id="cfB">${escHtml(body)}</p>
    <div class="cf-actions"><button class="ghost" data-cf="cancel">Cancel</button><button class="cta sm ${kind}" data-cf="ok">${escHtml(ok)}</button></div></div>`;
  el._ok = onOk; el.hidden = false; el.querySelector('[data-cf=cancel]').focus();
}
function confirmDuplicate(kind, o, lots) {
  const what = `${o.side} ${kind === 'ord' ? o.ot + ' ' : ''}${lotsFmt(o.sym, lots)} ${pretty(o.sym)}`;
  lastReject = 'duplicate order awaiting confirmation';
  askConfirm({ title: 'Send the same order again?', body: `You sent ${what} less than ${DUP_MS / 1000} seconds ago. A second identical order doubles the position.`, ok: `Send again`, kind: o.side,
    onOk: () => { const o2 = { ...o, dupOk: true }; if (kind === 'pos') openPosition(o2); else placeOrder(o2); } });
  return null;
}
/* ============ execution model ============
   Every fill goes through execFill(). While the simulation runs, a fill lands at the quote plus symmetric noise of
   σ = √(slipSd² + σ_lat²) pips, where σ_lat is the pair's own volatility over the simulated latency (latMs × speed).
   The noise has mean zero by construction: a fill is as likely to be in your favour as against you. A paused market
   (speed 0) has firm quotes, and a replay must stay reproducible, so both fill exactly at the quote. Fills are all-or-nothing (no partial fills). A limit
   (pending limit, triggered stop-limit, take profit) never fills worse than its price: when the noise would push it
   through, it keeps working. A stop fills at the quote that crossed it, so a jump through the stop is reported as a
   gap. Commission is per lot, round turn, charged in full at the fill that opens the position; it is off by default (a
   spread-only account) and set under Execution in the ticket. */
const EXEC_DEF = { slip: 'sym', slipSd: .2, latMs: 120, comm: 0 }; // comm: USD per lot round turn (S.set.comm; the backtester's default is 5)
const execCfg = () => { const s = S.set; return { on: s.slip !== 'off', sd: s.slipSd ?? EXEC_DEF.slipSd, lat: s.latMs ?? EXEC_DEF.latMs, comm: s.comm ?? EXEC_DEF.comm }; };
let fillRs = null; // execSeed(n): seeded fill noise (tests); Math.random otherwise
function execSeed(n) { fillRs = n == null ? null : n >>> 0; }
function fillRand() {
  if (fillRs == null) return Math.random();
  fillRs = (fillRs + 0x6D2B79F5) >>> 0; let t = fillRs;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const fillGauss = () => { let u = 0, v = 0; while (!u) u = fillRand(); while (!v) v = fillRand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const volCache = {};
// the pair's volatility in pips per √(simulated second), from its last hour of 1-minute closes (cached 30 s sim)
function vol1s(sym) {
  const c = volCache[sym]; if (c && Math.abs(Engine.simTime - c.t) < 30) return c.v;
  const r = Engine.returns(sym, 60), n = r.length, mu = n ? r.reduce((s, x) => s + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) : 0;
  const v = sd * Engine.mid(sym) / M(sym).pip / Math.sqrt(60);
  volCache[sym] = { v, t: Engine.simTime }; return v;
}
const execModelText = (c = execCfg()) => c.on ? `symmetric (equal odds for and against you), σ ${c.sd} pip plus the market move over ${c.lat} ms of simulated latency; none while the simulation is paused or in a replay; a market fill further than the sheet's maximum deviation from the quote is requoted` : 'off — fills at the quote';
const commText = (c = execCfg()) => c.comm > 0 ? `$${c.comm.toFixed(2)} per lot round turn (simulation extra; the instrument sheet charges none), charged in full when the position opens` : 'none (spread-only account)';
/* Maximum deviation (sheet maxDev, points): a market fill that lands further than that from the quote is not filled
   ('requote', out.ok false). Stops, limits, gaps and the stop-out (dev: false) are never requoted. */
function execFill({ sym, side, kind = 'market', ref = null, limit = null, dev = true }) {
  const q = Engine.quote(sym), m = M(sym), d = side === 'buy' ? 1 : -1, base = d > 0 ? q.ask : q.bid, c = execCfg();
  const live = c.on && Engine.speed > 0 && (Engine.mode || 'live') === 'live'; // a replay stays reproducible: fills at the quote
  const lat = live ? c.lat * (.5 + fillRand()) : 0;
  const sdLat = live ? vol1s(sym) * Math.sqrt(lat / 1000 * Engine.speed) : 0;
  const eps = live ? fillGauss() * Math.sqrt(sdLat ** 2 + c.sd ** 2) : 0; // pips, positive = against the trader
  const px = base + d * eps * m.pip, want = ref ?? base;
  const out = { ok: true, px, base, ref: want, kind, bid: q.bid, ask: q.ask, spread: q.spread, lat: Math.round(lat), slip: (px - want) * d / m.pip,
    gap: kind !== 'market' && Math.abs(base - want) > 2 * m.pip, model: { on: c.on, sd: c.sd, lat: c.lat, live } };
  if (kind === 'limit' && d * (px - limit) > 1e-12) { out.ok = false; out.why = 'not reached'; }
  if (kind === 'market' && dev) { const pts = Math.abs(px - base) / m.point; if (pts > m.p.maxDev + 1e-9) { out.ok = false; out.why = 'requote'; out.devPts = pts; } }
  return out;
}
// commission per lot round turn: the sheet's (0 on every instrument of the Default profile) + the simulation's extra
const commOf = (lots, sym) => ((sym && M(sym) ? M(sym).p.comm : 0) + execCfg().comm) * lots;
const requoteReject = (sym, ex) => { const n = Math.round(ex.devPts); lastReject = `requote — price moved ${n} pts`; legToast('Requote', `${M(sym).short}: the price moved ${n} pts from the quote (maximum deviation ${M(sym).p.maxDev} pts) — not filled. Send again at the new price.`, 'dn'); legBeep('err'); return null; };
const slipWords = (slip, sym) => Math.abs(slip) < .05 ? 'none' : `${Math.abs(slip).toFixed(1)} ${unitWord(sym, true)} ${slip > 0 ? 'against you' : 'in your favour'}`;

/* Fill receipts (S.fills, newest first, at most 500) and the order log (S.ordLog: orders that left the book, with
   why, at most 300). Fill ids have their own counter (S.nextFill) and do not use S.nextId. */
const FILL_MAX = 500, LOG_MAX = 300;
let lastFill = null;
function recordFill(ex, x) {
  if (!Array.isArray(S.fills)) S.fills = [];
  if (!(Number.isInteger(S.nextFill) && S.nextFill > 0)) S.nextFill = 1 + S.fills.reduce((mx, f) => Math.max(mx, f.fid | 0), 0);
  const f = { fid: S.nextFill++, t: Engine.simTime, sym: x.sym, side: x.side, lots: x.lots, pos: x.pos, order: x.order ?? null, kind: x.kind, reason: x.reason,
    bid: ex.bid, ask: ex.ask, ref: ex.ref, refKind: x.refKind, px: ex.px, slip: ex.slip, slipUsd: ex.slip * pipValue(x.sym, x.lots), spread: ex.spread,
    spreadUsd: ex.spread * pipValue(x.sym, x.lots), lat: ex.lat, comm: x.comm || 0, gap: ex.gap, model: ex.model };
  S.fills.unshift(f); if (S.fills.length > FILL_MAX) S.fills.length = FILL_MAX;
  lastFill = f;
  return f;
}
const ordType = o => o.limit != null ? 'stop-limit' : o.ot;
const tifText = o => o.tif === 'GTC' || !o.tif ? 'GTC' : `${o.tif} until ${dts(o.expires)} UTC`;
function endOrder(o, status, why) {
  const i = S.orders.indexOf(o); if (i >= 0) S.orders.splice(i, 1);
  if (!Array.isArray(S.ordLog)) S.ordLog = [];
  S.ordLog.unshift({ ...o, status, end: Engine.simTime, why }); if (S.ordLog.length > LOG_MAX) S.ordLog.length = LOG_MAX;
  changed('ord');
}

/* ============ order model (hybrid) ============
   Protections live on the position: one stop loss (sl, optionally trailing or moved to break-even once) and up to 4
   take profits (tp alone, or tps legs that each close part of the position; p.tp always shows the nearest). Entry
   orders in the book can be limit, stop or stop-limit (a stop with a limit price), good till cancelled, DAY or GTD
   (simulation UTC), and two or more can form an OCO group: the first to fill (or to trigger, for a stop-limit) cancels
   the others. Their exits are offsets from the fill (slPips, tpPips or tps rows, trail, be). */
const TP_MAX = 4, MAX_WORKING = 200;
const r2 = v => Math.round(v * 100) / 100;
// sizes on the instrument's step: round (rS), round down (fS)
const rS = (sym, v) => normLots(sym, v), fS = (sym, v) => { const st = volOf(sym)[2]; return +(Math.floor(v / st + 1e-6) * st).toFixed(lotDec(sym)); };
// one trailing rule for live stops and the Exit lab: the stop follows px (the best price so far) at dist, never loosened
const trailNext = (d, stop, px, dist) => stop == null ? px - d * dist : d > 0 ? Math.max(stop, px - dist) : Math.min(stop, px + dist);
/* targets from {pips, pct} rows (or absolute {price, lots}). Lots per leg round down to the sheet's step and the last
   leg takes the remainder, so the legs never cover more than the position; the share left over (Σpct < 100) runs on
   the stop. */
function buildTps(sym, side, entry, lots, rows) {
  const m = M(sym), d = side === 'buy' ? 1 : -1;
  if (!Array.isArray(rows) || !rows.length) return { tps: null };
  if (rows.length > TP_MAX) return { err: `At most ${TP_MAX} targets` };
  let legs;
  if (rows.every(x => x && x.price > 0 && x.lots > 0)) legs = rows.map(x => ({ price: +x.price, lots: rS(sym, x.lots) }));
  else {
    if (!rows.every(x => x && x.pips > 0 && x.pct > 0 && x.pct <= 100)) return { err: 'Each target needs pips above 0 and a share between 0 and 100%' };
    const tot = rows.reduce((s, x) => s + +x.pct, 0); if (tot > 100 + 1e-9) return { err: `Targets add up to ${Math.round(tot)}% — max 100%` };
    legs = [...rows].sort((a, b) => a.pips - b.pips).map(x => ({ price: entry + d * x.pips * m.pip, lots: fS(sym, lots * x.pct / 100) }));
    legs[legs.length - 1].lots = rS(sym, fS(sym, lots * tot / 100) - legs.slice(0, -1).reduce((s, x) => s + x.lots, 0));
  }
  legs.sort((a, b) => d * (a.price - b.price));
  const mn = volOf(sym)[0];
  for (let i = 0; i < legs.length; i++) {
    if (!(legs[i].lots >= mn - 1e-9)) return { err: `TP${i + 1} is below the ${lotsFmt(sym, mn)}-${m.lotName === 'shares' ? 'share' : 'lot'} minimum` };
    if (i && Math.abs(legs[i].price - legs[i - 1].price) < m.pip / 100) return { err: 'Two targets at the same price' };
  }
  if (legs.reduce((s, x) => s + x.lots, 0) > lots + 1e-9) return { err: 'Targets cover more than the position' };
  legs.forEach((x, i) => { x.leg = 'TP' + (i + 1); });
  return { tps: legs };
}
// break-even: after `at` pips in profit and/or after the first target fills, the stop moves to entry + off pips (once)
function beSpec(b, spread, sym) {
  if (!b || typeof b !== 'object') return { be: null };
  const at = b.at == null || b.at === '' ? null : +b.at, off = +b.off || 0;
  if (at != null && !(at > spread)) return { err: `Break-even trigger must exceed the spread (${spread.toFixed(1)} ${unitWord(sym)})` };
  if (at == null && !b.onTp) return { be: null };
  return { be: { at, off, onTp: !!b.onTp, done: false } };
}
// after a partial close the targets are cut back to the remaining size, nearest first (a manual close is a target taken early)
function trimTps(p) {
  if (!p.tps) return;
  const rs = v => M(p.sym) ? rS(p.sym, v) : r2(v), mn = M(p.sym) ? volOf(p.sym)[0] : .01;
  let over = rs(p.tps.reduce((s, x) => s + x.lots, 0) - p.lots);
  for (const x of p.tps) { if (over <= 0) break; const cut = Math.min(x.lots, over); x.lots = rs(x.lots - cut); over = rs(over - cut); }
  p.tps = p.tps.filter(x => x.lots >= mn - 1e-9);
  if (!p.tps.length) { delete p.tps; p.tp = null; } else p.tp = p.tps[0].price;
}
// p.tp is edited in place by the dock and the chart: the nearest leg follows it (cleared: that leg is removed)
function syncTps(p) {
  if (!p.tps || !p.tps.length || p.tp === p.tps[0].price) return;
  const d = p.side === 'buy' ? 1 : -1;
  if (p.tp == null) p.tps.shift(); else { p.tps[0].price = p.tp; p.tps.sort((a, b) => d * (a.price - b.price)); }
  if (!p.tps.length) { delete p.tps; p.tp = null; } else p.tp = p.tps[0].price;
}
// a target set on the losing side of the entry (the price had moved against the position) is a limit, not a profit
const tpWhy = (p, ex, name) => (p.side === 'buy' ? ex.px < p.entry : ex.px > p.entry) ? `${name} · limit at a loss` : name; // keeps 'Take profit' so behav.js still sees an automatic exit
const slWhy = p => p.trail && p.trailed ? 'Trailing stop' : p.beSl != null && p.sl === p.beSl ? 'Stop loss (break-even)' : 'Stop loss';

/* openPosition(o) → position | null, synchronously (behav.js and pwa.js wrap it). o: {sym, side, lots, sl?, tp? (prices),
   slPips?, tpPips? (pips from the fill), tps? (rows), be?, trail?, exec? (a fill from the book), src?, reason?, basket?
   (a basket leg: no toast or beep of its own, refusals included; lastReject still says why)}. */
function openPosition(o) { const q0 = legQuiet; legQuiet = !!(o && o.basket); try { return openPos(o); } finally { legQuiet = q0; } }
function openPos(o) {
  lastReject = '';
  if (!M(o.sym)) return reject('Order rejected', 'Unknown instrument');
  // not offered under the profile, or close only: no new exposure; closes do not come through here
  { const why = unavailableWhy(o.sym); if (why) return reject('Order rejected', why); }
  // outside its session (or off quotes): nothing fills
  { const w = marketWhy(o.sym); if (w) return closedReject(o.sym, w); }
  const sym = o.sym, m = M(sym), q = Engine.quote(sym), d = o.side === 'buy' ? 1 : -1;
  const lots = normLots(sym, o.lots);
  if (!(lots >= volOf(sym)[0] - 1e-9)) return reject('Order rejected', volWhy(sym, lots || 0));
  const cap = orderCaps(sym, lots); if (cap) return reject('Order blocked', cap);
  const req = notionalUsd(sym, lots) / effLev(sym), a = account();
  if (req > a.free) return reject('Insufficient margin', `Needs ${usdFmt(req)} · free ${usdFmt(a.free)}`);
  const ex = o.exec || execFill({ sym, side: o.side, kind: 'market' }), entry = ex.px;
  if (!ex.ok) return ex.why === 'requote' ? requoteReject(sym, ex) : reject('Order rejected', 'not filled');
  let sl = o.sl ?? (o.slPips > 0 ? entry - d * o.slPips * m.pip : null), tp = o.tp ?? (o.tpPips > 0 ? entry + d * o.tpPips * m.pip : null);
  const trail = Math.max(0, +o.trail || 0);
  // a stop between the entry and the other side of the quote is not the wrong side: it sits inside the spread
  if (sl != null && (d > 0 ? sl >= q.bid : sl <= q.ask)) return reject('Order rejected', (d > 0 ? sl < entry : sl > entry) ? stopInSpreadWhy(sym, q.spread) : 'Stop loss is on the wrong side of price');
  // a trailing stop without a stop loss protects at once: the stop starts at entry ∓ trail and follows the price
  let trailNow = false;
  if (trail > 0 && sl == null) {
    sl = trailNext(d, null, entry, trail * m.pip); trailNow = true;
    if (d > 0 ? sl >= q.bid : sl <= q.ask) return reject('Order rejected', `Trailing stop must be wider than the spread (${q.spread.toFixed(1)} ${unitWord(sym)})`);
  }
  let tps = null;
  if (o.tps) { const b = buildTps(sym, o.side, entry, lots, o.tps); if (b.err) return reject('Order rejected', b.err); tps = b.tps; }
  if (tps && tps.length === 1 && tps[0].lots >= lots) { tp = tps[0].price; tps = null; }
  if (tps) tp = tps[0].price;
  if (tp != null && (d > 0 ? tp <= q.bid : tp >= q.ask)) return reject('Order rejected', 'Take profit is on the wrong side of price');
  const bs = beSpec(o.be, q.spread, sym); if (bs.err) return reject('Order rejected', bs.err);
  if (isDuplicate('pos', o, lots)) return confirmDuplicate('pos', o, lots);
  markSent('pos', o, lots);
  const comm = commOf(lots, sym);
  const p = { id: S.nextId++, sym, side: o.side, lots, entry, sl, tp, trail, swap: 0, comm, im: req, open: Engine.simTime, risk: sl != null ? Math.abs(entry - sl) * lots * m.size * Engine.usd(m.quote) : null, src: o.src ?? null };
  if (trailNow) { p.trailNow = true; p.trailSl = sl; }
  if (tps) p.tps = tps;
  if (bs.be) p.be = bs.be;
  S.balance -= comm;
  S.positions.push(p);
  p.fills = [recordFill(ex, { sym, side: o.side, lots, pos: p.id, order: o.src, kind: 'open', reason: o.reason || 'Market order', refKind: o.refKind || 'quote at the click', comm }).fid];
  changed('pos');
  legToast(`${o.side === 'buy' ? 'Bought' : 'Sold'} ${lotsFmt(sym, lots)} ${pretty(sym)}`, `@ ${fp(sym, entry)}${sl != null ? (trailNow ? ' · trailing SL ' : ' · SL ') + fp(sym, sl) : ''}${tp != null ? ' · TP ' + fp(sym, tp) + (tps ? ` (${tps.length} targets)` : '') : ''}${Math.abs(ex.slip) >= .1 ? ' · slip ' + slipWords(ex.slip, sym) : ''}`, d > 0 ? 'up' : 'dn');
  legBeep('fill');
  return p;
}
// exit context for the next closePosition call: the wrappers in behav.js, pwa.js and persist.js pass three arguments only
let exitCtx = null;
function closeVia(id, reason, frac, ctx) { exitCtx = ctx; try { closePosition(id, reason, frac); } finally { exitCtx = null; } }
/* closePosition(id, reason, frac): a close or a reduction, also on a close-only instrument. Refused while the market
   is closed (or off quotes) and on a requote; the stop-out passes its own fill (never requoted). Partial sizes go on
   the sheet's step; what would be left under the minimum size is closed with the rest. A basket leg closed by the basket
   tool (closeVia with ctx.basket) has no toast or beep of its own, the "Market closed" refusal included: the tool sums
   them up. A leg closed by hand or by its own stop still says so. */
function closePosition(id, reason, frac) { const p = S.positions.find(x => x.id === id), q0 = legQuiet; legQuiet = !!(p && p.bgid && exitCtx && exitCtx.basket); try { return closePos(id, reason, frac); } finally { legQuiet = q0; } }
function closePos(id, reason = 'Manual', frac = 1) {
  const ctx = exitCtx; exitCtx = null;
  const i = S.positions.findIndex(p => p.id === id); if (i < 0) return;
  const p = S.positions[i], m = M(p.sym), d = p.side === 'buy' ? 1 : -1;
  lastReject = '';
  { const w = marketWhy(p.sym); if (w) { closedReject(p.sym, w); return; } }
  const mn = volOf(p.sym)[0];
  let lots = frac >= 1 ? p.lots : Math.max(mn, normLots(p.sym, p.lots * frac));
  if (lots >= p.lots - 1e-9 || p.lots - lots < mn - 1e-9) lots = p.lots;
  const ex = ctx?.exec || execFill({ sym: p.sym, side: d > 0 ? 'sell' : 'buy', kind: 'market' });
  if (!ex.ok) { if (ex.why === 'requote') requoteReject(p.sym, ex); return; }
  const exit = ex.px, pips = (exit - p.entry) * d / m.pip;
  const swap = (p.swap || 0) * lots / p.lots, pnl = (exit - p.entry) * d * lots * m.size * Engine.usd(m.quote) + swap, comm = (p.comm || 0) * lots / p.lots;
  S.balance += pnl;
  const riskPart = p.risk ? p.risk * lots / p.lots : null, full = lots === p.lots;
  if (full && frac < 1 && reason === 'Partial close') reason = 'Close'; // ½ of the minimum lot is the whole position
  const f = recordFill(ex, { sym: p.sym, side: d > 0 ? 'sell' : 'buy', lots, pos: p.id, order: null, kind: full ? 'close' : 'reduce', reason, refKind: ctx?.refKind || 'quote at the click', comm: 0 });
  S.history.unshift({ id: p.id, sym: p.sym, side: p.side, lots, entry: p.entry, exit, open: p.open, close: Engine.simTime, pnl, pips, r: riskPart ? pnl / riskPart : null, reason, note: '', setup: '', swap,
    leg: ctx?.leg ?? null, comm, slip: ex.slip, gap: ex.gap, fills: [...(p.fills || []).slice(0, 1), f.fid] });
  if (S.history.length > 500) S.history.pop();
  if (full) S.positions.splice(i, 1);
  else { const l0 = p.lots; p.lots = normLots(p.sym, p.lots - lots); if (p.risk) p.risk -= riskPart; if (p.swap) p.swap -= swap; if (p.comm) p.comm -= comm; if (okIm(p.im)) p.im *= p.lots / l0; trimTps(p); }
  changed('pos', 'hist');
  legToast(`${reason}: ${pretty(p.sym)} ${lotsFmt(p.sym, lots)}`, `${usdFmt(pnl, true)} · ${sgn(pips)} ${unitWord(p.sym)}${Math.abs(ex.slip) >= .1 ? ' · slip ' + slipWords(ex.slip, p.sym) : ''}${ex.gap ? ' · gap' : ''}`, pnl >= 0 ? 'up' : 'dn');
  legBeep(pnl >= 0 ? 'win' : 'loss');
}
const dayEnd = t => (Math.floor(t / 86400) + 1) * 86400;
/* placeOrder(o) → order | null. o: {sym, side, ot: 'limit'|'stop', price, limit? (stop-limit), lots, slPips, tpPips, tps?,
   be?, trail, tif?: 'GTC'|'DAY'|'GTD', expires? (sim seconds, GTD), oca? (an order id or 'o<id>' group to join)}.
   Margin is not checked here: it is checked at the fill, and the ticket warns. */
function placeOrder(o) {
  lastReject = '';
  const no = (title, why, b = true) => { lastReject = `${title.toLowerCase()} (${why})`; toast(title, why, 'dn'); if (b) beep('err'); return null; };
  if (!M(o.sym)) return no('Order rejected', 'Unknown instrument');
  { const why = unavailableWhy(o.sym); if (why) return no('Order rejected', why); }
  { const w = marketWhy(o.sym); if (w) return closedReject(o.sym, w); }
  const m = M(o.sym), q = Engine.quote(o.sym), d = o.side === 'buy' ? 1 : -1, ref = d > 0 ? q.ask : q.bid, now = Engine.simTime;
  if (!(o.price > 0)) return no('Order rejected', 'Enter a valid price', false);
  const ok = o.ot === 'limit' ? (d > 0 ? o.price < ref : o.price > ref) : (d > 0 ? o.price > ref : o.price < ref);
  if (!ok) return no('Order rejected', `${o.side} ${o.ot} must be ${(o.ot === 'limit') === (d > 0) ? 'below' : 'above'} market`);
  // minimum pending distance (sheet minPend, points) from the side the order fills on
  if (Math.abs(o.price - ref) < m.p.minPend * m.point - 1e-12) return no('Order rejected', `Too close to the market: at least ${m.p.minPend} points (${fp(o.sym, m.p.minPend * m.point)}) from the ${d > 0 ? 'ask' : 'bid'}`);
  const lots = normLots(o.sym, o.lots);
  if (!(lots >= m.p.vol[0] - 1e-9)) return no('Order rejected', volWhy(o.sym, lots || 0), false);
  const cap = orderCaps(o.sym, lots);
  if (cap) return no('Order blocked', cap);
  if (S.orders.length >= MAX_WORKING) return no('Order rejected', `Too many working orders (${MAX_WORKING})`);
  let limit = null;
  if (o.limit != null) {
    if (o.ot !== 'stop') return no('Order rejected', 'Only a stop order can carry a limit price');
    if (!(o.limit > 0)) return no('Order rejected', 'Enter a valid limit price');
    if (d > 0 ? o.limit < o.price : o.limit > o.price) return no('Order rejected', `${d > 0 ? 'Buy' : 'Sell'} stop-limit: the limit must be at or ${d > 0 ? 'above' : 'below'} the stop price`);
    limit = +o.limit;
  }
  const tif = ['DAY', 'GTD'].includes(o.tif) ? o.tif : 'GTC';
  const expires = tif === 'DAY' ? dayEnd(now) : tif === 'GTD' ? (finite(o.expires) ? o.expires : null) : null;
  if (tif === 'GTD' && !(expires >= now + 60)) return no('Order rejected', 'Expiry must be at least one minute ahead');
  // a stop measured from the fill price must clear the spread, or the fill would be refused later
  if (o.slPips > 0 && o.slPips <= q.spread) return no('Order rejected', stopInSpreadWhy(o.sym, q.spread));
  if (!(o.slPips > 0) && o.trail > 0 && o.trail <= q.spread) return no('Order rejected', `Trailing stop must be wider than the spread (${q.spread.toFixed(1)} ${unitWord(o.sym)})`);
  const rows = Array.isArray(o.tps) && o.tps.length ? o.tps.map(x => ({ pips: +x.pips, pct: +x.pct })) : null;
  if (rows) { const b = buildTps(o.sym, o.side, o.price, lots, rows); if (b.err) return no('Order rejected', b.err); }
  const bs = beSpec(o.be, q.spread, o.sym); if (bs.err) return no('Order rejected', bs.err);
  let oca = null, peer = null;
  if (o.oca != null && o.oca !== '' && o.oca !== 0) {
    const m = typeof o.oca === 'string' ? /^o(\d+)$/.exec(o.oca) : null;
    peer = (m && S.orders.find(x => x.oca === o.oca)) || S.orders.find(x => x.id === (m ? +m[1] : +o.oca));
    if (!peer || peer.sym !== o.sym) return no('Order rejected', 'OCO group not found');
    oca = peer.oca || 'o' + peer.id;
  }
  if (isDuplicate('ord', o, lots)) { confirmDuplicate('ord', o, lots); return null; }
  markSent('ord', o, lots);
  const { dupOk, oca: _g, tps: _t, be: _b, exec: _e, ...rec } = o;
  const ord = { id: S.nextId++, ...rec, lots, limit, tif, expires, oca, status: 'pending', created: now };
  if (rows) { ord.tps = rows; ord.tpPips = Math.min(...rows.map(x => x.pips)); }
  if (bs.be) { const { done, ...b } = bs.be; ord.be = b; }
  if (peer && !peer.oca) peer.oca = oca;
  S.orders.push(ord);
  changed('ord');
  toast(`${o.side} ${ordType(ord)} placed`, `${lotsFmt(o.sym, lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)}${limit != null ? ' → limit ' + fp(o.sym, limit) : ''}${tif !== 'GTC' ? ' · ' + tifText(ord) : ''}${oca ? ` · OCO with #${peer.id}` : ''}`, 'info'); beep('fill');
  return ord;
}
function cancelOrder(id, why = 'Cancelled') { const o = S.orders.find(x => x.id === id); if (o) endOrder(o, 'cancelled', why); else changed('ord'); }
// OCO: the first entry of a group to fill (or a stop-limit to trigger) cancels the other entries of the group
function ocoCancel(o, what) {
  if (!o.oca) return;
  const sib = S.orders.filter(x => x !== o && x.oca === o.oca);
  for (const x of sib) endOrder(x, 'cancelled', `OCO: #${o.id} ${what}`);
  if (sib.length) toast(`OCO: ${sib.length > 1 ? sib.length + ' orders' : 'order #' + sib[0].id} cancelled`, `${o.side} ${ordType(o)} #${o.id} ${what}, so ${sib.map(x => `${x.side} ${ordType(x)} #${x.id}`).join(', ')} left the book.`, 'info');
}
function closeWhere(fn, reason = 'Manual') { [...S.positions].filter(fn).forEach(p => closePosition(p.id, reason)); }


/* Negative balance protection: the client cannot lose more than the account's funds. Whatever closed the last
   position (a stop-out, a gap through a stop loss or take profit, a manual close, Close all) leaves at most a zero
   balance: the negative part is covered and recorded in the history. It runs on every loop tick and before every
   save, so a negative flat account is never stored or exported. With positions still open the account is judged on
   equity by the stop-out, not here. */
function negativeBalanceProtection() {
  if (S.positions.length || !(S.balance < 0)) return false;
  const cover = -S.balance, h0 = S.history[0], sym = h0 ? h0.sym : S.set.sym, px = h0 ? h0.exit : Engine.mid(sym);
  S.balance = 0;
  S.history.unshift({ id: S.nextId++, sym, side: 'nbp', lots: 0, entry: px, exit: px, open: Engine.simTime, close: Engine.simTime, pnl: cover, pips: 0, r: null, reason: 'Negative balance protection', note: '', setup: '', swap: 0, nbp: true });
  if (S.history.length > 500) S.history.pop();
  changed('hist');
  toast('Negative balance protection', `${h0 ? h0.reason : 'The last close'} left the balance at ${usdFmt(-cover)}. ${usdFmt(cover)} covered; balance reset to ${usdFmt(0)}.`, 'info');
  return true;
}
function checkTriggers() {
  const now = Engine.simTime;
  // 1. DAY / GTD expiry (simulation UTC)
  const gone = S.orders.filter(o => o.expires != null && now >= o.expires);
  for (const o of gone) endOrder(o, 'expired', `${o.tif} expiry ${dts(o.expires)} UTC (simulation time)`);
  if (gone.length) toast(gone.length > 1 ? `${gone.length} orders expired` : 'Order expired', gone.map(o => `${o.side} ${ordType(o)} ${lotsFmt(o.sym, o.lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)}`).join(' · '), 'info');
  // 2. entries
  for (const o of [...S.orders]) {
    if (!S.orders.includes(o)) continue; // cancelled by an OCO sibling earlier in this tick
    if (!isAvailable(o.sym)) continue; // not offered under the profile: never fills (dropUnavailableOrders cancels it)
    const q = Engine.quote(o.sym), d = o.side === 'buy' ? 1 : -1;
    if (!q.open) continue; // closed: works again at the first quote of the next session
    const stopHit = d > 0 ? q.ask >= o.price : q.bid <= o.price;
    if (o.limit != null && o.status !== 'triggered') {
      if (!stopHit) continue;
      o.status = 'triggered'; o.trig = now; changed('ord');
      toast('Stop-limit triggered', `${o.side} ${lotsFmt(o.sym, o.lots)} ${pretty(o.sym)} #${o.id}: now working as a limit at ${fp(o.sym, o.limit)}.`, 'info');
      ocoCancel(o, 'triggered');
    }
    const lim = o.ot === 'limit' ? o.price : o.status === 'triggered' ? o.limit : null;
    if (!(lim != null ? (d > 0 ? q.ask <= lim : q.bid >= lim) : stopHit)) continue;
    const ex = execFill({ sym: o.sym, side: o.side, kind: lim != null ? 'limit' : 'stop', ref: lim ?? o.price, limit: lim });
    if (!ex.ok) continue; // the fill noise is beyond the limit: still working
    let p = null;
    try {
      p = openPosition({ sym: o.sym, side: o.side, lots: o.lots, slPips: o.slPips, tpPips: o.tps ? 0 : o.tpPips, tps: o.tps, be: o.be, trail: o.trail, pm: o.pm, auto: true,
        src: o.id, exec: ex, reason: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${ordType(o)} #${o.id}`, refKind: lim != null ? 'limit price' : 'stop price' });
    } catch (e) { console.error('[Meridian] order fill failed:', e); }
    // the order leaves the book either way; when the fill was refused (margin, stop inside the spread) say so explicitly
    endOrder(o, p ? 'filled' : 'rejected', p ? `filled: position #${p.id}` : lastReject || 'could not be filled');
    if (p) ocoCancel(o, 'filled');
    else toast('Pending order cancelled', `${o.side} ${o.ot} ${lotsFmt(o.sym, o.lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)} reached its price but could not be filled: ${lastReject || 'see the browser console'}.`, 'dn');
  }
  // 3. position protections: trailing, break-even, stop, targets
  for (const p of [...S.positions]) {
    if (!S.positions.includes(p)) continue;
    const q = Engine.quote(p.sym), m = M(p.sym), d = p.side === 'buy' ? 1 : -1, px = d > 0 ? q.bid : q.ask, out = d > 0 ? 'sell' : 'buy', held = drag?.ref === p;
    // closed: stops and targets wait; at the first quote of the session a stop fills there (gap marked), a target at
    // its price or better
    if (!q.open) continue;
    if (!held) syncTps(p);
    // a trail without a stop of its own is the stop (it follows from entry ∓ trail at once, as in the Exit lab); with
    // a stop you set, the trail starts once it can lock in the entry, then follows. It never loosens the stop.
    if (p.trail && !held) {
      const dist = p.trail * m.pip;
      if (p.trailNow && p.sl !== p.trailSl) delete p.trailNow; // you moved the stop: it is yours now (the trail resumes once it can lock in the entry)
      if (p.trailNow) { const n = trailNext(d, p.sl, px, dist); if (n !== p.sl) { p.sl = p.trailSl = n; p.trailed = true; } }
      else { const n = trailNext(d, null, px, dist); if (d * (n - p.entry) >= 0 && (p.sl == null || d * (n - p.sl) > 0)) { p.sl = n; p.trailed = true; } }
    }
    // the rule stays armed until it has moved the stop (a level still beyond the quote is retried on the next
    // sub-step), or until the stop already sits at or beyond the level (nothing left to move)
    const be = byTp => {
      const b = p.be; if (!b || b.done) return;
      if (byTp && b.onTp) b.tpHit = true;
      if (!b.tpHit && !(b.at != null && d * (px - p.entry) / m.pip >= b.at)) return;
      const lvl = p.entry + d * b.off * m.pip; // only ever tightens the stop
      if (p.sl != null && d * (lvl - p.sl) <= 0) { b.done = true; return; }
      if (d > 0 ? lvl < q.bid : lvl > q.ask) {
        b.done = true; p.sl = lvl; p.beSl = lvl; p.trailed = false; changed('pos');
        toast('Stop moved to break-even', `${pretty(p.sym)} #${p.id} · SL ${fp(p.sym, lvl)}`, 'info');
      }
    };
    if (!held) be(false);
    if (p.sl != null && (d > 0 ? q.bid <= p.sl : q.ask >= p.sl)) {
      closeVia(p.id, slWhy(p), 1, { exec: execFill({ sym: p.sym, side: out, kind: 'stop', ref: p.sl }), refKind: 'stop price', leg: 'SL' });
      continue;
    }
    if (p.tps) {
      let hit = false;
      while (S.positions.includes(p) && p.tps && p.tps.length) {
        const leg = p.tps[0];
        if (!(d > 0 ? q.bid >= leg.price : q.ask <= leg.price)) break;
        const ex = execFill({ sym: p.sym, side: out, kind: 'limit', ref: leg.price, limit: leg.price });
        if (!ex.ok) break;
        const frac = leg.lots >= p.lots ? 1 : leg.lots / p.lots;
        p.tps.shift(); if (!p.tps.length) delete p.tps; p.tp = p.tps ? p.tps[0].price : null;
        closeVia(p.id, tpWhy(p, ex, `Take profit ${leg.leg.slice(2)}`), frac, { exec: ex, refKind: 'take-profit limit', leg: leg.leg });
        hit = true;
      }
      if (hit && S.positions.includes(p)) be(true);
    } else if (p.tp != null && (d > 0 ? q.bid >= p.tp : q.ask <= p.tp)) {
      const ex = execFill({ sym: p.sym, side: out, kind: 'limit', ref: p.tp, limit: p.tp });
      if (ex.ok) closeVia(p.id, tpWhy(p, ex, 'Take profit'), 1, { exec: ex, refKind: 'take-profit limit', leg: 'TP1' });
    }
  }
  // stop-out under 50%: worst first, among the positions whose market is open (a closed one waits for its open)
  let a = account(), guard = 0;
  while (S.positions.length && a.level < 50 && guard++ < 50) {
    const live = S.positions.filter(p => M(p.sym) && marketOpen(p.sym)); if (!live.length) break;
    const worst = live.reduce((w, p) => posPnl(p).pnl < posPnl(w).pnl ? p : w);
    closeVia(worst.id, 'Stop-out', 1, { exec: execFill({ sym: worst.sym, side: worst.side === 'buy' ? 'sell' : 'buy', kind: 'market', dev: false }), refKind: 'quote at the stop-out' });
    if (S.positions.includes(worst)) break;
    a = account();
  }
  negativeBalanceProtection();
  // alerts fire on a crossing: from the side they started on (from) to the side of their condition, once. An alert
  // without a known start side (older states, an edited level) arms itself on the first check that finds it unmet.
  for (const al of S.alerts) {
    if (al.done) continue;
    const px = Engine.quote(al.sym).mid, other = al.cond === 'above' ? 'below' : 'above';
    if (!(al.cond === 'above' ? px >= al.price : px <= al.price)) { if (al.from !== other) al.from = other; continue; }
    if (al.from === other) {
      al.done = true; al.at = Engine.simTime; changed('al');
      toast(`Alert · ${pretty(al.sym)}`, `Crossed ${al.cond} ${fp(al.sym, al.price)} · now ${fp(al.sym, px)}`, 'info'); beep('alert');
    }
  }
}
/* Order-model fields of a state from outside (boot, import, reset), after sanitizeState(). loadState() calls it.
   Old states keep every level: positions with sl/tp/trail stay as they are, orders with slPips/tpPips/trail become
   GTC entries. A position that trailed without a stop (the old rule gave it none until price moved in its favour)
   gets its protective stop at entry ∓ trail, or trail behind the current price if that level is already crossed. */
function normalizeOrders(st = S) {
  const fin = v => typeof v === 'number' && isFinite(v), pxOk = v => fin(v) && v > 0, num = (v, a, b, def) => fin(v) && v >= a && v <= b ? v : def;
  const set = st.set;
  if (set.slip !== 'off' && set.slip !== 'sym') set.slip = EXEC_DEF.slip;
  set.slipSd = num(set.slipSd, 0, 5, EXEC_DEF.slipSd); set.latMs = num(set.latMs, 0, 2000, EXEC_DEF.latMs); set.comm = num(set.comm, 0, 50, EXEC_DEF.comm);
  const beOk = b => b && typeof b === 'object' && !Array.isArray(b) && (b.at == null || fin(b.at) && b.at > 0) && fin(+b.off || 0) && (b.at != null || b.onTp === true);
  const rowsOk = r => Array.isArray(r) && r.length >= 1 && r.length <= TP_MAX && r.every(x => x && fin(x.pips) && x.pips > 0 && fin(x.pct) && x.pct > 0 && x.pct <= 100) && r.reduce((s, x) => s + x.pct, 0) <= 100 + 1e-9;
  let migrated = 0;
  for (const p of st.positions) {
    const m = M(p.sym), d = p.side === 'buy' ? 1 : -1, q = Engine.quote(p.sym);
    p.comm = fin(p.comm) && p.comm >= 0 ? p.comm : 0;
    p.fills = Array.isArray(p.fills) ? p.fills.filter(Number.isInteger) : [];
    if (p.trailNow !== true || p.sl == null) { delete p.trailNow; delete p.trailSl; } else if (!fin(p.trailSl)) p.trailSl = p.sl;
    if (!fin(p.beSl)) delete p.beSl;
    if (Array.isArray(p.tps)) {
      const mn = m ? m.p.vol[0] : .01, rs = v => m ? normLots(p.sym, v) : r2(v);
      p.tps = p.tps.filter(x => x && pxOk(x.price) && fin(x.lots) && x.lots >= mn - 1e-9).slice(0, TP_MAX).map(x => ({ price: x.price, lots: rs(x.lots), leg: /^TP[1-4]$/.test(x.leg) ? x.leg : '' }))
        .sort((a, b) => d * (a.price - b.price));
      p.tps.forEach((x, i) => { if (!x.leg) x.leg = 'TP' + (i + 1); });
      if (p.tps.length) { p.tp = p.tps[0].price; trimTps(p); } else delete p.tps;
    } else delete p.tps;
    if (beOk(p.be)) p.be = { at: p.be.at ?? null, off: +p.be.off || 0, onTp: p.be.onTp === true, done: p.be.done === true, ...(p.be.tpHit === true && { tpHit: true }) }; else delete p.be;
    if (p.trail > 0 && p.sl == null) {
      const dist = p.trail * m.pip; let sl = trailNext(d, null, p.entry, dist);
      if (d > 0 ? sl >= q.bid : sl <= q.ask) sl = trailNext(d, null, d > 0 ? q.bid : q.ask, dist);
      p.sl = p.trailSl = sl; p.trailNow = true; migrated++;
    }
  }
  for (const o of st.orders) {
    o.limit = o.ot === 'stop' && pxOk(o.limit) && (o.side === 'buy' ? o.limit >= o.price : o.limit <= o.price) ? o.limit : null;
    o.tif = o.tif === 'DAY' || o.tif === 'GTD' ? o.tif : 'GTC';
    o.expires = o.tif !== 'GTC' && fin(o.expires) ? o.expires : null;
    if (o.expires == null) o.tif = 'GTC';
    o.oca = typeof o.oca === 'string' && /^o\d+$/.test(o.oca) ? o.oca : null;
    o.status = o.limit != null && o.status === 'triggered' ? 'triggered' : 'pending';
    if (rowsOk(o.tps)) o.tps = o.tps.map(x => ({ pips: x.pips, pct: x.pct })); else delete o.tps;
    if (beOk(o.be)) o.be = { at: o.be.at ?? null, off: +o.be.off || 0, onTp: o.be.onTp === true }; else delete o.be;
  }
  // a group with one member left is a plain order
  const n = {}; for (const o of st.orders) if (o.oca) n[o.oca] = (n[o.oca] || 0) + 1;
  for (const o of st.orders) if (o.oca && n[o.oca] < 2) o.oca = null;
  st.fills = Array.isArray(st.fills) ? st.fills.filter(f => f && typeof f === 'object' && Number.isInteger(f.fid) && f.fid > 0 && okSym(f.sym) && pxOk(f.px)).slice(0, FILL_MAX) : [];
  st.nextFill = Math.max(Number.isInteger(st.nextFill) ? st.nextFill : 1, 1 + st.fills.reduce((mx, f) => Math.max(mx, f.fid), 0));
  st.ordLog = Array.isArray(st.ordLog) ? st.ordLog.filter(x => x && typeof x === 'object' && okSym(x.sym)).slice(0, LOG_MAX) : [];
  if (typeof normTkx === 'function') st.tkx = normTkx(st.tkx);
  if (migrated) setTimeout(() => { try { toast('Trailing stops now protect at once', `${migrated} open position${migrated > 1 ? 's' : ''} had a trailing stop but no stop loss. ${migrated > 1 ? 'Each' : 'It'} now has its stop at the trail distance from entry (or from the current price), and the stop follows the price from there.`, 'info'); } catch (e) { console.error(e); } }, 0);
}
/* addAlert → the alert, or null when the price already meets its condition (it fires on a crossing, never at once). */
function addAlert(sym, price, cond) {
  const mid = Engine.quote(sym).mid;
  if (cond !== 'above' && cond !== 'below') cond = price >= mid ? 'above' : 'below';
  if (cond === 'above' ? mid >= price : mid <= price) {
    toast('Alert not set', `${pretty(sym)} is already ${cond} ${fp(sym, price)} (now ${fp(sym, mid)}). An alert fires when the price crosses its level.`, 'dn');
    return null;
  }
  const al = { id: S.nextId++, sym, price, cond, from: cond === 'above' ? 'below' : 'above', done: false };
  S.alerts.push(al);
  changed('al'); toast('Alert set', `${pretty(sym)} ${cond} ${fp(sym, price)}`, 'info');
  return al;
}
/* Every market sub-step (Engine.advance in the live market, every replay step) emits 'q': orders, stops, trailing,
   stop-out and alerts at that sub-step's quote (a replay also books its swap per step; the live loop books it once
   per tick, as before). The loop's own call after Engine.tick sees the last sub-step's quote again: nothing new. */
Engine.on('q', () => {
  if (!S) return; // before the state is loaded
  if (Engine.mode !== 'live') safe('swap', rolloverTick);
  if (S.orders.length || S.positions.length || S.alerts.some(a => !a.done)) safe('order and stop checks', checkTriggers);
});
